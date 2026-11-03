/**
 * Invite tracking core — who invited whom, and what happens when they register.
 *
 * Lifecycle of one `invites` row (one per invitee):
 *
 *   join ──► tracked ──(registers)──► counted         clean: inviter pinged + DMed
 *                                  ├► pending_review  flagged: staff decide on the admin tab
 *                                  └► claimable       no person to credit: /claim-invite for 5 days
 *                                        └► unattributed (window closed, no claim)
 *   staff can move any row anywhere (admin_locked = automation never overrides it)
 *
 * Attribution: Discord's own member-source data wins; the invite-count diff is the
 * backup. A disagreement between the two is flagged → staff, never auto-credited.
 *
 * Every function is non-throwing toward its caller (bot events, the register hook,
 * role sync) — failures go to Logger.error, which mirrors into higgenlogs.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { db, ensureInviteSchema, getSettings, getSetting, setSetting, intSetting, logEvent, getActiveCampaign } = require('./inviteSchema');
const memberSource = require('./memberSource');
const inviteCache = require('./inviteCache');
const notify = require('./inviteNotify');

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFY_DELAYS_MS = [45e3, 90e3, 180e3, 300e3, 600e3]; // index lag after a join

/** "Oct 29, 2026, 9:00 PM ET" — invite history is read by staff on the admin tab. */
function fmtET(d) {
    try {
        return `${new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`;
    } catch { return String(d); }
}

function snowflakeDate(id) {
    try { return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)); } catch { return null; }
}

// ── source resolution ─────────────────────────────────────────────────────────

async function loadCodeInfo(codes) {
    const list = [...new Set(codes.filter(Boolean))];
    const map = new Map();
    if (!list.length || !db()) return map;
    const { rows } = await pool.query(
        `SELECT code, is_general, is_vanity, inviter_is_bot, label, to_jsonb(invite_codes) ->> 'is_moderation' AS is_moderation
           FROM invite_codes WHERE code = ANY($1::text[])`,
        [list]
    );
    for (const r of rows) map.set(r.code, r);
    return map;
}

function isBotUser(client, id) {
    if (!id) return false;
    return !!client.users.cache.get(String(id))?.bot;
}

/**
 * Turn Discord's join data into { sourceType, inviterId }. Only a PERSON's
 * untagged invite produces an inviter; vanity / discovery / general-tagged / bot
 * invites are "unattributed" (claimable once they register).
 */
function resolveDiscord(client, rec, codeInfo) {
    const info = rec.code ? codeInfo.get(rec.code) : null;
    if (info?.is_moderation === 'true') return { sourceType: 'moderation', inviterId: null };
    if (rec.source === 'vanity' || info?.is_vanity) return { sourceType: 'vanity', inviterId: null };
    if (rec.code && rec.inviterId) {
        if (info?.is_general) return { sourceType: 'general', inviterId: null };
        if (info?.inviter_is_bot || isBotUser(client, rec.inviterId)) return { sourceType: 'bot_invite', inviterId: null };
        return { sourceType: 'invite', inviterId: rec.inviterId };
    }
    if (rec.code && info?.is_general) return { sourceType: 'general', inviterId: null };
    return { sourceType: rec.source === 'invite' ? 'unknown' : rec.source, inviterId: null };
}

function resolveDiff(client, diff, codeInfo) {
    if (!diff || diff.result !== 'match') return null;
    if (diff.vanity) return { sourceType: 'vanity', inviterId: null, code: diff.code };
    const info = codeInfo.get(diff.code);
    if (info?.is_moderation === 'true') return { sourceType: 'moderation', inviterId: null, code: diff.code };
    if (info?.is_general) return { sourceType: 'general', inviterId: null, code: diff.code };
    if (diff.inviterBot || info?.inviter_is_bot || isBotUser(client, diff.inviterId)) return { sourceType: 'bot_invite', inviterId: null, code: diff.code };
    return { sourceType: diff.inviterId ? 'invite' : 'unknown', inviterId: diff.inviterId || null, code: diff.code };
}

async function isInGuild(guild, id) {
    if (!guild || !id) return false;
    if (guild.members.cache.has(String(id))) return true;
    try { await guild.members.fetch(String(id)); return true; } catch { return false; }
}

async function getRow(id) {
    const { rows } = await pool.query('SELECT * FROM invites WHERE invitee_id = $1', [String(id)]);
    return rows[0] || null;
}

const withFlags = (flags, add = [], remove = []) => {
    const s = new Set(flags || []);
    for (const f of remove) s.delete(f);
    for (const f of add) s.add(f);
    return [...s];
};

// ── join / leave ──────────────────────────────────────────────────────────────

async function onMemberJoin(member) {
    if (member.user?.bot || !db()) return;
    if (!(await ensureInviteSchema())) return;
    const id = String(member.id);
    try {
        // Rejoiner evidence must be read BEFORE anything else upserts discord_members.
        const [existing, known] = await Promise.all([
            getRow(id),
            pool.query('SELECT 1 FROM discord_members WHERE discord_id = $1', [id]).then((r) => r.rowCount > 0).catch(() => false),
        ]);
        const diff = await inviteCache.diffOnJoin(member.guild);
        const joinedAt = member.joinedAt || new Date();
        const diffInviter = diff.result === 'match' ? (diff.inviterId || null) : null;
        const diffCode = diff.result === 'match' ? diff.code : null;

        if (existing) {
            // Rejoin. A registered row goes back through review (staff decide who gets
            // the credit) — unless staff locked it, or rejected it / closed it out.
            const reopen = !existing.admin_locked && ['counted', 'pending_review', 'claimable', 'tracked'].includes(existing.status);
            await pool.query(
                `UPDATE invites SET in_guild = TRUE, left_at = NULL, joined_at = $2, join_count = join_count + 1,
                        known_before = TRUE, diff_inviter_id = $3, diff_code = $4, diff_result = $5,
                        flags = $6, status = CASE WHEN $7 THEN 'tracked' ELSE status END,
                        review_posted_at = CASE WHEN $7 THEN NULL ELSE review_posted_at END,
                        verified_at = CASE WHEN admin_locked THEN verified_at ELSE NULL END,
                        updated_at = NOW()
                  WHERE invitee_id = $1`,
                [id, joinedAt, diffInviter, diffCode, diff.result, withFlags(existing.flags, ['rejoiner']), reopen]
            );
            await logEvent({ inviteeId: id, inviterId: existing.inviter_id, kind: 'rejoin', summary: `Rejoined the server (join #${(existing.join_count || 1) + 1}).` });
        } else {
            await pool.query(
                `INSERT INTO invites (invitee_id, joined_at, in_guild, account_created_at, pre_launch, known_before,
                                      diff_inviter_id, diff_code, diff_result, flags, status)
                 VALUES ($1, $2, TRUE, $3, FALSE, $4, $5, $6, $7, $8, 'tracked')
                 ON CONFLICT (invitee_id) DO NOTHING`,
                [id, joinedAt, snowflakeDate(id), known, diffInviter, diffCode, diff.result, known ? ['rejoiner'] : []]
            );
            const how = diff.result === 'match'
                ? (diff.vanity ? 'the vanity invite' : `invite \`${diff.code}\`${diffInviter ? ` (created by <@${diffInviter}>)` : ''}`)
                : diff.result === 'ambiguous' ? 'an invite the bot could not pin down' : 'no invite the bot could see';
            await logEvent({ inviteeId: id, inviterId: diffInviter, kind: 'join', summary: `Joined the server. Invite count check: ${how}. Waiting on Discord's join data.` });
        }
        scheduleVerify(member.client, id, 0);
    } catch (err) {
        Logger.error(`Invite tracking failed on join for ${id}`, err);
    }
}

async function onMemberLeave(member) {
    if (member?.user?.bot || !db()) return;
    try {
        await ensureInviteSchema();
        const { rows } = await pool.query(
            `UPDATE invites SET in_guild = FALSE, left_at = NOW(), updated_at = NOW()
              WHERE invitee_id = $1 AND in_guild RETURNING *`,
            [String(member.id)]
        );
        const row = rows[0];
        if (!row) return;
        await logEvent({ inviteeId: row.invitee_id, inviterId: row.inviter_id, kind: 'leave', summary: 'Left the server.' });
        if (row.status === 'counted' && row.inviter_id) await notify.sendLeft(member.client, row);
    } catch (err) {
        Logger.error(`Invite tracking failed on leave for ${member?.id}`, err);
    }
}

// ── verification against Discord's join data ──────────────────────────────────

function scheduleVerify(client, id, attempt) {
    const delay = VERIFY_DELAYS_MS[Math.min(attempt, VERIFY_DELAYS_MS.length - 1)];
    setTimeout(() => { verifyMember(client, id, attempt).catch((err) => Logger.error(`Invite verify crashed for ${id}`, err)); }, delay);
}

/**
 * Store Discord's join data on the row, compare it with the diff, and — if the
 * member is already registered — run the registration decision.
 * @param {object|null} rec  a memberSource record, or null to fall back to the diff
 */
async function applySource(client, row, rec) {
    const codeInfo = await loadCodeInfo([rec?.code, row.diff_code]);
    let sourceType;
    let inviterId;
    let flags = withFlags(row.flags, [], ['unverified', 'ambiguous', 'disagreement']);
    let via;

    if (rec) {
        ({ sourceType, inviterId } = resolveDiscord(client, rec, codeInfo));
        via = 'discord';
        if (row.diff_result === 'match') {
            const diff = resolveDiff(client, { result: 'match', code: row.diff_code, inviterId: row.diff_inviter_id, vanity: codeInfo.get(row.diff_code)?.is_vanity }, codeInfo);
            const sameCode = !rec.code || !row.diff_code || rec.code === row.diff_code;
            if (diff && (!sameCode || (diff.inviterId || null) !== (inviterId || null))) flags = withFlags(flags, ['disagreement']);
        }
    } else {
        const diff = resolveDiff(client, { result: row.diff_result, code: row.diff_code, inviterId: row.diff_inviter_id, vanity: codeInfo.get(row.diff_code)?.is_vanity }, codeInfo);
        sourceType = diff ? diff.sourceType : 'unknown';
        inviterId = diff ? diff.inviterId : null;
        via = 'diff';
        flags = withFlags(flags, row.diff_result === 'ambiguous' ? ['unverified', 'ambiguous'] : ['unverified']);
    }

    const locked = row.admin_locked;
    await pool.query(
        `UPDATE invites SET source_type = CASE WHEN $8 THEN source_type ELSE $2 END,
                invite_code = CASE WHEN $8 THEN invite_code ELSE $3 END,
                discord_inviter_id = $4,
                inviter_id = CASE WHEN $8 THEN inviter_id ELSE $5 END,
                verified_via = CASE WHEN $8 THEN verified_via ELSE $6 END, verified_at = NOW(),
                flags = CASE WHEN $8 THEN flags ELSE $7 END, updated_at = NOW()
          WHERE invitee_id = $1`,
        [row.invitee_id, sourceType, rec ? rec.code : row.diff_code, rec ? rec.inviterId : null, inviterId, via, flags, locked]
    );
    const what = inviterId
        ? `invited by <@${inviterId}>${rec?.code ? ` with invite \`${rec.code}\`` : ''}`
        : `joined through ${await notify.sourceLabel({ source_type: sourceType, invite_code: rec?.code || row.diff_code })}`;
    await logEvent({
        inviteeId: row.invitee_id,
        inviterId,
        kind: 'verified',
        summary: `${via === 'discord' ? "Discord's join data" : "The bot's invite count (Discord's data unavailable)"}: ${what}.${flags.includes('disagreement') ? ' This disagrees with the invite count, so it will go to staff.' : ''}${locked ? ' Staff locked this record, so the credit was left as staff set it.' : ''}`,
    });
}

async function verifyMember(client, id, attempt) {
    if (!db()) return;
    const guild = notify.getGuild(client);
    if (!guild) return;
    let rec = null;
    let broken = false;
    try {
        rec = await memberSource.lookup(client, guild.id, id);
    } catch {
        broken = true;
    }
    if (!rec && !broken && attempt + 1 < VERIFY_DELAYS_MS.length) {
        scheduleVerify(client, id, attempt + 1);
        return;
    }
    const row = await getRow(id);
    if (!row || !row.in_guild) return;
    await applySource(client, row, rec);
    const fresh = await getRow(id);
    if (fresh?.registered_at && fresh.status === 'tracked') await evaluateRegistration(client, id, { via: 'verify' });
}

// ── registration ──────────────────────────────────────────────────────────────

/** Create a row for a member we never saw join (e.g. joined while the bot was down). */
async function createFromDiscord(client, id) {
    const guild = notify.getGuild(client);
    if (!guild) return null;
    let rec = null;
    try { rec = await memberSource.lookup(client, guild.id, id); } catch { /* fall through */ }
    const launchedAt = await getSetting('launched_at');
    const joinedAt = rec?.joinedAt || guild.members.cache.get(String(id))?.joinedAt || new Date();
    const preLaunch = launchedAt ? joinedAt < new Date(launchedAt) : false;
    await pool.query(
        `INSERT INTO invites (invitee_id, joined_at, in_guild, account_created_at, pre_launch, flags, status, verified_at)
         VALUES ($1, $2, TRUE, $3, $4, $5, 'tracked', NULL)
         ON CONFLICT (invitee_id) DO NOTHING`,
        [String(id), joinedAt, snowflakeDate(id), preLaunch, rec ? [] : ['unverified']]
    );
    const row = await getRow(id);
    if (row) await applySource(client, row, rec);
    return getRow(id);
}

/**
 * The member registered (register hook, role-sync sweep, or a verify that
 * finished after they registered). Decides counted / review / claimable.
 * Idempotent: anything not in `tracked` is left alone.
 */
async function evaluateRegistration(client, inviteeId, { via = 'hook' } = {}) {
    if (!db()) return;
    if (!(await ensureInviteSchema())) return;
    const id = String(inviteeId);
    try {
        let row = await getRow(id);
        if (!row) row = await createFromDiscord(client, id);
        if (!row || row.status !== 'tracked') return;

        const firstDetection = !row.registered_at;
        if (firstDetection) {
            await pool.query(`UPDATE invites SET registered_at = NOW(), updated_at = NOW() WHERE invitee_id = $1 AND registered_at IS NULL`, [id]);
            await logEvent({
                inviteeId: id, inviterId: row.inviter_id, kind: 'register',
                summary: via === 'sweep' ? 'Found in the SalSheet (registered without the /register flow being seen).' : 'Registered with /register.',
            });
            row = await getRow(id);
        }
        // Discord's join data still loading → verifyMember calls back here when done.
        if (!row.verified_at) return;

        // Someone coming back through the moderation return invite isn't an invite
        // anyone earned, so it's closed quietly rather than offered as a claim.
        if (row.source_type === 'moderation') {
            await pool.query(`UPDATE invites SET status = 'unattributed', updated_at = NOW() WHERE invitee_id = $1 AND status = 'tracked'`, [id]);
            return;
        }

        const settings = await getSettings();
        const guild = notify.getGuild(client);
        const campaign = await getActiveCampaign();
        const flags = new Set(row.flags || []);
        if (via === 'sweep' && firstDetection) flags.add('sheet_only');
        // Account age at JOIN for people who joined during tracking (the alt-farming
        // case). For members already here at launch, age at REGISTRATION — joining
        // two years ago on a day-old account is not a fresh alt.
        const minAgeDays = intSetting(settings, 'min_account_age_days');
        const ageAt = row.pre_launch ? row.registered_at : row.joined_at;
        if (row.account_created_at && ageAt &&
            new Date(ageAt) - new Date(row.account_created_at) < minAgeDays * DAY_MS) flags.add('new_account');
        if (row.inviter_id && row.inviter_id === id) flags.add('self_invite');
        if (row.inviter_id && !(await isInGuild(guild, row.inviter_id))) flags.add('inviter_left');

        let status;
        let claimableUntil = null;
        if (row.admin_locked && row.inviter_id) status = 'counted';
        else if (!row.inviter_id) {
            status = 'claimable';
            claimableUntil = new Date(new Date(row.registered_at).getTime() + intSetting(settings, 'claim_window_days') * DAY_MS);
        } else if (flags.size) status = 'pending_review';
        else status = 'counted';

        const credited = row.admin_locked && row.credited_campaign_id ? row.credited_campaign_id : (campaign?.id || null);
        const upd = await pool.query(
            `UPDATE invites SET status = $2, flags = $3, credited_campaign_id = $4,
                    counted_at = CASE WHEN $2 = 'counted' THEN NOW() ELSE counted_at END,
                    claimable_until = COALESCE(claimable_until, $5), updated_at = NOW()
              WHERE invitee_id = $1 AND status = 'tracked' RETURNING *`,
            [id, status, [...flags], credited, claimableUntil]
        );
        if (!upd.rowCount) return; // someone else decided it in the meantime

        const flagText = notify.flagList([...flags]);
        if (status === 'counted') {
            await logEvent({ inviteeId: id, inviterId: row.inviter_id, kind: 'counted', summary: `Counted for <@${row.inviter_id}>${campaign ? ` in ${campaign.name}` : ''}.` });
            await notify.sendRegistered(client, id);
        } else if (status === 'pending_review') {
            await logEvent({ inviteeId: id, inviterId: row.inviter_id, kind: 'queued', summary: `Sent to staff review: ${flagText}.` });
            await notify.sendReviewNotice(client, id);
        } else {
            await logEvent({ inviteeId: id, kind: 'claimable', summary: `No inviter to credit — claimable with /claim-invite until ${fmtET(upd.rows[0].claimable_until)}.` });
            await notify.sendClaimable(client, id);
        }
        higgenLog.logInteraction({
            eventType: 'job',
            action: 'invites.registered',
            actor: { name: guild?.members.cache.get(id)?.displayName || `User ${id}`, id },
            what: status === 'counted'
                ? `registered and was counted as an invite for ${guild?.members.cache.get(row.inviter_id)?.displayName || row.inviter_id}`
                : status === 'pending_review'
                    ? 'registered, and their invite was sent to staff review'
                    : 'registered with no inviter to credit, so they are now claimable',
            target: row.inviter_id ? `inviter ${row.inviter_id}` : null,
            details: [
                ['Source', row.source_type],
                ['Invite code', row.invite_code || '—'],
                ['Flags', flagText || 'none'],
            ],
        });
    } catch (err) {
        Logger.error(`Invite registration handling failed for ${id}`, err);
    }
}

/** Called from the very end of /register (fire-and-forget). */
async function onRegistrationComplete(client, discordId) {
    require('../moderation/banEvasion').checkRegistration(client, discordId).catch(() => {});
    return evaluateRegistration(client, discordId, { via: 'hook' });
}

/** Role-sync backup: anyone tracked who is now in the SalSheet counts as registered. */
async function sweepRegistrations(client, sheetIdSet) {
    if (!db() || !sheetIdSet?.size) return;
    if (!(await ensureInviteSchema())) return;
    if (!(await getSetting('backfill_done_at'))) return; // backfill owns pre-launch rows until it finishes
    try {
        const { rows } = await pool.query(`SELECT invitee_id FROM invites WHERE status = 'tracked' AND registered_at IS NULL AND in_guild`);
        for (const r of rows) {
            if (sheetIdSet.has(String(r.invitee_id))) await evaluateRegistration(client, r.invitee_id, { via: 'sweep' });
        }
    } catch (err) {
        Logger.error('Invite registration sweep failed', err);
    }
}

// ── backfill + reconcile ──────────────────────────────────────────────────────

/**
 * ONE-TIME at launch: record every current member's join source. Registered
 * members invited by a person add to that person's LIFETIME count only — silently
 * (no queue, no posts). Not-yet-registered members are tracked and count to the
 * campaign + lifetime when they register.
 */
async function runBackfill(client) {
    if (!db() || (await getSetting('backfill_done_at'))) return false;
    const guild = notify.getGuild(client);
    if (!guild) return false;
    const { getSalSheetDiscordIds } = require('../utils/roleSync');
    const sheetIds = await getSalSheetDiscordIds();
    if (!sheetIds) {
        Logger.warning('Invite backfill postponed: the SalSheet could not be read.');
        return false;
    }
    await inviteCache.refresh(guild).catch((err) => Logger.warning(`Invite backfill: invite list fetch failed (${err.message})`));
    const recs = (await memberSource.scanAll(client, guild.id)).filter((r) => !r.isBot);
    const codeInfo = await loadCodeInfo(recs.map((r) => r.code));
    const now = new Date().toISOString();
    const rows = recs.map((rec) => {
        const { sourceType, inviterId } = resolveDiscord(client, rec, codeInfo);
        const credit = inviterId && inviterId !== rec.userId ? inviterId : null;
        const registered = sheetIds.has(rec.userId);
        return {
            invitee_id: rec.userId,
            joined_at: rec.joinedAt ? rec.joinedAt.toISOString() : null,
            account_created_at: snowflakeDate(rec.userId)?.toISOString() || null,
            source_type: sourceType,
            invite_code: rec.code,
            discord_inviter_id: rec.inviterId,
            inviter_id: credit,
            status: registered ? (credit ? 'counted' : 'unattributed') : 'tracked',
            registered_at: registered ? now : null,
            counted_at: registered && credit ? now : null,
            notified_at: registered && credit ? now : null,
        };
    });
    const res = await pool.query(
        `INSERT INTO invites (invitee_id, joined_at, in_guild, account_created_at, pre_launch, source_type, invite_code,
                              discord_inviter_id, inviter_id, verified_via, verified_at, status, registered_at, counted_at, notified_at)
         SELECT invitee_id, joined_at, TRUE, account_created_at, TRUE, source_type, invite_code,
                discord_inviter_id, inviter_id, 'discord', NOW(), status, registered_at, counted_at, notified_at
           FROM jsonb_to_recordset($1::jsonb) AS x(invitee_id TEXT, joined_at TIMESTAMPTZ, account_created_at TIMESTAMPTZ,
                source_type TEXT, invite_code TEXT, discord_inviter_id TEXT, inviter_id TEXT, status TEXT,
                registered_at TIMESTAMPTZ, counted_at TIMESTAMPTZ, notified_at TIMESTAMPTZ)
         ON CONFLICT (invitee_id) DO NOTHING
         RETURNING invitee_id, inviter_id, status`,
        [JSON.stringify(rows)]
    );
    await pool.query(
        `INSERT INTO invite_events (invitee_id, inviter_id, kind, summary)
         SELECT invitee_id, inviter_id, 'backfill',
                CASE WHEN status = 'counted' THEN 'Recorded at launch: already registered, added to the inviter''s lifetime count.'
                     WHEN status = 'unattributed' THEN 'Recorded at launch: already registered, no person to credit.'
                     ELSE 'Recorded at launch: in the server, not registered yet.' END
           FROM jsonb_to_recordset($1::jsonb) AS x(invitee_id TEXT, inviter_id TEXT, status TEXT)`,
        [JSON.stringify(res.rows)]
    );
    if (!(await getSetting('launched_at'))) await setSetting('launched_at', now);
    await setSetting('backfill_done_at', now);
    const counted = res.rows.filter((r) => r.status === 'counted').length;
    Logger.success(`Invite backfill: ${res.rowCount} member(s) recorded, ${counted} pre-launch invite(s) added to lifetime counts.`);
    higgenLog.logInteraction({
        eventType: 'job',
        action: 'invites.backfill',
        actor: { name: 'Beluga Bot', id: null },
        what: `recorded how every current member joined (${res.rowCount} members) and added ${counted} already-registered invites to lifetime counts`,
        details: [['Members recorded', String(res.rowCount)], ['Lifetime invites added', String(counted)]],
    });
    return true;
}

/**
 * Every 30 min (and on startup): catch whatever live tracking missed — joins and
 * leaves during downtime, rows whose Discord data never loaded, pending items that
 * were only waiting on that data. Staff-locked rows are never touched.
 */
let reconciling = false;
async function reconcile(client) {
    if (reconciling || !db()) return;
    reconciling = true;
    try {
        if (!(await ensureInviteSchema())) return;
        if (!(await getSetting('backfill_done_at'))) { await runBackfill(client); return; }
        const guild = notify.getGuild(client);
        if (!guild) return;
        await inviteCache.refresh(guild).catch(() => {});
        let recs;
        try { recs = (await memberSource.scanAll(client, guild.id)).filter((r) => !r.isBot); } catch { return; }
        const recMap = new Map(recs.map((r) => [r.userId, r]));
        const { rows } = await pool.query(`SELECT * FROM invites`);
        const rowMap = new Map(rows.map((r) => [String(r.invitee_id), r]));

        for (const rec of recs) {
            const row = rowMap.get(rec.userId);
            if (!row) {
                await createFromDiscord(client, rec.userId);
                await logEvent({ inviteeId: rec.userId, kind: 'join', summary: 'Joined while the bot was offline — picked up by the reconcile sweep.' });
            } else if (!row.in_guild) {
                const member = guild.members.cache.get(rec.userId) || await guild.members.fetch(rec.userId).catch(() => null);
                if (member) await onMemberJoin(member); // rejoined while offline
            } else if (!row.admin_locked && (!row.verified_at || row.verified_via === 'diff')) {
                await applySource(client, row, rec);
                // Items that were only waiting on Discord's data get decided again.
                const fresh = await getRow(rec.userId);
                if (['pending_review', 'claimable'].includes(fresh.status) && !fresh.decided_at) {
                    await pool.query(`UPDATE invites SET status = 'tracked' WHERE invitee_id = $1 AND status = $2`, [rec.userId, fresh.status]);
                }
                if (fresh.registered_at) await evaluateRegistration(client, rec.userId, { via: 'reconcile' });
            }
        }
        for (const row of rows) {
            if (row.in_guild && !recMap.has(String(row.invitee_id))) {
                await onMemberLeave({ id: row.invitee_id, client, user: null });
            }
        }
        await setSetting('last_reconcile_at', new Date().toISOString());
    } catch (err) {
        Logger.error('Invite reconcile sweep failed', err);
    } finally {
        reconciling = false;
    }
}

/** Claim windows that closed with no pending claim → unattributed. */
async function expireClaimWindows() {
    if (!db()) return;
    try {
        const { rows } = await pool.query(
            `UPDATE invites i SET status = 'unattributed', updated_at = NOW()
              WHERE i.status = 'claimable' AND i.claimable_until < NOW()
                AND NOT EXISTS (SELECT 1 FROM invite_claims c WHERE c.invitee_id = i.invitee_id AND c.status = 'pending')
              RETURNING invitee_id`
        );
        for (const r of rows) await logEvent({ inviteeId: r.invitee_id, kind: 'claim_window', summary: 'Claim window closed with no claim — left unattributed (staff can still assign an inviter).' });
    } catch (err) {
        Logger.error('Invite claim-window expiry failed', err);
    }
}

// ── /claim-invite ─────────────────────────────────────────────────────────────

/** @returns {Promise<{ ok: boolean, message: string }>} */
async function fileClaim(client, claimerId, target) {
    if (!db() || !(await ensureInviteSchema())) return { ok: false, message: 'Invite tracking is unavailable right now.' };
    const guild = notify.getGuild(client);
    const targetId = String(target.id);
    if (target.bot) return { ok: false, message: 'Bots cannot be claimed.' };
    if (targetId === String(claimerId)) return { ok: false, message: 'You cannot claim yourself.' };
    if (!(await isInGuild(guild, targetId))) return { ok: false, message: 'That member is not in the server.' };

    const pending = await pool.query(`SELECT invitee_id FROM invite_claims WHERE claimer_id = $1 AND status = 'pending'`, [String(claimerId)]);
    if (pending.rowCount) return { ok: false, message: `You already have a claim waiting on staff (<@${pending.rows[0].invitee_id}>). You can file another once it is decided.` };

    let row = await getRow(targetId);
    if (!row) row = await createFromDiscord(client, targetId);
    if (!row) return { ok: false, message: 'The bot has no join record for that member yet. Try again in a few minutes.' };

    const settings = await getSettings();
    const windowMs = intSetting(settings, 'claim_window_days') * DAY_MS;
    if (row.inviter_id && row.status !== 'claimable') {
        return { ok: false, message: row.inviter_id === String(claimerId) ? 'They are already recorded as invited by you.' : 'They are already recorded as invited by someone else. If that is wrong, open a ticket so staff can check.' };
    }
    if (row.status === 'tracked') {
        if (!row.verified_at) return { ok: false, message: 'Their join is still being checked. Try again in a few minutes.' };
        if (!row.joined_at || Date.now() - new Date(row.joined_at).getTime() > windowMs) {
            return { ok: false, message: 'They joined too long ago to claim before registering. They can be claimed for a few days after they register.' };
        }
    } else if (row.status === 'claimable') {
        if (row.claimable_until && new Date(row.claimable_until) < new Date()) return { ok: false, message: 'The claim window for that member has closed. Ask staff if you invited them.' };
    } else {
        return { ok: false, message: 'That member cannot be claimed. Ask staff if you invited them.' };
    }

    try {
        await pool.query(`INSERT INTO invite_claims (invitee_id, claimer_id) VALUES ($1, $2)`, [targetId, String(claimerId)]);
    } catch (err) {
        if (err.code === '23505') return { ok: false, message: 'You already have a claim waiting on staff.' };
        throw err;
    }
    await logEvent({ inviteeId: targetId, inviterId: String(claimerId), kind: 'claim', summary: `<@${claimerId}> claimed they invited this member.`, actorId: String(claimerId) });
    await notify.sendClaimNotice(client, claimerId, targetId);
    const held = row.status === 'tracked';
    return {
        ok: true,
        message: `Claim filed for <@${targetId}>. Staff will review it${held ? ', and it will count once they register' : ''}.`,
    };
}

module.exports = {
    onMemberJoin,
    onMemberLeave,
    onRegistrationComplete,
    evaluateRegistration,
    sweepRegistrations,
    runBackfill,
    reconcile,
    expireClaimWindows,
    fileClaim,
    snowflakeDate,
    resolveDiscord,
};
