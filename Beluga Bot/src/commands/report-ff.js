const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, LeagueDB } = require('../utils/database');
const { teamAutocomplete } = require('../utils/teamRoles');
const { isSalaryCrew } = require('../stats/report/threadContext');
const { DIVISION_RESULT_CHANNELS } = require('../stats/report/constants');
const { logEdge } = require('../stats/report/logChannel');
const { buildResultCard } = require('../stats/report/resultCard');
const statsStore = require('../stats/statsStore');
const Logger = require('../utils/logger');

/**
 * /report-ff — salary-crew-only forfeit entry (operator rules D3):
 *   - A full forfeit records as a single 1-0 result for the winner.
 *   - A DOUBLE forfeit (both teams no-showed) has no winner: each team is charged
 *     the same 0-1 loss the loser of a full FF takes, and it is a strike for both.
 *   - No player stats. Excluded from H2H tiebreakers automatically.
 *   - If this is a team's 3rd forfeit in a row, salary crew gets a warning.
 * Partial forfeits: report the played games with /staff-report first, then
 * salary crew edits that series to 1-0 + forfeit on the website (stats stay).
 *
 * `week` is REQUIRED: the unreported-week gate matches on s.week = wt.week_number,
 * so a week-less forfeit would leave the matchup permanently "unreported" and
 * block that week from ever being closed without a force-delete.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('report-ff')
        .setDescription('Salary crew: record a forfeited series (no player stats).')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true)
            .addChoices({ name: 'Majors', value: 'Majors' }, { name: 'AAA', value: 'AAA' }, { name: 'AA', value: 'AA' }))
        .addStringOption((o) => o.setName('winner').setDescription('Team receiving the win (double forfeit: just one of the two teams)').setRequired(true)
            .setAutocomplete(true))
        .addStringOption((o) => o.setName('loser').setDescription('Team that forfeited (double forfeit: the other team)').setRequired(true)
            .setAutocomplete(true))
        .addIntegerOption((o) => o.setName('week').setDescription('Week number').setRequired(true).setMinValue(1).setMaxValue(30))
        .addStringOption((o) => o.setName('type').setDescription('Forfeit type (default: full)').setRequired(false)
            .addChoices(
                { name: 'Full forfeit — 1-0 to the winner', value: 'full' },
                { name: 'Double forfeit — both teams take a 0-1 loss', value: 'double' },
            ))
        .addBooleanOption((o) => o.setName('playoffs').setDescription('Is this a playoff series?').setRequired(false)),

    // Live team list from the current season (DB), filtered by the chosen division.
    async autocomplete(interaction) {
        await teamAutocomplete(interaction, { valueField: 'name', divisionOptionName: 'division' });
    },

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        if (!isSalaryCrew(interaction.member)) {
            await interaction.editReply('❌ Only **salary crew** can record forfeits.');
            return;
        }

        const division = interaction.options.getString('division');
        const winnerName = interaction.options.getString('winner');
        const loserName = interaction.options.getString('loser');
        const week = interaction.options.getInteger('week');
        const forfeitKind = interaction.options.getString('type') || statsStore.FULL_FORFEIT;
        const isDouble = forfeitKind === statsStore.DOUBLE_FORFEIT;
        const isPlayoff = Boolean(interaction.options.getBoolean('playoffs'));

        if (winnerName === loserName) {
            await interaction.editReply(isDouble
                ? '❌ The two teams must be different.'
                : '❌ Winner and loser must be different teams.');
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

            // Which teams are charged a forfeit? A full FF strikes only the loser;
            // a double FF strikes BOTH.
            const charged = isDouble ? [winner, loser] : [loser];

            // FF count callout (operator rule): show, big and highlighted, how many
            // forfeits each charged team will have in this division AFTER this one.
            // NOTE `winner_team_id IS NULL OR ...`: a double FF has no winner, and
            // `NULL <> id` is NULL, not TRUE — without this a double forfeit would
            // count as a strike against nobody at all.
            const ffAfterThis = new Map();
            for (const team of charged) {
                const ffCount = await pool.query(
                    `SELECT COUNT(*)::int AS n FROM stats_series
                     WHERE season_id = $1 AND division = $2 AND status = 'confirmed' AND is_forfeit = TRUE
                       AND (home_team_id = $3 OR away_team_id = $3)
                       AND (winner_team_id IS NULL OR winner_team_id <> $3)`,
                    [season.id, division, team.id]
                );
                ffAfterThis.set(team.id, Number(ffCount.rows[0]?.n || 0) + 1);
            }

            // Full FF   = a single 1-0 series (one synthetic game row carries the 1-0 game/goal diff).
            // Double FF = no winner and NO game rows; recomputeTeamSeason charges both
            //             teams the 0-1 loss directly off forfeit_kind.
            const result = await statsStore.commitSeries({
                seasonId: season.id, division, week, isPlayoff, format: isPlayoff ? 'bo7' : 'bo5',
                homeTeamId: winner.id, awayTeamId: loser.id,
                homeScore: isDouble ? 0 : 1, awayScore: 0,
                isForfeit: true, forfeitKind,
                group: {}, reportedByDiscordId: interaction.user.id,
                reportedVia: isDouble ? 'salary_crew_ff_double' : 'salary_crew_ff',
                games: isDouble ? [] : [{ gameNumber: 1, homeGoals: 1, awayGoals: 0, isForfeit: true, players: [] }],
            });

            // 3 forfeits in a row by a charged team → warn salary crew (operator D3.5).
            let streakWarning = '';
            for (const team of charged) {
                const total = ffAfterThis.get(team.id);
                const recent = await pool.query(
                    `SELECT is_forfeit, winner_team_id FROM stats_series
                     WHERE season_id = $1 AND status = 'confirmed'
                       AND (home_team_id = $2 OR away_team_id = $2)
                     ORDER BY id DESC LIMIT 3`,
                    [season.id, team.id]
                );
                const threeFFLossesInARow = recent.rows.length === 3 &&
                    recent.rows.every((r) => r.is_forfeit && r.winner_team_id !== team.id);
                if (!threeFFLossesInARow && total < 3) continue;

                streakWarning += threeFFLossesInARow
                    ? `\n⚠️ **${team.name} has now forfeited 3 series in a row.**`
                    : `\n⚠️ **${team.name} has reached ${total} total forfeits in ${division}.**`;
                await logEdge(interaction.client, {
                    summary: `${team.name} (${division}) FF strike: ${threeFFLossesInARow ? '3 in a row' : `${total} total this season`}.`,
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
                            await ch.send(`⚠️ **FF strike:** ${team.name} (${division}) — ${threeFFLossesInARow ? '3 forfeits in a row' : `${total} forfeits this season`}.`);
                        }
                    }
                } catch { /* stats channel optional */ }
            }

            // Result card (clearly labeled FORFEIT) → division channel + here.
            const card = await buildResultCard({
                winnerName: winner.name, loserName: loser.name,
                winnerScore: isDouble ? 0 : 1, loserScore: 0,
                division, week, isForfeit: true, isDoubleForfeit: isDouble,
            });
            const embed = new EmbedBuilder()
                .setColor(0xE67E22)
                .setTitle(isDouble
                    ? `🏳️ ${winner.name} 0–0 ${loser.name} (Double FF)`
                    : `🏳️ ${winner.name} 1–0 ${loser.name} (FF)`)
                .setDescription(isDouble
                    ? `${division} · Week ${week} · **Double forfeit** — both teams take a 0–1 loss.`
                    : `${division} · Week ${week} · **Forfeit**`)
                .setTimestamp();
            if (card) embed.setImage('attachment://result.png');
            const files = card ? [new AttachmentBuilder(card, { name: 'result.png' })] : [];

            const chId = DIVISION_RESULT_CHANNELS[division];
            if (chId) {
                const ch = await interaction.client.channels.fetch(chId).catch(() => null);
                if (ch?.isTextBased()) await ch.send({ embeds: [embed], files });
            }

            const tally = charged
                .map((team) => {
                    const n = ffAfterThis.get(team.id);
                    return `${team.name} now has ${n} forfeit${n === 1 ? '' : 's'} in ${division} this season.`;
                })
                .join('\n');
            await interaction.editReply(
                (isDouble
                    ? `✅ Double forfeit recorded: **${winner.name}** and **${loser.name}** each take a **0–1 loss** (${division}, Week ${week}). Series #${result.seriesId}.`
                    : `✅ Forfeit recorded: **${winner.name} 1–0 ${loser.name}** (${division}, Week ${week}). Series #${result.seriesId}.`) +
                `\n\n# ⚠️ ${tally}${streakWarning}`
            );
        } catch (error) {
            Logger.error('/report-ff failed', error);
            await logEdge(interaction.client, { summary: 'Forfeit report failed.', error, division, pingInThread: false });
            await interaction.editReply(`❌ Failed to record the forfeit: ${error.message}`);
        }
    },
};
