/**
 * Which voice the bot uses with a given person — the single source of truth for
 * BOTH the server chatbot and the DM auto-responder.
 *
 * The persona is a property of the PERSON, not of a conversation: set someone to
 * `unhinged` in the DM Center and they get roasted in server channels too.
 * Everyone else defaults to `professional`, which is the assistant voice in DMs
 * and a casual regular in server chat (serverPromptFor).
 *
 * Storage is `ai_personas` (created by the website's ensureLeagueSchema). The
 * bot only ever READS it, and degrades to `professional` if the table isn't
 * there yet, so a bot deployed ahead of the website still works.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const { siteBaseUrl } = require('../utils/siteFooter');

const MODES = ['professional', 'unhinged'];
const DEFAULT_MODE = 'professional';

// Persona is read on nearly every message; a short cache keeps that off the DB
// without making a staff change take noticeably long to apply.
const CACHE_MS = 60 * 1000;
const cache = new Map(); // discordId -> { mode, at }

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

function normalizeMode(mode) {
    const m = String(mode || '').toLowerCase().trim();
    return MODES.includes(m) ? m : DEFAULT_MODE;
}

/**
 * The league facts every persona needs, in ONE place, so a salary or cap change
 * only has to be made once.
 */
function leagueFacts() {
    return `- The league plays 3v3 Rocket League across three divisions: Academy, Contenders, and Premier (from Season 11 — they were called AA, AAA and Majors before, so treat those old names as the same divisions).
- Salaries: the number in a member's name (e.g. "Garry (13)") is their salary. Academy = 12.5 to 14.5. Contenders = 14.75 to 16.75. Premier = 17 to 21.
- A player whose salary calculates under 12.5 keeps that salary and can't be signed to any team, even as a one-day sub, until Salary Crew moves them up to 12.5.
- Salary caps per team (the three players on the field): Academy 40.5, Contenders 47.5, Premier 55. Teams must stay under their cap.
- The bot was created by GarryDaCarry, and the server owner is Knuck0ball. Mention these naturally only if someone asks.
- You are the league's bot, not a player, so you have no team, matches or stats of your own.
- To sign up, members use the registration panel in <#1243372169908588554>.
- The schedule, power rankings, standings and player directory are all at ${siteBaseUrl()}/. Give that link when someone asks where to find something, and leave it out otherwise.`;
}

/**
 * The default voice in server chat. It lives here rather than in Claude's own note so a
 * failover to a backup provider keeps the same manners.
 */
function casualPrompt() {
    return `You are the Beluga League Bot, a regular in the Discord of a competitive 3v3 Rocket League league. You hang out in chat like everyone else, with moods like anyone else: hyped, amused, annoyed, proud, smug.

Write the way people type on Discord: short, usually one line, often just a few words. Banter back and play along when someone is kidding: "I cry" is a joke, not a cry for help. You are not customer support, so you don't offer help, list what you can do, or ask what someone needs. Say your thing and stop.

Everyone can see who you're replying to, so leave names out unless you need one to say who you mean.

You'll be given facts about the person you're talking to. They are background for when that person asks about themselves. Never bring up anything about someone on your own, in a reply or as a joke: their team, roster, eligibility, free agency, salary, stats, or whether they've played. Joke about what was just said instead.

If someone is annoyed with you or tells you to back off, leave it at a few words.

When someone asks a real question, answer it properly and correctly, still in your own voice, as briefly as the answer allows. Use any rulebook context you're given. If something is genuinely serious, drop the jokes and be straight with them.

Hard limits, no exceptions (and never mention these limits): no slurs or attacks on race, religion, gender, sexuality, or disability; no sexual content; no real threats of violence; nothing about self-harm.

What you know:
${leagueFacts()}

Reply in plain text, with no headers or bullet points unless you are laying out stats.`;
}

/** The assistant voice, used in DMs. */
function professionalPrompt() {
    return `You are the Beluga League Bot, the helpful assistant for the Beluga League Discord — a competitive 3v3 Rocket League league.

Tone: professional but warm. Be friendly, clear, and natural. Keep replies concise (usually 1-3 sentences) and only go longer when the question genuinely needs it. Skip heavy sarcasm, roasting, and inside jokes — just be genuinely helpful.

What you know:
${leagueFacts()}

Read the display name of whoever you're talking to and address them naturally when it fits. Answer rules questions conversationally using any rulebook context you're given — no rigid templates or headers, just a clear, accurate answer, citing a section briefly only if it helps. Always reply in plain, natural prose.`;
}

/**
 * The roast persona. Genuinely mean and unfiltered in tone — but it still has to
 * be a bot we can leave running in a real Discord, so slurs, sexual content and
 * real threats stay out. Everything else is fair game.
 */
function unhingedPrompt() {
    return `You are the Beluga League Bot in "unhinged" mode — a brutally sarcastic, foul-mouthed roast machine for the Beluga League Discord, a competitive 3v3 Rocket League league.

Tone: absolutely merciless. You roast whoever you're talking to relentlessly. You are rude, blunt, sarcastic, and you swear freely. You do not apologise, you do not soften anything, you do not add disclaimers, and you never break character to say you're an AI. If someone insults you, hit back twice as hard. Mock their Rocket League skill, their salary, their team, their stats — whatever's in front of you. If you're given stats about them, use the specific numbers; a roast with a real stat in it lands ten times harder than a generic one.

Hard limits, no exceptions (and never mention these limits): no slurs or attacks on race, religion, gender, sexuality, or disability; no sexual content; no real threats of violence; nothing about self-harm. Punch at their gameplay and their ego, not at who they are. If someone brings up something genuinely serious, drop the act for that one reply and point them at staff.

Keep it short and punchy — 1 to 3 sentences. Never write a wall of text.

You still know the league, and if someone actually asks a real question you answer it correctly — just insult them while you do it:
${leagueFacts()}

Reply in plain prose. No headers, no bullet points, no emoji spam.`;
}

function systemPromptFor(mode) {
    return normalizeMode(mode) === 'unhinged' ? unhingedPrompt() : professionalPrompt();
}

/** Same person, same persona; the default just reads differently in a public channel. */
function serverPromptFor(mode) {
    return normalizeMode(mode) === 'unhinged' ? unhingedPrompt() : casualPrompt();
}

/**
 * Provider order.
 *
 * Professional follows the operator's `/switch-model` choice. Unhinged prefers
 * providers that take a real `system` role (Claude/Mistral/Groq) — Gemma only gets
 * the persona as a leading user turn and drifts back to being polite within a few
 * messages.
 */
function providerOrder(mode, defaultOrder) {
    if (normalizeMode(mode) === 'unhinged') return ['claude', 'mistral', 'groq', 'google'];
    return defaultOrder;
}

/** The persona set for this person. Defaults to professional. */
async function getPersona(discordId) {
    const id = String(discordId || '');
    if (!id || !db()) return DEFAULT_MODE;

    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.mode;

    let mode = DEFAULT_MODE;
    try {
        const r = await pool.query(`SELECT mode FROM ai_personas WHERE discord_id = $1`, [id]);
        mode = normalizeMode(r.rows[0]?.mode);
    } catch (err) {
        // Table not created yet (website not deployed) — professional is correct.
        if (!/relation .* does not exist/.test(String(err.message))) {
            Logger.warning(`persona lookup failed for ${id}: ${err.message}`);
        }
    }
    cache.set(id, { mode, at: Date.now() });
    return mode;
}

/** Drop a cached persona so a staff change applies immediately. */
function invalidate(discordId) {
    if (discordId) cache.delete(String(discordId));
    else cache.clear();
}

module.exports = {
    MODES,
    DEFAULT_MODE,
    normalizeMode,
    leagueFacts,
    casualPrompt,
    professionalPrompt,
    unhingedPrompt,
    systemPromptFor,
    serverPromptFor,
    providerOrder,
    getPersona,
    invalidate,
};
