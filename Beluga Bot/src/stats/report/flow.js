/**
 * Report flow orchestrator (state machine).
 *
 * States (stats_report_sessions.state):
 *   await_group  -> (modal) parse group, assign sides, build slots
 *   assign_sides -> only if sides can't be auto-detected
 *   matching     -> each side matches its players + submits
 *   await_confirm-> both sides confirm (or salary crew finalizes)
 *   confirmed / cancelled (terminal)
 *
 * Discord safety: every handler acknowledges within 3s (reply / deferUpdate),
 * heavy work (Ballchasing parse, DB commit) happens after a defer, panels are
 * normal channel messages with persistent customIds, and unauthorized clicks
 * get an ephemeral "not for you".
 */

const {
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, AttachmentBuilder,
} = require('discord.js');

const ids = require('./ids');
const { buildResultCard } = require('./resultCard');
const sessions = require('./sessionStore');
const tc = require('./threadContext');
const matching = require('./matching');
const panel = require('./panel');
const { logEdge } = require('./logChannel');
const { buildSalaryResolver, checkSeriesCaps } = require('./salaryCap');
const { DIVISION_RESULT_CHANNELS, VAL_SKIP, VAL_SEARCH } = require('./constants');
const { siteUrl } = require('../../utils/siteFooter');
const higgenLog = require('../../utils/higgenLog');
const { parseSeries } = require('../seriesParser');
const bcClient = require('../ballchasingClient');
const statsStore = require('../statsStore');
const { pool, isDatabaseAvailable } = require('../../utils/database');
const Logger = require('../../utils/logger');

const EPHEMERAL = 64;
const sideCode = (s) => (s === 'home' ? 'h' : 'a');
const sideFromCode = (c) => (c === 'h' ? 'home' : 'away');

function db() { return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable; }

// ---- small helpers ----------------------------------------------------------

async function safeReply(interaction, content) {
    try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
        else await interaction.reply({ content, flags: EPHEMERAL });
    } catch (e) {
        if (e?.code !== 10062 && e?.code !== 40060) Logger.error('safeReply failed', e);
    }
}

function bag(session) { return session.message_ids || {}; }

function getMatches(session, side) {
    const m = side === 'home' ? session.home_matches : session.away_matches;
    return m || { slots: [], submitted: false, confirmed: false, page: 0 };
}

async function getRecentSubCandidates(seasonId, teamId) {
    if (!db() || !teamId) return [];
    try {
        const r = await pool.query(
            `SELECT DISTINCT ON (discord_id) discord_id, display_name, discord_username
             FROM transactions
             WHERE team_id = $1 AND type IN ('sign','esub','adminsign','nonplayingsign','trade_in')
             ORDER BY discord_id, performed_at DESC
             LIMIT 20`,
            [teamId]
        );
        return r.rows.map((x) => ({
            discordId: x.discord_id,
            displayName: x.display_name || x.discord_username || `User ${String(x.discord_id).slice(-4)}`,
        }));
    } catch (err) {
        Logger.error('getRecentSubCandidates failed', err);
        return [];
    }
}

function initSlots(parsedTeam) {
    return (parsedTeam.players || []).map((p, i) => ({
        index: i, pkey: p.pkey, name: (p.names && p.names[0]) || null,
        platform: p.platform, platformId: p.platformId,
        discordId: null, mode: 'select', skipped: false, subDisplay: null,
    }));
}

// autoSuggest() and assignSides() now live in ./sideMatch so the website's manual
// report importer uses the SAME matching logic (see stats/seriesIngest.js).
const { autoSuggest, assignSides } = require('./sideMatch');

// ---- rendering --------------------------------------------------------------

async function renderSide(session, side) {
    const teamId = side === 'home' ? session.home_team_id : session.away_team_id;
    const b = bag(session);
    const teamName = side === 'home' ? (b.homeName || 'Home') : (b.awayName || 'Away');
    const [roster, subCandidates] = await Promise.all([
        tc.getTeamRoster(session.season_id, teamId),
        getRecentSubCandidates(session.season_id, teamId),
    ]);
    const m = getMatches(session, side);
    return matching.buildSideMessage({
        sessionId: session.id, side, teamName, slots: m.slots, roster, subCandidates,
        submitted: m.submitted, page: m.page || 0,
    });
}

async function editStored(client, channelId, messageId, payload) {
    if (!channelId || !messageId) return;
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) await msg.edit(payload);
    } catch (err) {
        Logger.error('editStored failed', err);
    }
}

async function pingTeamLeaders(channel, seasonId, teamId, text) {
    try {
        const r = await pool.query(
            `SELECT discord_id FROM team_roster_members
             WHERE season_id = $1 AND team_id = $2 AND role IN ('captain','gm') AND is_active = TRUE`,
            [seasonId, teamId]
        );
        const mentions = r.rows.map((x) => `<@${x.discord_id}>`).join(' ');
        await channel.send({ content: `${mentions} ${text}`.trim() });
    } catch (err) {
        Logger.error('pingTeamLeaders failed', err);
    }
}

// ---- entry: start + group modal --------------------------------------------

function buildGroupModal(...extraParts) {
    return new ModalBuilder()
        .setCustomId(ids.build('group', ...extraParts))
        .setTitle('Report Series')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('group_url')
                    .setLabel('Ballchasing replay GROUP link')
                    .setPlaceholder('https://ballchasing.com/group/...')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(300)
            )
        );
}

/**
 * Staff-only variant of the report modal: the group link is OPTIONAL and a game
 * scores box is offered instead. A series whose replay group was never made still
 * has to be recordable, and salary crew are the ones who record it.
 *
 * Captains keep the strict modal above — they must always supply a group.
 */
function buildStaffGroupModal(...extraParts) {
    return new ModalBuilder()
        .setCustomId(ids.build('group', ...extraParts))
        .setTitle('Staff Report Series')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('group_url')
                    .setLabel('Ballchasing GROUP link (optional)')
                    .setPlaceholder('https://ballchasing.com/group/...')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(300)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('scores')
                    .setLabel('No group? Game scores, one per line')
                    .setPlaceholder('3-1\n2-3\n4-2')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(200)
            )
        );
}

/**
 * Parse the staff "game scores" box: one game per line, "3-1" / "3 - 1" / "3:1".
 * @returns {{games:Array<{homeGoals:number,awayGoals:number}>}|{error:string}}
 */
function parseManualScores(raw) {
    const lines = String(raw || '').split(/[\r\n,]+/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { error: 'No game scores were given.' };
    if (lines.length > 7) return { error: `That's ${lines.length} games — a series can have at most 7.` };

    const games = [];
    for (const line of lines) {
        const m = line.match(/^(\d{1,2})\s*[-–:]\s*(\d{1,2})$/);
        if (!m) return { error: `"${line}" isn't a game score. Use one line per game, like \`3-1\`.` };
        const homeGoals = Number(m[1]);
        const awayGoals = Number(m[2]);
        if (homeGoals === awayGoals) return { error: `Game ${games.length + 1} (${line}) is a tie — a Rocket League game always has a winner.` };
        games.push({ homeGoals, awayGoals });
    }
    return { games };
}

/**
 * Has this matchup already been reported (any source: thread report, staff
 * report, or /report-ff)? Matched by season+division+week+the two teams in
 * either order — schedule_match_id alone misses FF/staff entries.
 * @returns {Promise<null | {id:number, label:string}>}
 */
async function findExistingSeries(ctx) {
    if (!db()) return null;
    try {
        const r = await pool.query(
            `SELECT s.id, s.home_score, s.away_score, s.is_forfeit,
                ht.name AS home_name, at.name AS away_name
             FROM stats_series s
             LEFT JOIN teams ht ON ht.id = s.home_team_id
             LEFT JOIN teams at ON at.id = s.away_team_id
             WHERE s.season_id = $1 AND s.division = $2 AND s.status = 'confirmed'
               AND s.week IS NOT DISTINCT FROM $3
               AND ((s.home_team_id = $4 AND s.away_team_id = $5) OR (s.home_team_id = $5 AND s.away_team_id = $4))
             ORDER BY s.id DESC LIMIT 1`,
            [ctx.seasonId, ctx.division, ctx.week ?? null, ctx.homeTeam.id, ctx.awayTeam.id]
        );
        if (!r.rows.length) return null;
        const s = r.rows[0];
        return {
            id: s.id,
            label: `**${s.home_name} ${s.home_score}–${s.away_score} ${s.away_name}**${s.is_forfeit ? ' (FF)' : ''}`,
        };
    } catch (err) {
        Logger.error('findExistingSeries failed', err);
        return null;
    }
}

/** Shared entry for the panel button and /report command. Must finish within 3s → show modal. */
async function startReport(interaction) {
    const threadId = interaction.channelId;
    const ctx = await tc.resolveThreadContext(threadId);
    if (!ctx) {
        return safeReply(interaction, '❌ This isn\'t a recognized week-thread matchup. If that\'s wrong, ping salary crew.');
    }
    const isSC = tc.isSalaryCrew(interaction.member);
    let authed = null;
    if (!isSC) {
        authed = await tc.getUserAuthorizedTeam(interaction.member, ctx.seasonId, ctx.homeTeam, ctx.awayTeam, ctx.division);
        if (!authed) return safeReply(interaction, '❌ Only a **captain/GM** of one of these franchises (or **salary crew**) can report this series.');
        if (ctx.isClosed) return safeReply(interaction, '❌ This week is closed — only salary crew can report it now.');
    }
    const active = await sessions.getActiveSessionByThread(threadId);
    if (active) return safeReply(interaction, 'ℹ️ A report is **already in progress** for this matchup. Finish or cancel it first.');

    // Already recorded (including via /report-ff or /staff-report) → locked.
    const existing = await findExistingSeries(ctx);
    if (existing) {
        return safeReply(interaction, `🔒 This matchup is **already reported**: ${existing.label} (series #${existing.id}).\nContact **salary crew** if it needs to be changed.`);
    }

    await interaction.showModal(buildGroupModal());
    return null;
}

/**
 * Staff "missed week" entry (salary crew, any channel): the command has already
 * validated the teams; encode the matchup into the modal customId so the modal
 * submit can rebuild the context without a week thread.
 */
async function startStaffReport(interaction, { seasonId, homeTeamId, awayTeamId, week, isPlayoff }) {
    if (!tc.isSalaryCrew(interaction.member)) {
        return safeReply(interaction, '❌ Only salary crew can use the staff report.');
    }
    if (await sessions.getActiveSessionByThread(interaction.channelId)) {
        return safeReply(interaction, 'ℹ️ A report is already in progress in this channel. Finish or cancel it first.');
    }
    await interaction.showModal(buildStaffGroupModal('staff', seasonId, homeTeamId, awayTeamId, week || 0, isPlayoff ? 1 : 0));
    return null;
}

/**
 * Build a matchup context for the staff "missed week" path from the values the
 * staff command encoded into the modal customId (no week thread required).
 */
async function buildStaffContext(parts) {
    const [seasonId, homeTeamId, awayTeamId, weekRaw, poRaw] = parts.map((p) => Number(p));
    const teams = await pool.query(
        `SELECT id, name, division FROM teams WHERE id IN ($1, $2)`,
        [homeTeamId, awayTeamId]
    );
    const home = teams.rows.find((t) => t.id === homeTeamId);
    const away = teams.rows.find((t) => t.id === awayTeamId);
    if (!home || !away) return null;
    const week = weekRaw > 0 ? weekRaw : null;
    const isPlayoff = poRaw === 1;

    let scheduleMatchId = null;
    if (week != null) {
        const sm = await pool.query(
            `SELECT id FROM schedule_matches
             WHERE season_id = $1 AND division = $2 AND week = $3
               AND ((home_team_id = $4 AND away_team_id = $5) OR (home_team_id = $5 AND away_team_id = $4))
             LIMIT 1`,
            [seasonId, home.division, week, homeTeamId, awayTeamId]
        ).catch(() => ({ rows: [] }));
        scheduleMatchId = sm.rows[0]?.id || null;
    }

    return {
        seasonId, division: home.division, week, isPlayoff,
        format: isPlayoff ? 'bo7' : 'bo5',
        homeTeam: { id: home.id, name: home.name },
        awayTeam: { id: away.id, name: away.name },
        scheduleMatchId, isClosed: false,
    };
}

/** Modal submit: parse the group, assign sides, create the session, post matching panels. */
async function handleGroupModal(interaction, parts = []) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const threadId = interaction.channelId;
    const channel = interaction.channel;

    const isStaffPath = parts[0] === 'staff';
    let ctx;
    let isSC = tc.isSalaryCrew(interaction.member);
    let authed = null;

    if (isStaffPath) {
        // Missed-week staff flow: salary crew only, works in any channel.
        if (!isSC) return safeReply(interaction, '❌ Only salary crew can use the staff report.');
        ctx = await buildStaffContext(parts.slice(1));
        if (!ctx) return safeReply(interaction, '❌ Could not resolve those teams anymore.');
    } else {
        ctx = await tc.resolveThreadContext(threadId);
        if (!ctx) return safeReply(interaction, '❌ This thread is no longer a recognized matchup.');
        if (!isSC) {
            authed = await tc.getUserAuthorizedTeam(interaction.member, ctx.seasonId, ctx.homeTeam, ctx.awayTeam, ctx.division);
            if (!authed) return safeReply(interaction, '❌ You\'re not a captain/GM of these teams.');
            if (ctx.isClosed) return safeReply(interaction, '❌ This week is closed — salary crew only.');
        }
    }
    if (await sessions.getActiveSessionByThread(threadId)) {
        return safeReply(interaction, 'ℹ️ A report is already in progress here.');
    }
    const existing = await findExistingSeries(ctx);
    if (existing) {
        return safeReply(interaction, `🔒 This matchup is **already reported**: ${existing.label} (series #${existing.id}).\nStaff can edit or delete it from the website admin panel.`);
    }

    const groupUrl = String(interaction.fields.getTextInputValue('group_url') || '').trim();

    // Staff-only escape hatch: no group link, just the game scores. This records a
    // scores-only series — right series/game/goal differential, no player stats —
    // for a series whose replay group was never made. Player stats can be added
    // afterwards from the website admin panel.
    if (isStaffPath && !groupUrl) {
        const rawScores = String(interaction.fields.getTextInputValue('scores') || '').trim();
        if (!rawScores) {
            return safeReply(interaction,
                '❌ Give either a **Ballchasing group link** or the **game scores** (one per line, e.g. `3-1`).\n'
                + 'For full control — per-game replay links, player stat lines, forfeits — report it on the website: **Admin → Match Results → Report a series**.');
        }
        const manual = parseManualScores(rawScores);
        if (manual.error) return safeReply(interaction, `❌ ${manual.error}`);

        try {
            const result = await statsStore.commitSeries({
                seasonId: ctx.seasonId, division: ctx.division, week: ctx.week, isPlayoff: ctx.isPlayoff,
                format: ctx.format, homeTeamId: ctx.homeTeam.id, awayTeamId: ctx.awayTeam.id,
                scheduleMatchId: ctx.scheduleMatchId, threadId: isStaffPath ? null : threadId,
                group: {}, reportedByDiscordId: interaction.user.id, reportedVia: 'salary_crew_manual',
                games: manual.games.map((g, i) => ({ gameNumber: i + 1, ...g, players: [] })),
            });
            await postManualResult(interaction.client, ctx, result, manual.games);
            return safeReply(interaction,
                `✅ Recorded **${ctx.homeTeam.name} ${result.homeScore}–${result.awayScore} ${ctx.awayTeam.name}** `
                + `(${ctx.division}${ctx.week ? `, Week ${ctx.week}` : ''}) from the scores you gave. Series #${result.seriesId}.\n`
                + '-# No player stats — add them on the website (Admin → Match Results), or attach a replay group there and import.');
        } catch (err) {
            // Handled here, so the router never sees it — tell the audit log directly
            // or this failure would be recorded as a successful report.
            higgenLog.markSubRouterOutcome(interaction, {
                outcome: 'failed',
                note: 'A staff scores-only report could not be saved.',
                error: err,
            });
            Logger.error('manual staff report failed', err);
            await logEdge(interaction.client, { summary: `Manual staff report failed in ${ctx.division}.`, error: err, thread: channel, division: ctx.division });
            return safeReply(interaction, `❌ Could not record that series: ${err.message}`);
        }
    }

    if (!bcClient.isGroupUrl(groupUrl)) {
        await logEdge(interaction.client, {
            summary: `Invalid report input (not a Ballchasing group link) by ${interaction.user.tag} in ${ctx.division}.`,
            detail: `Provided: ${groupUrl}`, thread: channel, division: ctx.division, groupUrl,
        });
        return safeReply(interaction,
            '❌ That isn\'t a Ballchasing **group** link. Only a replay group URL is accepted here.'
            + (isStaffPath
                ? '\nIf this series has no group, leave the link blank and fill in the **game scores** box instead.'
                : ' Salary crew has been notified.'));
    }

    let parsed;
    try {
        parsed = await parseSeries({ groupUrl, format: ctx.format });
    } catch (err) {
        await logEdge(interaction.client, { summary: `Ballchasing parse threw for ${ctx.division}.`, error: err, thread: channel, division: ctx.division, groupUrl });
        return safeReply(interaction, '❌ Something went wrong reading that group. Salary crew has been notified.');
    }

    if (parsed.fatal || !parsed.ok || !parsed.complete) {
        // !complete with no reject = extra games beyond a clean Bo5/Bo7 (the
        // TOO_MANY_GAMES warn). No cherry-picking allowed (operator B3), so the
        // group must be fixed or handled by salary crew.
        const reject = (parsed.issues || []).find((i) => i.severity === 'reject')
            || (parsed.issues || []).find((i) => i.code === 'TOO_MANY_GAMES');
        const reason = reject ? reject.message : 'The series could not be validated.';
        await logEdge(interaction.client, {
            summary: `Report rejected (${reject?.code || 'unknown'}) in ${ctx.division}: ${reason}`,
            detail: (parsed.issues || []).map((i) => `[${i.severity}] ${i.code}: ${i.message}`).join('\n'),
            thread: channel, division: ctx.division, groupUrl,
        });
        return safeReply(interaction, `❌ ${reason}\nSalary crew has been notified to take a look.`);
    }

    // Sides + slots.
    const homeRoster = await tc.getTeamRoster(ctx.seasonId, ctx.homeTeam.id);
    const awayRoster = await tc.getTeamRoster(ctx.seasonId, ctx.awayTeam.id);
    const assign = await assignSides(parsed, homeRoster, awayRoster);

    const homeTeamParsed = parsed.teams[assign.homeIdx];
    const awayTeamParsed = parsed.teams[assign.homeIdx === 0 ? 1 : 0];
    const homeSlots = await autoSuggest(initSlots(homeTeamParsed), homeRoster);
    const awaySlots = await autoSuggest(initSlots(awayTeamParsed), awayRoster);

    const session = await sessions.createSession({
        threadId, channelId: channel.id, division: ctx.division, seasonId: ctx.seasonId,
        week: ctx.week, isPlayoff: ctx.isPlayoff, format: ctx.format,
        homeTeamId: ctx.homeTeam.id, awayTeamId: ctx.awayTeam.id, scheduleMatchId: ctx.scheduleMatchId,
        groupUrl, parsed,
        homeMatches: { slots: homeSlots, submitted: false, confirmed: false, page: 0 },
        awayMatches: { slots: awaySlots, submitted: false, confirmed: false, page: 0 },
        // The reporter always confirms which cluster is which team — a wrong
        // auto-guess here used to flip every score and logo downstream.
        state: 'assign_sides',
        startedByDiscordId: interaction.user.id,
        messageIds: { homeName: ctx.homeTeam.name, awayName: ctx.awayTeam.name, homeIdx: assign.homeIdx },
    });

    // Remove the "Report Series" panel while this report is in progress.
    await panel.hidePanel(interaction.client, threadId);

    const msg = await channel.send(matching.buildAssignMessage({
        sessionId: session.id, parsed, homeName: ctx.homeTeam.name, awayName: ctx.awayTeam.name,
        suggestedIdx: assign.homeIdx, confident: assign.confident,
    }));
    await sessions.updateSession(session.id, { messageIds: { ...bag(session), assignMsgId: msg.id } });
    return safeReply(interaction, '✅ Report started. First, confirm which group is which team in the panel above.');
}

// ---- guards -----------------------------------------------------------------

/** @returns {Promise<{ok:boolean, isSC:boolean, authed:('home'|'away'|null)}>} */
async function authorize(interaction, session, side, { allowAnySide = false } = {}) {
    const isSC = tc.isSalaryCrew(interaction.member);
    if (isSC) return { ok: true, isSC: true, authed: null };
    // A disputed report is frozen for captains — only salary crew can act.
    if (session.state === 'disputed') {
        await safeReply(interaction, '⚠️ This report is **disputed** — only salary crew can act on it now.');
        return { ok: false, isSC: false, authed: null };
    }
    const b = bag(session);
    const authed = await tc.getUserAuthorizedTeam(
        interaction.member, session.season_id,
        { id: session.home_team_id, name: b.homeName }, { id: session.away_team_id, name: b.awayName },
        session.division
    );
    const ok = allowAnySide ? Boolean(authed) : authed === side;
    if (!ok) {
        await safeReply(interaction, '❌ This panel isn\'t for you.');
        return { ok: false, isSC: false, authed };
    }
    return { ok: true, isSC: false, authed };
}

async function loadActive(interaction, sessionId) {
    const session = await sessions.getSession(sessionId);
    if (!session || ['confirmed', 'cancelled'].includes(session.state)) {
        await safeReply(interaction, 'ℹ️ This report is no longer active.');
        return null;
    }
    return session;
}

// ---- interaction handlers ---------------------------------------------------

async function handleAssign(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    const auth = await authorize(interaction, session, null, { allowAnySide: true });
    if (!auth.ok) return;

    // The chosen home-group index now rides in the button's customId (parts[1]).
    // (Was interaction.values[0] from a select that silently no-op'd on the guess.)
    const homeIdx = Number(parts[1]) === 1 ? 1 : 0;
    await interaction.deferUpdate();

    const homeRoster = await tc.getTeamRoster(session.season_id, session.home_team_id);
    const awayRoster = await tc.getTeamRoster(session.season_id, session.away_team_id);
    const parsed = session.parsed;
    const homeSlots = await autoSuggest(initSlots(parsed.teams[homeIdx]), homeRoster);
    const awaySlots = await autoSuggest(initSlots(parsed.teams[homeIdx === 0 ? 1 : 0]), awayRoster);

    await sessions.updateSession(session.id, {
        homeMatches: { slots: homeSlots, submitted: false, confirmed: false, page: 0 },
        awayMatches: { slots: awaySlots, submitted: false, confirmed: false, page: 0 },
        state: 'matching', messageIds: { ...bag(session), homeIdx },
    });
    const updated = await sessions.getSession(session.id);

    // Replace the assign message with the picker's own matching panel (salary
    // crew sees home here and away below; the other captain's panel appears
    // after this side submits).
    const ownSide = auth.isSC ? 'home' : (auth.authed || 'home');
    await interaction.editReply(await renderSide(updated, ownSide));
    const newBag = { ...bag(updated) };
    newBag[ownSide === 'home' ? 'homeMsgId' : 'awayMsgId'] = bag(updated).assignMsgId;
    if (auth.isSC) {
        const awayMsg = await interaction.channel.send(await renderSide(updated, 'away'));
        newBag.awayMsgId = awayMsg.id;
    }
    await sessions.updateSession(session.id, { messageIds: newBag });
}

async function handleMatch(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    const side = sideFromCode(parts[1]);
    const slotIdx = Number(parts[2]);
    const auth = await authorize(interaction, session, side);
    if (!auth.ok) return;

    await interaction.deferUpdate();
    const m = getMatches(session, side);
    const slot = m.slots[slotIdx];
    if (!slot) return;
    const value = interaction.values[0];
    if (value === VAL_SEARCH) { slot.mode = 'search'; }
    else if (value === VAL_SKIP) { slot.skipped = true; slot.discordId = null; slot.mode = 'select'; }
    else { slot.discordId = value; slot.skipped = false; slot.mode = 'select'; }

    await sessions.updateSession(session.id, side === 'home' ? { homeMatches: m } : { awayMatches: m });
    const updated = await sessions.getSession(session.id);
    await interaction.editReply(await renderSide(updated, side));
}

async function handleSub(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    const side = sideFromCode(parts[1]);
    const slotIdx = Number(parts[2]);
    const auth = await authorize(interaction, session, side);
    if (!auth.ok) return;

    await interaction.deferUpdate();
    const m = getMatches(session, side);
    const slot = m.slots[slotIdx];
    if (!slot) return;
    const userId = interaction.values[0];
    slot.discordId = userId;
    slot.mode = 'select';
    slot.skipped = false;
    const picked = interaction.members?.get?.(userId) || interaction.users?.get?.(userId);
    slot.subDisplay = picked?.displayName || picked?.globalName || picked?.username || `User ${String(userId).slice(-4)}`;

    await sessions.updateSession(session.id, side === 'home' ? { homeMatches: m } : { awayMatches: m });
    const updated = await sessions.getSession(session.id);
    await interaction.editReply(await renderSide(updated, side));
}

async function handlePage(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    const side = sideFromCode(parts[1]);
    const page = Number(parts[2]) || 0;
    const auth = await authorize(interaction, session, side);
    if (!auth.ok) return;
    await interaction.deferUpdate();
    const m = getMatches(session, side);
    m.page = page;
    await sessions.updateSession(session.id, side === 'home' ? { homeMatches: m } : { awayMatches: m });
    const updated = await sessions.getSession(session.id);
    await interaction.editReply(await renderSide(updated, side));
}

async function handleSubmit(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    const side = sideFromCode(parts[1]);
    const auth = await authorize(interaction, session, side);
    if (!auth.ok) return;

    const m = getMatches(session, side);
    const unresolved = m.slots.filter((s) => !s.skipped && (s.mode === 'search' || !s.discordId));
    if (unresolved.length) {
        return safeReply(interaction, `❌ Match or skip every player first (${unresolved.length} left): ${unresolved.map((s) => s.name || s.platformId).join(', ')}`);
    }
    await interaction.deferUpdate();
    m.submitted = true;
    await sessions.updateSession(session.id, side === 'home' ? { homeMatches: m } : { awayMatches: m });
    let updated = await sessions.getSession(session.id);
    await interaction.editReply(await renderSide(updated, side)); // shows the "submitted" state

    const home = getMatches(updated, 'home');
    const away = getMatches(updated, 'away');
    if (home.submitted && away.submitted) {
        await sessions.updateSession(updated.id, { state: 'await_confirm' });
        updated = await sessions.getSession(updated.id);
        await postConfirmPanel(interaction.client, updated);
        return;
    }

    // Other side not done yet — post its panel (if missing) and ping its leaders.
    const otherSide = side === 'home' ? 'away' : 'home';
    const b = bag(updated);
    const otherMsgKey = otherSide === 'home' ? 'homeMsgId' : 'awayMsgId';
    if (!b[otherMsgKey]) {
        const channel = interaction.channel;
        const msg = await channel.send(await renderSide(updated, otherSide));
        await sessions.updateSession(updated.id, { messageIds: { ...b, [otherMsgKey]: msg.id } });
        const otherTeamId = otherSide === 'home' ? updated.home_team_id : updated.away_team_id;
        const otherName = otherSide === 'home' ? b.homeName : b.awayName;
        await pingTeamLeaders(channel, updated.season_id, otherTeamId, `your turn — match **${otherName}**'s players above. 🧩`);
    }
}

async function postConfirmPanel(client, session) {
    const channel = await client.channels.fetch(session.channel_id).catch(() => null);
    if (!channel) return;
    const b = bag(session);
    const parsed = session.parsed;
    // Series label oriented as home-away (home is parsed cluster homeIdx).
    const homeIsT0 = (b.homeIdx ?? 0) === 0;
    const homeWins = homeIsT0 ? parsed.seriesScore.team0 : parsed.seriesScore.team1;
    const awayWins = homeIsT0 ? parsed.seriesScore.team1 : parsed.seriesScore.team0;
    const msg = await channel.send(matching.buildConfirmMessage({
        sessionId: session.id, parsed, homeName: b.homeName, awayName: b.awayName,
        seriesLabel: `${homeWins}–${awayWins}`, confirm: { home: false, away: false }, showSalaryFinalize: true,
    }));
    await sessions.updateSession(session.id, { messageIds: { ...b, confirmMsgId: msg.id } });
    await pingTeamLeaders(channel, session.season_id, session.home_team_id, '');
    await pingTeamLeaders(channel, session.season_id, session.away_team_id, 'both teams — please confirm the result above. ✅');
}

async function handleConfirm(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    const side = sideFromCode(parts[1]);
    const auth = await authorize(interaction, session, side);
    if (!auth.ok) return;

    await interaction.deferUpdate();
    const m = getMatches(session, side);
    m.confirmed = true;
    await sessions.updateSession(session.id, side === 'home' ? { homeMatches: m } : { awayMatches: m });
    let updated = await sessions.getSession(session.id);

    const home = getMatches(updated, 'home');
    const away = getMatches(updated, 'away');
    if (home.confirmed && away.confirmed) {
        await commitFromSession(interaction, updated, { via: 'captain' });
        return;
    }
    // Re-render the confirm panel with the updated state.
    const b = bag(updated);
    const parsed = updated.parsed;
    const homeIsT0 = (b.homeIdx ?? 0) === 0;
    const homeWins = homeIsT0 ? parsed.seriesScore.team0 : parsed.seriesScore.team1;
    const awayWins = homeIsT0 ? parsed.seriesScore.team1 : parsed.seriesScore.team0;
    await interaction.editReply(matching.buildConfirmMessage({
        sessionId: updated.id, parsed, homeName: b.homeName, awayName: b.awayName,
        seriesLabel: `${homeWins}–${awayWins}`,
        confirm: { home: home.confirmed, away: away.confirmed }, showSalaryFinalize: true,
    }));
}

async function handleReject(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    const auth = await authorize(interaction, session, null, { allowAnySide: true });
    if (!auth.ok) return;
    await interaction.deferUpdate();

    // Reset submitted/confirmed flags → back to matching so captains can fix.
    const home = getMatches(session, 'home'); home.submitted = false; home.confirmed = false;
    const away = getMatches(session, 'away'); away.submitted = false; away.confirmed = false;
    await sessions.updateSession(session.id, { homeMatches: home, awayMatches: away, state: 'matching' });
    const updated = await sessions.getSession(session.id);

    await interaction.editReply({ content: '↩️ Sent back for corrections — re-match and submit again.', embeds: [], components: [] });
    const channel = interaction.channel;
    const b = bag(updated);
    if (b.homeMsgId) await editStored(interaction.client, updated.channel_id, b.homeMsgId, await renderSide(updated, 'home'));
    if (b.awayMsgId) await editStored(interaction.client, updated.channel_id, b.awayMsgId, await renderSide(updated, 'away'));
    await channel.send('↩️ The result was sent back. Each team: re-check your matches and submit again.').catch(() => {});
}

async function handleCancel(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    const auth = await authorize(interaction, session, null, { allowAnySide: true });
    if (!auth.ok) return;
    await interaction.deferUpdate();
    await sessions.cancelSession(session.id);
    await statsStore.logAudit({ action: 'report_cancelled', actorDiscordId: interaction.user.id, detail: { sessionId: session.id } });

    const b = bag(session);
    const cancelled = { content: '🛑 Report cancelled.', embeds: [], components: [] };
    for (const key of ['homeMsgId', 'awayMsgId', 'confirmMsgId', 'assignMsgId']) {
        if (b[key]) await editStored(interaction.client, session.channel_id, b[key], cancelled);
    }
    // Bring the "Report Series" panel back so the series can be re-reported.
    await panel.restorePanel(interaction.client, session.thread_id);
}

/** "Dispute" — freezes the report for captains and calls in salary crew (Q8.5). */
async function handleDispute(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    const auth = await authorize(interaction, session, null, { allowAnySide: true });
    if (!auth.ok) return;
    await interaction.deferUpdate();

    await sessions.updateSession(session.id, { state: 'disputed' });
    await statsStore.logAudit({ action: 'report_disputed', actorDiscordId: interaction.user.id, detail: { sessionId: session.id } });
    await logEdge(interaction.client, {
        summary: `Report DISPUTED in ${session.division} (Week ${session.week ?? '—'}) — captains disagree; salary crew must resolve.`,
        thread: interaction.channel, division: session.division, groupUrl: session.group_url,
    });
    await interaction.channel.send('⚠️ **This report is now disputed.** Captains are frozen — salary crew will resolve it.').catch(() => {});
}

async function handleSalaryFinalize(interaction, parts) {
    const session = await loadActive(interaction, Number(parts[0]));
    if (!session) return;
    if (!tc.isSalaryCrew(interaction.member)) {
        return safeReply(interaction, '❌ Only salary crew can finalize directly.');
    }
    const home = getMatches(session, 'home');
    const away = getMatches(session, 'away');
    if (!home.submitted || !away.submitted) {
        return safeReply(interaction, '❌ Both teams must be matched and submitted before finalizing.');
    }
    await interaction.deferUpdate();
    await commitFromSession(interaction, session, { via: 'salary_crew' });
}

// ---- commit -----------------------------------------------------------------

function buildCommitPayload(session, homeRosterIds, awayRosterIds) {
    const parsed = session.parsed;
    const home = getMatches(session, 'home');
    const away = getMatches(session, 'away');
    // FULL side maps (including skipped/unmatched slots) — the slot lists are
    // already partitioned by team and keyed by pkey, so they tell us which side a
    // parsed player is on even when they were skipped or never matched to a Discord
    // ID. (homeMatch/awayMatch carry the resolved discordId; presence in homeSide/
    // awaySide is enough to know the team.)
    const homeSide = new Map(home.slots.map((s) => [s.pkey, s]));
    const awaySide = new Map(away.slots.map((s) => [s.pkey, s]));

    // Orientation comes from the session's confirmed homeIdx — the parser keeps
    // every game in cluster order, so this single flag covers the whole series.
    // (Re-detecting per game from matched slots flips games where all of a
    // team's players were skipped/unmatched.)
    const homeIsT0 = (bag(session).homeIdx ?? 0) === 0;

    const games = [];
    for (let i = 0; i < parsed.games.length; i += 1) {
        const g = parsed.games[i];
        const allPlayers = [...g.team0Players, ...g.team1Players];
        const homeGoals = homeIsT0 ? g.team0Goals : g.team1Goals;
        const awayGoals = homeIsT0 ? g.team1Goals : g.team0Goals;
        const players = [];
        for (const p of allPlayers) {
            const hs = homeSide.get(p.pkey);
            const as = awaySide.get(p.pkey);
            if (!hs && !as) continue; // true ghost (on neither roster panel) — no team, drop
            const isHome = Boolean(hs);
            const slot = hs || as;
            // Skipped or unmatched → discordId stays NULL. The stat line is STILL
            // recorded (against the team, with platform/platform_id/ingame_name) so
            // it never disappears — it surfaces as an "unlinked player" and can be
            // relinked to a Discord ID later (stats_player_accounts link moves these
            // rows). Per-player aggregates already ignore NULL-discord rows.
            const discordId = slot.skipped ? null : (slot.discordId || null);
            const rosterIds = isHome ? homeRosterIds : awayRosterIds;
            players.push({
                teamId: isHome ? session.home_team_id : session.away_team_id,
                discordId,
                platform: p.platform, platformId: p.platformId, ingameName: p.name,
                // Unlinked rows aren't on a roster, so they count as a sub.
                isSub: discordId ? !rosterIds.has(discordId) : true,
                score: p.score, goals: p.goals, assists: p.assists, saves: p.saves, shots: p.shots,
                shootingPct: p.shootingPct, demosInflicted: p.demoInflicted, demosTaken: p.demoTaken,
                mvp: p.mvp, playedSeconds: p.playedSeconds,
            });
        }
        games.push({
            gameNumber: i + 1, replayId: g.replayId, replayUrl: g.url, map: g.map,
            durationSeconds: g.duration, overtime: g.overtime, playedAt: g.date,
            homeGoals, awayGoals, players,
        });
    }
    return { games };
}

async function commitFromSession(interaction, session, { via }) {
    const b = bag(session);
    const homeRoster = await tc.getTeamRoster(session.season_id, session.home_team_id);
    const awayRoster = await tc.getTeamRoster(session.season_id, session.away_team_id);
    const homeRosterIds = new Set(homeRoster.map((m) => m.discordId));
    const awayRosterIds = new Set(awayRoster.map((m) => m.discordId));

    const { games } = buildCommitPayload(session, homeRosterIds, awayRosterIds);

    // --- on-field salary cap check (per game, both teams) ---
    try {
        const caps = await tc.getOnfieldCaps(session.season_id);
        const { sourceOk, salaryOf } = await buildSalaryResolver();
        // Only DISCORD-LINKED players count toward the on-field salary cap. Skipped/
        // unmatched (NULL-discord, "unlinked") players have no roster salary, so
        // including them would falsely flag "missing salary" and block the report —
        // they're now recorded for stats but excluded from the cap math (operator
        // rule: unverifiable salary warns, never blocks).
        const capGames = games.map((g) => ({
            gameNumber: g.gameNumber,
            homePlayers: g.players.filter((p) => p.teamId === session.home_team_id && p.discordId).map((p) => ({ discordId: p.discordId, name: p.ingameName })),
            awayPlayers: g.players.filter((p) => p.teamId === session.away_team_id && p.discordId).map((p) => ({ discordId: p.discordId, name: p.ingameName })),
        }));
        const cap = checkSeriesCaps({ division: session.division, caps, games: capGames, salaryOf, sourceOk, teamNames: { home: b.homeName, away: b.awayName } });
        if (!cap.canVerify) {
            // Salary source down or no cap configured — operator rule: warn, don't block.
            await logEdge(interaction.client, {
                summary: `Salary cap NOT verified for this ${session.division} report (source ${sourceOk ? 'ok' : 'down'}, cap ${cap.cap ?? 'unset'}) — recorded anyway.`,
                division: session.division, groupUrl: session.group_url, thread: interaction.channel, pingInThread: false,
            });
        }
        if (cap.blocked) {
            const lines = [];
            for (const v of cap.violations) lines.push(`• ${v.team} game ${v.game}: $${v.total} (cap $${v.cap}, over by $${v.over})`);
            for (const ms of cap.missing) lines.push(`• ${ms.team} game ${ms.game}: ${ms.name} has no salary on file`);
            await logEdge(interaction.client, {
                summary: `On-field salary cap block in ${session.division} — report NOT recorded.`,
                detail: lines.join('\n'), thread: interaction.channel, division: session.division, groupUrl: session.group_url,
            });
            await safeReply(interaction, `❌ Cannot report — on-field salary cap exceeded / missing salary:\n${lines.join('\n')}\nSalary crew notified.`);
            return;
        }
    } catch (err) {
        Logger.error('cap check failed (continuing, will warn)', err);
        await logEdge(interaction.client, { summary: `Salary cap check errored in ${session.division} (report still recorded).`, error: err, thread: interaction.channel, division: session.division, pingInThread: false });
    }

    let result;
    try {
        result = await statsStore.commitSeries({
            seasonId: session.season_id, division: session.division, week: session.week,
            isPlayoff: session.is_playoff, format: session.format,
            homeTeamId: session.home_team_id, awayTeamId: session.away_team_id,
            scheduleMatchId: session.schedule_match_id, threadId: session.thread_id,
            group: { id: bcClient.parseGroupId(session.group_url), url: session.group_url, name: session.parsed.groupName },
            reportedByDiscordId: interaction.user.id, reportedVia: via,
            games,
        });
    } catch (err) {
        await logEdge(interaction.client, { summary: `Commit failed in ${session.division}.`, error: err, thread: interaction.channel, division: session.division, groupUrl: session.group_url });
        await safeReply(interaction, '❌ Failed to save the series. Salary crew notified.');
        return;
    }

    await sessions.updateSession(session.id, { state: 'confirmed', seriesId: result.seriesId });
    await sessions.setPanelStatus(session.thread_id, 'reported');

    // Playoff finals → automatically record the champions (uses the bracket's
    // is_finals round; no-op for regular-season series).
    if (session.is_playoff) {
        try {
            await maybeRecordChampion(session, result);
        } catch (err) {
            Logger.error('champion auto-record failed (non-fatal)', err);
        }
    }

    // Clean up the working panels.
    const cleanup = { content: '✅ Series confirmed and recorded.', embeds: [], components: [] };
    for (const key of ['homeMsgId', 'awayMsgId', 'confirmMsgId', 'assignMsgId']) {
        if (b[key]) await editStored(interaction.client, session.channel_id, b[key], cleanup);
    }

    await postConfirmation(interaction.client, session, result);
}

/**
 * If a confirmed playoff series matches the bracket's FINALS matchup for its
 * division, record the winner as that division's season champion.
 */
async function maybeRecordChampion(session, result) {
    if (!result.winnerTeamId) return;
    const finals = await pool.query(
        `SELECT pm.home_team_id, pm.away_team_id
         FROM playoff_matchups pm
         JOIN playoff_rounds pr ON pr.id = pm.round_id
         JOIN playoff_brackets pb ON pb.id = pr.bracket_id
         WHERE pb.season_id = $1 AND pb.division = $2 AND pr.is_finals = TRUE`,
        [session.season_id, session.division]
    ).catch(() => ({ rows: [] }));

    const isFinals = finals.rows.some((m) =>
        (m.home_team_id === session.home_team_id && m.away_team_id === session.away_team_id) ||
        (m.home_team_id === session.away_team_id && m.away_team_id === session.home_team_id));
    if (!isFinals) return;

    const exists = await pool.query(
        `SELECT id FROM season_champions WHERE season_id = $1 AND division = $2`,
        [session.season_id, session.division]
    );
    if (exists.rows.length) return; // already set (e.g. manually) — don't overwrite

    await pool.query(
        `INSERT INTO season_champions (season_id, division, team_id, notes)
         VALUES ($1, $2, $3, 'Auto-recorded from the reported playoff finals series')`,
        [session.season_id, session.division, result.winnerTeamId]
    );
    await statsStore.logAudit({
        seriesId: result.seriesId, action: 'champion_recorded',
        detail: { seasonId: session.season_id, division: session.division, teamId: result.winnerTeamId },
    });
}

/** Confirmation post: winning team first, two-logo result card, player mentions, links. */
/**
 * Announce a scores-only staff report (no session, no player stats, no replays).
 * Same card and division channel as a normal confirmation, but it says plainly
 * that the stats aren't in yet so nobody thinks the report is finished.
 */
async function postManualResult(client, ctx, result, games) {
    try {
        const homeWon = result.homeScore > result.awayScore;
        const winName = homeWon ? ctx.homeTeam.name : ctx.awayTeam.name;
        const loseName = homeWon ? ctx.awayTeam.name : ctx.homeTeam.name;
        const winScore = homeWon ? result.homeScore : result.awayScore;
        const loseScore = homeWon ? result.awayScore : result.homeScore;

        const gameTiles = (games || []).map((g) => {
            const homeWonGame = Number(g.homeGoals) > Number(g.awayGoals);
            return {
                wName: homeWonGame ? ctx.homeTeam.name : ctx.awayTeam.name,
                lName: homeWonGame ? ctx.awayTeam.name : ctx.homeTeam.name,
                wGoals: homeWonGame ? g.homeGoals : g.awayGoals,
                lGoals: homeWonGame ? g.awayGoals : g.homeGoals,
            };
        });

        const card = await buildResultCard({
            winnerName: winName, loserName: loseName, winnerScore: winScore, loserScore: loseScore,
            division: ctx.division, week: ctx.week, isForfeit: false, games: gameTiles,
        });
        const embed = new EmbedBuilder()
            .setColor(0x27AE60)
            .setTitle(`🏆 ${winName} ${winScore}–${loseScore} ${loseName}`)
            .setDescription(`${ctx.division} · Week ${ctx.week ?? '—'} · reported by staff`)
            .addFields({ name: 'Player stats', value: 'Not recorded — this series had no replay group.' })
            .setTimestamp();
        if (card) embed.setImage('attachment://result.png');
        const files = card ? [new AttachmentBuilder(card, { name: 'result.png' })] : [];

        const chId = DIVISION_RESULT_CHANNELS[ctx.division];
        if (chId) {
            const ch = await client.channels.fetch(chId).catch(() => null);
            if (ch?.isTextBased()) await ch.send({ embeds: [embed], files });
        }
    } catch (err) {
        // The series is already saved; a failed announcement must not undo that.
        Logger.error('postManualResult failed', err);
    }
}

async function postConfirmation(client, session, result) {
    const b = bag(session);
    const homeWon = result.homeScore > result.awayScore;
    const winName = homeWon ? b.homeName : b.awayName;
    const loseName = homeWon ? b.awayName : b.homeName;
    const winScore = homeWon ? result.homeScore : result.awayScore;
    const loseScore = homeWon ? result.awayScore : result.homeScore;
    // NOT RAILWAY_PUBLIC_DOMAIN — on Railway that is the BOT service's own domain,
    // so this link used to point at the bot instead of the league site.
    const site = siteUrl();

    // Distinct players who actually played (for mentions, rendered outside the embed).
    const collect = (m) => (m?.slots || []).filter((s) => !s.skipped && s.discordId).map((s) => s.discordId);
    const playerIds = [...new Set([...collect(getMatches(session, 'home')), ...collect(getMatches(session, 'away'))])];
    const mentions = playerIds.map((id) => `<@${id}>`).join(' ');

    // Per-game tiles: each game's winner shown first (logos only on the card).
    const parsed = session.parsed || {};
    const homeIsT0 = (b.homeIdx ?? 0) === 0;
    const gameTiles = (parsed.games || []).map((g) => {
        const homeGoals = homeIsT0 ? g.team0Goals : g.team1Goals;
        const awayGoals = homeIsT0 ? g.team1Goals : g.team0Goals;
        const homeWonGame = Number(homeGoals) > Number(awayGoals);
        return {
            wName: homeWonGame ? b.homeName : b.awayName,
            lName: homeWonGame ? b.awayName : b.homeName,
            wGoals: homeWonGame ? homeGoals : awayGoals,
            lGoals: homeWonGame ? awayGoals : homeGoals,
        };
    });

    const card = await buildResultCard({
        winnerName: winName, loserName: loseName, winnerScore: winScore, loserScore: loseScore,
        division: session.division, week: session.week, isForfeit: false, games: gameTiles,
    });

    const embed = new EmbedBuilder()
        .setColor(0x27AE60)
        .setTitle(`🏆 ${winName} ${winScore}–${loseScore} ${loseName}`)
        .setDescription(`${session.division} · Week ${session.week ?? '—'}`)
        .addFields({ name: 'Replay group', value: session.group_url || '—' })
        .setTimestamp();
    if (card) embed.setImage('attachment://result.png');
    if (site) embed.addFields({ name: 'Full stats', value: `${site}/teams/${encodeURIComponent(winName)}` });

    const fileFor = () => (card ? [new AttachmentBuilder(card, { name: 'result.png' })] : []);

    // Thread (with player mentions).
    try {
        const thread = await client.channels.fetch(session.thread_id).catch(() => null);
        if (thread?.isTextBased()) {
            await thread.send({ content: `✅ **Series confirmed!** ${mentions}`.trim(), embeds: [embed], files: fileFor() });
        }
    } catch (err) { Logger.error('postConfirmation thread failed', err); }

    // Division channel.
    try {
        const chId = DIVISION_RESULT_CHANNELS[session.division];
        if (chId) {
            const ch = await client.channels.fetch(chId).catch(() => null);
            if (ch?.isTextBased()) await ch.send({ embeds: [embed], files: fileFor() });
        }
    } catch (err) { Logger.error('postConfirmation division channel failed', err); }
}

module.exports = {
    buildCommitPayload, // exported for the orientation test harness (tools/)
    parseManualScores,  // pure — exported so the score box can be tested directly
    startReport,
    startStaffReport,
    handleGroupModal,
    handleAssign,
    handleMatch,
    handleSub,
    handlePage,
    handleSubmit,
    handleConfirm,
    handleReject,
    handleCancel,
    handleDispute,
    handleSalaryFinalize,
};
