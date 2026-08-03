/**
 * The one-line website footer appended to every public info command.
 *
 * Renders in Discord as small grey subtext with a short-form clickable link:
 *
 *   -# Check out [belugaleague.com](<https://belugaleague.com>) for more information <:0belugaLogo:…>
 *
 * Why this exact shape:
 *   - `-# ` is Discord's SUBTEXT syntax. It must start the line, and it renders in
 *     plain message CONTENT (not just embeds), which is what lets one helper work
 *     for embed replies, image replies and plain replies alike.
 *   - Masked links `[text](url)` DO render in message content when the message is
 *     sent by an app/bot (they stay raw for messages typed by users), so the link
 *     can be short-form instead of a full pasted URL.
 *   - The `<>` around the href suppresses the big unfurled link-preview card while
 *     keeping the link clickable. Without it every /standings post would drag an
 *     unwanted embed along behind the images.
 *
 * Keep this line short and professional — the beluga brand emoji is the only
 * decoration it gets.
 */

/** Website base URL. Env-overridable; `RAILWAY_PUBLIC_DOMAIN` is deliberately NOT
 *  used here — on Railway that resolves to the BOT service's domain, not the site. */
function siteBaseUrl() {
    const raw = process.env.WEBSITE_URL || process.env.PUBLIC_WEBSITE_URL || 'https://belugaleague.com';
    return String(raw).trim().replace(/\/+$/, '');
}

/** The short display label for the link (host only, no scheme, no trailing slash). */
function siteLabel() {
    return siteBaseUrl().replace(/^https?:\/\//, '');
}

/** Build an absolute site URL for a path, e.g. siteUrl('/players/123'). */
function siteUrl(path = '') {
    const p = String(path || '');
    return `${siteBaseUrl()}${p.startsWith('/') || !p ? p : `/${p}`}`;
}

// The league's own logo emoji. Resolved from the guild by name when we can (so a
// re-uploaded emoji keeps working), else the known id, else a unicode whale.
const EMOJI_NAMES = ['0belugalogo', 'belugalogo'];
const EMOJI_FALLBACK = `<:0belugaLogo:${process.env.BELUGA_EMOJI_ID || '1195271824083271750'}>`;

/**
 * @param {import('discord.js').Guild|null} guild
 * @returns {string} a renderable emoji token
 */
function belugaEmoji(guild) {
    try {
        const cache = guild?.emojis?.cache;
        if (cache) {
            for (const want of EMOJI_NAMES) {
                const emoji = cache.find((e) => e.name && e.name.toLowerCase() === want);
                if (emoji) return emoji.toString(); // <:name:id> / <a:name:id>
            }
        }
    } catch { /* fall through */ }
    return EMOJI_FALLBACK || '🐋';
}

/**
 * The footer line on its own.
 * @param {import('discord.js').Guild|null} guild
 */
function siteFooter(guild) {
    return `-# Check out [${siteLabel()}](<${siteBaseUrl()}>) for more information ${belugaEmoji(guild)}`;
}

/**
 * Append the footer to a message content string, on its own line.
 * Safe with an empty/undefined content (returns just the footer).
 * @param {string|null|undefined} content
 * @param {import('discord.js').Guild|null} guild
 */
function appendFooter(content, guild) {
    const base = String(content ?? '').trim();
    return base ? `${base}\n${siteFooter(guild)}` : siteFooter(guild);
}

module.exports = { siteFooter, appendFooter, belugaEmoji, siteUrl, siteBaseUrl, siteLabel };
