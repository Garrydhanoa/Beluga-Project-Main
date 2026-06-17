/**
 * Builders for the public, interaction-locked report messages:
 *   - side assignment (which replay cluster is which team) when not auto-resolved
 *   - per-team player matching panel (one select per replay player)
 *   - final two-sided confirmation panel
 *
 * Discord limits respected: ≤5 action rows/message, one select per row, ≤25
 * options/select, customId ≤100. With ≤4 player slots per page we fit 4 selects
 * + a button row; more than 4 paginates.
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, UserSelectMenuBuilder,
} = require('discord.js');
const ids = require('./ids');
const { VAL_SKIP, VAL_SEARCH } = require('./constants');

const SLOTS_PER_PAGE = 4;

function truncate(s, n) { const v = String(s ?? ''); return v.length > n ? `${v.slice(0, n - 1)}…` : v; }

/** Resolve a friendly label for a matched discord id, from roster/subs/slot. */
function nameFor(discordId, roster, subCandidates, slot) {
    if (!discordId) return null;
    const r = roster.find((m) => m.discordId === discordId);
    if (r) return r.displayName;
    const s = subCandidates.find((m) => m.discordId === discordId);
    if (s) return s.displayName;
    if (slot && slot.subDisplay) return slot.subDisplay;
    return `User ${String(discordId).slice(-4)}`;
}

function slotStatusLine(slot, roster, subCandidates) {
    if (slot.skipped) return `⏭️ skipped (no stats)`;
    if (slot.mode === 'search') return `🔎 searching…`;
    if (slot.discordId) return `→ **${nameFor(slot.discordId, roster, subCandidates, slot)}**`;
    return `→ _not matched yet_`;
}

/**
 * @param {object} o
 * @param {number} o.sessionId
 * @param {'home'|'away'} o.side
 * @param {string} o.teamName
 * @param {Array} o.slots   [{ index, name, platform, platformId, discordId, mode, skipped, subDisplay }]
 * @param {Array} o.roster  [{ discordId, displayName, role }]
 * @param {Array} o.subCandidates [{ discordId, displayName }]
 * @param {boolean} o.submitted
 * @param {number} [o.page=0]
 */
function buildSideMessage(o) {
    const { sessionId, side, teamName, slots, roster, subCandidates, submitted, page = 0 } = o;
    const pageCount = Math.max(1, Math.ceil(slots.length / SLOTS_PER_PAGE));
    const start = page * SLOTS_PER_PAGE;
    const pageSlots = slots.slice(start, start + SLOTS_PER_PAGE);

    const embed = new EmbedBuilder()
        .setTitle(`🧩 Match ${teamName}'s players`)
        .setColor(submitted ? 0x27AE60 : 0x2980B9)
        .setDescription(
            submitted
                ? `✅ **${teamName}** submitted. Waiting on the other team / final confirmation.`
                : `Match each **Ballchasing player** below to the Discord account that played. ` +
                  `Use **🔎 Search server** for a sub, or **⏭️ Skip** to drop a player's stats.\n\n` +
                  `Only **${teamName}**'s captain/GM (or salary crew) can use this panel.`
        )
        .addFields(
            slots.map((s) => ({
                name: truncate(`🎮 ${s.name || s.platformId || 'Unknown'}`, 250),
                value: slotStatusLine(s, roster, subCandidates),
                inline: true,
            }))
        )
        .setFooter({ text: pageCount > 1 ? `Page ${page + 1}/${pageCount}` : 'Match all, then Submit.' });

    const components = [];
    if (!submitted) {
        for (const slot of pageSlots) {
            if (slot.mode === 'search') {
                components.push(new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId(ids.build('sub', sessionId, side === 'home' ? 'h' : 'a', slot.index))
                        .setPlaceholder(truncate(`Search Discord for ${slot.name || 'this player'}`, 150))
                        .setMinValues(1).setMaxValues(1)
                ));
                continue;
            }
            const options = [];
            const used = new Set();
            for (const m of roster) {
                if (used.has(m.discordId)) continue;
                used.add(m.discordId);
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel(truncate(`${m.displayName}${m.role && m.role !== 'player' ? ` (${m.role})` : ''}`, 100))
                    .setValue(m.discordId)
                    .setDefault(slot.discordId === m.discordId));
            }
            for (const m of subCandidates) {
                if (used.has(m.discordId) || options.length >= 21) continue;
                used.add(m.discordId);
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel(truncate(`${m.displayName} (recent sub)`, 100))
                    .setValue(m.discordId)
                    .setDefault(slot.discordId === m.discordId));
            }
            // A searched sub not in either list — keep it visible + selected.
            if (slot.discordId && !used.has(slot.discordId)) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel(truncate(`${slot.subDisplay || 'Selected account'} (sub)`, 100))
                    .setValue(slot.discordId).setDefault(true));
            }
            options.push(new StringSelectMenuOptionBuilder().setLabel('🔎 Search server…').setValue(VAL_SEARCH));
            options.push(new StringSelectMenuOptionBuilder().setLabel('⏭️ Skip (no stats)').setValue(VAL_SKIP).setDefault(Boolean(slot.skipped)));

            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(ids.build('match', sessionId, side === 'home' ? 'h' : 'a', slot.index))
                    .setPlaceholder(truncate(`Who is "${slot.name || slot.platformId}"?`, 150))
                    .addOptions(options.slice(0, 25))
            ));
        }

        const buttons = new ActionRowBuilder();
        if (pageCount > 1) {
            buttons.addComponents(
                new ButtonBuilder().setCustomId(ids.build('page', sessionId, side === 'home' ? 'h' : 'a', Math.max(0, page - 1)))
                    .setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId(ids.build('page', sessionId, side === 'home' ? 'h' : 'a', Math.min(pageCount - 1, page + 1)))
                    .setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pageCount - 1),
            );
        }
        buttons.addComponents(
            new ButtonBuilder().setCustomId(ids.build('submit', sessionId, side === 'home' ? 'h' : 'a'))
                .setLabel('Submit matches').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(ids.build('cancel', sessionId))
                .setLabel('Cancel report').setStyle(ButtonStyle.Danger),
        );
        components.push(buttons);
    }

    return { embeds: [embed], components };
}

/** Side-assignment message — always shown so the reporter confirms which cluster is which team. */
function buildAssignMessage({ sessionId, parsed, homeName, awayName, suggestedIdx = null, confident = false }) {
    const group = (players) => players.map((p) => p.names?.[0] || p.platformId).slice(0, 5).join(', ');
    const hasGuess = suggestedIdx === 0 || suggestedIdx === 1;
    const guessLabel = hasGuess ? (suggestedIdx === 0 ? 'A' : 'B') : null;
    const description = hasGuess
        ? `Our best guess: **Group ${guessLabel}** is **${homeName}**${confident ? '' : ' (low confidence)'}. Confirm it below — or pick the other if we got it backwards.`
        : `We couldn't auto-detect sides. Pick which replay group is **${homeName}**.`;
    const embed = new EmbedBuilder()
        .setTitle('🔀 Which group is which team?')
        .setColor(0x9B59B6)
        .setDescription(description)
        .addFields(
            { name: suggestedIdx === 0 ? `Group A — looks like ${truncate(homeName, 200)}` : 'Group A', value: truncate(group(parsed.teams[0].players), 1000) || '—', inline: false },
            { name: suggestedIdx === 1 ? `Group B — looks like ${truncate(homeName, 200)}` : 'Group B', value: truncate(group(parsed.teams[1].players), 1000) || '—', inline: false },
        );
    // BUTTONS, not a pre-selected select menu: Discord fires NO interaction when a
    // user re-picks the option already marked default, so a correct guess left the
    // reporter stuck (they had to choose the WRONG group to advance). Two buttons
    // always fire. The guessed side is highlighted Primary so it reads as "confirm".
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(ids.build('assign', sessionId, 0))
            .setLabel(truncate(`Group A is ${homeName}`, 80))
            .setStyle(suggestedIdx === 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(ids.build('assign', sessionId, 1))
            .setLabel(truncate(`Group B is ${homeName}`, 80))
            .setStyle(suggestedIdx === 1 ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row] };
}

/** Final confirmation panel (each side confirms; salary crew can finalize instantly). */
function buildConfirmMessage({ sessionId, parsed, homeName, awayName, seriesLabel, confirm, showSalaryFinalize }) {
    const embed = new EmbedBuilder()
        .setTitle('📝 Confirm the result')
        .setColor(0xF1C40F)
        .setDescription(
            `**${homeName}** ${seriesLabel} **${awayName}**\n\n` +
            `Both teams' captains/GMs: confirm the matched result below. Salary crew can finalize directly.`
        )
        .addFields(
            { name: homeName, value: confirm.home ? '✅ confirmed' : '⏳ waiting', inline: true },
            { name: awayName, value: confirm.away ? '✅ confirmed' : '⏳ waiting', inline: true },
        );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ids.build('confirm', sessionId, 'h')).setLabel(`${homeName} confirm`).setStyle(ButtonStyle.Success).setDisabled(Boolean(confirm.home)),
        new ButtonBuilder().setCustomId(ids.build('confirm', sessionId, 'a')).setLabel(`${awayName} confirm`).setStyle(ButtonStyle.Success).setDisabled(Boolean(confirm.away)),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ids.build('reject', sessionId, 'h')).setLabel('Reject / fix').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ids.build('dispute', sessionId)).setLabel('Dispute (call staff)').setEmoji('⚠️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ids.build('cancel', sessionId)).setLabel('Cancel report').setStyle(ButtonStyle.Danger),
    );
    if (showSalaryFinalize) {
        row2.addComponents(
            new ButtonBuilder().setCustomId(ids.build('scfinal', sessionId)).setLabel('Salary crew: finalize').setEmoji('🛡️').setStyle(ButtonStyle.Primary)
        );
    }
    return { embeds: [embed], components: [row, row2] };
}

module.exports = { buildSideMessage, buildAssignMessage, buildConfirmMessage, SLOTS_PER_PAGE };
