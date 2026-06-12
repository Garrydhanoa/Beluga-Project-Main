const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, LeagueDB } = require('../utils/database');
const { TEAM_NAMES } = require('../constants/roles');
const { isSalaryCrew } = require('../stats/report/threadContext');
const { DIVISION_RESULT_CHANNELS } = require('../stats/report/constants');
const { logEdge } = require('../stats/report/logChannel');
const { buildResultCard } = require('../stats/report/resultCard');
const statsStore = require('../stats/statsStore');
const Logger = require('../utils/logger');

/**
 * /report-ff — salary-crew-only forfeit entry (operator rules D3):
 *   - A forfeited series records as a single 1-0 result for the winner.
 *   - No player stats. Excluded from H2H tiebreakers automatically.
 *   - If this is the loser's 3rd forfeit in a row, salary crew gets a warning.
 * Partial forfeits: report the played games with /staff-report first, then
 * salary crew edits that series to 1-0 + forfeit on the website (stats stay).
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('report-ff')
        .setDescription('Salary crew: record a forfeited series (1-0, no player stats).')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true)
            .addChoices({ name: 'Majors', value: 'Majors' }, { name: 'AAA', value: 'AAA' }, { name: 'AA', value: 'AA' }))
        .addStringOption((o) => o.setName('winner').setDescription('Team receiving the win').setRequired(true)
            .addChoices(...TEAM_NAMES.map((t) => ({ name: t, value: t }))))
        .addStringOption((o) => o.setName('loser').setDescription('Team that forfeited').setRequired(true)
            .addChoices(...TEAM_NAMES.map((t) => ({ name: t, value: t }))))
        .addIntegerOption((o) => o.setName('week').setDescription('Week number').setRequired(false).setMinValue(1).setMaxValue(30))
        .addBooleanOption((o) => o.setName('playoffs').setDescription('Is this a playoff series?').setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        if (!isSalaryCrew(interaction.member)) {
            await interaction.editReply('❌ Only **salary crew** can record forfeits.');
            return;
        }

        const division = interaction.options.getString('division');
        const winnerName = interaction.options.getString('winner');
        const loserName = interaction.options.getString('loser');
        const week = interaction.options.getInteger('week') ?? null;
        const isPlayoff = Boolean(interaction.options.getBoolean('playoffs'));

        if (winnerName === loserName) {
            await interaction.editReply('❌ Winner and loser must be different teams.');
            return;
        }

        try {
            const season = await LeagueDB.getActiveSeason();
            if (!season) {
                await interaction.editReply('❌ No active season.');
                return;
            }
            const teams = await pool.query(
                `SELECT id, name FROM teams
                 WHERE season_id = $1 AND division = $2 AND is_active = TRUE
                   AND LOWER(name) IN (LOWER($3), LOWER($4))`,
                [season.id, division, winnerName, loserName]
            );
            const byName = new Map(teams.rows.map((t) => [t.name.toLowerCase(), t]));
            const winner = byName.get(winnerName.toLowerCase());
            const loser = byName.get(loserName.toLowerCase());
            if (!winner || !loser) {
                await interaction.editReply(`❌ Both teams must be active in ${division} this season.`);
                return;
            }

            // Block double-reporting: same matchup + week already confirmed (any source).
            const dupe = await pool.query(
                `SELECT id, home_score, away_score, is_forfeit FROM stats_series
                 WHERE season_id = $1 AND division = $2 AND status = 'confirmed'
                   AND week IS NOT DISTINCT FROM $3
                   AND ((home_team_id = $4 AND away_team_id = $5) OR (home_team_id = $5 AND away_team_id = $4))
                 LIMIT 1`,
                [season.id, division, week, winner.id, loser.id]
            );
            if (dupe.rows.length) {
                const d = dupe.rows[0];
                await interaction.editReply(`🔒 That matchup is **already reported** (series #${d.id}: ${d.home_score}–${d.away_score}${d.is_forfeit ? ' FF' : ''}). Edit or delete it from the website admin panel first.`);
                return;
            }

            // FF count callout (operator rule): show, big and highlighted, how many
            // forfeits this team will have in this division AFTER this one.
            const ffCount = await pool.query(
                `SELECT COUNT(*)::int AS n FROM stats_series
                 WHERE season_id = $1 AND division = $2 AND status = 'confirmed' AND is_forfeit = TRUE
                   AND (home_team_id = $3 OR away_team_id = $3) AND winner_team_id <> $3`,
                [season.id, division, loser.id]
            );
            const ffAfterThis = Number(ffCount.rows[0]?.n || 0) + 1;

            // FF = single 1-0 series (one synthetic game row carries the 1-0 game/goal diff).
            const result = await statsStore.commitSeries({
                seasonId: season.id, division, week, isPlayoff, format: isPlayoff ? 'bo7' : 'bo5',
                homeTeamId: winner.id, awayTeamId: loser.id,
                homeScore: 1, awayScore: 0,
                isForfeit: true, forfeitKind: 'full',
                group: {}, reportedByDiscordId: interaction.user.id, reportedVia: 'salary_crew_ff',
                games: [{ gameNumber: 1, homeGoals: 1, awayGoals: 0, isForfeit: true, players: [] }],
            });

            // 3 forfeits in a row by the losing team → warn salary crew (operator D3.5).
            let streakWarning = '';
            const recent = await pool.query(
                `SELECT is_forfeit, winner_team_id FROM stats_series
                 WHERE season_id = $1 AND status = 'confirmed'
                   AND (home_team_id = $2 OR away_team_id = $2)
                 ORDER BY id DESC LIMIT 3`,
                [season.id, loser.id]
            );
            const threeFFLossesInARow = recent.rows.length === 3 &&
                recent.rows.every((r) => r.is_forfeit && r.winner_team_id !== loser.id);
            if (threeFFLossesInARow || ffAfterThis >= 3) {
                streakWarning = threeFFLossesInARow
                    ? `\n⚠️ **${loser.name} has now forfeited 3 series in a row.**`
                    : `\n⚠️ **${loser.name} has reached ${ffAfterThis} total forfeits in ${division}.**`;
                await logEdge(interaction.client, {
                    summary: `${loser.name} (${division}) FF strike: ${threeFFLossesInARow ? '3 in a row' : `${ffAfterThis} total this season`}.`,
                    detail: 'Reported while recording this forfeit — review the team (no automatic punishment).',
                    division, pingInThread: false,
                });
                // Also ping the admin-configured stats channel (website Settings).
                try {
                    const { getConfig } = require('../utils/appConfig');
                    const statsChannelId = await getConfig('stats_channel_id');
                    if (statsChannelId) {
                        const ch = await interaction.client.channels.fetch(statsChannelId).catch(() => null);
                        if (ch?.isTextBased()) {
                            await ch.send(`⚠️ **FF strike:** ${loser.name} (${division}) — ${threeFFLossesInARow ? '3 forfeits in a row' : `${ffAfterThis} forfeits this season`}.`);
                        }
                    }
                } catch { /* stats channel optional */ }
            }

            // Result card (clearly labeled FORFEIT) → division channel + here.
            const card = await buildResultCard({
                winnerName: winner.name, loserName: loser.name, winnerScore: 1, loserScore: 0,
                division, week, isForfeit: true,
            });
            const embed = new EmbedBuilder()
                .setColor(0xE67E22)
                .setTitle(`🏳️ ${winner.name} 1–0 ${loser.name} (FF)`)
                .setDescription(`${division} · Week ${week ?? '—'} · **Forfeit**`)
                .setTimestamp();
            if (card) embed.setImage('attachment://result.png');
            const files = card ? [new AttachmentBuilder(card, { name: 'result.png' })] : [];

            const chId = DIVISION_RESULT_CHANNELS[division];
            if (chId) {
                const ch = await interaction.client.channels.fetch(chId).catch(() => null);
                if (ch?.isTextBased()) await ch.send({ embeds: [embed], files });
            }

            await interaction.editReply(
                `✅ Forfeit recorded: **${winner.name} 1–0 ${loser.name}** (${division}${week ? `, Week ${week}` : ''}). Series #${result.seriesId}.` +
                `\n\n# ⚠️ ${loser.name} now has ${ffAfterThis} forfeit${ffAfterThis === 1 ? '' : 's'} in ${division} this season.${streakWarning}`
            );
        } catch (error) {
            Logger.error('/report-ff failed', error);
            await logEdge(interaction.client, { summary: 'Forfeit report failed.', error, division, pingInThread: false });
            await interaction.editReply(`❌ Failed to record the forfeit: ${error.message}`);
        }
    },
};
