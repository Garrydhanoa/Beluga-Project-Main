const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { ROLES, TEAM_ROLES } = require('../constants/roles');
const { LeagueDB, ScoreReportDB } = require('./database');
const Logger = require('./logger');

const FINAL_CONFIRMATION_CHANNEL_ID = '1444621891275985037';

function normalizeTeamName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toDbDivision(division) {
    if (String(division).toUpperCase() === 'MAJORS') return 'Majors';
    return String(division || '').toUpperCase();
}

function isBallchasingGroupUrl(url) {
    return /^https:\/\/ballchasing\.com\/group\//i.test(String(url || '').trim());
}

function parseBallchasingGroupId(url) {
    const raw = String(url || '').trim();
    const match = raw.match(/^https:\/\/ballchasing\.com\/group\/([A-Za-z0-9_-]+)(?:[/?#].*)?$/i);
    return match ? match[1] : null;
}

function parseReplayUrl(url) {
    const raw = String(url || '').trim();
    const match = raw.match(/^https:\/\/ballchasing\.com\/replay\/([0-9a-f-]{36})(?:[/?#].*)?$/i);
    if (!match) return null;

    return {
        replayId: match[1].toLowerCase(),
        replayUrl: `https://ballchasing.com/replay/${match[1].toLowerCase()}`,
    };
}

function guessWeekFromChannel(channel) {
    const name = String(channel?.name || '');
    const weekMatch = name.match(/week[\s\-_]*(\d{1,2})/i);
    if (!weekMatch) return null;

    const parsed = Number(weekMatch[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function hasSalaryCrewRole(member) {
    return Boolean(member?.roles?.cache?.has(ROLES.SALARY_CREW));
}

function hasCaptainRoleForDivision(member, division) {
    const roleId = ROLES.CAPTAINS[division];
    if (!roleId) return false;
    return Boolean(member?.roles?.cache?.has(roleId));
}

function hasGmRoleForTeam(member, teamName) {
    const roleId = ROLES.GM_ROLES[teamName];
    if (!roleId) return false;
    return Boolean(member?.roles?.cache?.has(roleId));
}

function getApproverTeamId(member, division, homeTeam, awayTeam) {
    const divisionRoles = TEAM_ROLES[division] || {};

    const homeRole = divisionRoles[homeTeam.name] || ROLES.GM_ROLES[homeTeam.name];
    if (homeRole && member.roles.cache.has(homeRole)) return homeTeam.id;

    const awayRole = divisionRoles[awayTeam.name] || ROLES.GM_ROLES[awayTeam.name];
    if (awayRole && member.roles.cache.has(awayRole)) return awayTeam.id;

    return null;
}

async function fetchReplayStats(replayId) {
    const apiKey = process.env.BALLCHASING_API_KEY;
    if (!apiKey) {
        throw new Error('BALLCHASING_API_KEY is missing.');
    }

    const response = await fetch(`https://ballchasing.com/api/replays/${replayId}`, {
        headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Ballchasing API error ${response.status}`);
    }

    return response.json();
}

async function fetchGroupReplayIds(groupId) {
    const apiKey = process.env.BALLCHASING_API_KEY;
    if (!apiKey) {
        throw new Error('BALLCHASING_API_KEY is missing.');
    }

    const ids = [];
    let nextUrl = `https://ballchasing.com/api/replays?group=${encodeURIComponent(groupId)}&count=200`;
    while (nextUrl) {
        const response = await fetch(nextUrl, {
            headers: {
                Authorization: apiKey,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Ballchasing group API error ${response.status} for group ${groupId}`);
        }
        const data = await response.json();
        const list = Array.isArray(data?.list) ? data.list : [];
        for (const item of list) {
            if (item?.id) ids.push(String(item.id).toLowerCase());
        }
        nextUrl = data?.next || null;
    }
    if (ids.length === 0) {
        throw new Error(`Ballchasing group ${groupId} contains no replays (or API returned an empty list).`);
    }
    return ids;
}

function mapReplayTeamsToSeries(replay, homeTeamName, awayTeamName) {
    const homeNorm = normalizeTeamName(homeTeamName);
    const awayNorm = normalizeTeamName(awayTeamName);

    const blueName = normalizeTeamName(replay?.blue?.name || '');
    const orangeName = normalizeTeamName(replay?.orange?.name || '');

    const blueLooksHome = blueName.includes(homeNorm) || homeNorm.includes(blueName);
    const blueLooksAway = blueName.includes(awayNorm) || awayNorm.includes(blueName);
    const orangeLooksHome = orangeName.includes(homeNorm) || homeNorm.includes(orangeName);
    const orangeLooksAway = orangeName.includes(awayNorm) || awayNorm.includes(orangeName);

    if (blueLooksHome && orangeLooksAway) {
        return {
            homeSide: 'blue',
            awaySide: 'orange',
        };
    }

    if (blueLooksAway && orangeLooksHome) {
        return {
            homeSide: 'orange',
            awaySide: 'blue',
        };
    }

    return null;
}

function extractReplayPlayerStats(mappedReplay, homeTeamId, awayTeamId) {
    const { replay, sideMap } = mappedReplay;
    const home = replay[sideMap.homeSide] || { players: [] };
    const away = replay[sideMap.awaySide] || { players: [] };

    const mapLine = (player, teamId, teamColor) => {
        const core = player?.stats?.core || {};
        return {
            teamId,
            teamName: teamColor === 'blue' ? replay.blue?.name : replay.orange?.name,
            playerName: player?.name || 'Unknown',
            platform: player?.id?.platform || null,
            platformId: player?.id?.id || null,
            teamColor,
            goals: Number(core.goals || 0),
            assists: Number(core.assists || 0),
            saves: Number(core.saves || 0),
            shots: Number(core.shots || 0),
            score: Number(core.score || 0),
            stats: core,
        };
    };

    const homeLines = (home.players || []).map((p) => mapLine(p, homeTeamId, sideMap.homeSide));
    const awayLines = (away.players || []).map((p) => mapLine(p, awayTeamId, sideMap.awaySide));

    return [...homeLines, ...awayLines];
}

function sumGoalStats(mappedReplays) {
    return mappedReplays.reduce(
        (acc, item) => {
            const replay = item.replay;
            const homeGoals = Number(replay?.[item.sideMap.homeSide]?.goals || 0);
            const awayGoals = Number(replay?.[item.sideMap.awaySide]?.goals || 0);
            return {
                homeGoalsFor: acc.homeGoalsFor + homeGoals,
                homeGoalsAgainst: acc.homeGoalsAgainst + awayGoals,
                awayGoalsFor: acc.awayGoalsFor + awayGoals,
                awayGoalsAgainst: acc.awayGoalsAgainst + homeGoals,
            };
        },
        { homeGoalsFor: 0, homeGoalsAgainst: 0, awayGoalsFor: 0, awayGoalsAgainst: 0 }
    );
}

function calculateSeriesScore(mappedReplays) {
    let homeScore = 0;
    let awayScore = 0;

    for (const item of mappedReplays) {
        const replay = item.replay;
        const homeGoals = Number(replay?.[item.sideMap.homeSide]?.goals || 0);
        const awayGoals = Number(replay?.[item.sideMap.awaySide]?.goals || 0);
        if (homeGoals > awayGoals) homeScore += 1;
        if (awayGoals > homeGoals) awayScore += 1;
    }

    return { homeScore, awayScore };
}

async function resolveSeasonAndTeams(division, homeTeamName, awayTeamName) {
    const season = await LeagueDB.getActiveSeason();
    if (!season) {
        throw new Error('No active season found in the database.');
    }

    const dbDivision = toDbDivision(division);

    const homeTeam = await ScoreReportDB.findTeamByName(season.id, dbDivision, homeTeamName);
    const awayTeam = await ScoreReportDB.findTeamByName(season.id, dbDivision, awayTeamName);

    if (!homeTeam || !awayTeam) {
        throw new Error('One or both teams are not active in this division for the current season.');
    }

    return { season, homeTeam, awayTeam, dbDivision };
}

function buildCaptainApprovalComponents(seriesId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`sr:captain:approve:${seriesId}`)
                .setLabel('Captain/GM Approve')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`sr:captain:reject:${seriesId}`)
                .setLabel('Captain/GM Reject')
                .setStyle(ButtonStyle.Danger)
        ),
    ];
}

function buildSalaryApprovalComponents(seriesId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`sr:salary:approve:${seriesId}`)
                .setLabel('Salary Crew Approve Final')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`sr:salary:reject:${seriesId}`)
                .setLabel('Salary Crew Reject')
                .setStyle(ButtonStyle.Danger)
        ),
    ];
}

function buildSeriesEmbed(title, series, options = {}) {
    const reportTag = series.report_type === 'ff' ? 'FF (3-0 standings only)' : 'Standard';
    const isPlayoff = Boolean(series.is_playoff);
    const lines = [
        `Division: ${series.division}`,
        `Week: ${series.week || 'Manual'}`,
        `Type: ${reportTag}`,
        `Playoffs: ${isPlayoff ? 'Yes' : 'No'}`,
        `Status: ${series.status}`,
    ];

    if (series.home_team_name && series.away_team_name) {
        lines.push(`Series: ${series.home_team_name} ${series.home_score} - ${series.away_score} ${series.away_team_name}`);
    }

    if (options.extraLine) {
        lines.push(options.extraLine);
    }

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(lines.join('\n'))
        .setColor(options.color || 0x3498db)
        .setTimestamp();
}

async function sendSalaryFinalMessage(client, series) {
    const channel = await client.channels.fetch(FINAL_CONFIRMATION_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
        throw new Error('Final confirmation channel is not available.');
    }

    const embed = buildSeriesEmbed('Score Report Final Approval', series, {
        color: 0xf1c40f,
        extraLine: 'Salary crew: please approve or reject this final result.',
    });

    const message = await channel.send({
        embeds: [embed],
        components: buildSalaryApprovalComponents(series.id),
    });

    await ScoreReportDB.setSeriesMessages(series.id, {
        salaryMessageId: message.id,
        salaryChannelId: channel.id,
    });

    return message;
}

async function finalizeSeries(series) {
    if (series.status === 'completed') {
        return { ok: true, note: 'already completed' };
    }

    if (series.report_type === 'ff') {
        const teamRecordApplied = await ScoreReportDB.applyTeamRecord(series, {
            homeGoalsFor: 0,
            homeGoalsAgainst: 0,
            awayGoalsFor: 0,
            awayGoalsAgainst: 0,
        });
        if (!teamRecordApplied) {
            throw new Error('Failed to apply FF team records.');
        }
        await ScoreReportDB.setSeriesStatus(series.id, 'completed', false);
        return { ok: true, note: 'ff completed' };
    }

    const replayResult = await ScoreReportDB.getSeries(series.id);
    if (!replayResult) {
        throw new Error('Series not found while finalizing.');
    }

    const replaysQuery = await ScoreReportDB.getSeries(series.id);
    if (!replaysQuery) {
        throw new Error('Series is missing replay data.');
    }

    const replayRows = await (async () => {
        const { pool, isDatabaseAvailable } = require('./database');
        if (!isDatabaseAvailable()) return [];
        const result = await pool.query('SELECT * FROM match_replays WHERE series_id = $1 ORDER BY id ASC', [series.id]);
        return result.rows;
    })();

    const playersRows = await (async () => {
        const { pool, isDatabaseAvailable } = require('./database');
        if (!isDatabaseAvailable()) return [];
        const result = await pool.query(
            `SELECT mrp.*
             FROM match_replay_players mrp
             JOIN match_replays mr ON mr.id = mrp.replay_id
             WHERE mr.series_id = $1`,
            [series.id]
        );
        return result.rows;
    })();

    const goalSums = replayRows.reduce(
        (acc, row) => ({
            homeGoalsFor: acc.homeGoalsFor + Number(row.home_goals || 0),
            homeGoalsAgainst: acc.homeGoalsAgainst + Number(row.away_goals || 0),
            awayGoalsFor: acc.awayGoalsFor + Number(row.away_goals || 0),
            awayGoalsAgainst: acc.awayGoalsAgainst + Number(row.home_goals || 0),
        }),
        { homeGoalsFor: 0, homeGoalsAgainst: 0, awayGoalsFor: 0, awayGoalsAgainst: 0 }
    );

    const teamRecordApplied = await ScoreReportDB.applyTeamRecord(series, goalSums);
    if (!teamRecordApplied) {
        throw new Error('Failed to apply team records.');
    }

    for (const player of playersRows) {
        await ScoreReportDB.applyPlayerStatLine(series.season_id, series.division, {
            teamId: player.team_id,
            playerName: player.player_name,
            platform: player.platform,
            platformId: player.platform_id,
            goals: Number(player?.stats?.goals || 0),
            assists: Number(player?.stats?.assists || 0),
            saves: Number(player?.stats?.saves || 0),
            shots: Number(player?.stats?.shots || 0),
            score: Number(player?.stats?.score || 0),
        });
    }

    await ScoreReportDB.setSeriesStatus(series.id, 'completed', true);
    return { ok: true, note: 'completed' };
}

async function submitSeries({
    interaction,
    division,
    homeTeamName,
    awayTeamName,
    week,
    isPlayoff,
    reportType,
    replayUrls,
    reportSource,
    requireApprovals,
}) {
    const { season, homeTeam, awayTeam, dbDivision } = await resolveSeasonAndTeams(division, homeTeamName, awayTeamName);

    let mappedReplays = [];
    let score = { homeScore: 0, awayScore: 0 };
    let goalSums = { homeGoalsFor: 0, homeGoalsAgainst: 0, awayGoalsFor: 0, awayGoalsAgainst: 0 };

    if (reportType !== 'ff') {
        if (!replayUrls.length) {
            throw new Error('At least one replay link is required.');
        }

        if (replayUrls.length > 7) {
            throw new Error('A maximum of 7 replay links is allowed.');
        }

        const expandedReplayIds = [];
        const seenReplayIds = new Set();

        for (const replayUrl of replayUrls) {
            if (isBallchasingGroupUrl(replayUrl)) {
                const groupId = parseBallchasingGroupId(replayUrl);
                if (!groupId) {
                    throw new Error(`Invalid Ballchasing group URL: ${replayUrl}`);
                }
                const groupReplayIds = await fetchGroupReplayIds(groupId);
                for (const id of groupReplayIds) {
                    if (!seenReplayIds.has(id)) {
                        seenReplayIds.add(id);
                        expandedReplayIds.push({
                            replayId: id,
                            replayUrl: `https://ballchasing.com/replay/${id}`,
                        });
                    }
                }
                continue;
            }

            const parsed = parseReplayUrl(replayUrl);
            if (!parsed) {
                throw new Error('Invalid replay URL. Use https://ballchasing.com/replay/<uuid> or https://ballchasing.com/group/<id>.');
            }
            if (!seenReplayIds.has(parsed.replayId)) {
                seenReplayIds.add(parsed.replayId);
                expandedReplayIds.push(parsed);
            }
        }

        if (expandedReplayIds.length === 0) {
            throw new Error('No replays found in the provided links.');
        }
        if (expandedReplayIds.length > 7) {
            throw new Error(`Series produced ${expandedReplayIds.length} replays (max 7). Trim the group or pass individual replays.`);
        }

        for (const parsed of expandedReplayIds) {
            const replay = await fetchReplayStats(parsed.replayId);
            const sideMap = mapReplayTeamsToSeries(replay, homeTeam.name, awayTeam.name);
            if (!sideMap) {
                throw new Error(`Replay ${parsed.replayId} does not match ${homeTeam.name} vs ${awayTeam.name}.`);
            }

            mappedReplays.push({
                parsed,
                replay,
                sideMap,
                playerLines: extractReplayPlayerStats({ replay, sideMap }, homeTeam.id, awayTeam.id),
            });
        }

        score = calculateSeriesScore(mappedReplays);
        goalSums = sumGoalStats(mappedReplays);
    } else {
        score = { homeScore: 3, awayScore: 0 };
    }

    const threadId = interaction.channel?.isThread?.() ? interaction.channel.id : null;

    const series = await ScoreReportDB.createSeries({
        seasonId: season.id,
        division: dbDivision,
        week,
        isPlayoff,
        playoffMatchupId: null,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        homeScore: score.homeScore,
        awayScore: score.awayScore,
        isForfeit: reportType === 'ff',
        reportType,
        reportSource,
        status: requireApprovals ? 'pending_captains' : 'pending_salary',
        threadId,
        reportedByDiscordId: interaction.user.id,
        reportedByUsername: interaction.user.username,
    });

    if (!series) {
        throw new Error('Failed to create score report series.');
    }

    if (reportType !== 'ff') {
        for (const item of mappedReplays) {
            const replayRow = await ScoreReportDB.addReplay(series.id, {
                ballchasingId: item.parsed.replayId,
                ballchasingUrl: item.parsed.replayUrl,
                status: item.replay.status || 'ok',
                homeTeamId: homeTeam.id,
                awayTeamId: awayTeam.id,
                homeGoals: Number(item.replay?.[item.sideMap.homeSide]?.goals || 0),
                awayGoals: Number(item.replay?.[item.sideMap.awaySide]?.goals || 0),
            });

            if (!replayRow) continue;
            await ScoreReportDB.addReplayPlayers(replayRow.id, item.playerLines);
        }
    }

    if (!requireApprovals) {
        const sent = await sendSalaryFinalMessage(interaction.client, {
            ...series,
            home_team_name: homeTeam.name,
            away_team_name: awayTeam.name,
        });

        await ScoreReportDB.setSeriesMessages(series.id, {
            salaryMessageId: sent.id,
            salaryChannelId: FINAL_CONFIRMATION_CHANNEL_ID,
        });

        return {
            seriesId: series.id,
            status: 'pending_salary',
            summary: `${homeTeam.name} ${score.homeScore}-${score.awayScore} ${awayTeam.name}`,
            goals: goalSums,
        };
    }

    const captainEmbed = buildSeriesEmbed('Score Report Captain/GM Approval', {
        ...series,
        home_team_name: homeTeam.name,
        away_team_name: awayTeam.name,
    }, {
        color: 0x2980b9,
        extraLine: 'Captains/GMs: one approval per team is required before salary crew final.',
    });

    const captainMessage = await interaction.channel.send({
        embeds: [captainEmbed],
        components: buildCaptainApprovalComponents(series.id),
    });

    await ScoreReportDB.setSeriesMessages(series.id, {
        captainMessageId: captainMessage.id,
    });

    return {
        seriesId: series.id,
        status: 'pending_captains',
        summary: `${homeTeam.name} ${score.homeScore}-${score.awayScore} ${awayTeam.name}`,
        goals: goalSums,
    };
}

async function handleScoreReportButton(interaction) {
    const [prefix, stage, decision, seriesIdRaw] = String(interaction.customId || '').split(':');
    if (prefix !== 'sr') return false;

    const seriesId = Number(seriesIdRaw);
    if (!Number.isFinite(seriesId)) {
        await interaction.reply({ content: 'Invalid series id.', flags: 64 });
        return true;
    }

    const series = await ScoreReportDB.getSeries(seriesId);
    if (!series) {
        await interaction.reply({ content: 'Series not found.', flags: 64 });
        return true;
    }

    if (series.status === 'completed') {
        await interaction.reply({ content: 'Series already completed.', flags: 64 });
        return true;
    }

    if (stage === 'captain') {
        const divisionKey = String(series.division || '').toUpperCase();
        const hasCaptain = hasCaptainRoleForDivision(interaction.member, divisionKey);
        const hasGm = hasGmRoleForTeam(interaction.member, series.home_team_name) || hasGmRoleForTeam(interaction.member, series.away_team_name);

        if (!hasCaptain && !hasGm) {
            await interaction.reply({ content: 'Only captains/GMs for this matchup can use this button.', flags: 64 });
            return true;
        }

        const approverTeamId = getApproverTeamId(
            interaction.member,
            divisionKey,
            { id: series.home_team_id, name: series.home_team_name },
            { id: series.away_team_id, name: series.away_team_name }
        );

        await ScoreReportDB.addApproval(
            seriesId,
            approverTeamId,
            interaction.user.id,
            interaction.user.username,
            hasGm ? 'gm' : 'captain',
            decision
        );

        const approvals = await ScoreReportDB.getApprovals(seriesId);
        const rejected = approvals.some((a) => a.decision === 'reject');

        if (rejected) {
            await ScoreReportDB.setSeriesStatus(seriesId, 'rejected');
            await interaction.update({
                embeds: [buildSeriesEmbed('Score Report Rejected', series, { color: 0xc0392b })],
                components: [],
            });
            return true;
        }

        const approvedTeamIds = new Set(
            approvals.filter((a) => a.decision === 'approve' && a.team_id).map((a) => a.team_id)
        );

        const readyForSalary = approvedTeamIds.has(series.home_team_id) && approvedTeamIds.has(series.away_team_id);

        if (readyForSalary) {
            await ScoreReportDB.setSeriesStatus(seriesId, 'pending_salary');
            const updatedSeries = await ScoreReportDB.getSeries(seriesId);
            await sendSalaryFinalMessage(interaction.client, updatedSeries);
            await interaction.update({
                embeds: [buildSeriesEmbed('Captain/GM Approval Complete', updatedSeries, {
                    color: 0x27ae60,
                    extraLine: 'Sent to salary crew for final confirmation.',
                })],
                components: [],
            });
            return true;
        }

        await interaction.reply({
            content: 'Approval recorded. Waiting for the other team captain/GM.',
            flags: 64,
        });
        return true;
    }

    if (stage === 'salary') {
        if (!hasSalaryCrewRole(interaction.member)) {
            await interaction.reply({ content: 'Only salary crew can use this final confirmation.', flags: 64 });
            return true;
        }

        await ScoreReportDB.addApproval(
            seriesId,
            null,
            interaction.user.id,
            interaction.user.username,
            'salary',
            decision
        );

        if (decision === 'reject') {
            await ScoreReportDB.setSeriesStatus(seriesId, 'rejected');
            await interaction.update({
                embeds: [buildSeriesEmbed('Score Report Rejected By Salary Crew', series, { color: 0xc0392b })],
                components: [],
            });
            return true;
        }

        try {
            await finalizeSeries(series);
            const completed = await ScoreReportDB.getSeries(seriesId);
            await interaction.update({
                embeds: [buildSeriesEmbed('Score Report Finalized', completed, { color: 0x27ae60 })],
                components: [],
            });
        } catch (error) {
            Logger.error('Failed to finalize series', error);
            await interaction.reply({ content: `Failed to finalize series: ${error.message}`, flags: 64 });
        }

        return true;
    }

    return false;
}

module.exports = {
    FINAL_CONFIRMATION_CHANNEL_ID,
    normalizeTeamName,
    isBallchasingGroupUrl,
    parseBallchasingGroupId,
    parseReplayUrl,
    guessWeekFromChannel,
    hasSalaryCrewRole,
    fetchReplayStats,
    fetchGroupReplayIds,
    submitSeries,
    handleScoreReportButton,
};
