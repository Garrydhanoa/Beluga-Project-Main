const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { ROLES, TEAM_ROLES, NP_ROLES } = require('../constants/roles');
const { TransactionDB } = require('../utils/database');

// ─── Constants ────────────────────────────────────────────────────────────────
const DEVELOPER_ID              = '769357454890631170';
const DIRECTOR_ROLE_ID          = '1156814621429215240';
const APPROVAL_CHANNEL_ID       = '1473156680568016906';
const CONFIRMATION_CHANNEL_ID   = '1156814623371169801';
const SPREADSHEET_ID            = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
const REQUIRED_APPROVALS        = 3;
const DROP_DELAY_MS             = 500; // ms between each player drop to avoid rate-limiting

// Pending approval requests – keyed by approval message ID
const pendingMassDrops = new Map();

// ─── Google Sheets ─────────────────────────────────────────────────────────────
class SheetsManager {
    constructor() {
        this.auth   = null;
        this.sheets = null;
    }

    async initialize() {
        if (this.auth) return true;
        try {
            let credentials;
            if (config.sheets.credentialsJson) {
                credentials = config.sheets.credentialsJson;
            } else {
                const credPath = path.join(__dirname, '../../', config.sheets.credentials);
                if (!fs.existsSync(credPath)) throw new Error('Credentials not found');
                credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
            }
            const { client_email, private_key } = credentials;
            this.auth = new google.auth.JWT(
                client_email, null,
                private_key.replace(/\\n/g, '\n'),
                ['https://www.googleapis.com/auth/spreadsheets']
            );
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            return true;
        } catch (err) {
            Logger.error('SheetsManager init failed', err);
            return false;
        }
    }

    /**
     * Bulk-read SalSheet and return a Map of discordId → { rowIndex, username }
     */
    async buildPlayerMap() {
        await this.initialize();
        // Columns B (username) through P (discordId): B=0, I=7, K=9, M=11, P=14
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'SalSheet!B:P',
        });
        const rows = response.data.values || [];
        const map  = new Map();
        for (let i = 0; i < rows.length; i++) {
            const row      = rows[i];
            const discordId = row[14] ? String(row[14]).trim() : null;
            if (!discordId) continue;
            map.set(discordId, {
                rowIndex: i + 1, // 1-indexed sheet row
                username: row[0] || null,
            });
        }
        return map;
    }

    /**
     * Drop a player row (team decision – no RFA):
     *   I = FA = YES
     *   M = Playing = YES
     *   K = IR = NO
     *   W = IR Expiry = (clear)
     */
    async dropPlayer(rowIndex) {
        await this.initialize();
        await this.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                valueInputOption: 'RAW',
                data: [
                    { range: `SalSheet!I${rowIndex}`, values: [['YES']] }, // FA
                    { range: `SalSheet!M${rowIndex}`, values: [['YES']] }, // Playing
                    { range: `SalSheet!K${rowIndex}`, values: [['NO']]  }, // IR
                    { range: `SalSheet!W${rowIndex}`, values: [['']]    }, // IR Expiry
                ]
            }
        });
    }
}

const sheetsManager = new SheetsManager();

// ─── Logo helper ────────────────────────────────────────────────────────────────
function findTeamLogo(teamName) {
    try {
        const logosDir = path.join(__dirname, '../../IMAGES/logos');
        if (!fs.existsSync(logosDir)) return null;
        const files = fs.readdirSync(logosDir);
        const norm  = teamName.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const file of files) {
            if (path.parse(file).name.toLowerCase() === teamName.toLowerCase()) return path.join(logosDir, file);
        }
        for (const file of files) {
            if (path.parse(file).name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return path.join(logosDir, file);
        }
        return null;
    } catch { return null; }
}

// ─── Collect all team members ──────────────────────────────────────────────────
/**
 * Returns an array of { member, divisions: Set<string>, teamName, npOnly }
 * One entry per guild member who holds AT LEAST ONE team or NP role.
 */
function collectTeamMembers(guild) {
    const result = [];

    for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;

        const divisions = new Set();
        let teamName    = null;
        let npOnly      = true;

        // Scan regular team roles
        for (const [div, teams] of Object.entries(TEAM_ROLES)) {
            for (const [name, roleId] of Object.entries(teams)) {
                if (member.roles.cache.has(roleId)) {
                    divisions.add(div);
                    teamName = name;
                    npOnly   = false;
                }
            }
        }

        // Check NP roles
        for (const [name, npRoleId] of Object.entries(NP_ROLES)) {
            if (member.roles.cache.has(npRoleId)) {
                teamName = teamName || name;
                // Derive division from league division role
                for (const [div, divRoleId] of Object.entries(ROLES.DIVISIONS)) {
                    if (member.roles.cache.has(divRoleId)) {
                        divisions.add(div);
                    }
                }
            }
        }

        if (divisions.size > 0 || teamName) {
            result.push({ member, divisions, teamName, npOnly });
        }
    }

    return result;
}

// ─── Core mass-drop executor ───────────────────────────────────────────────────
async function executeMassDrop(approvalMessage, client, requestedBy) {
    const guild             = approvalMessage.guild;
    const confirmChannel    = await client.channels.fetch(CONFIRMATION_CHANNEL_ID);

    // 1. Force-fetch all members so the cache is complete
    await guild.members.fetch();

    // 2. Build sheet player map (single API call)
    let playerMap;
    try {
        playerMap = await sheetsManager.buildPlayerMap();
    } catch (err) {
        Logger.error('Mass drop: failed to build player map', err);
        await approvalMessage.edit({ content: '❌ Mass drop failed: could not read salary sheet.', embeds: [] });
        return;
    }

    // 3. Collect players to drop
    const targets = collectTeamMembers(guild);

    Logger.info(`Mass drop: ${targets.length} players to process`);

    // 4. Update approval message with progress
    const progressEmbed = new EmbedBuilder()
        .setTitle('⚙️ Mass Drop In Progress')
        .setDescription(`Processing **0 / ${targets.length}** players…`)
        .setColor(0xFFA500)
        .setTimestamp();
    await approvalMessage.edit({ content: '', embeds: [progressEmbed] });

    let done = 0;
    let failed = 0;

    for (const { member, divisions, teamName } of targets) {
        try {
            // ── a. Determine which FA roles to grant ──────────────────────────
            const faRolesToAdd = [];
            if (divisions.has('MAJORS') && ROLES.FREE_AGENTS.MAJORS) faRolesToAdd.push(ROLES.FREE_AGENTS.MAJORS);
            if (divisions.has('AAA') && ROLES.FREE_AGENTS.AAA)        faRolesToAdd.push(ROLES.FREE_AGENTS.AAA);
            if (divisions.has('AA') && ROLES.FREE_AGENTS.AA)          faRolesToAdd.push(ROLES.FREE_AGENTS.AA);

            // ── b. Remove all team roles ─────────────────────────────────────
            for (const [div, teams] of Object.entries(TEAM_ROLES)) {
                for (const roleId of Object.values(teams)) {
                    if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
                }
            }

            // ── c. Remove NP role ────────────────────────────────────────────
            for (const npRoleId of Object.values(NP_ROLES)) {
                if (member.roles.cache.has(npRoleId)) await member.roles.remove(npRoleId);
            }

            // ── d. Remove captain roles ──────────────────────────────────────
            for (const captainRoleId of Object.values(ROLES.CAPTAINS)) {
                if (member.roles.cache.has(captainRoleId)) await member.roles.remove(captainRoleId);
            }

            // ── e. Add FA role(s) ────────────────────────────────────────────
            for (const faId of faRolesToAdd) {
                if (!member.roles.cache.has(faId)) await member.roles.add(faId);
            }

            // ── f. Update sheet ──────────────────────────────────────────────
            const sheetData = playerMap.get(member.user.id);
            if (sheetData) {
                await sheetsManager.dropPlayer(sheetData.rowIndex);
            } else {
                Logger.warning(`Mass drop: ${member.user.username} (${member.user.id}) not found in sheet`);
            }

            // ── g. Send confirmation ─────────────────────────────────────────
            const confirmEmbed = new EmbedBuilder()
                .setTitle(`${teamName || 'Unknown Team'} drop ${member.displayName}`)
                .setDescription(
                    `${member} has been dropped via **Mass Drop** by <@${requestedBy}>.`
                )
                .addFields(
                    { name: 'Team',       value: teamName || 'Unknown',                   inline: true },
                    { name: 'Division(s)', value: [...divisions].join(', ') || 'Unknown',  inline: true },
                    { name: 'Method',     value: 'Mass Drop',                              inline: true }
                )
                .setColor(0xFF4444)
                .setTimestamp();

            const logoPath = teamName ? findTeamLogo(teamName) : null;
            if (logoPath && fs.existsSync(logoPath)) {
                const attachment = new AttachmentBuilder(logoPath, { name: 'team_logo.png' });
                confirmEmbed.setThumbnail('attachment://team_logo.png');
                await confirmChannel.send({ embeds: [confirmEmbed], files: [attachment] });
            } else {
                await confirmChannel.send({ embeds: [confirmEmbed] });
            }

            // Log the drop per-player to the shared transactions table.
            try {
                const divsArr = [...divisions];
                const primaryDiv = divsArr[0] || null;
                const teamId = teamName ? await TransactionDB.findTeamIdByName(primaryDiv, teamName) : null;
                await TransactionDB.log({
                    discordId: member.user.id,
                    discordUsername: member.user.username,
                    displayName: member.displayName,
                    teamId,
                    teamNameSnapshot: teamName || null,
                    type: 'drop',
                    details: {
                        kind: 'massDrop',
                        divisions: divsArr,
                    },
                    performedByDiscordId: requestedBy,
                    source: 'bot:/mass-drop',
                });
            } catch { /* non-fatal */ }

            done++;
        } catch (err) {
            failed++;
            Logger.error(`Mass drop: failed for ${member.user.username}`, err);
        }

        // ── h. Progress update every 10 players ──────────────────────────────
        if (done % 10 === 0 || done + failed === targets.length) {
            try {
                progressEmbed.setDescription(`Processing **${done + failed} / ${targets.length}** players…`);
                await approvalMessage.edit({ embeds: [progressEmbed] });
            } catch { /* ignore edit errors */ }
        }

        // ── i. Delay to avoid Discord rate limits ────────────────────────────
        await new Promise(resolve => setTimeout(resolve, DROP_DELAY_MS));
    }

    // 5. Final summary on the approval message
    const summaryEmbed = new EmbedBuilder()
        .setTitle('✅ Mass Drop Complete')
        .setDescription(
            `Successfully dropped **${done}** player(s).` +
            (failed > 0 ? `\n⚠️ Failed on **${failed}** player(s) — check bot logs.` : '')
        )
        .addFields({ name: 'Executed By', value: `<@${requestedBy}>`, inline: true })
        .setColor(failed > 0 ? 0xFFA500 : 0x00CC44)
        .setTimestamp();

    await approvalMessage.edit({ content: '', embeds: [summaryEmbed] });
    Logger.success(`Mass drop complete: ${done} dropped, ${failed} failed`);
}

// ─── Module export ─────────────────────────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName('massdrop')
        .setDescription('[Developer Only] Drop every player from every team'),

    async execute(interaction) {
        // Developer-only gate
        if (interaction.user.id !== DEVELOPER_ID) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        // Count players on teams so we can show the warning number
        await interaction.guild.members.fetch();
        const targets = collectTeamMembers(interaction.guild);

        // Send approval request embed to the approval channel
        const approvalChannel = await interaction.client.channels.fetch(APPROVAL_CHANNEL_ID);

        const requestEmbed = new EmbedBuilder()
            .setTitle('⚠️ Mass Drop Approval Required')
            .setDescription(
                `<@${interaction.user.id}> has requested a **Mass Drop**.\n\n` +
                `This will drop **${targets.length} player(s)** from all teams immediately.\n\n` +
                `**${REQUIRED_APPROVALS} Directors** must react ✅ to begin.`
            )
            .addFields(
                { name: 'Requested By', value: `<@${interaction.user.id}>`,   inline: true },
                { name: 'Players to Drop', value: `${targets.length}`,        inline: true },
                { name: 'Approvals Needed', value: `${REQUIRED_APPROVALS}`,   inline: true }
            )
            .setColor(0xFF0000)
            .setFooter({ text: 'React ✅ to approve. Requires 3 Director approvals.' })
            .setTimestamp();

        const approvalMessage = await approvalChannel.send({
            content: `<@&${DIRECTOR_ROLE_ID}> — Approval required for a mass drop.`,
            embeds: [requestEmbed]
        });

        await approvalMessage.react('✅');
        await approvalMessage.react('❌');

        pendingMassDrops.set(approvalMessage.id, {
            requestedBy:  interaction.user.id,
            approvedBy:   new Set(),  // tracks unique director IDs who reacted ✅
            messageId:    approvalMessage.id,
            channelId:    approvalChannel.id,
            cancelled:    false,
        });

        await interaction.editReply({
            content: `✅ Approval request sent to <#${APPROVAL_CHANNEL_ID}>. Waiting for ${REQUIRED_APPROVALS} Director approvals.`,
        });
    },

    async handleReaction(reaction, user, client) {
        if (user.bot) return;

        const pending = pendingMassDrops.get(reaction.message.id);
        if (!pending || pending.cancelled) return;

        // Only Directors can interact
        const member = await reaction.message.guild.members.fetch(user.id);
        const isDirector = member.roles.cache.has(DIRECTOR_ROLE_ID);
        if (!isDirector) return;

        // ── Cancel ──────────────────────────────────────────────────────────
        if (reaction.emoji.name === '❌') {
            pending.cancelled = true;
            pendingMassDrops.delete(reaction.message.id);

            const embed = reaction.message.embeds[0];
            await reaction.message.edit({
                content:  `❌ Mass drop cancelled by ${user.username}.`,
                embeds:   [EmbedBuilder.from(embed).setColor(0x888888).setFooter({ text: 'Cancelled' })]
            });
            return;
        }

        // ── Approve ─────────────────────────────────────────────────────────
        if (reaction.emoji.name === '✅') {
            pending.approvedBy.add(user.id);

            const approvalCount = pending.approvedBy.size;

            // Update embed with current approval count
            const embed = reaction.message.embeds[0];
            const updatedEmbed = EmbedBuilder.from(embed)
                .setDescription(
                    EmbedBuilder.from(embed).data.description +
                    `\n\n✅ **${approvalCount}/${REQUIRED_APPROVALS}** approvals received.`
                );

            if (approvalCount < REQUIRED_APPROVALS) {
                await reaction.message.edit({ embeds: [updatedEmbed] });
                return;
            }

            // Enough approvals — start mass drop
            pendingMassDrops.delete(reaction.message.id);

            const goEmbed = EmbedBuilder.from(embed)
                .setTitle('⚙️ Mass Drop Approved — Starting…')
                .setColor(0xFFA500)
                .setFooter({ text: 'Mass drop is now running.' })
                .setDescription(
                    EmbedBuilder.from(embed).data.description +
                    `\n\n✅ **${approvalCount}/${REQUIRED_APPROVALS}** approvals. Starting now…`
                );

            await reaction.message.edit({ content: '', embeds: [goEmbed] });

            // Execute the drop (async, non-blocking relative to the reaction handler)
            executeMassDrop(reaction.message, client, pending.requestedBy).catch(err => {
                Logger.error('Mass drop execution error', err);
            });
        }
    },
};
