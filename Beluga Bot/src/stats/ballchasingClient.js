/**
 * Ballchasing API client (low-level).
 *
 * Wraps the three endpoints the stats system needs:
 *   - GET /api/groups/{id}            → group metadata + aggregated player stats
 *   - GET /api/replays?group={id}     → list of replays in a group (paginated)
 *   - GET /api/replays/{id}           → full per-replay detail (blue/orange + players)
 *
 * Design notes:
 *   - Auth header is the raw API key (NOT "Bearer <key>") per Ballchasing's docs.
 *   - Every call goes through a single serialized rate limiter so we never trip
 *     Ballchasing's per-second cap, and we retry on 429 / 5xx with backoff.
 *   - This module reads/parses only — it never uploads or mutates anything.
 *
 * The key is read lazily from process.env.BALLCHASING_API_KEY so the module can
 * be required without the key present (e.g. when the bot boots without stats env).
 */

const BASE_URL = 'https://ballchasing.com/api';

// Minimum gap between any two API calls. Ballchasing's free tier allows a few
// calls/sec; 600ms (~1.6/s) is comfortably under that and polite. Bump down if
// the league account has a higher patron tier.
const MIN_REQUEST_GAP_MS = 600;
const MAX_RETRIES = 4;

class BallchasingError extends Error {
    constructor(message, { status = null, code = null, url = null } = {}) {
        super(message);
        this.name = 'BallchasingError';
        this.status = status;
        this.code = code; // 'no_key' | 'not_found' | 'private' | 'rate_limit' | 'invalid_url' | 'http' | 'network'
        this.url = url;
    }
}

// ---- serialized rate limiter -------------------------------------------------
let _chain = Promise.resolve();
let _lastCallAt = 0;

function _schedule(fn) {
    const run = async () => {
        const now = Date.now();
        const wait = Math.max(0, _lastCallAt + MIN_REQUEST_GAP_MS - now);
        if (wait > 0) await _sleep(wait);
        _lastCallAt = Date.now();
        return fn();
    };
    // Chain so calls run strictly one-at-a-time, but don't let one failure break the chain.
    const result = _chain.then(run, run);
    _chain = result.then(() => undefined, () => undefined);
    return result;
}

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey() {
    const key = process.env.BALLCHASING_API_KEY;
    return key && String(key).trim() ? String(key).trim() : null;
}

function hasApiKey() {
    return Boolean(getApiKey());
}

/**
 * Extract the Ballchasing group id (slug-hash) from any group URL or a raw id.
 * Handles:
 *   https://ballchasing.com/group/<id>
 *   https://ballchasing.com/group/<id>/players-stats   (and other sub-paths)
 *   <id>
 * Returns null if it can't find a plausible id.
 */
function parseGroupId(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;

    // Bare id (no slashes, no scheme).
    if (!raw.includes('/') && !raw.includes(' ')) return raw;

    let url;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (!/(^|\.)ballchasing\.com$/i.test(url.hostname)) return null;

    const parts = url.pathname.split('/').filter(Boolean); // e.g. ['group', '<id>', 'players-stats']
    const gIdx = parts.indexOf('group');
    if (gIdx === -1 || !parts[gIdx + 1]) return null;
    return parts[gIdx + 1];
}

function isGroupUrl(input) {
    const raw = String(input || '').trim();
    try {
        const url = new URL(raw);
        return /(^|\.)ballchasing\.com$/i.test(url.hostname) && /\/group\//i.test(url.pathname);
    } catch {
        return false;
    }
}

/**
 * Replay id from a link (the mirror of parseGroupId). Handles:
 *   https://ballchasing.com/replay/<id>
 *   https://ballchasing.com/replay/<id>/anything
 *   <id>
 * Returns null if it can't find a plausible id. Used by the manual/admin report
 * path, where staff supply one replay link per game instead of a group.
 */
function parseReplayId(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;

    // Bare id (no slashes, no scheme).
    if (!raw.includes('/') && !raw.includes(' ')) return raw;

    let url;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (!/(^|\.)ballchasing\.com$/i.test(url.hostname)) return null;

    const parts = url.pathname.split('/').filter(Boolean); // e.g. ['replay', '<id>']
    const rIdx = parts.indexOf('replay');
    if (rIdx === -1 || !parts[rIdx + 1]) return null;
    return parts[rIdx + 1];
}

function isReplayUrl(input) {
    const raw = String(input || '').trim();
    try {
        const url = new URL(raw);
        return /(^|\.)ballchasing\.com$/i.test(url.hostname) && /\/replay\//i.test(url.pathname);
    } catch {
        return false;
    }
}

async function _request(path, { query } = {}) {
    const key = getApiKey();
    if (!key) {
        throw new BallchasingError('BALLCHASING_API_KEY is not set.', { code: 'no_key' });
    }

    const url = new URL(BASE_URL + path);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        }
    }
    const href = url.toString();

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        attempt += 1;
        let res;
        try {
            res = await _schedule(() =>
                fetch(href, { headers: { Authorization: key, Accept: 'application/json' } })
            );
        } catch (err) {
            if (attempt <= MAX_RETRIES) {
                await _sleep(500 * attempt);
                continue;
            }
            throw new BallchasingError(`Network error calling Ballchasing: ${err.message}`, {
                code: 'network',
                url: href,
            });
        }

        if (res.ok) {
            return res.json();
        }

        if (res.status === 429) {
            const retryAfter = Number(res.headers.get('retry-after')) || attempt;
            if (attempt <= MAX_RETRIES) {
                await _sleep(Math.min(10000, retryAfter * 1000));
                continue;
            }
            throw new BallchasingError('Ballchasing rate limit hit (429).', {
                status: 429,
                code: 'rate_limit',
                url: href,
            });
        }

        if (res.status >= 500 && attempt <= MAX_RETRIES) {
            await _sleep(700 * attempt);
            continue;
        }

        // Non-retryable HTTP error — map to a friendly code.
        let code = 'http';
        if (res.status === 404) code = 'not_found';
        else if (res.status === 401 || res.status === 403) code = 'private';
        let bodyText = '';
        try {
            bodyText = await res.text();
        } catch { /* ignore */ }
        throw new BallchasingError(
            `Ballchasing API ${res.status} for ${path}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`,
            { status: res.status, code, url: href }
        );
    }
}

/** GET /groups/{id} — group metadata + aggregated player stats. */
async function getGroup(groupId) {
    const id = parseGroupId(groupId) || groupId;
    return _request(`/groups/${encodeURIComponent(id)}`);
}

/**
 * GET /replays?group={id} — every replay in the group (follows pagination).
 * Returns the array of replay "list" items (summaries, not full detail).
 */
async function listGroupReplays(groupId, { pageSize = 200, maxPages = 25 } = {}) {
    const id = parseGroupId(groupId) || groupId;
    const out = [];
    let next = null;
    let pages = 0;
    do {
        let data;
        if (next) {
            // `next` is an absolute URL; call it directly through the limiter.
            const key = getApiKey();
            data = await _schedule(() =>
                fetch(next, { headers: { Authorization: key, Accept: 'application/json' } }).then((r) => {
                    if (!r.ok) throw new BallchasingError(`Ballchasing pagination ${r.status}`, { status: r.status, code: 'http', url: next });
                    return r.json();
                })
            );
        } else {
            data = await _request('/replays', { query: { group: id, count: pageSize } });
        }
        const list = Array.isArray(data?.list) ? data.list : [];
        out.push(...list);
        next = data?.next || null;
        pages += 1;
    } while (next && pages < maxPages);
    return out;
}

/** GET /replays/{id} — full replay detail (blue/orange teams + per-player stats). */
async function getReplay(replayId) {
    return _request(`/replays/${encodeURIComponent(replayId)}`);
}

module.exports = {
    BallchasingError,
    BASE_URL,
    getApiKey,
    hasApiKey,
    parseGroupId,
    isGroupUrl,
    parseReplayId,
    isReplayUrl,
    getGroup,
    listGroupReplays,
    getReplay,
};
