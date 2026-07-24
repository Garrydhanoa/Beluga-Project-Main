/**
 * DB-first team service — the single source for teams, Discord roles, colors,
 * and logos (the migration away from constants/roles.js):
 *   - TEAM role  → teams.discord_role_id (admin → Teams)
 *   - GM role    → team_franchises.gm_role_id (one per franchise)
 *   - NP role    → team_franchises.np_role_id (one per franchise)
 *   - CAPTAIN    → fixed per-division constants (operator rule)
 *   - Color      → team_franchises.color (hex, admin-set)
 *   - Logo       → teams.logo_data, falling back to the franchise logo
 * Legacy constants remain a silent last-resort fallback during the transition.
 * Short caches keep Discord autocomplete (3s budget) and embeds fast.
 */

const { AttachmentBuilder } = require('discord.js');
const { pool, isDatabaseAvailable } = require('./database');
const { ROLES, TEAM_ROLES, NP_ROLES, TEAM_COLORS } = require('../constants/roles');
const Logger = require('./logger');

const ROLE_CACHE_TTL_MS = 60 * 1000;
const LIST_CACHE_TTL_MS = 60 * 1000;
const LOGO_CACHE_TTL_MS = 10 * 60 * 1000;

const _roleCache = new Map();   // teamId -> { at, value }
const _logoCache = new Map();   // teamId -> { at, buffer|null }
let _teamListCache = null;      // { at, seasonId, teams }

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

async function getActiveSeasonId() {
    if (!db()) return null;
    try {
        const r = await pool.query(`SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
        return r.rows[0]?.id ?? null;
    } catch (err) {
        Logger.error('getActiveSeasonId failed', err);
        return null;
    }
}

/**
 * All active teams in the active season (cached ~60s).
 * @returns {Promise<Array<{id:number,name:string,division:string,franchiseId:number|null,color:string|null}>>}
 */
async function getActiveTeams() {
    if (_teamListCache && Date.now() - _teamListCache.at < LIST_CACHE_TTL_MS) {
        return _teamListCache.teams;
    }
    if (!db()) return [];
    try {
        const seasonId = await getActiveSeasonId();
        if (!seasonId) return [];
        const r = await pool.query(
            `SELECT t.id, t.name, t.division, t.franchise_id, f.color
             FROM teams t
             LEFT JOIN team_franchises f ON f.id = t.franchise_id
             WHERE t.season_id = $1 AND t.is_active = TRUE
             ORDER BY CASE t.division WHEN 'Majors' THEN 0 WHEN 'AAA' THEN 1 ELSE 2 END, t.name`,
            [seasonId]
        );
        const teams = r.rows.map((t) => ({
            id: t.id, name: t.name, division: t.division,
            franchiseId: t.franchise_id, color: t.color || null,
        }));
        _teamListCache = { at: Date.now(), seasonId, teams };
        return teams;
    } catch (err) {
        Logger.error('getActiveTeams failed', err);
        return [];
    }
}

/** Find an active-season team by name (+ optional division). Case-insensitive. */
async function findTeam(name, division = null) {
    const teams = await getActiveTeams();
    const n = String(name || '').toLowerCase();
    return teams.find((t) =>
        t.name.toLowerCase() === n && (!division || t.division.toLowerCase() === String(division).toLowerCase())
    ) || null;
}

/**
 * Autocomplete responder for team options. Two value formats:
 *   - valueField:'id'   → value = team row id (default; resolve with resolveTeamOption())
 *   - valueField:'name' → value = team name; the list is deduped by name so the
 *     same franchise fielded across divisions appears once. Use this when the
 *     command's execute reads a team-NAME string (the transaction/roster commands).
 * Optionally filter by a division the user already picked on the command.
 */
async function teamAutocomplete(interaction, { divisionOptionName = 'division', perDivision = true, valueField = 'id' } = {}) {
    try {
        const q = String(interaction.options.getFocused() || '').toLowerCase();
        let division = null;
        if (perDivision && divisionOptionName) {
            try { division = interaction.options.getString(divisionOptionName); } catch { /* option absent */ }
        }
        let teams = await getActiveTeams();
        if (division) teams = teams.filter((t) => t.division.toLowerCase() === String(division).toLowerCase());
        teams = teams.filter((t) => t.name.toLowerCase().includes(q));

        let choices;
        if (valueField === 'name') {
            // Value is the name — collapse duplicate names (across divisions) so the
            // dropdown shows each team once and execute gets a plain name string.
            const seen = new Set();
            choices = [];
            for (const t of teams) {
                if (seen.has(t.name)) continue;
                seen.add(t.name);
                choices.push({ name: t.name, value: t.name });
                if (choices.length >= 25) break;
            }
        } else {
            choices = teams.slice(0, 25).map((t) => ({
                name: division ? t.name : `${t.name} (${t.division})`,
                value: String(t.id),
            }));
        }
        await interaction.respond(choices);
    } catch (err) {
        if (err?.code !== 10062) Logger.error('teamAutocomplete failed', err);
    }
}

/**
 * Resolve a team option value that may be an id (from autocomplete) or a name
 * (typed by hand). Returns the active team row or null.
 */
async function resolveTeamOption(value, division = null) {
    const teams = await getActiveTeams();
    const raw = String(value || '').trim();
    if (/^\d+$/.test(raw)) {
        const byId = teams.find((t) => t.id === Number(raw));
        if (byId) return byId;
    }
    return findTeam(raw, division);
}

/**
 * Resolve all Discord wiring for a team (by team row id).
 */
async function getTeamDiscordRoles(teamId) {
    const cached = _roleCache.get(teamId);
    if (cached && Date.now() - cached.at < ROLE_CACHE_TTL_MS) return cached.value;

    let row = null;
    if (db() && teamId) {
        try {
            const r = await pool.query(
                `SELECT t.id, t.name, t.division, t.franchise_id,
                    t.discord_role_id, t.discord_gm_role_id, t.discord_np_role_id,
                    f.gm_role_id AS franchise_gm_role_id,
                    f.np_role_id AS franchise_np_role_id,
                    f.discord_invite_url, f.color
                 FROM teams t
                 LEFT JOIN team_franchises f ON f.id = t.franchise_id
                 WHERE t.id = $1`,
                [teamId]
            );
            row = r.rows[0] || null;
        } catch (err) {
            Logger.error('getTeamDiscordRoles query failed', err);
        }
    }

    const name = row?.name || null;
    const division = row?.division || null;
    const divKey = String(division || '').toUpperCase();

    const value = {
        teamName: name,
        division,
        franchiseId: row?.franchise_id ?? null,
        discordInviteUrl: row?.discord_invite_url || null,
        color: row?.color || (name && TEAM_COLORS[name] ? `#${TEAM_COLORS[name].toString(16).padStart(6, '0')}` : null),
        teamRoleId: row?.discord_role_id
            || (name && TEAM_ROLES[divKey]?.[name]) || null,
        gmRoleId: row?.franchise_gm_role_id
            || row?.discord_gm_role_id
            || (name && ROLES.GM_ROLES[name]) || null,
        npRoleId: row?.franchise_np_role_id
            || row?.discord_np_role_id
            || (name && NP_ROLES[name]) || null,
    };
    _roleCache.set(teamId, { at: Date.now(), value });
    return value;
}

/** Embed color int for a team (DB franchise color → constants → league blue). */
async function getTeamColorInt(teamId) {
    const roles = await getTeamDiscordRoles(teamId);
    if (roles.color) {
        const hex = roles.color.replace('#', '');
        const n = parseInt(hex, 16);
        if (Number.isFinite(n)) return n;
    }
    return 0x3498DB;
}

/**
 * Team logo as an image Buffer — team logo first, then the franchise logo.
 * Cached ~10 min. Returns null when neither exists.
 */
async function getTeamLogoBuffer(teamId) {
    const cached = _logoCache.get(teamId);
    if (cached && Date.now() - cached.at < LOGO_CACHE_TTL_MS) return cached.buffer;
    let buffer = null;
    if (db() && teamId) {
        try {
            const r = await pool.query(
                `SELECT COALESCE(t.logo_data, f.logo_data) AS logo
                 FROM teams t LEFT JOIN team_franchises f ON f.id = t.franchise_id
                 WHERE t.id = $1`,
                [teamId]
            );
            if (r.rows[0]?.logo) buffer = Buffer.from(r.rows[0].logo);
        } catch (err) {
            Logger.error('getTeamLogoBuffer failed', err);
        }
    }
    _logoCache.set(teamId, { at: Date.now(), buffer });
    return buffer;
}

/** Logo buffer by team NAME in the active season (for callers without an id). */
async function getTeamLogoBufferByName(name, division = null) {
    const team = await findTeam(name, division);
    return team ? getTeamLogoBuffer(team.id) : null;
}

/**
 * Single DB-backed team-logo attachment for embeds — the one helper all bot
 * commands should use (replaces per-file findTeamLogo + IMAGES/logos/*.png).
 * Resolves team→franchise logo from Postgres; returns an AttachmentBuilder named
 * `team_logo.png` (referenceable as `attachment://team_logo.png`) or null when no
 * logo exists. Never reads the filesystem; never returns a path to a missing file.
 * Pass a teamId when you have one (exact match); otherwise a name (active-season
 * lookup with franchise fallback). `filename` overrides the attachment name when a
 * caller needs a distinct one (e.g. two logos in one message).
 */
async function attachTeamLogo(teamId, teamName, filename = 'team_logo.png') {
    try {
        let buf = teamId != null ? await getTeamLogoBuffer(teamId) : null;
        if (!buf && teamName) buf = await getTeamLogoBufferByName(teamName).catch(() => null);
        if (buf) return new AttachmentBuilder(buf, { name: filename });
    } catch { /* no logo — embed renders without a thumbnail */ }
    return null;
}

/** Per-division captain role (fixed constants by operator decision). */
function getCaptainRoleId(division) {
    return ROLES.CAPTAINS[String(division || '').toUpperCase()] || null;
}

function clearTeamRoleCache() {
    _roleCache.clear();
    _logoCache.clear();
    _teamListCache = null;
}

module.exports = {
    getActiveSeasonId,
    getActiveTeams,
    findTeam,
    teamAutocomplete,
    resolveTeamOption,
    getTeamDiscordRoles,
    getTeamColorInt,
    getTeamLogoBuffer,
    getTeamLogoBufferByName,
    attachTeamLogo,
    getCaptainRoleId,
    clearTeamRoleCache,
};
