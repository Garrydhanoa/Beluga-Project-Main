/**
 * higgenLog — the bot's audit writer for the shared `higgen_logs` table.
 *
 * Every interaction (slash command, button, select menu, modal, context menu,
 * approval reaction) and every failure lands here, and surfaces on the website's
 * hidden /admin/dashboard/higgenlogs page. The point is forensic: if something
 * gets sabotaged, there is a plain-English record of who did it and exactly what
 * they did.
 *
 * Two rules shape everything below:
 *
 *  1. READABILITY. `summary` is a finished English sentence and `details` is an
 *     ORDERED list of [label, value] pairs. Nobody reading the page should ever
 *     see a customId, a JSON brace, or a stack trace unless they asked for one.
 *     (details is an ARRAY of pairs, not an object, because Postgres jsonb does
 *     not preserve object key order — an array does.)
 *
 *  2. IT MUST NEVER BREAK THE BOT. Nothing here throws, everything is wrapped,
 *     writes are buffered off the interaction path, and a dead database just
 *     means the buffer drains to nowhere. `database.js` is lazy-required because
 *     it requires `logger.js`, which requires this module.
 */

const MAX_BUFFER = 2000;   // hard ceiling so a DB outage can't eat memory
const FLUSH_AT = 50;       // rows queued before an immediate flush
const FLUSH_MS = 2000;     // otherwise flush on this cadence
const BATCH = 200;         // rows per INSERT (17 cols → 3400 params, well under the limit)
const RETENTION_DAYS = 30;

const buffer = [];
let flushTimer = null;
let flushing = false;
let dropped = 0;

// ── small helpers ─────────────────────────────────────────────────────────────

function clip(v, n) {
    if (v === null || v === undefined) return null;
    const s = String(v);
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** `player_name` / `playerName` → `Player name` */
function humanizeKey(key) {
    const spaced = String(key || '')
        .replace(/[_\-.]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();
    if (!spaced) return 'Value';
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function db() {
    try {
        const { pool, isDatabaseAvailable } = require('./database');
        const up = typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
        return up && pool ? pool : null;
    } catch {
        return null;
    }
}

// ── the write path ────────────────────────────────────────────────────────────

const COLUMNS = [
    'occurred_at', 'source', 'stream', 'event_type', 'actor_name', 'actor_tag', 'actor_id',
    'action', 'target', 'location', 'outcome', 'duration_ms', 'division', 'summary',
    'details', 'error_message', 'error_stack',
];

function enqueue(row) {
    if (buffer.length >= MAX_BUFFER) { dropped++; return; }
    buffer.push(row);
    if (buffer.length >= FLUSH_AT) { flush(); return; }
    if (!flushTimer) {
        flushTimer = setTimeout(() => { flushTimer = null; flush(); }, FLUSH_MS);
        if (typeof flushTimer.unref === 'function') flushTimer.unref();
    }
}

/** Drain the buffer into Postgres. Safe to call any time; never throws. */
async function flush() {
    if (flushing || buffer.length === 0) return;
    const pool = db();
    if (!pool) return;               // no DB yet — hold the rows, try again next tick
    flushing = true;
    try {
        while (buffer.length) {
            const batch = buffer.splice(0, BATCH);
            const params = [];
            const tuples = batch.map((row) => {
                const slot = COLUMNS.map((col) => {
                    params.push(row[col] === undefined ? null : row[col]);
                    return `$${params.length}`;
                });
                return `(${slot.join(',')})`;
            });
            try {
                await pool.query(
                    `INSERT INTO higgen_logs (${COLUMNS.join(',')}) VALUES ${tuples.join(',')}`,
                    params
                );
            } catch {
                // Table missing or DB down — drop this batch rather than spin.
                // (Logging its failure through Logger would recurse straight back here.)
                break;
            }
        }
        if (dropped) {
            // Tell the record itself that it has a hole in it, once the DB is back.
            const n = dropped;
            dropped = 0;
            enqueue(baseRow({
                source: 'bot', stream: 'error', eventType: 'crash', outcome: 'failed',
                action: 'higgenlog.overflow',
                summary: `Audit log overflowed — ${n} bot event${n === 1 ? '' : 's'} were not recorded because the database was unreachable.`,
            }));
        }
    } finally {
        flushing = false;
    }
}

function baseRow({
    source = 'bot', stream, eventType = null, actor = null, action = null, target = null,
    location = null, outcome = null, durationMs = null, division = null, summary,
    details = null, error = null,
}) {
    return {
        occurred_at: new Date(),
        source,
        stream,
        event_type: clip(eventType, 40),
        actor_name: clip(actor?.name, 120),
        actor_tag: clip(actor?.tag, 120),
        actor_id: clip(actor?.id, 40),
        action: clip(action, 160),
        target: clip(target, 400),
        location: clip(location, 200),
        outcome: clip(outcome, 30),
        duration_ms: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
        division: clip(division, 40),
        summary: clip(summary, 800) || 'Unlabelled event',
        details: details && details.length ? JSON.stringify(details) : null,
        error_message: error ? clip(error.message || String(error), 600) : null,
        error_stack: error ? clip(error.stack || String(error), 6000) : null,
    };
}

// ── describing a Discord interaction in English ───────────────────────────────

const OPTION_TYPE = {
    1: 'subcommand', 2: 'subcommand_group', 3: 'string', 4: 'integer', 5: 'boolean',
    6: 'user', 7: 'channel', 8: 'role', 9: 'mentionable', 10: 'number', 11: 'attachment',
};

const BUTTON_STYLE = { 1: 'blue', 2: 'grey', 3: 'green', 4: 'red', 5: 'link' };

// Modal customIds are internal strings; the log should name the FORM a person
// actually filled in. Longest prefix wins, then a de-slugified fallback.
const FORM_NAMES = [
    ['rs:group', 'Ballchasing group link'],
    ['rs:', 'series report'],
    ['tk:modal', 'new ticket'],
    ['tk:', 'ticket'],
    ['registration', 'registration'],
    ['main_account', 'registration — main account'],
    ['alt_account', 'registration — alt account'],
    ['staff_report', 'staff series report'],
];

function friendlyFormName(customId) {
    const id = String(customId || '');
    const hit = FORM_NAMES.filter(([p]) => id.startsWith(p) || id.includes(p))
        .sort((a, b) => b[0].length - a[0].length)[0];
    if (hit) return `${hit[1]} form`;
    return `“${humanizeKey(id.replace(/^[a-z]{2}:/, ''))}” form`;
}

/** Compact "Player: Wolf, Team: Ocean Kings" for the one-line summary. */
function inlinePairs(pairs, max = 160) {
    if (!pairs || !pairs.length) return null;
    const parts = [];
    let len = 0;
    for (const [k, v] of pairs) {
        const piece = `${k}: ${v}`;
        if (len + piece.length > max) { parts.push('…'); break; }
        parts.push(piece);
        len += piece.length + 2;
    }
    return parts.join(', ');
}

function personLabel(user, member = null) {
    if (!user) return null;
    const nick = member?.nickname || member?.displayName;
    const display = nick || user.globalName || user.displayName || user.username || 'Unknown';
    const tag = user.username ? `@${user.username}` : null;
    return [display, tag ? `(${tag} · ${user.id})` : `(${user.id})`].join(' ');
}

/** Render one resolved slash-command option as a human value string. */
function optionValue(opt) {
    switch (OPTION_TYPE[opt.type]) {
        case 'user':
            return personLabel(opt.user, opt.member) || String(opt.value);
        case 'channel':
            return opt.channel?.name ? `#${opt.channel.name} (${opt.channel.id})` : String(opt.value);
        case 'role':
            return opt.role?.name ? `@${opt.role.name} (${opt.role.id})` : String(opt.value);
        case 'mentionable':
            return personLabel(opt.user, opt.member) || (opt.role?.name ? `@${opt.role.name}` : String(opt.value));
        case 'attachment':
            return opt.attachment
                ? `${opt.attachment.name || 'file'} (${opt.attachment.size ?? '?'} bytes) — ${opt.attachment.url || ''}`.trim()
                : String(opt.value);
        case 'boolean':
            return opt.value ? 'Yes' : 'No';
        default:
            return String(opt.value ?? '');
    }
}

/**
 * Walk `interaction.options.data` and pull out the subcommand path plus EVERY
 * supplied option, resolved to names rather than snowflakes. This is what makes
 * "who used what command, and the depth of the command" work for all 38 commands
 * without touching a single command file.
 */
function walkOptions(data, path = [], pairs = []) {
    for (const opt of data || []) {
        const kind = OPTION_TYPE[opt.type];
        if (kind === 'subcommand' || kind === 'subcommand_group') {
            path.push(opt.name);
            walkOptions(opt.options, path, pairs);
        } else if (opt.value !== undefined && opt.value !== null && opt.value !== '') {
            pairs.push([humanizeKey(opt.name), clip(optionValue(opt), 500)]);
        }
    }
    return { path, pairs };
}

/** Depth-first hunt through (possibly nested) message components for a customId. */
function findComponent(components, customId, depth = 0) {
    if (!Array.isArray(components) || depth > 6) return null;
    for (const c of components) {
        const id = c?.customId ?? c?.custom_id ?? c?.data?.custom_id;
        if (id && id === customId) return c;
        const nested = c?.components ?? c?.data?.components;
        const hit = findComponent(nested, customId, depth + 1);
        if (hit) return hit;
    }
    return null;
}

function componentLabel(c) {
    if (!c) return null;
    const label = c.label ?? c.data?.label;
    const emoji = c.emoji ?? c.data?.emoji;
    const emojiStr = emoji ? (emoji.name || emoji.id || '') : '';
    return [emojiStr, label].filter(Boolean).join(' ').trim() || null;
}

/** Where did this happen, in words. */
function describeLocation(interaction) {
    if (!interaction.guild) return 'Direct message with the bot';
    const ch = interaction.channel;
    if (!ch) return interaction.guild.name;
    let where;
    if (typeof ch.isThread === 'function' && ch.isThread()) {
        where = ch.parent?.name ? `#${ch.parent.name} › ${ch.name}` : `thread “${ch.name}”`;
    } else {
        where = `#${ch.name}`;
    }
    return `${where} (${interaction.guild.name})`;
}

/** The panel/message a component interaction was fired from, in words. */
function describeOrigin(interaction) {
    const msg = interaction.message;
    if (!msg) return null;
    const embedTitle = msg.embeds?.[0]?.title || msg.embeds?.[0]?.author?.name;
    if (embedTitle) return clip(embedTitle, 160);
    if (msg.content) return clip(String(msg.content).replace(/\s+/g, ' ').trim(), 160);
    return null;
}

/**
 * Turn any interaction into { eventType, actor, action, target, location, what, details }.
 * `what` is the verb phrase used to build the summary sentence.
 */
function describeInteraction(interaction) {
    const actor = {
        name: interaction.member?.displayName || interaction.user?.globalName || interaction.user?.username || 'Someone',
        tag: interaction.user?.username || null,
        id: interaction.user?.id || null,
    };
    const location = describeLocation(interaction);
    const details = [];
    let eventType = 'interaction';
    let action = null;
    let target = null;
    let what = 'interacted with the bot';

    try {
        if (typeof interaction.isChatInputCommand === 'function' && interaction.isChatInputCommand()) {
            eventType = 'slash_command';
            const { path, pairs } = walkOptions(interaction.options?.data);
            const full = ['/' + interaction.commandName, ...path].join(' ');
            action = full;
            if (pairs.length) {
                target = pairs.map(([k, v]) => `${k}: ${v}`).join(', ');
                // Put the options in the one-line summary too, so the collapsed
                // row already answers "what did they actually do".
                what = `used the ${full} command with ${inlinePairs(pairs)}`;
                details.push(...pairs);
            } else {
                what = `used the ${full} command`;
                details.push(['Options', 'none supplied']);
            }
        } else if (typeof interaction.isContextMenuCommand === 'function' && interaction.isContextMenuCommand()) {
            eventType = 'context_menu';
            action = `menu:${interaction.commandName}`;
            const on = interaction.targetUser
                ? personLabel(interaction.targetUser, interaction.targetMember)
                : (interaction.targetMessage ? `a message from ${interaction.targetMessage.author?.username || 'someone'}` : null);
            target = on;
            what = `used the “${interaction.commandName}” right-click menu${on ? ` on ${on}` : ''}`;
            if (on) details.push(['Applied to', on]);
        } else if (typeof interaction.isButton === 'function' && interaction.isButton()) {
            eventType = 'button';
            action = `button:${interaction.customId}`;
            const comp = findComponent(interaction.message?.components, interaction.customId);
            const label = componentLabel(comp);
            const origin = describeOrigin(interaction);
            target = [label ? `“${label}”` : null, origin ? `on “${origin}”` : null].filter(Boolean).join(' ') || interaction.customId;
            what = label
                ? `clicked the “${label}” button${origin ? ` on the “${origin}” panel` : ''}`
                : `clicked a button${origin ? ` on the “${origin}” panel` : ''}`;
            details.push(['Button', label || '(no label — icon only)']);
            if (origin) details.push(['On panel', origin]);
            if (comp && BUTTON_STYLE[comp.style ?? comp.data?.style]) {
                details.push(['Button colour', BUTTON_STYLE[comp.style ?? comp.data?.style]]);
            }
            details.push(['Internal id', interaction.customId]);
        } else if (typeof interaction.isAnySelectMenu === 'function' && interaction.isAnySelectMenu()) {
            eventType = 'select_menu';
            action = `select:${interaction.customId}`;
            const comp = findComponent(interaction.message?.components, interaction.customId);
            const opts = comp?.options ?? comp?.data?.options ?? [];
            const chosen = (interaction.values || []).map((v) => {
                const match = opts.find((o) => (o.value ?? o.data?.value) === v);
                const label = match?.label ?? match?.data?.label;
                return label ? `${label}` : v;
            });
            // User/role/channel selects resolve to real objects rather than options.
            const resolvedPeople = interaction.users ? [...interaction.users.values()].map((u) => personLabel(u)) : [];
            const resolvedRoles = interaction.roles ? [...interaction.roles.values()].map((r) => `@${r.name}`) : [];
            const resolvedChannels = interaction.channels ? [...interaction.channels.values()].map((c) => `#${c.name}`) : [];
            const picked = [...resolvedPeople, ...resolvedRoles, ...resolvedChannels];
            const shown = picked.length ? picked : chosen;
            const origin = describeOrigin(interaction);
            const placeholder = comp?.placeholder ?? comp?.data?.placeholder;
            target = shown.join(', ') || interaction.customId;
            what = `chose ${shown.length ? shown.map((s) => `“${s}”`).join(', ') : 'an option'} from the ${placeholder ? `“${placeholder}” ` : ''}dropdown${origin ? ` on the “${origin}” panel` : ''}`;
            details.push(['Selected', shown.join(', ') || '(nothing)']);
            if (placeholder) details.push(['Dropdown', placeholder]);
            if (origin) details.push(['On panel', origin]);
            details.push(['Internal id', interaction.customId]);
        } else if (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()) {
            eventType = 'modal';
            action = `modal:${interaction.customId}`;
            const fields = [];
            try {
                const collection = interaction.fields?.fields;
                if (collection && typeof collection.forEach === 'function') {
                    collection.forEach((f, key) => {
                        const id = f?.customId || key;
                        const val = f?.value;
                        if (val !== undefined && val !== null && String(val).trim() !== '') {
                            fields.push([humanizeKey(id), clip(val, 500)]);
                        }
                    });
                }
            } catch { /* shape varies by discord.js version — best effort */ }
            target = fields.map(([k, v]) => `${k}: ${v}`).join(', ') || interaction.customId;
            const formName = friendlyFormName(interaction.customId);
            what = fields.length
                ? `submitted the ${formName} with ${inlinePairs(fields)}`
                : `submitted the ${formName} (empty)`;
            if (fields.length) details.push(...fields);
            else details.push(['Fields', '(none filled in)']);
            details.push(['Form', formName]);
            details.push(['Internal id', interaction.customId]);
        }
    } catch {
        // A malformed interaction must not cost us the log line — fall through
        // with whatever was gathered before the throw.
    }

    // NB: no 'Where'/'Took' rows here — location and duration have their own
    // columns and the page already prints them in the header block. Repeating
    // them in the detail table just makes the entry harder to read.
    return { eventType, actor, action, target, location, what, details };
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Record a completed interaction.
 * @param {object} desc     the result of describeInteraction()
 * @param {object} [opts]   { outcome, durationMs, note, division, error }
 */
function logInteraction(desc, { outcome = 'success', durationMs = null, note = null, division = null, error = null } = {}) {
    try {
        if (!desc) return;
        const details = [...(desc.details || [])];
        if (note) details.unshift(['Note', clip(note, 400)]);

        const tail = {
            success: '',
            failed: ' — it FAILED',
            expired: ' — but the interaction had already expired, so nothing happened',
            unhandled: ' — nothing in the bot handles that button, so nothing happened',
            denied: ' — the bot refused it (no permission)',
        }[outcome] ?? ` — ${outcome}`;

        enqueue(baseRow({
            stream: 'interaction',
            eventType: desc.eventType,
            actor: desc.actor,
            action: desc.action,
            target: desc.target,
            location: desc.location,
            outcome,
            durationMs,
            division,
            summary: `${desc.actor?.name || 'Someone'} ${desc.what}${desc.location ? ` in ${desc.location}` : ''}${tail}.`,
            details,
            error,
        }));
    } catch { /* never throw */ }
}

/**
 * Record a failure. `desc` is optional — pass it when the failure happened during
 * a known interaction so the entry says what the person was doing at the time.
 */
function logFailure({ summary, error = null, desc = null, action = null, where = null, division = null, details = null, eventType = 'crash' } = {}) {
    try {
        const rows = [];
        if (desc) rows.push(['While', `${desc.actor?.name || 'someone'} ${desc.what}`]);
        if (Array.isArray(details)) rows.push(...details);
        if (desc?.details) rows.push(...desc.details);

        // Prefer a sentence that says what the person was doing when it broke.
        const reason = error ? (error.message || String(error)) : 'an unspecified problem';
        const fallback = desc
            ? `${desc.actor?.name || 'Someone'} ${desc.what}${desc.location ? ` in ${desc.location}` : ''} and the bot failed: ${reason}`
            : `The bot hit an error: ${reason}`;

        enqueue(baseRow({
            stream: 'error',
            eventType,
            actor: desc?.actor || null,
            action: action || desc?.action || null,
            target: desc?.target || null,
            location: where || desc?.location || null,
            outcome: 'failed',
            division,
            summary: summary || fallback,
            details: rows,
            error,
        }));
    } catch { /* never throw */ }
}

/**
 * The `rs:` / `tk:` / `ap:` sub-routers catch their own errors and never rethrow,
 * so bot.js would otherwise score a crashed interaction as a success. They call
 * this; bot.js drains it right after dispatch and stamps the real outcome on the
 * interaction row. The map is drained per interaction and capped, so it can't grow.
 */
const subRouterOutcomes = new Map();

function markSubRouterOutcome(interaction, { outcome = 'failed', note = null, error = null } = {}) {
    try {
        const id = interaction?.id;
        if (!id) return;
        if (subRouterOutcomes.size > 200) subRouterOutcomes.clear();
        subRouterOutcomes.set(id, { outcome, note });
        if (error) {
            logFailure({
                eventType: 'interaction_error',
                desc: describeInteraction(interaction),
                summary: null,
                error,
            });
        }
    } catch { /* never throw */ }
}

function takeSubRouterOutcome(interactionId) {
    const hit = subRouterOutcomes.get(interactionId);
    if (hit) subRouterOutcomes.delete(interactionId);
    return hit || null;
}

/**
 * Record an approval/denial REACTION. These are not interactions — the whole
 * transaction workflow (/sign, /trade, /drop, /ir, /esub, season delete) runs on
 * ✅ reactions, so without this the most sensitive actions in the league would be
 * invisible.
 */
function logReaction({ user, member = null, emoji, message, guild = null, handled = null, note = null } = {}) {
    try {
        const actor = {
            name: member?.displayName || user?.globalName || user?.username || 'Someone',
            tag: user?.username || null,
            id: user?.id || null,
        };
        const ch = message?.channel;
        const chName = ch ? (ch.isThread?.() ? `#${ch.parent?.name || '?'} › ${ch.name}` : `#${ch.name}`) : null;
        const location = [chName, guild?.name ? `(${guild.name})` : null].filter(Boolean).join(' ') || null;
        const subject = message?.embeds?.[0]?.title
            || (message?.content ? clip(String(message.content).replace(/\s+/g, ' ').trim(), 160) : null)
            || 'a message';

        const details = [
            ['Reacted with', emoji],
            ['On', subject],
            ['Posted by', message?.author?.username ? `@${message.author.username}` : 'unknown'],
            ['Message link', message?.url || '(unavailable)'],
        ];
        if (note) details.push(['Note', clip(note, 400)]);

        enqueue(baseRow({
            stream: 'interaction',
            eventType: 'reaction',
            actor,
            action: `reaction:${emoji}`,
            target: subject,
            location,
            outcome: handled === false ? 'unhandled' : 'success',
            summary: `${actor.name} reacted ${emoji} to “${subject}”${location ? ` in ${location}` : ''}${handled === false ? ' — no approval workflow was listening, so nothing happened' : ''}.`,
            details,
        }));
    } catch { /* never throw */ }
}

/**
 * Mirror of Logger.error — the single sink every existing `Logger.error(...)`
 * call site in the bot already flows through. Called from logger.js.
 */
function logLoggerError(level, message, error) {
    enqueue(baseRow({
        stream: 'error',
        eventType: 'crash',
        outcome: 'failed',
        action: 'bot.error',
        summary: `The bot logged an error: ${clip(message, 500)}`,
        details: [['Message', clip(message, 500)], ['Severity', level]],
        error,
    }));
}

/** Delete anything past the retention window. Returns rows removed (0 on failure). */
async function prune() {
    const pool = db();
    if (!pool) return 0;
    try {
        const r = await pool.query(
            `DELETE FROM higgen_logs WHERE occurred_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
        );
        return r.rowCount || 0;
    } catch {
        return 0;
    }
}

module.exports = {
    describeInteraction,
    logInteraction,
    logFailure,
    logReaction,
    logLoggerError,
    markSubRouterOutcome,
    takeSubRouterOutcome,
    flush,
    prune,
    RETENTION_DAYS,
    // exported for the test harness
    _internals: { humanizeKey, walkOptions, findComponent, componentLabel, baseRow },
};
