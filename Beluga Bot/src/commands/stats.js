const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, isDatabaseAvailable, LeagueDB } = require('../utils/database');
const { TEAM_NAMES } = require('../constants/roles');
const { getTeamLogoBuffer } = require('../utils/teamRoles');
const { buildPlayerStatCard, buildTeamStatCard } = require('../stats/statCard');
const Logger = require('../utils/logger');

/**
 * /stats — public stat lookup for a player or a team.
 * Open to everyone, with a single GLOBAL 5-second cooldown across the whole bot
 * (operator spec: "not per player, an overall 5 second rate limit").
 */

let lastUseAt = 0;
const COOLDOWN_MS = 5000;

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

function siteUrl(path) {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    return domain ? `https://${domain}${path}` : null;
}

const fmt = (n) => Number(n || 0).toLocaleString();
const avg = (total, games) => (games ? (Number(total) / Number(games)).toFixed(2) : '0.00');

async function resolvePlayerDiscordId(interaction) {
    const user = interaction.options.getUser('player');
    if (user) return { discordId: user.id, label: user.username };

    const name = String(interaction.options.getString('name') || '').trim();
    if (!name) return { discordId: interaction.user.id, label: interaction.user.username };

    if (/^\d{16,20}$/.test(name)) return { discordId: name, label: name };

    const r = await pool.query(
        `SELECT discord_id, display_name, username FROM discord_members
         WHERE LOWER(display_name) = LOWER($1) OR LOWER(username) = LOWER($1)
         ORDER BY is_in_guild DESC LIMIT 1`,
        [name]
    ).catch(() => ({ rows: [] }));
    if (r.rows.length) return { discordId: r.rows[0].discord_id, label: r.rows[0].display_name || r.rows[0].username };

    // Fall back to the stats identity map (in-game names seen on Ballchasing).
    const acc = await pool.query(
        `SELECT discord_id, current_name FROM stats_player_accounts
         WHERE LOWER(current_name) = LOWER($1) ORDER BY last_seen DESC LIMIT 1`,
        [name]
    ).catch(() => ({ rows: [] }));
    if (acc.rows.length) return { discordId: acc.rows[0].discord_id, label: acc.rows[0].current_name };

    return { discordId: null, label: name };
}

// Resolve the `season` option to a season row. A given season number views that past
// season; absent/unknown → the active season. Team stats are per-season; player stats
// show the resolved season's block PLUS lifetime (which never changes with the option).
async function resolveSeasonForOption(interaction) {
    const n = interaction.options.getInteger('season');
    if (n && n > 0) {
        const r = await pool.query('SELECT * FROM seasons WHERE season_number = $1', [n]).catch(() => ({ rows: [] }));
        if (r.rows.length) return { season: r.rows[0], isActive: r.rows[0].status === 'active' };
    }
    const active = await LeagueDB.getActiveSeason();
    return { season: active, isActive: true };
}

function statBlock(title, t) {
    const games = Number(t.games || 0);
    return {
        name: title,
        value: [
            `Games **${fmt(games)}** · MVPs **${fmt(t.mvps)}**`,
            `Score **${fmt(t.score)}** (${avg(t.score, games)}/g)`,
            `G **${fmt(t.goals)}** · A **${fmt(t.assists)}** · SV **${fmt(t.saves)}** · SH **${fmt(t.shots)}**`,
            `Demos **${fmt(t.demos_inflicted)}** / taken **${fmt(t.demos_taken)}**`,
            t.beluga_score != null ? `Beluga Score **${Number(t.beluga_score).toFixed(2)}**` : null,
        ].filter(Boolean).join('\n'),
        inline: true,
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Look up league stats for a player or team.')
        .addSubcommand((sc) => sc
            .setName('player')
            .setDescription('Player stats (defaults to yourself). Lifetime always shown.')
            .addUserOption((o) => o.setName('player').setDescription('The player (mention)').setRequired(false))
            .addStringOption((o) => o.setName('name').setDescription('…or look up by name').setRequired(false))
            .addIntegerOption((o) => o.setName('season').setDescription('Season number (default: current). Lifetime is unaffected.').setRequired(false).setMinValue(1)))
        .addSubcommand((sc) => sc
            .setName('team')
            .setDescription('Team stats (defaults to the current season).')
            .addStringOption((o) => o.setName('team').setDescription('Team').setRequired(true)
                .addChoices(...TEAM_NAMES.map((t) => ({ name: t, value: t }))))
            .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true)
                .addChoices({ name: 'Majors', value: 'Majors' }, { name: 'AAA', value: 'AAA' }, { name: 'AA', value: 'AA' }))
            .addIntegerOption((o) => o.setName('season').setDescription('Season number (default: current)').setRequired(false).setMinValue(1))),

    async execute(interaction) {
        const now = Date.now();
        if (now - lastUseAt < COOLDOWN_MS) {
            await interaction.reply({ content: '⏳ Wait 5 seconds.', flags: 64 });
            return;
        }
        lastUseAt = now;

        if (!db()) {
            await interaction.reply({ content: '❌ Stats are unavailable right now (no database).', flags: 64 });
            return;
        }
        await interaction.deferReply();

        try {
            if (interaction.options.getSubcommand() === 'team') {
                await this.teamStats(interaction);
            } else {
                await this.playerStats(interaction);
            }
        } catch (error) {
            Logger.error('/stats failed', error);
            await interaction.editReply('❌ Failed to fetch stats. Try again, or ping salary crew.');
        }
    },

    async playerStats(interaction) {
        const { discordId, label } = await resolvePlayerDiscordId(interaction);
        if (!discordId) {
            await interaction.editReply(`❌ Couldn't find a player named **${label}**.`);
            return;
        }

        const { season, isActive } = await resolveSeasonForOption(interaction);
        const [seasonRows, lifeRows, memRows] = await Promise.all([
            season
                ? pool.query(
                    `SELECT sps.division, sps.team_id, sps.games, sps.score, sps.goals, sps.assists, sps.saves,
                            sps.shots, sps.demos_inflicted, sps.demos_taken, sps.mvps, sps.beluga_score,
                            t.name AS team_name
                     FROM stats_player_season sps LEFT JOIN teams t ON t.id = sps.team_id
                     WHERE sps.discord_id = $1 AND sps.season_id = $2 AND sps.is_playoff = FALSE
                     ORDER BY sps.games DESC`,
                    [String(discordId), season.id]
                ).catch(() => ({ rows: [] }))
                : Promise.resolve({ rows: [] }),
            pool.query(
                `SELECT games, seasons_played, score, goals, assists, saves, shots, demos_inflicted, demos_taken, mvps, beluga_score
                 FROM stats_player_lifetime WHERE discord_id = $1 AND is_playoff = FALSE`,
                [String(discordId)]
            ).catch(() => ({ rows: [] })),
            pool.query(
                `SELECT display_name, username, avatar_url FROM discord_members WHERE discord_id = $1`,
                [String(discordId)]
            ).catch(() => ({ rows: [] })),
        ]);

        if (!seasonRows.rows.length && !lifeRows.rows.length) {
            await interaction.editReply(`📭 No recorded stats for <@${discordId}> yet.`);
            return;
        }

        const primary = seasonRows.rows[0] || {};
        const mem = memRows.rows[0] || {};
        const mentioned = interaction.options.getUser('player');
        const avatarUrl =
            (mentioned && mentioned.id === String(discordId) ? mentioned.displayAvatarURL({ extension: 'png', size: 128 }) : null)
            || mem.avatar_url || null;
        const teamLogo = primary.team_id ? await getTeamLogoBuffer(primary.team_id).catch(() => null) : null;
        const url = siteUrl(`/players/${encodeURIComponent(String(discordId))}`);
        const seasonNo = season?.season_number ?? season?.seasonNumber ?? '';

        try {
            const buf = await buildPlayerStatCard({
                name: mem.display_name || mem.username || label || `User ${String(discordId).slice(-4)}`,
                avatarBuffer: avatarUrl,
                teamName: primary.team_name || null,
                teamLogoBuffer: teamLogo,
                division: primary.division || null,
                seasonLabel: `${isActive ? 'THIS SEASON' : 'SEASON'} · S${seasonNo}`,
                season: primary,
                lifetime: lifeRows.rows[0] || {},
                siteUrl: url ? url.replace(/^https?:\/\//, '') : null,
            });
            const file = new AttachmentBuilder(buf, { name: 'player-stats.png' });
            const extra = seasonRows.rows.length > 1 ? ` _(showing ${primary.division}; full splits on the site)_` : '';
            const content = url
                ? `📊 Stats for <@${discordId}> — full game-by-game breakdown: ${url}${extra}`
                : `📊 Stats for <@${discordId}>${extra}`;
            await interaction.editReply({ content, files: [file], allowedMentions: { parse: [] } });
        } catch (error) {
            Logger.error('player stat card render failed, falling back to embed', error);
            const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('📊 Player Stats').setDescription(`<@${discordId}>`).setTimestamp();
            for (const row of seasonRows.rows) embed.addFields(statBlock(`S${seasonNo} · ${row.division}`, row));
            if (lifeRows.rows.length) { const lt = lifeRows.rows[0]; embed.addFields(statBlock(`Lifetime (${lt.seasons_played} season${lt.seasons_played === 1 ? '' : 's'})`, lt)); }
            if (url) embed.addFields({ name: 'Full breakdown', value: url, inline: false });
            await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
        }
    },

    async teamStats(interaction) {
        const teamName = interaction.options.getString('team');
        const division = interaction.options.getString('division');
        const { season } = await resolveSeasonForOption(interaction);
        if (!season) {
            await interaction.editReply('❌ No season found.');
            return;
        }

        const teamRes = await pool.query(
            `SELECT id, name FROM teams WHERE season_id = $1 AND division = $2 AND LOWER(name) = LOWER($3) AND is_active = TRUE LIMIT 1`,
            [season.id, division, teamName]
        );
        if (!teamRes.rows.length) {
            await interaction.editReply(`❌ **${teamName}** isn't an active ${division} team this season.`);
            return;
        }
        const team = teamRes.rows[0];

        const ts = await pool.query(
            `SELECT * FROM stats_team_season WHERE season_id = $1 AND division = $2 AND team_id = $3 AND is_playoff = FALSE`,
            [season.id, division, team.id]
        );
        if (!ts.rows.length) {
            await interaction.editReply(`📭 **${team.name}** (${division}) has no recorded stats yet this season.`);
            return;
        }
        const t = ts.rows[0];
        const teamLogo = await getTeamLogoBuffer(team.id).catch(() => null);
        const url = siteUrl(`/teams/${encodeURIComponent(team.name)}`);
        const seasonNo = season?.season_number ?? season?.seasonNumber ?? '';

        try {
            const buf = await buildTeamStatCard({
                teamName: team.name,
                teamLogoBuffer: teamLogo,
                division,
                seasonLabel: `S${seasonNo}`,
                record: {
                    seriesW: t.series_wins, seriesL: t.series_losses,
                    gameW: t.game_wins, gameL: t.game_losses,
                    goalsFor: t.goals_for, goalsAgainst: t.goals_against,
                },
                totals: t,
                siteUrl: url ? url.replace(/^https?:\/\//, '') : null,
            });
            const file = new AttachmentBuilder(buf, { name: 'team-stats.png' });
            const content = url ? `📊 ${team.name} (${division}) — team page: ${url}` : `📊 ${team.name} (${division})`;
            await interaction.editReply({ content, files: [file] });
        } catch (error) {
            Logger.error('team stat card render failed, falling back to embed', error);
            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(`📊 ${team.name} — ${division}`)
                .addFields(
                    { name: 'Record', value: `Series **${t.series_wins}-${t.series_losses}** · Games **${t.game_wins}-${t.game_losses}**\nGoals **${t.goals_for}-${t.goals_against}** (${t.goals_for - t.goals_against >= 0 ? '+' : ''}${t.goals_for - t.goals_against})`, inline: true },
                    statBlock('Team totals', { ...t, games: t.games_played, mvps: 0 }),
                )
                .setTimestamp();
            if (url) embed.addFields({ name: 'Team page', value: url, inline: false });
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
