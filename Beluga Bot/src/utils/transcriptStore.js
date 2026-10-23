/**
 * Shared transcript plumbing for week threads and tickets.
 *
 * Season 10 lost EVERY regular-season thread transcript (320 threads archived with
 * 0 messages). The old archive path had four ways to lose data, all fixed here:
 *   1. It only fetched the last 100 messages and silently skipped on any error.
 *      → backfillChannel() pages through the WHOLE history and reports failure.
 *   2. A failed snapshot read became an empty array that was saved as the
 *      transcript. → buildSnapshot() throws; the caller aborts.
 *   3. A re-archive overwrote a full transcript with a smaller/empty one.
 *      → mergeSnapshots() only ever grows a transcript.
 *   4. The live rows were deleted (and the Discord thread/channel deleted) even
 *      when nothing was saved. → writeArchive() verifies the stored row first, and
 *      callers keep the Discord thread/channel when it returns ok:false.
 * Plus: Discord attachment links expire within about a day and die when the
 * channel is deleted, so IMAGE attachments are copied into transcript_files at
 * capture time (operator: "save image copies"); the website serves them and embeds
 * them in the HTML download.
 */

const { pool, isDatabaseAvailable } = require('./database');
const Logger = require('./logger');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BACKFILL_MESSAGES = 5000;

let filesTableReady = false;

async function ensureTranscriptTables() {
    if (filesTableReady || !isDatabaseAvailable()) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS transcript_files (
            id            BIGSERIAL PRIMARY KEY,
            scope         TEXT NOT NULL,
            parent_id     TEXT NOT NULL,
            message_id    TEXT,
            attachment_id TEXT UNIQUE,
            name          TEXT,
            content_type  TEXT,
            size          INTEGER,
            data          BYTEA NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_transcript_files_parent ON transcript_files(scope, parent_id)`);
    filesTableReady = true;
}

function isImage(att) {
    const ct = String(att.contentType || '').toLowerCase();
    return ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(att.name || ''));
}

/**
 * The attachment list for a message, with image attachments copied into
 * transcript_files (each entry then carries a `fileId`). Never throws — a failed
 * copy just leaves the original link.
 */
async function captureAttachments(scope, parentId, message) {
    const out = [];
    const atts = Array.from(message.attachments?.values?.() || []);
    for (const a of atts) {
        const entry = { url: a.url, name: a.name, contentType: a.contentType || null, size: a.size ?? null };
        if (isImage(a) && (a.size || 0) <= MAX_IMAGE_BYTES && isDatabaseAvailable()) {
            try {
                await ensureTranscriptTables();
                const have = await pool.query(`SELECT id FROM transcript_files WHERE attachment_id = $1`, [String(a.id)]);
                if (have.rows[0]) {
                    entry.fileId = Number(have.rows[0].id);
                } else {
                    const res = await fetch(a.url, { signal: AbortSignal.timeout(15000) });
                    if (res.ok) {
                        const buf = Buffer.from(await res.arrayBuffer());
                        if (buf.length > 0 && buf.length <= MAX_IMAGE_BYTES) {
                            const ins = await pool.query(
                                `INSERT INTO transcript_files (scope, parent_id, message_id, attachment_id, name, content_type, size, data)
                                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                                 ON CONFLICT (attachment_id) DO UPDATE SET attachment_id = EXCLUDED.attachment_id
                                 RETURNING id`,
                                [scope, String(parentId), message.id, String(a.id), a.name || null,
                                    a.contentType || null, buf.length, buf]
                            );
                            entry.fileId = Number(ins.rows[0].id);
                        }
                    }
                }
            } catch (err) {
                Logger.warning(`Could not copy transcript image ${a.name} (${err.message}); keeping the link only.`);
            }
        }
        out.push(entry);
    }
    return out;
}

/**
 * Page through a channel's history (newest → oldest) and hand every message to
 * `capture`, oldest first. Stops at `stopAtId` (exclusive) when given, so a
 * catch-up only reads what's new. Returns { fetched } or { error }.
 */
async function backfillChannel(channel, capture, { stopAtId = null, max = MAX_BACKFILL_MESSAGES } = {}) {
    if (!channel || typeof channel.messages?.fetch !== 'function') return { fetched: 0, error: 'channel unavailable' };
    const collected = [];
    let before = null;
    try {
        while (collected.length < max) {
            const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
            if (!batch || batch.size === 0) break;
            const arr = Array.from(batch.values()); // newest first
            let reachedKnown = false;
            for (const m of arr) {
                if (stopAtId && BigInt(m.id) <= BigInt(stopAtId)) { reachedKnown = true; break; }
                collected.push(m);
            }
            if (reachedKnown || batch.size < 100) break;
            before = arr[arr.length - 1].id;
        }
    } catch (err) {
        return { fetched: collected.length, error: err.message || String(err) };
    }
    collected.reverse();
    for (const m of collected) {
        await capture(m);
    }
    return { fetched: collected.length };
}

/** Newest captured message id for a live transcript (null if none). Throws on DB error. */
async function newestCapturedId(table, idCol, id) {
    const r = await pool.query(
        `SELECT message_id FROM ${table} WHERE ${idCol} = $1 ORDER BY message_created_at DESC, id DESC LIMIT 1`,
        [String(id)]
    );
    return r.rows[0]?.message_id || null;
}

/** The live rows as the transcript shape the website renders. THROWS on a DB error. */
async function buildSnapshot(table, idCol, id) {
    const r = await pool.query(
        `SELECT message_id, author_id, author_username, author_display, author_avatar,
                author_color, is_bot, content, attachments, embeds, message_created_at
         FROM ${table} WHERE ${idCol} = $1
         ORDER BY message_created_at ASC, id ASC`,
        [String(id)]
    );
    return r.rows.map((m) => ({
        messageId: m.message_id,
        authorId: m.author_id,
        authorUsername: m.author_username,
        authorDisplay: m.author_display || m.author_username,
        authorAvatar: m.author_avatar,
        authorColor: m.author_color,
        isBot: !!m.is_bot,
        content: m.content || '',
        attachments: m.attachments || [],
        embeds: m.embeds || [],
        createdAt: m.message_created_at,
    }));
}

/** Union of an already-archived transcript and a fresh snapshot — never shrinks. */
function mergeSnapshots(existing, fresh) {
    const byId = new Map();
    for (const m of Array.isArray(existing) ? existing : []) if (m?.messageId) byId.set(String(m.messageId), m);
    for (const m of fresh) if (m?.messageId) byId.set(String(m.messageId), { ...byId.get(String(m.messageId)), ...m });
    return Array.from(byId.values()).sort((a, b) => {
        const ta = new Date(a.createdAt).getTime() || 0;
        const tb = new Date(b.createdAt).getTime() || 0;
        if (ta !== tb) return ta - tb;
        return BigInt(a.messageId) < BigInt(b.messageId) ? -1 : 1;
    });
}

/**
 * Save a transcript archive and VERIFY it before the live rows are dropped.
 * @param {{ archiveTable, keyCol, key, liveTable, liveCol, insertSql, insertParams(merged) }} spec
 * @returns {Promise<{ ok: boolean, count?: number, reason?: string }>}
 */
async function writeArchive({ archiveTable, keyCol, key, liveTable, liveCol, insertSql, insertParams, discordCount = null }) {
    const fresh = await buildSnapshot(liveTable, liveCol, key);
    const prev = await pool.query(`SELECT transcript FROM ${archiveTable} WHERE ${keyCol} = $1`, [String(key)]);
    const merged = mergeSnapshots(prev.rows[0]?.transcript, fresh);

    if (discordCount && discordCount > 0 && merged.length === 0) {
        return { ok: false, reason: `Discord has ${discordCount} message(s) but none could be captured` };
    }

    await pool.query(insertSql, insertParams(merged));

    const check = await pool.query(
        `SELECT jsonb_array_length(COALESCE(transcript, '[]'::jsonb)) AS n FROM ${archiveTable} WHERE ${keyCol} = $1`,
        [String(key)]
    );
    const stored = Number(check.rows[0]?.n ?? -1);
    if (stored < merged.length) {
        return { ok: false, reason: `archive verification failed (stored ${stored} of ${merged.length})` };
    }

    // The verified snapshot is now the kept transcript; drop the per-message rows.
    await pool.query(`DELETE FROM ${liveTable} WHERE ${liveCol} = $1`, [String(key)]);
    return { ok: true, count: merged.length };
}

module.exports = {
    ensureTranscriptTables,
    captureAttachments,
    backfillChannel,
    newestCapturedId,
    buildSnapshot,
    mergeSnapshots,
    writeArchive,
};
