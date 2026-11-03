/**
 * Ban evasion. A banned person's game accounts are remembered at ban time, posted to
 * #beluga-banned (staff used to do this by hand), and any later registration using one
 * of those accounts alerts Salary Crew. It never acts on its own, because a shared
 * household or a typo in a tracker link is not proof.
 *
 * Tracker links are the common key: SalSheet G/H and Registrations D/E hold TRN URLs,
 * and stats_player_accounts holds platform ids from Ballchasing. Epic trackers use a
 * display name while Ballchasing uses a GUID, so both spellings are kept.
 */

const { google } = require('googleapis');
const { EmbedBuilder } = require('discord.js');
const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const { googleSheetsService } = require('../utils/googleSheets');
const { ROLES } = require('../constants/roles');
const { CHANNELS } = require('./modConfig');
const posting = require('./modPosting');

const SPREADSHEET_ID = process.env.SHEET_ID_PLAYERS || '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
const CACHE_MS = 10 * 60 * 1000;

const PLATFORM_ALIASES = {
    steam: 'steam', epic: 'epic', epicgames: 'epic', psn: 'psn', ps: 'psn', ps4: 'psn', ps5: 'psn', playstation: 'psn',
    xbl: 'xbl', xbox: 'xbl', xboxlive: 'xbl', xboxone: 'xbl', switch: 'switch', nintendo: 'switch', nintendoswitch: 'switch',
};

function canonicalPlatform(p) {
    const k = String(p || '').trim().toLowerCase();
    return PLATFORM_ALIASES[k] || k;
}

function normKey(s) {
    return String(s || '').trim().toLowerCase();
}

function safeDecode(s) {
    try { return decodeURIComponent(s); } catch { return s; }
}

/** Pull every {platform, key, url} out of a cell of TRN links. */
function parseTrackers(text) {
    const out = [];
    const re = /https?:\/\/[^\s,]*?\/profile\/([a-z0-9]+)\/([^/\s,?#]+)[^\s,]*/gi;
    for (let m = re.exec(String(text || '')); m; m = re.exec(String(text || ''))) {
        out.push({ platform: canonicalPlatform(m[1]), key: normKey(safeDecode(m[2])), url: m[0] });
    }
    return out;
}

let cache = { at: 0, byId: null };

/** Map<discordId, [{platform, key, url}]> from both sheet tabs. */
async function sheetIdentities() {
    if (cache.byId && Date.now() - cache.at < CACHE_MS) return cache.byId;
    const auth = await googleSheetsService.authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const [sal, reg] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'SalSheet!G:P' }),
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Registrations!B:E' }),
    ]);
    const byId = new Map();
    const add = (id, cells) => {
        const discordId = String(id || '').trim();
        if (!/^\d{15,}$/.test(discordId)) return;
        const found = cells.flatMap(parseTrackers);
        if (!found.length) return;
        byId.set(discordId, [...(byId.get(discordId) || []), ...found]);
    };
    for (const row of sal.data.values || []) add(row[9], [row[0], row[1]]);
    for (const row of reg.data.values || []) add(row[0], [row[2], row[3]]);
    cache = { at: Date.now(), byId };
    return byId;
}

async function identitiesFor(discordId) {
    const id = String(discordId);
    const found = [];
    try {
        found.push(...((await sheetIdentities()).get(id) || []));
    } catch (err) {
        Logger.warning(`ban evasion: sheet identities unavailable: ${err.message}`);
    }
    const { rows } = await pool.query(
        'SELECT platform, platform_id, current_name FROM stats_player_accounts WHERE discord_id = $1',
        [id],
    );
    for (const r of rows) {
        const platform = canonicalPlatform(r.platform);
        found.push({ platform, key: normKey(r.platform_id), url: null });
        if (r.current_name) found.push({ platform, key: normKey(r.current_name), url: null });
    }
    const seen = new Set();
    return found.filter((f) => {
        const k = `${f.platform}/${f.key}`;
        if (!f.key || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

async function rememberIdentities(discordId) {
    const ids = await identitiesFor(discordId);
    for (const item of ids) {
        await pool.query(
            `INSERT INTO mod_identities (discord_id, platform, key, source) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [String(discordId), item.platform, item.key, item.url || 'ballchasing'],
        );
    }
    return ids.length;
}

async function postToBannedList(client, target) {
    const { rows } = await pool.query(
        `SELECT DISTINCT source FROM mod_identities WHERE discord_id = $1 AND source LIKE 'http%'`,
        [target.id],
    );
    const links = rows.map((r) => r.source);
    const msg = await posting.sendTo(client, CHANNELS.BELUGA_BANNED, {
        content: [`**${target.name || target.id}** (\`${target.id}\`)`, ...links].join('\n').slice(0, 1900),
        allowedMentions: { parse: [] },
    }, 'a #beluga-banned entry');
    return !!msg;
}

async function alert(client, newId, bannedId, key) {
    const claimed = await pool.query(
        `INSERT INTO mod_evasion_alerts (new_id, banned_id, key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
        [newId, bannedId, key],
    );
    if (!claimed.rows.length) return;
    const msg = await posting.sendTo(client, CHANNELS.TIMEOUT_LOG, {
        content: `<@&${ROLES.SALARY_CREW}>`,
        embeds: [new EmbedBuilder()
            .setTitle('Possible ban evasion')
            .setDescription(`<@${newId}> registered an account also linked to banned member <@${bannedId}>. Nothing has been done automatically.`)
            .addFields(
                { name: 'New member', value: `\`${newId}\``, inline: true },
                { name: 'Banned member', value: `\`${bannedId}\``, inline: true },
                { name: 'Shared account', value: posting.clip(key) },
            )
            .setColor(posting.COLORS.ban)
            .setTimestamp()],
        allowedMentions: { parse: [], roles: [ROLES.SALARY_CREW] },
    }, 'a ban evasion alert');
    if (msg) await pool.query('UPDATE mod_evasion_alerts SET alert_message_id = $2 WHERE id = $1', [claimed.rows[0].id, msg.id]);
    await require('./modStore').logEvent({
        discordId: newId, kind: 'evasion',
        summary: `Possible ban evasion: shares ${key} with banned member ${bannedId}.`,
    });
}

/** Banned identities as Map<"platform/key", bannedDiscordId>. */
async function bannedKeys() {
    const { rows } = await pool.query(
        `SELECT DISTINCT i.platform, i.key, i.discord_id FROM mod_identities i
           JOIN mod_bans b ON b.discord_id = i.discord_id AND b.status = 'active'`,
    );
    return new Map(rows.map((r) => [`${r.platform}/${r.key}`, r.discord_id]));
}

/** Called once from the end of a registration. Never throws into that flow. */
async function checkRegistration(client, discordId) {
    try {
        cache.at = 0;
        const banned = await bannedKeys();
        if (!banned.size) return;
        for (const item of await identitiesFor(discordId)) {
            const hit = banned.get(`${item.platform}/${item.key}`);
            if (hit && hit !== String(discordId)) await alert(client, String(discordId), hit, `${item.platform}/${item.key}`);
        }
    } catch (err) {
        Logger.error('ban evasion check failed', err);
    }
}

/** Backstop from the role sync, for anyone added to the sheet by hand. */
async function sweep(client) {
    try {
        const banned = await bannedKeys();
        if (!banned.size) return;
        for (const [discordId, items] of await sheetIdentities()) {
            for (const item of items) {
                const hit = banned.get(`${item.platform}/${item.key}`);
                if (hit && hit !== discordId) await alert(client, discordId, hit, `${item.platform}/${item.key}`);
            }
        }
    } catch (err) {
        Logger.error('ban evasion sweep failed', err);
    }
}

module.exports = { parseTrackers, identitiesFor, rememberIdentities, postToBannedList, checkRegistration, sweep };
