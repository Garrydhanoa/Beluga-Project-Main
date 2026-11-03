const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Logger = require('./logger');
const higgenLog = require('./higgenLog');
const { RosterDB, LeagueDB, isDatabaseAvailable } = require('./database');
const { CHANNELS } = require('../constants/roles');
const { divisionLabel: divisionDisplay } = require('./divisionLabels');
const { sameDivision } = require('./primaryDivision');
const {
    getActiveTeams,
    getTeamDiscordRoles,
    getTeamColorInt,
    getTeamLogoBuffer,
    getTeamLogoBufferByName,
    getCaptainRoleId,
} = require('./teamRoles');
// Channel IDs for each division (roster-specific)
const ROSTER_CHANNELS = {
    MAJORS: '1209370015560769637',
    AAA: '1240859362008895561',
    AA: '1201768054363803668'
};

const DIVISION_LABELS = {
    MAJORS: 'Majors',
    AAA: 'AAA',
    AA: 'AA'
};

/** Logo attachment for a team — DB only (team logo → franchise logo). */
async function getLogoAttachment(teamId, teamName) {
    try {
        let buf = teamId != null ? await getTeamLogoBuffer(teamId) : null;
        if (!buf && getTeamLogoBufferByName) buf = await getTeamLogoBufferByName(teamName).catch(() => null);
        if (buf) return new AttachmentBuilder(buf, { name: 'team_logo.png' });
    } catch { /* no logo */ }
    return null;
}

/**
 * Generate a hash for roster data to detect changes
 */
function generateRosterHash(rosterData, { seasonNumber = null, colorInt = null } = {}) {
    const { teamName, division, gm, captain, players } = rosterData;

    const gmId = gm ? gm.id : 'none';
    const agmIds = (rosterData.agms || []).map(m => m.id).sort().join(',') || 'none';
    const captainId = captain ? captain.id : 'none';
    const playerIds = players
        .map(p => p.id)
        .sort()
        .join(',');

    // Season + colour are part of the hash so a rollover or a franchise colour
    // change re-renders the embed instead of being skipped as "no changes".
    return `S${seasonNumber ?? '?'}|${colorInt ?? ''}|${teamName}|${division}|${gmId}|${agmIds}|${captainId}|${playerIds}`;
}

/**
 * Get team roster data for a DB team row ({ id, name, division }) — all role
 * IDs come from the database (team role on the team, GM on the franchise);
 * the captain role is the fixed per-division role.
 */
async function getTeamRoster(guild, team, division) {
    try {
        const roles = await getTeamDiscordRoles(team.id);
        if (!roles.teamRoleId) {
            Logger.warning(`No team role ID in the database for ${team.name} (${team.division}) — roster skipped`);
            return null;
        }

        const teamRole = await guild.roles.fetch(roles.teamRoleId).catch(() => null);
        if (!teamRole) return null;

        const members = teamRole.members;
        const captainRoleId = getCaptainRoleId(division);

        // Captain = member of this team holding the division captain role.
        let captain = null;
        if (captainRoleId) {
            for (const [, member] of members) {
                if (member.roles.cache.has(captainRoleId)) {
                    captain = member;
                    break;
                }
            }
        }

        // GM from the franchise role.
        let gm = null;
        if (roles.gmRoleId) {
            const gmRole = await guild.roles.fetch(roles.gmRoleId).catch(() => null);
            if (gmRole && gmRole.members.size > 0) {
                gm = gmRole.members.first();
            }
        }

        // Assistant GM(s) from the franchise AGM role (S11).
        let agms = [];
        if (roles.agmRoleId) {
            const agmRole = await guild.roles.fetch(roles.agmRoleId).catch(() => null);
            if (agmRole) agms = [...agmRole.members.values()].filter(m => m.id !== gm?.id);
        }

        const players = [];
        for (const [, member] of members) {
            players.push(member);
        }

        return {
            teamId: team.id,
            teamName: team.name,
            division,
            gm,
            agms,
            captain,
            players,
            totalPlayers: members.size
        };
    } catch (error) {
        Logger.error(`Failed to get roster for ${team?.name} ${division}`, error);
        return null;
    }
}

/**
 * Create roster embed for a team (color from the DB franchise color). The
 * season number sits in the footer so every message says which season it is.
 */
function createRosterEmbed(rosterData, { colorInt = 0x3498DB, seasonNumber = null } = {}) {
    const { teamName, division, gm, captain, players, totalPlayers } = rosterData;

    const embed = new EmbedBuilder()
        .setTitle(`${teamName} — ${divisionDisplay(division)}`)
        .setColor(colorInt)
        .setThumbnail('attachment://team_logo.png')
        .setTimestamp();
    if (seasonNumber != null) embed.setFooter({ text: `Season ${seasonNumber}` });

    const gmText = gm ? (gm.nickname || gm.user.username) : '*No GM assigned*';
    embed.addFields({ name: '👑 General Manager', value: gmText, inline: false });

    const agms = rosterData.agms || [];
    if (agms.length) {
        embed.addFields({ name: 'Assistant GM', value: agms.map(m => m.nickname || m.user.username).join('\n').slice(0, 1024), inline: false });
    }

    const captainText = captain ? (captain.nickname || captain.user.username) : '*No captain assigned*';
    embed.addFields({ name: '⭐ Captain', value: captainText, inline: false });

    if (players.length > 0) {
        const playersList = players
            .sort((a, b) => {
                const nameA = (a.nickname || a.user.username).toLowerCase();
                const nameB = (b.nickname || b.user.username).toLowerCase();
                return nameA.localeCompare(nameB);
            })
            .map(p => p.nickname || p.user.username)
            .join('\n');

        embed.addFields({ name: `👥 Players (${totalPlayers})`, value: playersList, inline: false });
    } else {
        embed.addFields({ name: `👥 Players (${totalPlayers})`, value: '*No players*', inline: false });
    }

    return embed;
}

function buildRosterMembers(rosterData) {
    const rolePriority = { gm: 4, agm: 3, captain: 2, player: 1 };
    const byId = new Map();

    const upsert = (member, role) => {
        if (!member) return;
        const discordId = member.id;
        const discordUsername = member.user?.username || null;
        const displayName = member.nickname || member.user?.username || null;
        const existing = byId.get(discordId);

        if (!existing || rolePriority[role] > rolePriority[existing.role]) {
            byId.set(discordId, {
                discordId,
                discordUsername,
                displayName,
                role
            });
        }
    };

    upsert(rosterData.gm, 'gm');
    (rosterData.agms || []).forEach((member) => upsert(member, 'agm'));
    upsert(rosterData.captain, 'captain');

    rosterData.players.forEach((member) => upsert(member, 'player'));

    return Array.from(byId.values());
}

/**
 * Update roster for a specific division — the team list comes from the
 * DATABASE (active teams in the active season), not constants.
 */
async function updateDivisionRoster(client, division) {
    try {
        if (!isDatabaseAvailable()) {
            Logger.warning(`Database not available, skipping ${division} roster update`);
            if (division === 'MAJORS') {
                try {
                    const majorsChannel = await client.channels.fetch(CHANNELS.MAJORS);
                    if (majorsChannel) {
                        await majorsChannel.send('-# Database Not Available (SKIPPING ROSTER EDITS)');
                    }
                } catch (error) {
                    Logger.error('Failed to send database skip message', error);
                }
            }
            return false;
        }

        const channelId = ROSTER_CHANNELS[division];
        const channel = await client.channels.fetch(channelId);

        if (!channel) {
            Logger.error(`Roster channel not found for ${division}: ${channelId}`);
            return false;
        }

        Logger.info(`Updating ${division} roster...`);

        const divisionLabel = DIVISION_LABELS[division] || division;
        const activeSeason = await LeagueDB.getActiveSeason();
        if (!activeSeason) {
            Logger.warning('No active season found; skipping roster updates');
            return false;
        }
        const seasonNumber = activeSeason.season_number ?? activeSeason.seasonNumber ?? null;

        // DB team list for this division.
        const divisionTeams = (await getActiveTeams()).filter((t) => sameDivision(t.division, divisionLabel));

        // Embeds are tracked per season, so a new season starts empty: fresh
        // messages get posted and last season's stay in the channel as history.
        const saved = await RosterDB.getSeasonEmbeds(activeSeason.id, division);
        if (!saved) return false; // DB read failed — don't risk duplicate posts

        // One "Season N" divider per channel, before the season's first embed.
        if (saved.size === 0 && divisionTeams.length && !(await RosterDB.getHeader(activeSeason.id, division))) {
            try {
                const header = await channel.send({
                    content: `## Season ${seasonNumber ?? ''} Rosters — ${divisionDisplay(division)}`,
                    allowedMentions: { parse: [] },
                });
                await RosterDB.saveHeader(activeSeason.id, division, channelId, header.id);
            } catch (error) {
                Logger.error(`Failed to post the Season ${seasonNumber} roster header for ${division}`, error);
            }
        }

        for (const team of divisionTeams) {
            const rosterData = await getTeamRoster(channel.guild, team, division);
            if (!rosterData) continue;

            // Sync to the league roster tables (powers the website).
            const members = buildRosterMembers(rosterData);
            await LeagueDB.syncTeamRoster(activeSeason.id, team.id, members);

            const colorInt = await getTeamColorInt(team.id);
            const currentHash = generateRosterHash(rosterData, { seasonNumber, colorInt });
            const savedMessage = saved.get(team.id);

            let message = null;
            if (savedMessage && savedMessage.messageId) {
                message = await channel.messages.fetch(savedMessage.messageId).catch(() => null);
                if (!message) Logger.warning(`Roster message for ${team.name} ${division} was deleted, will recreate`);
            }

            if (message && savedMessage.rosterHash === currentHash) {
                continue; // no changes
            }

            const embed = createRosterEmbed(rosterData, { colorInt, seasonNumber });
            const logoAttachment = await getLogoAttachment(team.id, team.name);
            const messageOptions = { embeds: [embed] };
            if (logoAttachment) messageOptions.files = [logoAttachment];

            try {
                if (message) {
                    await message.edit(messageOptions);
                    await RosterDB.saveEmbed(activeSeason.id, team.id, team.name, division, channelId, message.id, currentHash);
                    Logger.info(`Updated roster message for ${team.name} ${division}`);
                } else {
                    const newMessage = await channel.send(messageOptions);
                    await RosterDB.saveEmbed(activeSeason.id, team.id, team.name, division, channelId, newMessage.id, currentHash);
                    Logger.success(`Created roster message for ${team.name} ${division}`);
                }
            } catch (error) {
                Logger.error(`Failed to create/update roster for ${team.name} ${division}`, error);
            }
        }

        // A team disabled or removed during the season loses its embed. Teams
        // from past seasons are never touched — those messages are history.
        const activeIds = new Set(divisionTeams.map((t) => t.id));
        for (const row of saved.values()) {
            if (activeIds.has(row.teamId)) continue;
            const old = await channel.messages.fetch(row.messageId).catch(() => null);
            try {
                if (old) await old.delete();
                await RosterDB.deleteEmbed(activeSeason.id, row.teamId);
                Logger.info(`Removed the roster embed for ${row.teamName} ${division} (team no longer active)`);
                higgenLog.logInteraction({
                    eventType: 'job', action: 'rosters.embed_removed',
                    actor: { name: 'Beluga League BOT', id: null },
                    what: `removed the Season ${seasonNumber} ${divisionDisplay(division)} roster embed for ${row.teamName}, because that team is no longer active`,
                    location: `#${channel.name}`,
                    details: [['Team', `${row.teamName} (${divisionDisplay(division)})`], ['Season', String(seasonNumber ?? '—')]],
                });
            } catch (error) {
                Logger.error(`Failed to remove the roster embed for ${row.teamName} ${division}`, error);
            }
        }

        await LeagueDB.recordRosterSync(activeSeason.id, divisionLabel);

        Logger.success(`${division} roster updated successfully`);
        return true;
    } catch (error) {
        Logger.error(`Failed to update ${division} roster`, error);
        return false;
    }
}

/**
 * Update all division rosters
 */
async function updateAllRosters(client) {
    try {
        Logger.info('Starting full roster update...');

        await updateDivisionRoster(client, 'MAJORS');
        await updateDivisionRoster(client, 'AAA');
        await updateDivisionRoster(client, 'AA');

        Logger.success('All rosters updated successfully');
        return true;
    } catch (error) {
        Logger.error('Failed to update all rosters', error);
        return false;
    }
}

module.exports = {
    updateAllRosters,
    updateDivisionRoster,
    getTeamRoster,
    createRosterEmbed,
    getLogoAttachment,
    ROSTER_CHANNELS
};
