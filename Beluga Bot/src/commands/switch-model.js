const { SlashCommandBuilder } = require('discord.js');
const { ROLES } = require('../constants/roles');
const {
    getActiveProvider,
    setActiveProvider,
    AI_LOG_CHANNEL_ID,
} = require('../utils/aiSettings');
const Logger = require('../utils/logger');

// Friendly labels shown to the user (kept in sync with aiChat PROVIDERS).
const PROVIDER_LABELS = {
    google: 'Google · Gemma 4 (gemma-4-31b-it)',
    groq: 'Groq · Llama 3.3 70B (llama-3.3-70b-versatile)',
    mistral: 'Mistral · Medium 3.5 (mistral-medium-latest)',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('switch-model')
        .setDescription('Switch which AI provider the chat bot uses (Salary Crew only)')
        .addStringOption(option =>
            option
                .setName('provider')
                .setDescription('Provider to switch to. Leave empty to see the current one.')
                .setRequired(false)
                .addChoices(
                    { name: 'Google (Gemma 4)', value: 'google' },
                    { name: 'Groq (Llama 3.3 70B)', value: 'groq' },
                    { name: 'Mistral (Medium 3.5)', value: 'mistral' },
                )),

    async execute(interaction) {
        // Salary Crew gate
        if (!interaction.member?.roles?.cache?.has(ROLES.SALARY_CREW)) {
            await interaction.reply({
                content: '❌ You must be a member of Salary Crew to use this command.',
                flags: 64,
            });
            return;
        }

        const current = getActiveProvider();
        const choice = interaction.options.getString('provider');

        // No choice → just report the current model.
        if (!choice) {
            await interaction.reply({
                content: `🤖 The AI chat bot is currently using **${PROVIDER_LABELS[current] || current}**.\n` +
                    `Run \`/switch-model provider:<option>\` to change it.`,
                flags: 64,
            });
            return;
        }

        if (choice === current) {
            await interaction.reply({
                content: `ℹ️ The bot is already using **${PROVIDER_LABELS[current] || current}**.`,
                flags: 64,
            });
            return;
        }

        const ok = await setActiveProvider(choice);
        if (!ok) {
            await interaction.reply({ content: '❌ Unknown provider.', flags: 64 });
            return;
        }

        Logger.success(`AI provider switched ${current} → ${choice} by ${interaction.user.tag}`);

        await interaction.reply({
            content: `✅ Switched the AI chat bot to **${PROVIDER_LABELS[choice] || choice}**.\n` +
                `_(was ${PROVIDER_LABELS[current] || current})_`,
            flags: 64,
        });

        // Mirror the change to the AI activity log channel for real-time visibility.
        try {
            const logChannel = await interaction.client.channels.fetch(AI_LOG_CHANNEL_ID).catch(() => null);
            if (logChannel) {
                await logChannel.send({
                    content: `🔁 [Switch] ${interaction.user.tag} changed AI provider: ${current} → ${choice}`,
                    allowedMentions: { parse: [] },
                });
            }
        } catch (_) {
            // non-fatal
        }
    },
};
