const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { pool, isDatabaseAvailable, LeagueDB } = require('../utils/database');
const Logger = require('../utils/logger');

/**
 * /franchise — pick a franchise (autocompleted from the database) and get its
 * card: divisions fielded this season, GM role, and the franchise's Discord
 * invite link (set in the website admin → Teams → Franchises).
 */

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('franchise')
        .setDescription('Look up a franchise — divisions, GM, and their Discord link.')
        .setDMPermission(false)
        .addStringOption((o) => o
            .setName('franchise')
            .setDescription('Franchise name')
            .setRequired(true)
            .setAutocomplete(true)),

    async autocomplete(interaction) {
        if (!db()) return interaction.respond([]);
        const q = String(interaction.options.getFocused() || '').toLowerCase();
        const r = await pool.query(
            `SELECT id, name FROM team_franchises
             WHERE is_active = TRUE AND LOWER(name) LIKE $1
             ORDER BY name LIMIT 25`,
            [`%${q}%`]
        ).catch(() => ({ rows: [] }));
        return interaction.respond(r.rows.map((f) => ({ name: f.name, value: String(f.id) })));
    },

    async execute(interaction) {
        await interaction.deferReply();
        if (!db()) {
            await interaction.editReply('❌ Database unavailable.');
            return;
        }
        try {
            const input = interaction.options.getString('franchise');
            // Autocomplete sends the id; typing a name by hand still works.
            const fr = /^\d+$/.test(input)
                ? await pool.query(`SELECT * FROM team_franchises WHERE id = $1`, [Number(input)])
                : await pool.query(`SELECT * FROM team_franchises WHERE LOWER(name) = LOWER($1) LIMIT 1`, [input]);
            const franchise = fr.rows[0];
            if (!franchise) {
                await interaction.editReply('❌ Franchise not found.');
                return;
            }

            const season = await LeagueDB.getActiveSeason();
            const teams = season
                ? await pool.query(
                    `SELECT name, division FROM teams
                     WHERE franchise_id = $1 AND season_id = $2 AND is_active = TRUE
                     ORDER BY CASE division WHEN 'Majors' THEN 0 WHEN 'AAA' THEN 1 ELSE 2 END`,
                    [franchise.id, season.id]
                ).catch(() => ({ rows: [] }))
                : { rows: [] };

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(`🏛️ ${franchise.name}`)
                .setTimestamp();

            embed.addFields({
                name: season ? `Divisions (S${season.season_number ?? ''})` : 'Divisions',
                value: teams.rows.length
                    ? teams.rows.map((t) => `**${t.division}** — ${t.name}`).join('\n')
                    : '_Not fielding any teams this season._',
                inline: false,
            });

            // One-day subs: 3 per team-division per season, counted from the
            // esub/adminesub transactions of each division team.
            if (season && teams.rows.length) {
                try {
                    const teamIds = (await pool.query(
                        `SELECT id, division FROM teams WHERE franchise_id = $1 AND season_id = $2 AND is_active = TRUE`,
                        [franchise.id, season.id]
                    )).rows;
                    const lines = [];
                    for (const t of teamIds) {
                        const used = await pool.query(
                            `SELECT COUNT(*)::int AS n FROM transactions
                             WHERE team_id = $1 AND season_id = $2 AND type IN ('esub', 'adminesub')`,
                            [t.id, season.id]
                        );
                        const n = Number(used.rows[0]?.n || 0);
                        lines.push(`**${t.division}**: ${n}/3 used${n >= 3 ? ' ⚠️' : ''}`);
                    }
                    if (lines.length) embed.addFields({ name: 'One-day subs (this season)', value: lines.join('\n'), inline: false });
                } catch { /* ODS section optional */ }
            }
            if (franchise.gm_role_id) {
                embed.addFields({ name: 'GM', value: `<@&${franchise.gm_role_id}>`, inline: true });
            }
            if (franchise.discord_invite_url) {
                embed.addFields({ name: 'Discord', value: franchise.discord_invite_url, inline: true });
            } else {
                embed.setFooter({ text: 'No Discord link set — staff can add one in the admin panel (Teams → Franchises).' });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            Logger.error('/franchise failed', error);
            await interaction.editReply('❌ Failed to load that franchise.');
        }
    },
};
