import { query } from './db'
import { getMentionResolver } from './discordMembers'

/**
 * Builds the downloadable, self-contained HTML transcript for a ticket or a week
 * thread. Everything the file needs is INSIDE it — saved images (transcript_files)
 * and avatars are embedded as data URIs — so it still renders years later, after
 * the Discord channel and its CDN links are long gone.
 */

const TRANSCRIPT_LOCK_DAYS = 30
export { TRANSCRIPT_LOCK_DAYS }

function mapRow(m) {
  return {
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
  }
}

function mergeById(...lists) {
  const byId = new Map()
  for (const list of lists) for (const m of list || []) if (m?.messageId) byId.set(String(m.messageId), { ...byId.get(String(m.messageId)), ...m })
  return [...byId.values()].sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) || (BigInt(a.messageId) < BigInt(b.messageId) ? -1 : 1))
}

/** Everything known about one transcript: live rows + the archived snapshot, merged. */
export async function loadTranscript(type, id) {
  const key = String(id || '').trim()
  if (!key) return null
  if (type === 'ticket') {
    const [live, arc, open] = await Promise.all([
      query(`SELECT * FROM ticket_messages WHERE channel_id = $1 ORDER BY message_created_at ASC, id ASC`, [key]),
      query(`SELECT * FROM ticket_archives WHERE channel_id = $1`, [key]).catch(() => ({ rows: [] })),
      query(`SELECT * FROM tickets WHERE channel_id = $1`, [key]).catch(() => ({ rows: [] })),
    ])
    const a = arc.rows[0] || null
    const t = open.rows[0] || null
    const messages = mergeById(a?.transcript, live.rows.map(mapRow))
    if (!a && !t && !messages.length) return null
    return {
      type, id: key,
      title: `Ticket: ${a?.channel_name || t?.channel_name || key}`,
      open: !!t,
      meta: [
        ['Reason', a?.reason || t?.reason],
        ['Opened by', a?.opened_by_username || t?.created_by_username],
        ['Opened', a?.opened_at || t?.created_at],
        ['Closed by', a?.closed_by_username],
        ['Closed', a?.closed_at],
      ],
      closedAt: a?.closed_at || null,
      messages,
    }
  }
  if (type === 'thread') {
    const [live, arc, row] = await Promise.all([
      query(`SELECT * FROM thread_messages WHERE thread_id = $1 ORDER BY message_created_at ASC, id ASC`, [key]),
      query(`SELECT * FROM thread_archives WHERE thread_id = $1`, [key]).catch(() => ({ rows: [] })),
      query(`SELECT * FROM week_threads WHERE thread_id = $1 LIMIT 1`, [key]).catch(() => ({ rows: [] })),
    ])
    const a = arc.rows[0] || null
    const w = row.rows[0] || null
    const messages = mergeById(a?.transcript, live.rows.map(mapRow))
    if (!a && !w && !messages.length) return null
    const team1 = a?.team1 || w?.team1
    const team2 = a?.team2 || w?.team2
    const week = a?.week_number ?? w?.week_number
    return {
      type, id: key,
      title: `${team1 || 'Thread'}${team2 ? ` vs ${team2}` : ''}`,
      open: !!w && !w.is_closed,
      meta: [
        ['Division', a?.division || w?.division],
        ['Week', week == null ? null : week >= 90 ? `Playoffs (${week})` : `Week ${week}`],
        ['Match', a?.match_number || w?.match_number],
        ['Closed by', a?.closed_by_username],
        ['Closed', a?.closed_at],
      ],
      closedAt: a?.closed_at || null,
      messages,
    }
  }
  return null
}

// ── rendering ────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtTime(d) {
  const dt = new Date(d)
  if (Number.isNaN(dt.valueOf())) return ''
  return dt.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
}

function fmtDay(d) {
  const dt = new Date(d)
  if (Number.isNaN(dt.valueOf())) return ''
  return dt.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** Discord-flavoured markdown → safe HTML (escape first, then format). */
function renderContent(raw) {
  let s = esc(raw)
  const blocks = []
  s = s.replace(/```(?:[a-z0-9]+\n)?([\s\S]*?)```/gi, (_, code) => { blocks.push(`<pre>${code}</pre>`); return `\u0000${blocks.length - 1}\u0000` })
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  s = s.replace(/&lt;(a?):([a-zA-Z0-9_]+):(\d+)&gt;/g, (_, anim, name, id) =>
    `<img class="emoji" alt=":${name}:" title=":${name}:" src="https://cdn.discordapp.com/emojis/${id}.${anim ? 'gif' : 'webp'}?size=48">`)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<u>$1</u>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  s = s.replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler">$1</span>')
  s = s.replace(/(^|\n)&gt; ([^\n]*)/g, '$1<span class="quote">$2</span>')
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
  s = s.replace(/(^|\s)(@[\w.\- ]{1,40}?)(?=\s|$|[,.!?])/g, '$1<span class="mention">$2</span>')
  s = s.replace(/\n/g, '<br>')
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)])
  return s
}

/** A role colour, unless it's too dark to read on the dark background (then null). */
function readableColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return lum < 0.32 ? null : hex
}

async function toDataUri(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 512 * 1024) return null
    return `data:${res.headers.get('content-type') || 'image/png'};base64,${buf.toString('base64')}`
  } catch { return null }
}

export async function renderTranscriptHtml(t, { exportedBy = 'staff' } = {}) {
  const resolve = await getMentionResolver().catch(() => (c) => c)

  // Saved image copies, embedded.
  const fileIds = [...new Set(t.messages.flatMap((m) => (m.attachments || []).map((a) => a.fileId).filter(Boolean)))]
  const files = new Map()
  if (fileIds.length) {
    const r = await query(`SELECT id, content_type, data FROM transcript_files WHERE id = ANY($1::bigint[])`, [fileIds]).catch(() => ({ rows: [] }))
    for (const f of r.rows) files.set(Number(f.id), `data:${f.content_type || 'image/png'};base64,${Buffer.from(f.data).toString('base64')}`)
  }

  // Avatars, embedded (one fetch per distinct author).
  const avatarUrls = [...new Set(t.messages.map((m) => m.authorAvatar).filter(Boolean))].slice(0, 80)
  // Each avatar is embedded ONCE as a CSS class (not once per message — a busy
  // thread repeats the same few faces hundreds of times).
  const avatars = new Map() // url -> class name
  let avatarCss = ''
  await Promise.all(avatarUrls.map(async (u, i) => {
    const d = await toDataUri(u)
    if (d) { avatars.set(u, `av${i}`); avatarCss += `.av${i}{background-image:url(${d})}` }
  }))

  const participants = new Map()
  for (const m of t.messages) {
    const k = m.authorId || m.authorUsername
    if (!k) continue
    const p = participants.get(k) || { name: m.authorDisplay || m.authorUsername, count: 0, bot: m.isBot }
    p.count++
    participants.set(k, p)
  }

  let body = ''
  let lastDay = ''
  let prev = null
  for (const m of t.messages) {
    const day = fmtDay(m.createdAt)
    if (day && day !== lastDay) {
      body += `<div class="day"><span>${esc(day)}</span></div>`
      lastDay = day
      prev = null
    }
    const who = (x) => x.authorId || x.authorUsername || x.authorDisplay
    const sameAuthor = prev && who(prev) && who(prev) === who(m) &&
      new Date(m.createdAt) - new Date(prev.createdAt) < 7 * 60 * 1000
    const avatarClass = m.authorAvatar && avatars.get(m.authorAvatar)
    const initial = esc((m.authorDisplay || m.authorUsername || '?').charAt(0).toUpperCase())
    const color = readableColor(m.authorColor) || (m.isBot ? '#8ea1ff' : '#f2f3f5')

    let atts = ''
    for (const a of m.attachments || []) {
      const isImg = String(a.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(a.name || ''))
      const embedded = a.fileId && files.get(Number(a.fileId))
      if (isImg && embedded) {
        atts += `<a class="att-img" href="${embedded}" download="${esc(a.name || 'image')}"><img src="${embedded}" alt="${esc(a.name || 'image')}"></a>`
      } else {
        atts += `<div class="att-file">📎 <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.name || 'attachment')}</a><span class="note"> original Discord link — may have expired</span></div>`
      }
    }
    let embeds = ''
    for (const e of m.embeds || []) {
      if (!e?.title && !e?.description) continue
      embeds += `<div class="embed">${e.title ? `<div class="embed-title">${renderContent(resolve(e.title))}</div>` : ''}${e.description ? `<div class="embed-desc">${renderContent(resolve(e.description))}</div>` : ''}</div>`
    }
    const content = m.content ? `<div class="content">${renderContent(resolve(m.content))}</div>` : ''

    if (sameAuthor) {
      body += `<div class="msg cont" id="m${esc(m.messageId)}"><div class="gutter"><span class="hover-time">${esc(new Date(m.createdAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }))}</span></div><div class="main">${content}${embeds}${atts}</div></div>`
    } else {
      body += `<div class="msg" id="m${esc(m.messageId)}"><div class="gutter">${avatarClass ? `<div class="avatar ${avatarClass}"></div>` : `<div class="avatar ph">${initial}</div>`}</div><div class="main"><div class="head"><span class="name" style="color:${color}">${esc(m.authorDisplay || m.authorUsername || 'Unknown')}</span>${m.isBot ? '<span class="bot">BOT</span>' : ''}<span class="time">${esc(fmtTime(m.createdAt))}</span></div>${content}${embeds}${atts}</div></div>`
    }
    prev = m
  }
  if (!t.messages.length) body = '<div class="empty">No messages were captured for this transcript.</div>'

  const metaRows = t.meta
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v instanceof Date || /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? fmtTime(v) : v)}</b></div>`)
    .join('')
  const people = [...participants.values()].sort((a, b) => b.count - a.count)
    .map((p) => `<span class="chip">${esc(p.name)}${p.bot ? ' · bot' : ''} <i>${p.count}</i></span>`).join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title)} — Beluga League transcript</title>
<style>
:root{--bg:#313338;--panel:#2b2d31;--deep:#1e1f22;--text:#dbdee1;--muted:#949ba4;--line:#3f4147;--accent:#5ecbff}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.375 "gg sans","Noto Sans","Helvetica Neue",Helvetica,Arial,sans-serif}
header{background:linear-gradient(135deg,#0b2a4a,#0a1a2f 60%,#06121f);border-bottom:1px solid #12385e;padding:22px 24px}
.brand{font-size:11px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)}
h1{margin:6px 0 4px;font-size:24px;color:#fff}
.sub{color:#9fb7cf;font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:14px}
.kv span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#7f9ab5}.kv b{font-weight:600;color:#e8f1fa;font-size:13px}
.people{margin-top:12px;display:flex;flex-wrap:wrap;gap:6px}
.chip{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:2px 10px;font-size:12px;color:#d6e4f2}.chip i{font-style:normal;color:var(--accent);margin-left:4px}
main{max-width:980px;margin:0 auto;padding:12px 0 40px}
.day{display:flex;align-items:center;margin:18px 16px 6px;color:var(--muted);font-size:12px;font-weight:600}
.day:before,.day:after{content:"";flex:1;height:1px;background:var(--line)}.day span{padding:0 10px}
.msg{display:flex;padding:3px 16px 3px 0;margin-top:14px}.msg.cont{margin-top:0}
.msg:hover{background:rgba(0,0,0,.06)}
.gutter{width:72px;flex:none;display:flex;justify-content:center;padding-top:2px}
.avatar{width:40px;height:40px;border-radius:50%;background-size:cover;background-position:center}
.avatar.ph{display:flex;align-items:center;justify-content:center;background:#5865f2;color:#fff;font-weight:700}
.hover-time{visibility:hidden;font-size:11px;color:var(--muted);padding-top:4px}.msg.cont:hover .hover-time{visibility:visible}
.main{min-width:0;flex:1}
.head{display:flex;align-items:baseline;gap:8px}
.name{font-weight:600}.time{font-size:12px;color:var(--muted)}
.bot{background:#5865f2;color:#fff;font-size:10px;font-weight:700;border-radius:3px;padding:1px 4px}
.content{white-space:normal;word-wrap:break-word;overflow-wrap:anywhere}
.content a{color:#00a8fc}
code{background:var(--deep);border-radius:4px;padding:1px 4px;font-size:.85em}
pre{background:var(--deep);border:1px solid #1a1b1e;border-radius:6px;padding:8px;white-space:pre-wrap;font-size:.85em}
.quote{display:block;border-left:4px solid #4e5058;padding-left:10px;margin:2px 0}
.mention{background:rgba(88,101,242,.3);color:#c9cdfb;border-radius:3px;padding:0 2px}
.spoiler{background:#1e1f22;color:transparent;border-radius:3px}.spoiler:hover{color:inherit}
.emoji{width:22px;height:22px;vertical-align:-5px}
.embed{margin-top:6px;border-left:4px solid #5ecbff;background:var(--panel);border-radius:4px;padding:8px 12px;max-width:520px}
.embed-title{font-weight:700;color:#fff;margin-bottom:2px}.embed-desc{font-size:14px}
.att-img img{display:block;max-width:min(420px,100%);max-height:340px;border-radius:8px;margin-top:6px;cursor:zoom-in}
.att-file{margin-top:6px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px 10px;display:inline-block}
.att-file a{color:#00a8fc}.note{color:var(--muted);font-size:11px}
.empty{padding:60px;text-align:center;color:var(--muted)}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:12px;text-align:center;padding:16px}
${avatarCss}
</style></head><body>
<header>
  <div class="brand">Beluga League · ${t.type === 'ticket' ? 'Ticket transcript' : 'Match thread transcript'}</div>
  <h1>${esc(t.title)}</h1>
  <div class="sub">${t.messages.length} message${t.messages.length === 1 ? '' : 's'} · ${t.open ? 'still open when exported' : 'closed'} · id ${esc(t.id)}</div>
  <div class="meta">${metaRows}</div>
  ${people ? `<div class="people">${people}</div>` : ''}
</header>
<main>${body}</main>
<footer>Exported ${esc(fmtTime(new Date()))} by ${esc(exportedBy)} · times in US Eastern</footer>
</body></html>`
}
