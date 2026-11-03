/**
 * Turns whatever a member shared into pictures Claude can look at.
 *
 * The API only reads the first frame of an animated image, so anything that moves comes
 * back here as a few frames spread across the clip. That covers the forms a "GIF" really
 * takes on Discord: .gif uploads, the mp4 and webm behind Tenor, Giphy and KLIPY links,
 * animated PNG and WebP, animated stickers and animated emoji.
 *
 * Files come from strangers, so ffmpeg never touches the network. safeFetch downloads the
 * bytes, the format is read from the bytes instead of the name, and ffmpeg is told that
 * format outright, which stops a playlist posing as a .gif from opening anything else.
 */

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { StickerFormatType } = require('discord.js');
const Logger = require('../utils/logger');
const { safeFetch } = require('../utils/ssrfGuard');
const { resolveLinkToMedia, isResolvableLink } = require('../utils/tenor');

const MAX_ITEMS = 3;
const MAX_FRAMES = 6;
const FRAME_WIDTH = 512;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const LONG_CLIP_BYTES = 5 * 1024 * 1024;
const MIN_KEYFRAMES = 3;
const MAX_RAW_STILL_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15 * 1000;
const FFMPEG_TIMEOUT_MS = 10 * 1000;
const PREVIEW_WAIT_MS = 1500;
const PREVIEW_TRIES = 2;

const MEDIA_LINK = /\.(png|jpe?g|gif|webp|avif|mp4|m4v|mov|webm)(\?|#|$)/i;
const VIDEO_LINK = /\.(mp4|m4v|mov|webm)(\?|#|$)/i;
const LINK = /https?:\/\/[^\s<>()|]+/gi;
const DISCORD_FILE = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/(ephemeral-)?attachments\//i;
const CUSTOM_EMOJI = /<(a?):(\w{2,32}):(\d{15,25})>/g;
const STILL_QUERY = 'format=jpeg';

const FFMPEG_FORMAT = { gif: 'gif', apng: 'apng', mp4: 'mov', webm: 'matroska' };
const STILL_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const KIND_LABEL = {
    gif: 'A GIF', awebp: 'A GIF', apng: 'An animated image', mp4: 'A GIF or video', webm: 'A GIF or video',
    png: 'An image', jpeg: 'An image', webp: 'An image',
};

let ffmpegPath = null;
try {
    ffmpegPath = require('ffmpeg-static');
} catch (err) {
    Logger.warning(`ffmpeg isn't available, so GIFs will be read as a single frame: ${err.message}`);
}

/** The real format, from the file's own first bytes. */
function sniff(bytes) {
    if (bytes.length < 16) return null;
    const head = bytes.toString('latin1', 0, 16);
    if (head.startsWith('GIF8')) return 'gif';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
    if (bytes[0] === 0x89 && head.slice(1, 4) === 'PNG') {
        return bytes.subarray(0, 4096).includes('acTL') ? 'apng' : 'png';
    }
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') {
        return bytes.subarray(0, 256).includes('ANIM') ? 'awebp' : 'webp';
    }
    if (head.slice(4, 8) === 'ftyp') return 'mp4';
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
    return null;
}

function pickEven(list, count) {
    if (list.length <= count) return list;
    return Array.from({ length: count }, (_, i) => list[Math.round((i * (list.length - 1)) / (count - 1))]);
}

function toFrame(buffer) {
    return { mime: 'image/jpeg', base64: buffer.toString('base64') };
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, { timeout: FFMPEG_TIMEOUT_MS, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    });
}

const SCALE = `scale='min(${FRAME_WIDTH},iw)':-2`;
const FRAME_MODES = {
    key: { before: ['-skip_frame', 'nokey'], after: ['-vf', SCALE, '-fps_mode', 'vfr', '-frames:v', '400'] },
    paced: { before: ['-t', '12'], after: ['-vf', `fps=4,${SCALE}`, '-frames:v', '48'] },
    every: { before: ['-t', '12'], after: ['-vf', SCALE, '-fps_mode', 'passthrough', '-frames:v', '48'] },
};

async function extractFrames(input, dir, kind, mode) {
    const { before, after } = FRAME_MODES[mode];
    await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-protocol_whitelist', 'file',
        '-f', FFMPEG_FORMAT[kind],
        ...before,
        '-i', input,
        ...after,
        '-q:v', '5',
        path.join(dir, `${mode}%03d.jpg`),
    ]);
    return (await fs.readdir(dir)).filter((n) => n.startsWith(mode) && n.endsWith('.jpg')).sort();
}

async function ffmpegFrames(bytes, kind) {
    if (!ffmpegPath) return [];
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'beluga-media-'));
    try {
        const input = path.join(dir, 'input');
        await fs.writeFile(input, bytes);
        // A real clip decodes only its keyframes: quick even at 1080p, and they span the whole
        // thing, so a goal at the end gets seen. A GIF-sized file may have just one, so it doesn't.
        const clip = bytes.length > LONG_CLIP_BYTES && (kind === 'mp4' || kind === 'webm');
        let names = clip ? await extractFrames(input, dir, kind, 'key').catch(() => []) : [];
        if (names.length < MIN_KEYFRAMES) names = await extractFrames(input, dir, kind, 'paced');
        // A one-frame GIF with a zero delay has no running time for the fps filter to sample,
        // so ffmpeg succeeds with nothing written.
        if (!names.length) names = await extractFrames(input, dir, kind, 'every');
        const picked = pickEven(names, MAX_FRAMES);
        // Awaited here so the frames are read before `finally` deletes them.
        return await Promise.all(picked.map(async (name) => toFrame(await fs.readFile(path.join(dir, name)))));
    } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

/** ffmpeg can't decode animated WebP, so that one format goes through sharp. */
async function webpFrames(bytes) {
    const sharp = require('sharp');
    const { pages = 1 } = await sharp(bytes, { animated: true }).metadata();
    const indexes = pickEven(Array.from({ length: pages }, (_, i) => i), MAX_FRAMES);
    return Promise.all(indexes.map(async (page) => toFrame(
        await sharp(bytes, { page, pages: 1 })
            .resize({ width: FRAME_WIDTH, withoutEnlargement: true })
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 70 })
            .toBuffer(),
    )));
}

async function stillFrame(bytes, kind) {
    if (bytes.length <= MAX_RAW_STILL_BYTES) return [{ mime: STILL_MIME[kind], base64: bytes.toString('base64') }];
    const sharp = require('sharp');
    return [toFrame(await sharp(bytes).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer())];
}

async function framesOf(bytes, kind) {
    if (kind === 'awebp') return webpFrames(bytes);
    if (FFMPEG_FORMAT[kind]) return ffmpegFrames(bytes, kind);
    return stillFrame(bytes, kind);
}

async function download(url) {
    const res = await safeFetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BelugaBot/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) throw new Error('file too large');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('file too large');
    return bytes;
}

/** A Discord file link only opens with a current signature (the `ex` value is its expiry). */
function needsSignature(url) {
    if (!DISCORD_FILE.test(url)) return false;
    return parseInt(new URL(url).searchParams.get('ex') || '0', 16) * 1000 < Date.now();
}

/**
 * Discord's app quietly re-signs a pasted file link for its users, so a link that plays for
 * everyone is still a 404 from here. This asks Discord for the same thing.
 */
async function signLinks(candidates, client) {
    const stale = [...new Set(candidates.flatMap((c) => c.urls).filter(needsSignature))];
    if (!stale.length || !client?.rest) return candidates;
    try {
        const { refreshed_urls: rows = [] } = await client.rest.post('/attachments/refresh-urls', { body: { attachment_urls: stale } });
        const fresh = new Map(rows.map((row) => [row.original, row.refreshed]));
        return candidates.map((c) => ({ ...c, urls: c.urls.map((url) => fresh.get(url) || url) }));
    } catch (err) {
        Logger.warning(`Could not refresh Discord file links: ${err.message}`);
        return candidates;
    }
}

/** Discord's own picture of a video, as a last try for a clip too big to download. */
function stillOf(url) {
    return `${url.replace('//cdn.discordapp.com/', '//media.discordapp.net/')}${url.includes('?') ? '&' : '?'}${STILL_QUERY}`;
}

/** What a message contains. Each entry lists URLs to try, best first. */
function fromMessage(message) {
    const found = [];
    const seen = new Set();
    const add = (urls, extra = {}) => {
        const list = urls.filter(Boolean);
        if (!list.length || list.some((u) => seen.has(u))) return;
        list.forEach((u) => seen.add(u));
        found.push({ urls: list, ...extra });
    };

    for (const att of message.attachments?.values?.() || []) {
        if (/^video\//.test(att.contentType || '')) add([att.url, stillOf(att.url)]);
        else if (/^image\//.test(att.contentType || '') || MEDIA_LINK.test(att.url)) add([att.url]);
    }
    for (const embed of message.embeds || []) {
        // A video URL can be a player page (YouTube), so the picture stays as the next try.
        // Discord's proxied copies come after each one, for sites that turn bots away.
        add([embed.video?.url, embed.video?.proxyURL, embed.image?.url, embed.image?.proxyURL, embed.thumbnail?.url, embed.thumbnail?.proxyURL]);
        if (embed.url) seen.add(embed.url);
    }
    for (const raw of String(message.content || '').match(LINK) || []) {
        const link = raw.replace(/[).,*_~`]+$/, '');
        if (seen.has(link)) continue;
        if (DISCORD_FILE.test(link)) add([link, VIDEO_LINK.test(link) && stillOf(link)]);
        else if (MEDIA_LINK.test(link)) add([link]);
        else if (isResolvableLink(link)) add([link], { share: true });
    }
    for (const sticker of message.stickers?.values?.() || []) {
        const label = `The sticker "${sticker.name}"`;
        // Lottie stickers are drawing instructions, not pictures, so the name is all there is.
        if (sticker.format === StickerFormatType.Lottie) found.push({ urls: [], label });
        else add([sticker.url], { label });
    }
    // Last, so a row of emoji can't use up the slots ahead of a GIF.
    for (const match of String(message.content || '').matchAll(CUSTOM_EMOJI)) {
        const [, animated, name, id] = match;
        add([`https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`], { label: `The custom emoji :${name}:` });
    }
    return found;
}

function labelFor(candidate, kind, url = '') {
    const label = url.endsWith(STILL_QUERY) ? 'The very start of a long video clip' : (candidate.label || KIND_LABEL[kind]);
    return candidate.replied ? `${label} from the message they replied to` : label;
}

async function loadOne(candidate) {
    if (!candidate.urls.length) return { url: null, frames: [], label: labelFor(candidate) };
    for (const source of candidate.urls) {
        try {
            const url = candidate.share ? await resolveLinkToMedia(source) : source;
            if (!url) continue;
            const bytes = await download(url);
            const kind = sniff(bytes);
            if (!kind) continue;
            const frames = await framesOf(bytes, kind);
            if (frames.length) return { url, frames, label: labelFor(candidate, kind, url) };
        } catch (err) {
            Logger.warning(`Could not read shared media: ${err.message}`);
        }
    }
    return null;
}

/**
 * Discord adds a link's preview a moment after the message arrives. For a page link that
 * preview is the reliable way to the real file: many sites turn bots away, and KLIPY always does.
 */
async function withPreview(message) {
    const links = String(message.content || '').match(LINK) || [];
    const wanted = links.some((link) => !MEDIA_LINK.test(link) && !DISCORD_FILE.test(link));
    if (message.embeds?.length || !wanted || typeof message.fetch !== 'function') return message;
    let latest = message;
    for (let i = 0; i < PREVIEW_TRIES && !latest.embeds?.length; i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, PREVIEW_WAIT_MS); });
        latest = await latest.fetch(true).catch(() => latest);
    }
    return latest;
}

/** Everything viewable in a message, in what it forwards, and in the one it replies to. Never throws. */
async function readMedia(message) {
    try {
        const found = fromMessage(await withPreview(message));
        const forwarded = [...(message.messageSnapshots?.values?.() || [])];
        for (const snapshot of forwarded) found.push(...fromMessage(snapshot));
        if (!forwarded.length && message.reference?.messageId && typeof message.fetchReference === 'function') {
            const replied = await message.fetchReference().catch(() => null);
            if (replied) found.push(...fromMessage(replied).map((c) => ({ ...c, replied: true })));
        }
        const signed = await signLinks(found.slice(0, MAX_ITEMS), message.client);
        const loaded = await Promise.all(signed.map(loadOne));
        return loaded.filter(Boolean);
    } catch (err) {
        Logger.warning(`Reading shared media failed: ${err.message}`);
        return [];
    }
}

/** Claude content blocks, each item introduced by a line saying what it is. */
function toBlocks(media) {
    const blocks = [];
    for (const item of media) {
        const count = item.frames.length;
        blocks.push({ type: 'text', text: count > 1 ? `[${item.label}, shown as ${count} frames from start to end]` : `[${item.label}]` });
        for (const frame of item.frames) {
            blocks.push({ type: 'image', source: { type: 'base64', media_type: frame.mime, data: frame.base64 } });
        }
    }
    return blocks;
}

module.exports = { readMedia, toBlocks, download, sniff, framesOf, fromMessage, pickEven };
