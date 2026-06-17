const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const Logger = require('../utils/logger');
const { TicketDB, pool, isDatabaseAvailable } = require('../utils/database');
const { ROLES } = require('../constants/roles');
const https = require('https');

// Role IDs that can manage tickets
const AUTHORIZED_ROLES = {
    SALARY_CREW: ROLES.SALARY_CREW,
    ADMINS: '1299015429355999263',
    BOD: '1156814621429215240'
};

// Channel IDs
const TICKET_CATEGORY_ID = '1156814621865427022';
const TRANSCRIPT_CHANNEL_ID = '1304985779864473721';

/**
 * Message body pointing staff to the saved transcript on the website (replaces
 * the old dpaste link). The live + saved ticket transcript lives in the admin
 * panel's Tickets tab, rendered from the ticket_messages mirror.
 */
function ticketTranscriptPointer() {
    const base = process.env.WEBSITE_URL || process.env.PUBLIC_WEBSITE_URL;
    if (base) {
        const link = `${base.replace(/\/$/, '')}/admin/dashboard/tickets`;
        return `📄 **Check out the full transcript on the website.**\nView it under [Admin → Tickets](${link}).`;
    }
    return '📄 **Check out the full transcript on the website** — under the **Admin → Tickets** tab.';
}

// Ticket reasons
const TICKET_REASONS = {
    TRACKER_UPDATE: 'Tracker Update',
    GENERAL: 'General',
    FF_DISPUTE: 'FF Dispute'
};

// Store active tickets in memory (cached from database)
let activeTickets = new Map();

// Load active tickets from database on startup
async function loadActiveTickets() {
    try {
        const tickets = await TicketDB.getAll();
        activeTickets = new Map(tickets.map(t => [t.channelId, t]));
        Logger.info(`Loaded ${activeTickets.size} active tickets from database`);
    } catch (error) {
        Logger.error('Failed to load active tickets from database', error);
        activeTickets = new Map();
    }
}

// Save/update ticket to database
async function saveTicket(channelId, ticketData) {
    try {
        await TicketDB.create(ticketData);
        activeTickets.set(channelId, ticketData);
    } catch (error) {
        Logger.error('Failed to save ticket to database', error);
        throw error;
    }
}

// Update existing ticket in database
async function updateTicket(channelId, ticketData) {
    try {
        await TicketDB.update(channelId, ticketData);
        activeTickets.set(channelId, ticketData);
    } catch (error) {
        Logger.error('Failed to update ticket in database', error);
        throw error;
    }
}

// Delete ticket from database
async function deleteTicket(channelId) {
    try {
        await TicketDB.delete(channelId);
        activeTickets.delete(channelId);
    } catch (error) {
        Logger.error('Failed to delete ticket from database', error);
        throw error;
    }
}

// Check if user has permission to manage tickets
function canManageTickets(member) {
    return member.roles.cache.has(AUTHORIZED_ROLES.SALARY_CREW) ||
           member.roles.cache.has(AUTHORIZED_ROLES.ADMINS) ||
           member.roles.cache.has(AUTHORIZED_ROLES.BOD);
}

// Check if command is being used in a bot-created ticket
function isValidTicketChannel(channelId) {
    for (const [ticketChannelId, ticketData] of activeTickets.entries()) {
        if (ticketChannelId === channelId) {
            return ticketData;
        }
    }
    return null;
}

/**
 * Upload HTML to dpaste and return a viewable link
 * Uses dpaste.com API which is simple and reliable
 */
async function uploadHTMLToPaste(html, title) {
    return new Promise((resolve, reject) => {
        // Wrap HTML in a simple viewer that auto-renders
        const wrappedHtml = html;
        
        // URL encode the form data
        const formData = `content=${encodeURIComponent(wrappedHtml)}&syntax=html&expiry_days=365`;

        const options = {
            hostname: 'dpaste.com',
            port: 443,
            path: '/api/v2/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(formData)
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    // dpaste returns the URL directly as plain text
                    if (res.statusCode === 200 || res.statusCode === 201) {
                        const pasteUrl = data.trim();
                        // Add .txt to get raw content, then we'll create an HTML viewer
                        const rawUrl = `${pasteUrl}.txt`;
                        
                        // Create a simple HTML viewer URL that loads the content
                        // We'll use a data URL to create an instant viewer
                        resolve(rawUrl);
                    } else {
                        Logger.error(`dpaste returned status ${res.statusCode}: ${data}`);
                        reject(new Error(`Failed to upload to dpaste: HTTP ${res.statusCode}`));
                    }
                } catch (error) {
                    Logger.error('Error parsing dpaste response', error);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            Logger.error('Network error uploading to dpaste', error);
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(formData);
        req.end();
    });
}

// Generate ticket transcript in HTML format
async function generateTranscript(channel, ticketData) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const sortedMessages = Array.from(messages.values()).reverse();
        
        const createdAt = ticketData?.createdAt 
            ? new Date(ticketData.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })
            : channel.createdAt?.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' }) || 'Unknown';
        
        const closedAt = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });
        const reason = ticketData?.reason || 'Unknown';
        const openedBy = ticketData?.createdByUsername || 'Unknown';
        
        // Build HTML transcript
        let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticket: ${channel.name}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e0e0e0; 
            padding: 20px;
            min-height: 100vh;
        }
        .container { max-width: 900px; margin: 0 auto; }
        .header { 
            background: linear-gradient(135deg, #0f3460 0%, #16213e 100%);
            border-radius: 12px; 
            padding: 30px; 
            margin-bottom: 25px;
            border: 1px solid #1f4068;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .header h1 { 
            color: #00d9ff; 
            font-size: 24px; 
            margin-bottom: 15px;
            text-shadow: 0 0 10px rgba(0,217,255,0.3);
        }
        .header .ticket-info { 
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        .header .info-item { 
            background: rgba(255,255,255,0.05); 
            padding: 12px 15px; 
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .header .info-item label {
            display: block;
            color: #888;
            font-size: 12px;
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .header .info-item span {
            color: #fff;
            font-weight: 500;
        }
        .messages { display: flex; flex-direction: column; gap: 12px; }
        .message { 
            background: rgba(255,255,255,0.03); 
            border-radius: 10px; 
            padding: 15px 18px;
            border-left: 3px solid #0f3460;
            transition: background 0.2s;
        }
        .message:hover { background: rgba(255,255,255,0.06); }
        .message-header { 
            display: flex; 
            align-items: center; 
            gap: 12px; 
            margin-bottom: 8px; 
        }
        .avatar { 
            width: 36px; 
            height: 36px; 
            border-radius: 50%; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
            color: white;
        }
        .username { 
            font-weight: 600; 
            color: #00d9ff; 
        }
        .bot-badge {
            background: #5865f2;
            color: white;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 5px;
        }
        .timestamp { 
            color: #666; 
            font-size: 12px; 
            margin-left: auto;
        }
        .content { 
            color: #d0d0d0; 
            line-height: 1.6; 
            padding-left: 48px;
            word-wrap: break-word;
        }
        .embed { 
            background: rgba(0,217,255,0.05); 
            border-left: 3px solid #00d9ff; 
            padding: 12px 15px; 
            margin-top: 10px; 
            border-radius: 6px;
            margin-left: 48px;
        }
        .embed-title { color: #00d9ff; font-weight: 600; margin-bottom: 5px; }
        .embed-description { color: #ccc; margin-bottom: 8px; }
        .embed-field { margin-top: 8px; }
        .embed-field-name { color: #00d9ff; font-size: 13px; font-weight: 600; }
        .embed-field-value { color: #bbb; font-size: 13px; }
        .attachment { 
            color: #7289da; 
            text-decoration: none; 
            display: inline-block;
            margin-top: 8px;
            padding: 4px 10px;
            background: rgba(114,137,218,0.1);
            border-radius: 4px;
            margin-left: 48px;
        }
        .attachment:hover { background: rgba(114,137,218,0.2); }
        .footer { 
            text-align: center; 
            margin-top: 30px; 
            padding: 20px; 
            color: #666;
            font-size: 12px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }
        .no-messages { 
            text-align: center; 
            padding: 40px; 
            color: #666;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Ticket Transcript: ${channel.name}</h1>
            <div class="ticket-info">
                <div class="info-item">
                    <label>Reason</label>
                    <span>${reason}</span>
                </div>
                <div class="info-item">
                    <label>Opened By</label>
                    <span>${openedBy}</span>
                </div>
                <div class="info-item">
                    <label>Opened At</label>
                    <span>${createdAt}</span>
                </div>
                <div class="info-item">
                    <label>Closed At</label>
                    <span>${closedAt}</span>
                </div>
            </div>
        </div>
        <div class="messages">`;

        if (sortedMessages.length === 0) {
            html += `<div class="no-messages">No messages in this ticket</div>`;
        } else {
            for (const message of sortedMessages) {
                const timestamp = message.createdAt.toLocaleString('en-US', { 
                    timeZone: 'America/New_York',
                    dateStyle: 'short',
                    timeStyle: 'short'
                });
                
                const authorName = message.author.username;
                const isBot = message.author.bot;
                const initial = authorName.charAt(0).toUpperCase();
                
                // Escape HTML in content
                const escapedContent = (message.content || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/\n/g, '<br>');
                
                html += `
            <div class="message">
                <div class="message-header">
                    <div class="avatar">${initial}</div>
                    <span class="username">${authorName}${isBot ? '<span class="bot-badge">BOT</span>' : ''}</span>
                    <span class="timestamp">${timestamp}</span>
                </div>
                <div class="content">${escapedContent || '<em>No text content</em>'}</div>`;
                
                // Add embeds
                for (const embed of message.embeds) {
                    html += `
                <div class="embed">
                    ${embed.title ? `<div class="embed-title">${embed.title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}
                    ${embed.description ? `<div class="embed-description">${embed.description.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>` : ''}`;
                    
                    // Add embed fields
                    if (embed.fields && embed.fields.length > 0) {
                        for (const field of embed.fields) {
                            html += `
                    <div class="embed-field">
                        <div class="embed-field-name">${field.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                        <div class="embed-field-value">${field.value.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                    </div>`;
                        }
                    }
                    html += `</div>`;
                }
                
                // Add attachments
                for (const [, attachment] of message.attachments) {
                    html += `<a class="attachment" href="${attachment.url}" target="_blank">📎 ${attachment.name}</a>`;
                }
                
                html += `
            </div>`;
            }
        }

        html += `
        </div>
        <div class="footer">
            Beluga League Bot • Ticket Transcript • ${channel.name}
        </div>
    </div>
</body>
</html>`;

        return html;
    } catch (error) {
        Logger.error('Failed to generate transcript', error);
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('openticket')
        .setDescription('Open a new support ticket')
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for opening the ticket')
                .setRequired(true)
                .addChoices(
                    { name: 'Tracker Update', value: 'tracker_update' },
                    { name: 'General', value: 'general' },
                    { name: 'FF Dispute', value: 'ff_dispute' }
                ))
        .addUserOption(option =>
            option.setName('user1')
                .setDescription('First user to add to the ticket')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user2')
                .setDescription('Second user to add to the ticket')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user3')
                .setDescription('Third user to add to the ticket')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user4')
                .setDescription('Fourth user to add to the ticket')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user5')
                .setDescription('Fifth user to add to the ticket')
                .setRequired(false)),

    async execute(interaction) {
        try {
            // Check permissions
            if (!canManageTickets(interaction.member)) {
                await interaction.reply({
                    content: '❌ You do not have permission to open tickets.',
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply({ ephemeral: true });

            // Load active tickets from database
            await loadActiveTickets();

            // Get reason
            const reasonKey = interaction.options.getString('reason');
            const reasonText = TICKET_REASONS[reasonKey.toUpperCase().replace('_', '_')] || reasonKey;

            // Collect all users
            const users = [];
            for (let i = 1; i <= 5; i++) {
                const user = interaction.options.getUser(`user${i}`);
                if (user) {
                    users.push(user);
                }
            }

            if (users.length === 0) {
                await interaction.editReply({
                    content: '❌ You must specify at least one user.',
                });
                return;
            }

            // Generate ticket name
            const userNames = users.map(u => u.username).join(' ');
            const ticketName = `${reasonText} ${userNames}`.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').substring(0, 100);

            // Get category
            const category = await interaction.guild.channels.fetch(TICKET_CATEGORY_ID);
            if (!category || category.type !== ChannelType.GuildCategory) {
                await interaction.editReply({
                    content: '❌ Ticket category not found.',
                });
                return;
            }

            // Create ticket channel
            const ticketChannel = await interaction.guild.channels.create({
                name: ticketName,
                type: ChannelType.GuildText,
                parent: TICKET_CATEGORY_ID,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: AUTHORIZED_ROLES.SALARY_CREW,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    },
                    {
                        id: AUTHORIZED_ROLES.ADMINS,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    },
                    {
                        id: AUTHORIZED_ROLES.BOD,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    },
                    ...users.map(user => ({
                        id: user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    }))
                ]
            });

            // Store ticket data in database
            const ticketData = {
                channelId: ticketChannel.id,
                channelName: ticketChannel.name,
                reason: reasonText,
                createdBy: interaction.user.id,
                createdByUsername: interaction.user.username,
                userIds: users.map(u => u.id),
                createdAt: new Date().toISOString()
            };
            await saveTicket(ticketChannel.id, ticketData);

            // Send welcome message in ticket
            const userMentions = users.map(u => `<@${u.id}>`).join(', ');
            
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🎫 Ticket Opened')
                .setDescription(`This ticket has been opened for the following reason:\n**${reasonText}**`)
                .addFields(
                    { name: 'Users Added', value: userMentions, inline: false },
                    { name: 'Opened By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Opened At', value: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }), inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp()
                .setFooter({ text: 'Use /close to close this ticket' });

            await ticketChannel.send({
                content: `${userMentions} - A ticket has been opened for you.\n\n**Reason:** ${reasonText}`,
                embeds: [welcomeEmbed]
            });

            await interaction.editReply({
                content: `✅ Ticket created successfully: ${ticketChannel}`,
            });

            Logger.success(`Ticket opened: ${ticketName} by ${interaction.user.username}`);

        } catch (error) {
            Logger.error('Failed to execute openticket command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while opening the ticket. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    async executeAdd(interaction) {
        try {
            // Check permissions
            if (!canManageTickets(interaction.member)) {
                await interaction.reply({
                    content: '❌ You do not have permission to manage tickets.',
                    ephemeral: true
                });
                return;
            }

            // Load active tickets from database
            await loadActiveTickets();

            // Check if this is a valid ticket channel
            const ticketData = isValidTicketChannel(interaction.channel.id);
            if (!ticketData) {
                await interaction.reply({
                    content: '❌ This command can only be used in tickets created by this bot.',
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply();

            // Get user to add
            const user = interaction.options.getUser('user');
            if (!user) {
                await interaction.editReply({
                    content: '❌ You must specify a user to add.',
                });
                return;
            }

            // Check if user is already in ticket
            if (ticketData.userIds.includes(user.id)) {
                await interaction.editReply({
                    content: `❌ ${user.username} is already in this ticket.`,
                });
                return;
            }

            // Add permissions to channel
            await interaction.channel.permissionOverwrites.create(user.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });

            // Update ticket data in database
            ticketData.userIds.push(user.id);
            await updateTicket(interaction.channel.id, ticketData);

            await interaction.editReply({
                content: `✅ ${user} has been added to this ticket.\n\n**Reason:** ${ticketData.reason}`,
            });

            Logger.info(`User ${user.username} added to ticket ${interaction.channel.name}`);

        } catch (error) {
            Logger.error('Failed to execute add command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while adding the user. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    async executeRemove(interaction) {
        try {
            // Check permissions
            if (!canManageTickets(interaction.member)) {
                await interaction.reply({
                    content: '❌ You do not have permission to manage tickets.',
                    ephemeral: true
                });
                return;
            }

            // Load active tickets from database
            await loadActiveTickets();

            // Check if this is a valid ticket channel
            const ticketData = isValidTicketChannel(interaction.channel.id);
            if (!ticketData) {
                await interaction.reply({
                    content: '❌ This command can only be used in tickets created by this bot.',
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply();

            // Get user to remove
            const user = interaction.options.getUser('user');
            if (!user) {
                await interaction.editReply({
                    content: '❌ You must specify a user to remove.',
                });
                return;
            }

            // Check if user is in ticket
            if (!ticketData.userIds.includes(user.id)) {
                await interaction.editReply({
                    content: `❌ ${user.username} is not in this ticket.`,
                });
                return;
            }

            // Remove permissions from channel
            await interaction.channel.permissionOverwrites.delete(user.id);

            // Update ticket data in database
            ticketData.userIds = ticketData.userIds.filter(id => id !== user.id);
            await updateTicket(interaction.channel.id, ticketData);

            await interaction.editReply({
                content: `✅ ${user.username} has been removed from this ticket.`,
            });

            Logger.info(`User ${user.username} removed from ticket ${interaction.channel.name}`);

        } catch (error) {
            Logger.error('Failed to execute remove command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while removing the user. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    async executeClose(interaction) {
        try {
            // Check permissions
            if (!canManageTickets(interaction.member)) {
                await interaction.reply({
                    content: '❌ You do not have permission to manage tickets.',
                    ephemeral: true
                });
                return;
            }

            // Load active tickets from database
            await loadActiveTickets();

            // Check if this is a valid ticket channel
            const ticketData = isValidTicketChannel(interaction.channel.id);
            if (!ticketData) {
                await interaction.reply({
                    content: '❌ This command can only be used in tickets created by this bot.',
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply();

            const closeEmbed = new EmbedBuilder()
                .setTitle('🔒 Closing Ticket')
                .setDescription('This ticket will be closed in **5 minutes**.\n\n📄 The full transcript is saved — view it anytime on the **league website → Tickets tab**.')
                .setColor(0xFF0000)
                .setTimestamp()
                .setFooter({ text: `Closed by ${interaction.user.username}` });

            await interaction.editReply({
                embeds: [closeEmbed]
            });

            Logger.info(`Ticket ${interaction.channel.name} will close in 5 minutes`);

            // Wait 5 minutes
            setTimeout(async () => {
                try {
                    // Send transcript pointer to transcript channel. The transcript
                    // itself is saved on the website (ticket_messages mirror); we no
                    // longer upload HTML to dpaste.
                    const transcriptChannel = await interaction.client.channels.fetch(TRANSCRIPT_CHANNEL_ID);

                    const transcriptEmbed = new EmbedBuilder()
                        .setTitle(`🎫 Ticket Closed: ${ticketData.channelName}`)
                        .setDescription(ticketTranscriptPointer())
                        .addFields(
                            { name: 'Reason', value: ticketData.reason, inline: true },
                            { name: 'Opened By', value: ticketData.createdByUsername, inline: true },
                            { name: 'Closed By', value: interaction.user.username, inline: true },
                            { name: 'Opened At', value: new Date(ticketData.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York' }), inline: true },
                            { name: 'Closed At', value: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }), inline: true }
                        )
                        .setColor(0x0099FF)
                        .setTimestamp();

                    {
                        await transcriptChannel.send({
                            embeds: [transcriptEmbed],
                        });
                    }

                    // Backfill any missed messages, then archive (snapshot + delete
                    // live rows) for the website's closed-ticket transcript.
                    await backfillTicketChannel(interaction.channel).catch(() => {});
                    await archiveTicket(ticketData, interaction.user.username);

                    // Remove from active tickets database
                    await deleteTicket(interaction.channel.id);

                    // Delete channel
                    await interaction.channel.delete();

                    Logger.success(`Ticket ${ticketData.channelName} closed successfully`);

                } catch (error) {
                    Logger.error('Failed to close ticket', error);
                }
            }, 5 * 60 * 1000); // 5 minutes

        } catch (error) {
            Logger.error('Failed to execute close command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while closing the ticket. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    // Load tickets on module load
    loadActiveTickets,

    // Export for cleanup
    activeTickets,

    // Website integration
    isValidTicketChannel,
    captureTicketMessage,
    backfillTicketChannel,
    closeTicketByChannelId,
    createTicketFromRequest,
    archiveTicket,
};

/**
 * Create a ticket channel from a website request (ticket_requests row).
 * targetKind: 'user' → grant that user access; 'role' → grant that role access.
 * Mirrors the /openticket creation flow (category, permission overwrites,
 * welcome embed, DB row) so website-created tickets behave identically.
 */
async function createTicketFromRequest(client, { targetKind, targetId, reason, requestedByDiscordId, requestedByUsername }) {
    const guild = client.guilds.cache.first();
    if (!guild) return { ok: false, error: 'no guild' };

    const category = await guild.channels.fetch(TICKET_CATEGORY_ID).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
        return { ok: false, error: 'ticket category not found' };
    }

    const reasonText = reason || 'General';

    // Resolve a friendly name + the target permission overwrite.
    let targetLabel = targetId;
    const targetOverwrites = [];
    const userIds = [];
    if (targetKind === 'role') {
        const role = await guild.roles.fetch(targetId).catch(() => null);
        targetLabel = role ? role.name : `role-${targetId}`;
        targetOverwrites.push({
            id: targetId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
    } else {
        const member = await guild.members.fetch(targetId).catch(() => null);
        targetLabel = member ? member.user.username : `user-${targetId}`;
        userIds.push(targetId);
        targetOverwrites.push({
            id: targetId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
    }

    const ticketName = `${reasonText} ${targetLabel}`
        .toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').substring(0, 100) || `ticket-${Date.now()}`;

    let ticketChannel;
    try {
        ticketChannel = await guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            parent: TICKET_CATEGORY_ID,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: AUTHORIZED_ROLES.SALARY_CREW, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: AUTHORIZED_ROLES.ADMINS, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: AUTHORIZED_ROLES.BOD, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                ...targetOverwrites,
            ],
        });
    } catch (err) {
        Logger.error('createTicketFromRequest: channel create failed', err);
        return { ok: false, error: err.message };
    }

    const ticketData = {
        channelId: ticketChannel.id,
        channelName: ticketChannel.name,
        reason: reasonText,
        createdBy: requestedByDiscordId || 'website',
        createdByUsername: requestedByUsername || 'Website Admin',
        userIds,
        createdAt: new Date().toISOString(),
    };
    await saveTicket(ticketChannel.id, ticketData);

    const mention = targetKind === 'role' ? `<@&${targetId}>` : `<@${targetId}>`;
    const welcomeEmbed = new EmbedBuilder()
        .setTitle('🎫 Ticket Opened')
        .setDescription(`This ticket has been opened for the following reason:\n**${reasonText}**`)
        .addFields(
            { name: 'For', value: mention, inline: false },
            { name: 'Opened By', value: `${requestedByUsername || 'Website Admin'} (website)`, inline: true },
            { name: 'Opened At', value: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }), inline: true }
        )
        .setColor(0x00FF00)
        .setTimestamp()
        .setFooter({ text: 'Use /close to close this ticket' });

    await ticketChannel.send({
        content: `${mention} - A ticket has been opened for you.\n\n**Reason:** ${reasonText}`,
        embeds: [welcomeEmbed],
    }).catch(() => {});

    Logger.success(`Ticket opened via website: ${ticketName} (${targetKind} ${targetId})`);
    return { ok: true, channelId: ticketChannel.id, channelName: ticketChannel.name };
}

// ============================================================================
// Website integration: live transcript capture + close-from-website
// ============================================================================

/**
 * Insert one Discord message into ticket_messages (the website transcript
 * mirror). No-op if the channel isn't a tracked ticket.
 */
async function captureTicketMessage(message) {
    if (!isDatabaseAvailable || !isDatabaseAvailable()) return;
    try {
        const channelId = message.channel?.id;
        if (!channelId) return;
        // Only capture for tracked ticket channels. Check the in-memory map
        // first (cheap), then fall back to a direct DB lookup. The fallback is
        // REQUIRED for the new configurable ticket system (ticketSystem.js):
        // it writes the tickets row but never refreshes this module's in-memory
        // activeTickets map, so without the DB check its channels look untracked
        // and NOTHING gets mirrored — leaving both the live and the closed
        // (archive-from-snapshot) transcripts empty.
        if (!isValidTicketChannel(channelId)) {
            const dbTicket = await TicketDB.get(channelId).catch(() => null);
            if (!dbTicket) return;
        }

        const author = message.author;
        const member = message.member;
        const avatar = author?.displayAvatarURL ? author.displayAvatarURL({ extension: 'png', size: 64 }) : null;
        const color = member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null;
        const attachments = Array.from(message.attachments?.values?.() || []).map((a) => ({
            url: a.url, name: a.name, contentType: a.contentType || null,
        }));
        const embeds = (message.embeds || []).map((e) => ({
            title: e.title || null, description: e.description || null,
        }));

        await pool.query(`
            INSERT INTO ticket_messages
              (channel_id, message_id, author_id, author_username, author_display, author_avatar, author_color, is_bot, content, attachments, embeds, message_created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
            ON CONFLICT (channel_id, message_id) DO UPDATE SET content = EXCLUDED.content
        `, [
            channelId,
            message.id,
            author?.id || null,
            author?.username || null,
            member?.displayName || author?.globalName || author?.username || null,
            avatar,
            color,
            !!author?.bot,
            message.content || '',
            JSON.stringify(attachments),
            JSON.stringify(embeds),
            message.createdAt || new Date(),
        ]);
    } catch (err) {
        // The ticket_messages table is created by ticketSync.ensureTicketTables()
        // at startup; ignore the transient "relation does not exist" race quietly.
        if (err && err.code === '42P01') return;
        Logger.error('captureTicketMessage failed', err.message || err);
    }
}

/**
 * Backfill the last N messages of a ticket channel into ticket_messages.
 * Used on startup and when a ticket is first opened so the website transcript
 * isn't empty for already-active tickets.
 */
async function backfillTicketChannel(channel) {
    if (!isDatabaseAvailable || !isDatabaseAvailable()) return;
    try {
        const fetched = await channel.messages.fetch({ limit: 100 });
        const ordered = Array.from(fetched.values()).reverse();
        for (const msg of ordered) {
            await captureTicketMessage(msg);
        }
    } catch (err) {
        Logger.error(`backfillTicketChannel failed for ${channel?.id}`, err);
    }
}

/**
 * Close a ticket by channel id WITHOUT a slash-command interaction (used by the
 * website close queue). Mirrors the /close flow: save transcript → delete the
 * tickets row → delete the channel.
 */
async function closeTicketByChannelId(client, channelId, closedByUsername = 'Website Admin') {
    if (!isDatabaseAvailable || !isDatabaseAvailable()) return { ok: false, error: 'db unavailable' };
    await loadActiveTickets();
    const ticketData = isValidTicketChannel(channelId);
    if (!ticketData) return { ok: false, error: 'not a tracked ticket' };

    let channel;
    try {
        channel = await client.channels.fetch(channelId);
    } catch {
        // Channel already gone — clean up the row.
        await deleteTicket(channelId);
        return { ok: true, note: 'channel missing; row cleaned' };
    }

    try {
        const transcriptChannel = await client.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
        if (transcriptChannel) {
            const embed = new EmbedBuilder()
                .setTitle(`🎫 Ticket Closed: ${ticketData.channelName}`)
                .setDescription(ticketTranscriptPointer())
                .addFields(
                    { name: 'Reason', value: ticketData.reason || '—', inline: true },
                    { name: 'Opened By', value: ticketData.createdByUsername || '—', inline: true },
                    { name: 'Closed By', value: `${closedByUsername} (website)`, inline: true }
                )
                .setColor(0x0099FF)
                .setTimestamp();
            await transcriptChannel.send({ embeds: [embed] }).catch(() => {});
        }

        // Backfill any missed messages so the final snapshot is complete, then
        // archive (snapshot + delete live rows) before deleting the channel.
        await backfillTicketChannel(channel).catch(() => {});
        await archiveTicket(ticketData, closedByUsername);
        await deleteTicket(channelId);
        await channel.delete().catch(() => {});
        Logger.success(`Ticket ${ticketData.channelName} closed via website by ${closedByUsername}`);
        return { ok: true };
    } catch (err) {
        Logger.error('closeTicketByChannelId failed', err);
        return { ok: false, error: err.message };
    }
}

/**
 * Record closed-ticket header metadata into ticket_archives + store a single
 * FINAL transcript snapshot, then delete the live ticket_messages rows so closed
 * tickets don't accumulate per-message rows in the DB. The website reads the
 * snapshot for closed tickets and the live rows only while a ticket is open.
 */
async function archiveTicket(ticketData, closedByUsername) {
    if (!isDatabaseAvailable || !isDatabaseAvailable()) return;
    try {
        // Build the consolidated transcript from the live rows.
        const msgRes = await pool.query(
            `SELECT message_id, author_id, author_username, author_display, author_avatar,
                    author_color, is_bot, content, attachments, embeds, message_created_at
             FROM ticket_messages WHERE channel_id = $1
             ORDER BY message_created_at ASC, id ASC`,
            [ticketData.channelId]
        ).catch(() => ({ rows: [] }));
        const snapshot = msgRes.rows.map((m) => ({
            messageId: m.message_id,
            authorId: m.author_id,
            authorUsername: m.author_username,
            authorDisplay: m.author_display || m.author_username,
            authorAvatar: m.author_avatar,
            authorColor: m.author_color,
            isBot: !!m.is_bot,
            content: m.content || '',
            attachments: m.attachments || [],
            embeds: m.embeds || [],
            createdAt: m.message_created_at,
        }));

        await pool.query(`
            INSERT INTO ticket_archives (channel_id, channel_name, reason, opened_by_username, opened_at, closed_by_username, message_count, transcript)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            ON CONFLICT (channel_id) DO UPDATE SET
                closed_by_username = EXCLUDED.closed_by_username,
                closed_at = CURRENT_TIMESTAMP,
                message_count = EXCLUDED.message_count,
                transcript = EXCLUDED.transcript
        `, [
            ticketData.channelId,
            ticketData.channelName || null,
            ticketData.reason || null,
            ticketData.createdByUsername || null,
            ticketData.createdAt ? new Date(ticketData.createdAt) : null,
            closedByUsername || null,
            snapshot.length,
            JSON.stringify(snapshot),
        ]);

        // Delete the live per-message rows — the snapshot is the kept transcript.
        await pool.query('DELETE FROM ticket_messages WHERE channel_id = $1', [ticketData.channelId]).catch(() => {});
    } catch (err) {
        Logger.error('archiveTicket failed', err.message || err);
    }
}
