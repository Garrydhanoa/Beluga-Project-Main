/**
 * Spam detection, kept deliberately loose: a real burst or the same line over and over,
 * not someone who types quickly. Discord's own spam rules still run alongside this.
 * State is in memory on purpose, because a spam burst doesn't outlive a restart.
 */

const { foldLetters } = require('./normalize');
const { asInt } = require('../modConfig');

const KEEP_MS = 60 * 1000;
const MAX_TRACKED = 30;

const recent = new Map();   // authorId -> [{ at, key, id, channelId }]

/** @returns {{kind:string, messages:Array}|null} */
function check(message, settings) {
    const now = Date.now();
    const list = (recent.get(message.author.id) || []).filter((m) => now - m.at < KEEP_MS);
    // Compares the words as typed, numbers included: "game 1, game 2, game 3" isn't a repeat.
    const typed = foldLetters(message.content).replace(/\s+/g, ' ').trim();
    const key = typed || (message.attachments?.size ? 'attachment' : '');
    list.push({ at: now, key, id: message.id, channelId: message.channelId });
    recent.set(message.author.id, list.slice(-MAX_TRACKED));

    const burstCount = asInt(settings.filter_spam_burst_messages, 7);
    const burstMs = asInt(settings.filter_spam_burst_seconds, 6) * 1000;
    const burst = list.filter((m) => now - m.at <= burstMs);
    if (burst.length >= burstCount) {
        recent.delete(message.author.id);
        return { kind: `${burst.length} messages in ${burstMs / 1000} seconds`, messages: burst };
    }

    const dupeCount = asInt(settings.filter_spam_duplicate_messages, 4);
    const dupeMs = asInt(settings.filter_spam_duplicate_seconds, 30) * 1000;
    const dupes = key ? list.filter((m) => m.key === key && now - m.at <= dupeMs) : [];
    if (dupes.length >= dupeCount) {
        recent.delete(message.author.id);
        return { kind: `the same message ${dupes.length} times`, messages: dupes };
    }
    return null;
}

module.exports = { check };
