/**
 * Image discovery for AI vision.
 *
 * Pulls usable STILL-image URLs out of a Discord message from every place an
 * image can hide:
 *   1. Direct uploads (attachments)
 *   2. Discord-generated embeds (Tenor/Giphy links Discord already previewed)
 *   3. Tenor / Giphy / other share links → resolved to their og:image still
 *   4. Raw image links pasted in the message text
 *
 * For animated content (Tenor/Giphy) we only ever hand the vision model a
 * single static frame (the link's preview image). That keeps payloads tiny —
 * no extra API cost or rate-limit risk versus a normal image — and the fetch
 * to resolve a link is one small, time-bounded HTTP GET on the server.
 */

const Logger = require('./logger');

const fetch = global.fetch || require('node-fetch');

const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp)(\?|#|$)/i;
const LINK_RESOLVE_TIMEOUT_MS = 2500; // keep replies snappy

// Hosts whose share links need an og:image lookup to find the real media.
const RESOLVABLE_HOSTS = ['tenor.com', 'giphy.com', 'imgur.com'];

function looksLikeImageUrl(url) {
    return IMAGE_EXT_REGEX.test(url);
}

function isResolvableLink(url) {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return RESOLVABLE_HOSTS.some(h => host === h || host.endsWith('.' + h));
    } catch {
        return false;
    }
}

/**
 * Fetch a share-link page and read its og:image / twitter:image meta tag,
 * which points at a static preview image we can feed to a vision model.
 */
async function resolveLinkToImage(pageUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINK_RESOLVE_TIMEOUT_MS);
    try {
        const res = await fetch(pageUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BelugaBot/1.0)' },
        });
        if (!res.ok) return null;
        const html = await res.text();

        const patterns = [
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        ];
        for (const re of patterns) {
            const m = html.match(re);
            if (m && m[1]) {
                return m[1].replace(/&amp;/g, '&');
            }
        }
        return null;
    } catch (err) {
        if (err.name !== 'AbortError') {
            Logger.warning(`Could not resolve media link ${pageUrl}: ${err.message}`);
        }
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Collect still-image URLs from a message. Resolves share links as needed.
 * Returns a de-duplicated array (best/most-direct sources first).
 */
async function collectImageUrls(message) {
    const urls = [];
    const add = (u) => { if (u && !urls.includes(u)) urls.push(u); };

    // 1. Direct image attachments
    if (message.attachments && message.attachments.size > 0) {
        message.attachments.forEach(att => {
            if ((att.contentType && att.contentType.startsWith('image/')) || looksLikeImageUrl(att.url)) {
                add(att.url);
            }
        });
    }

    // 2. Discord-generated embeds (already-previewed Tenor/Giphy/etc.)
    if (message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
            if (embed.thumbnail && embed.thumbnail.url) add(embed.thumbnail.url);
            if (embed.image && embed.image.url) add(embed.image.url);
        }
    }

    // 3 + 4. Links in the message text: raw image links and resolvable shares
    const linkRegex = /https?:\/\/[^\s<>()]+/gi;
    const links = message.content ? message.content.match(linkRegex) || [] : [];
    for (const raw of links) {
        const link = raw.replace(/[).,]+$/, ''); // strip trailing punctuation
        if (looksLikeImageUrl(link)) {
            add(link);
        } else if (urls.length === 0 && isResolvableLink(link)) {
            // Only spend a network round-trip if we have nothing better yet.
            const resolved = await resolveLinkToImage(link);
            if (resolved) add(resolved);
        }
    }

    return urls;
}

module.exports = {
    collectImageUrls,
    resolveLinkToImage,
    looksLikeImageUrl,
};
