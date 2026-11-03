/**
 * GIF search for the chat AI. Tenor's API shut down on 30 June 2026, so this uses KLIPY,
 * the service Discord and WhatsApp moved to. Off until KLIPY_API_KEY is set.
 *
 * KLIPY's standard terms expect calls from a user's own device, and a bot calling from a
 * server needs their approval (developers@klipy.com). URLs are used exactly as returned
 * and nothing is stored, as those terms ask. A test key allows 100 requests an hour.
 */

const BASE_URL = 'https://api.klipy.com/api/v1';
const TIMEOUT_MS = 6 * 1000;
const PER_PAGE = '8';   // KLIPY's minimum.

function available() {
    return !!process.env.KLIPY_API_KEY;
}

/** @returns {Promise<Array<{id:string, title:string, url:string, preview:string}>>} */
async function search(query) {
    const params = new URLSearchParams({
        q: String(query).slice(0, 100), per_page: PER_PAGE, locale: 'us', content_filter: 'medium',
    });
    // The key is part of the URL, so errors here must never quote it.
    const res = await fetch(`${BASE_URL}/${process.env.KLIPY_API_KEY}/gifs/search?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`KLIPY returned ${res.status}`);
    const body = await res.json();
    const rows = body?.data?.data || [];
    return rows
        .filter((row) => row?.file && row.type !== 'ad')
        .map((row, i) => ({
            id: String(i + 1),
            title: String(row.title || row.slug || 'GIF').slice(0, 80),
            url: row.file.md?.gif?.url || row.file.hd?.gif?.url || row.file.sm?.gif?.url,
            preview: row.file.sm?.jpg?.url || row.file.md?.jpg?.url || row.file.xs?.jpg?.url,
        }))
        .filter((gif) => gif.url && gif.preview);
}

module.exports = { available, search };
