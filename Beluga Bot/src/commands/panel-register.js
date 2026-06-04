const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const Logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');
const { pool, isDatabaseAvailable } = require('../utils/database');

// Stable custom id for the panel's Register button. Kept constant so the
// persistent panel keeps working forever (it lives in Discord, not in memory).
const PANEL_BUTTON_ID = 'panel_register_start';

/**
 * Ensure the table that remembers the active registration panel exists. We store
 * the channel + message id so a freshly-created panel can expire (delete) the old
 * one — there should only ever be one live panel.
 */
async function ensurePanelTable() {
    if (!isDatabaseAvailable || !isDatabaseAvailable()) return false;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS register_panels (
                id SERIAL PRIMARY KEY,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                created_by TEXT,
                created_by_username TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
        `);
        return true;
    } catch (err) {
        Logger.error('ensurePanelTable failed', err);
        return false;
    }
}

/**
 * Delete the Discord message(s) for every currently-active panel, then mark them
 * inactive in the DB. This "expires" the old panel before a new one is made.
 */
async function expireOldPanels(client) {
    if (!isDatabaseAvailable || !isDatabaseAvailable()) return;
    let rows = [];
    try {
        const r = await pool.query(`SELECT id, channel_id, message_id FROM register_panels WHERE is_active = TRUE`);
        rows = r.rows;
    } catch {
        return;
    }
    for (const row of rows) {
        try {
            const channel = await client.channels.fetch(row.channel_id).catch(() => null);
            if (channel) {
                const msg = await channel.messages.fetch(row.message_id).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }
        } catch { /* ignore — message may already be gone */ }
    }
    await pool.query(`UPDATE register_panels SET is_active = FALSE WHERE is_active = TRUE`).catch(() => {});
}

/**
 * Resolve the Beluga logo emoji from the guild's CUSTOM emojis (by name), since
 * Discord's API rejects raw `:shortcode:` strings on buttons/embeds. Returns a
 * value usable on a button (setEmoji) and a string usable in embed text. Falls
 * back to a 🐋 whale (fitting for Beluga) when no custom emoji is found.
 */
function resolveBelugaEmoji(guild) {
    // EXACT emoji names to use, in priority order (the panel logo is `0belugaLogo`).
    // Exact match avoids grabbing other "beluga ..." emojis (e.g. "beluga car").
    const WANTED = ['0belugalogo', 'belugalogo'];
    try {
        const cache = guild?.emojis?.cache;
        if (cache) {
            let emoji = null;
            for (const want of WANTED) {
                emoji = cache.find((e) => e.name && e.name.toLowerCase() === want);
                if (emoji) break;
            }
            if (emoji) {
                return {
                    button: { id: emoji.id, name: emoji.name, animated: emoji.animated },
                    text: emoji.toString(), // <:name:id> / <a:name:id>
                };
            }
        }
    } catch { /* fall through to unicode */ }
    return { button: '🐋', text: '🐋' };
}

/**
 * The persistent registration panel embed — a clear, professional step-by-step
 * guide that mirrors the actual /register flow.
 */
function buildPanelEmbed(titleEmoji = '🐋') {
    return new EmbedBuilder()
        .setTitle(`${titleEmoji} Beluga League — Player Registration`)
        .setColor(0x3B82F6)
        .setDescription(
            'Welcome to **Beluga League**! Register your Rocket League tracker(s) so we can verify your rank and keep the league fair.\n\n' +
            'Click **Register** below to begin — the whole process is private (only you can see it) and takes about a minute.'
        )
        .addFields(
            {
                name: '‼️ Before you start',
                value:
                    '• Find your tracker at **[rocketleague.tracker.network](https://rocketleague.tracker.network/)**\n' +
                    '• Have the URL for your **main account** ready\n' +
                    '• Have URLs for **any alt accounts** (smurfs) ready too',
                inline: false,
            },
            {
                name: '1️⃣ Click Register',
                value: 'Press the **Register** button below. A private message opens just for you.',
                inline: false,
            },
            {
                name: '2️⃣ Choose your account type',
                value: 'Pick whether you have only a **main account**, or a **main + alt account(s)**.',
                inline: false,
            },
            {
                name: '3️⃣ Enter your main tracker URL',
                value:
                    'Paste your main account tracker link in the popup, e.g.\n' +
                    '`https://rocketleague.tracker.network/rocket-league/profile/epic/YourName/overview`',
                inline: false,
            },
            {
                name: '4️⃣ Add your alt accounts',
                value:
                    'Add a tracker URL for every alt/smurf you own.\n' +
                    '⚠️ **Unregistered alts can result in smurfing penalties — register them all.**',
                inline: false,
            },
            {
                name: '5️⃣ Review & complete',
                value: 'Check your summary and press **Complete Registration**. That\'s it — you\'re in! ✅',
                inline: false,
            },
        )
        .setFooter({ text: 'Beluga League · Registration' })
        .setTimestamp();
}

function buildPanelComponents(buttonEmoji = '🐋') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(PANEL_BUTTON_ID)
            .setLabel('Register')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(buttonEmoji)
    );
    return [row];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('panel-register')
        .setDescription('[Salary Crew] Post the persistent registration panel in this channel'),

    PANEL_BUTTON_ID,

    async execute(interaction) {
        try {
            // Salary-Crew only.
            if (!interaction.member?.roles?.cache?.has(ROLES.SALARY_CREW)) {
                return await interaction.reply({
                    content: '❌ Only Salary Crew can use this command.',
                    flags: 64, // ephemeral
                });
            }

            // Defer (ephemeral) — deleting the old panel + posting the new one can
            // take longer than Discord's 3s interaction window.
            await interaction.deferReply({ flags: 64 });

            await ensurePanelTable();

            // Expire the previous panel (delete its message + mark inactive).
            await expireOldPanels(interaction.client);

            // Resolve the Beluga logo emoji from the guild (custom emoji by name),
            // with a 🐋 fallback so the API never rejects an invalid emoji.
            const belugaEmoji = resolveBelugaEmoji(interaction.guild);

            // Post the new persistent panel into this channel.
            const panelMessage = await interaction.channel.send({
                embeds: [buildPanelEmbed(belugaEmoji.text)],
                components: buildPanelComponents(belugaEmoji.button),
            });

            // Remember it so the next panel can expire this one.
            if (isDatabaseAvailable && isDatabaseAvailable()) {
                await pool.query(
                    `INSERT INTO register_panels (channel_id, message_id, created_by, created_by_username)
                     VALUES ($1, $2, $3, $4)`,
                    [panelMessage.channelId, panelMessage.id, interaction.user.id, interaction.user.username]
                ).catch((e) => Logger.error('Failed to save register panel', e));
            }

            await interaction.editReply({
                content: `✅ Registration panel posted in <#${panelMessage.channelId}>. Any previous panel was removed.`,
            });
            Logger.success(`Registration panel created by ${interaction.user.tag} in channel ${panelMessage.channelId}`);
        } catch (error) {
            Logger.error('Failed to execute panel-register', error);
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: '❌ Failed to post the registration panel. Please try again.' });
                } else {
                    await interaction.reply({ content: '❌ Failed to post the registration panel. Please try again.', flags: 64 });
                }
            } catch (e) {
                Logger.error('panel-register error reply failed', e);
            }
        }
    },

    /**
     * Panel "Register" button → starts the SAME registration flow as /register.
     * We delegate to register.execute (which works on a button interaction: it
     * defers an ephemeral reply and shows the welcome + account-type buttons).
     * The existing register handlers take over from there. Modal logic untouched.
     */
    async handleButton(interaction) {
        if (interaction.customId !== PANEL_BUTTON_ID) return;
        try {
            const register = require('./register');
            await register.execute(interaction);
        } catch (error) {
            Logger.error('panel-register button → register.execute failed', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Could not start registration. Please run /register instead.', flags: 64 });
                }
            } catch { /* ignore */ }
        }
    },
};
