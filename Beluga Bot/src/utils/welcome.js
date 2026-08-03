/**
 * Onboarding messages — the two nudges a new member gets from the bot.
 *
 *  1. They JOIN            → welcome message + welcome card, posted in the welcome
 *                            channel AND DMed to them. Fires on every join, so a
 *                            rejoining member is greeted again.
 *  2. They get NEED RANK   → i.e. they verified but aren't in the SalSheet yet
 *                            (roleSync grants it) → a short "go register" DM.
 *                            Sent ONCE EVER per person: role sync runs every ~30 min
 *                            and any remove/re-add of the role would otherwise
 *                            re-DM them. `welcome_log` is the dedupe.
 *
 * Both DMs go through recordOutgoing() so they show up in the admin DM Center
 * thread for that member, next to anything staff type later.
 */

const { pool, isDatabaseAvailable, LeagueDB } = require('./database');
const { CHANNELS } = require('../constants/roles');
const { appendFooter, belugaEmoji } = require('./siteFooter');
const { buildWelcomeCard } = require('./welcomeCard');
const { recordOutgoing } = require('../dm/dmInbox');
const Logger = require('./logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

let _schemaReady = false;

/** Dedupe ledger for the once-ever DMs. New table; touches nothing existing. */
async function ensureWelcomeSchema() {
    if (_schemaReady || !db()) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS welcome_log (
                discord_id TEXT NOT NULL,
                kind       TEXT NOT NULL,
                sent_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (discord_id, kind)
            )
        `);
        _schemaReady = true;
    } catch (err) {
        Logger.error('ensureWelcomeSchema failed', err);
    }
}

/**
 * Claim the one-shot slot for (member, kind). True = we got it and should send.
 * Claiming BEFORE the send makes this atomic against two role events racing.
 * With no DB we let the send through rather than going silent.
 */
async function claimOnce(discordId, kind) {
    if (!db()) return true;
    await ensureWelcomeSchema();
    try {
        const r = await pool.query(
            `INSERT INTO welcome_log (discord_id, kind) VALUES ($1, $2)
             ON CONFLICT (discord_id, kind) DO NOTHING
             RETURNING discord_id`,
            [String(discordId), kind]
        );
        return r.rowCount > 0;
    } catch (err) {
        Logger.error(`welcome: claimOnce(${kind}) failed for ${discordId}`, err);
        return false;
    }
}

/** Hand the slot back so a later attempt can retry (used when the send fails). */
async function releaseOnce(discordId, kind) {
    if (!db()) return;
    try {
        await pool.query('DELETE FROM welcome_log WHERE discord_id = $1 AND kind = $2', [String(discordId), kind]);
    } catch { /* best effort */ }
}

/**
 * "Season 10" from the active season, never a hardcoded number. Falls back to the
 * season_number, then to neutral wording if the DB is unreachable.
 */
async function seasonLabel() {
    try {
        const season = await LeagueDB.getActiveSeason();
        if (!season) return null;
        if (season.name) return String(season.name);
        const n = season.season_number ?? season.seasonNumber;
        return n != null ? `Season ${n}` : null;
    } catch (err) {
        Logger.warning(`welcome: season lookup failed — ${err.message}`);
        return null;
    }
}

/**
 * The join message. `who` is already-rendered text for the person — a `<@id>` ping
 * in the channel, their plain display name in the DM (pinging someone inside their
 * own DM reads oddly).
 */
function buildJoinText({ who, guild, season }) {
    const emoji = belugaEmoji(guild);
    const label = season || 'The new season';
    return appendFooter(
        `Thanks for joining Beluga League ${who}, welcome in!\n\n` +
        `${label} is under way! ${emoji} To verify yourself please head over to <#${CHANNELS.VERIFY}> channel ` +
        `and follow the listed instructions to get access to the server.\n\n` +
        `Then once you are verified head over to <#${CHANNELS.REGISTER}> channel to register for the league.\n` +
        `Head over to <#${CHANNELS.SUPPORT}> if you are having trouble navigating at any step.`,
        guild
    );
}

/** The follow-up sent when Need Rank lands on them. */
function buildNeedRankText(guild) {
    return appendFooter(
        'Congratulations on verifying yourself!\n\n' +
        `Please head over to <#${CHANNELS.REGISTER}> channel to register for the league.\n\n` +
        'The bot will get you registered within 30 mins. If any error occurs please create a ticket in ' +
        `<#${CHANNELS.SUPPORT}> for help.\n\n` +
        'Welcome to Beluga League and have a good time!',
        guild
    );
}

/**
 * Discord avatar as PNG BYTES. Passing the URL string straight to canvas
 * loadImage() renders blank (the old /whois bug), and animated avatars fail to
 * decode — hence forceStatic.
 */
async function fetchAvatarBuffer(user) {
    try {
        const url = user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
        const res = await fetch(url);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch (err) {
        Logger.warning(`welcome: avatar fetch failed for ${user?.id} — ${err.message}`);
        return null;
    }
}

/** The {name, url, contentType} shape the DM Center renders inline. */
function attachmentMeta(message) {
    try {
        const a = [...message.attachments.values()][0];
        if (!a) return [];
        return [{ name: a.name || 'welcome.png', url: a.url, contentType: a.contentType || 'image/png', size: a.size || null }];
    } catch {
        return [];
    }
}

/**
 * Greet a member who just joined: channel post + DM, both with the welcome card.
 * Every stage is independently guarded — a card that fails to render still gets
 * the text out, and closed DMs (code 50007) never block the channel post.
 */
async function sendJoinWelcome(member) {
    if (!member || member.user?.bot) return;

    const guild = member.guild;
    const season = await seasonLabel();

    // Card (optional — the text is the part that matters).
    let card = null;
    try {
        const avatarBuffer = await fetchAvatarBuffer(member.user);
        card = await buildWelcomeCard({
            displayName: member.displayName || member.user.globalName || member.user.username,
            username: member.user.username,
            avatarBuffer,
            memberNumber: guild?.memberCount ?? null,
            seasonLabel: season,
            joinedAt: member.joinedAt || new Date(),
        });
    } catch (err) {
        Logger.error(`welcome: card render failed for ${member.id}`, err);
    }

    const files = card ? [{ attachment: card, name: 'welcome.png' }] : [];

    // ---- Channel post
    try {
        const channel = await guild.channels.fetch(CHANNELS.WELCOME).catch(() => null);
        if (!channel || typeof channel.send !== 'function') {
            Logger.warning(`welcome: channel ${CHANNELS.WELCOME} not found or not sendable`);
        } else {
            await channel.send({
                content: buildJoinText({ who: `<@${member.id}>`, guild, season }),
                files,
                allowedMentions: { users: [member.id] },
            });
        }
    } catch (err) {
        Logger.error(`welcome: channel post failed for ${member.id} (${err.code || 'no code'}: ${err.message})`, err);
    }

    // ---- DM
    const dmText = buildJoinText({
        who: member.displayName || member.user.globalName || member.user.username,
        guild,
        season,
    });
    try {
        const sent = await member.user.send({ content: dmText, files, allowedMentions: { parse: [] } });
        await recordOutgoing({
            discordId: member.id,
            content: dmText,
            authorName: 'Beluga Bot',
            source: 'welcome',
            discordMessageId: sent?.id ? String(sent.id) : null,
            attachments: attachmentMeta(sent),
            displayName: member.displayName || member.user.globalName || member.user.username,
            avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
        });
    } catch (err) {
        if (err.code === 50007) {
            Logger.warning(`welcome: ${member.user?.tag || member.id} has DMs closed — channel post only`);
        } else {
            Logger.error(`welcome: DM failed for ${member.id} (${err.code || 'no code'})`, err);
        }
    }
}

/**
 * DM a member who was just granted Need Rank (verified, not yet in the sheet).
 * Once ever — see the welcome_log note at the top of this file.
 */
async function sendNeedRankDm(member) {
    if (!member || member.user?.bot) return;

    if (!(await claimOnce(member.id, 'need_rank'))) return;

    const text = buildNeedRankText(member.guild);
    try {
        const sent = await member.user.send({ content: text, allowedMentions: { parse: [] } });
        await recordOutgoing({
            discordId: member.id,
            content: text,
            authorName: 'Beluga Bot',
            source: 'verified',
            discordMessageId: sent?.id ? String(sent.id) : null,
            displayName: member.displayName || member.user.globalName || member.user.username,
            avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
        });
        Logger.info(`welcome: sent Need Rank follow-up DM to ${member.user?.tag || member.id}`);
    } catch (err) {
        // DMs closed is final — don't retry forever on every role sync pass.
        if (err.code === 50007) {
            Logger.warning(`welcome: ${member.user?.tag || member.id} has DMs closed — Need Rank follow-up skipped`);
        } else {
            await releaseOnce(member.id, 'need_rank');
            Logger.error(`welcome: Need Rank DM failed for ${member.id} (${err.code || 'no code'})`, err);
        }
    }
}

module.exports = { sendJoinWelcome, sendNeedRankDm, ensureWelcomeSchema, buildJoinText, buildNeedRankText };
