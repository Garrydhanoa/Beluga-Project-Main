'use client'

// Admin — Site Content & Settings: bot/site settings (stats channel), staff
// quotes (shown across the public site), and homepage montage videos.

import { useEffect, useState, useCallback } from 'react'

export default function SiteContentPage() {
  const [data, setData] = useState(null)
  const [msg, setMsg] = useState('')

  const reload = useCallback(async () => {
    const r = await fetch('/api/admin/site-content', { cache: 'no-store' })
    setData(await r.json())
  }, [])
  useEffect(() => { reload() }, [reload])

  async function post(payload) {
    setMsg('Working…')
    const r = await fetch('/api/admin/site-content', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const d = await r.json().catch(() => ({}))
    setMsg(r.ok ? '✓ saved' : `❌ ${d.error || 'failed'}`)
    setTimeout(() => setMsg(''), 2500)
    await reload()
  }

  if (!data) return <div className="text-blue-200/60">Loading…</div>

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-1">Site Content & Settings</h1>
        {msg && <span className="text-xs text-green-300">{msg}</span>}
      </div>

      <SettingsCard config={data.config} onSave={(key, value) => post({ action: 'set-config', key, value })} />
      <AwardRolesCard config={data.config} onAdd={(roleId) => post({ action: 'add-award-role', roleId })} onRemove={(roleId) => post({ action: 'remove-award-role', roleId })} />
      <QuotesCard quotes={data.quotes} onAdd={(q) => post({ action: 'add-quote', ...q })} onDelete={(id) => post({ action: 'delete-quote', id })} />
      <MontageCard montage={data.montage} onAdd={(m) => post({ action: 'add-montage', ...m })}
        onDelete={(id) => post({ action: 'delete-montage', id })}
        onToggle={(id, isActive) => post({ action: 'toggle-montage', id, isActive })} />
    </div>
  )
}

function SettingsCard({ config, onSave }) {
  const [statsChannel, setStatsChannel] = useState(config.stats_channel_id || '')
  return (
    <section className="p-5 rounded-2xl bg-white/[0.02] border border-white/10">
      <h2 className="text-sm font-black text-white tracking-wide mb-3">Bot Settings</h2>
      <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">
        Stats channel ID — FF-strike pings + Game/Player of the Week posts
      </label>
      <div className="flex gap-2">
        <input value={statsChannel} onChange={(e) => setStatsChannel(e.target.value.trim())}
          placeholder="channel snowflake"
          className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-sm" />
        <button onClick={() => onSave('stats_channel_id', statsChannel)}
          className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 rounded">Save</button>
      </div>
    </section>
  )
}

function AwardRolesCard({ config, onAdd, onRemove }) {
  const [roleId, setRoleId] = useState('')
  let list = []
  try { list = JSON.parse(config.award_roles || '[]') } catch { list = [] }
  return (
    <section className="p-5 rounded-2xl bg-white/[0.02] border border-white/10">
      <h2 className="text-sm font-black text-white tracking-wide mb-1">Award Roles</h2>
      <p className="text-[11px] text-white/40 mb-3">Paste a Discord role ID — its name auto-detects and everyone holding it gets that badge on their player page (refreshed by the bot every ~10 min). Championships are automatic and don't need a role here.</p>
      <div className="flex gap-2 mb-3">
        <input value={roleId} onChange={(e) => setRoleId(e.target.value.trim())} placeholder="role snowflake"
          className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs" />
        <button onClick={() => { onAdd(roleId); setRoleId('') }} disabled={!roleId}
          className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded">Add role</button>
      </div>
      <ul className="space-y-1.5">
        {list.map((r) => (
          <li key={r.roleId} className="flex items-center gap-3 px-3 py-2 rounded bg-white/[0.02] border border-white/5 text-sm">
            <span className="text-yellow-200 font-bold">🏅 {r.label}</span>
            <span className="text-white/30 font-mono text-[10px] flex-1">{r.roleId}</span>
            <button onClick={() => onRemove(r.roleId)} className="text-red-300 hover:text-red-200 text-xs font-bold">✕</button>
          </li>
        ))}
        {!list.length && <li className="text-xs text-white/40 italic">No award roles yet.</li>}
      </ul>
    </section>
  )
}

function QuotesCard({ quotes, onAdd, onDelete }) {
  const [text, setText] = useState('')
  const [authorDiscordId, setAuthor] = useState('')
  const [playerDiscordId, setPlayer] = useState('')
  return (
    <section className="p-5 rounded-2xl bg-white/[0.02] border border-white/10">
      <h2 className="text-sm font-black text-white tracking-wide mb-1">Quotes</h2>
      <p className="text-[11px] text-white/40 mb-3">Shown randomly across the public site. Author must be a Discord member (their ID — avatar + name render automatically). Set a player Discord ID to pin the quote to that player's page instead.</p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Quote text…" className="sm:col-span-2 px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
        <input value={authorDiscordId} onChange={(e) => setAuthor(e.target.value.trim())} placeholder="Author Discord ID" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs" />
        <div className="flex gap-2">
          <input value={playerDiscordId} onChange={(e) => setPlayer(e.target.value.trim())} placeholder="Player ID (optional)" className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs" />
          <button disabled={!text || !authorDiscordId}
            onClick={() => { onAdd({ text, authorDiscordId, playerDiscordId: playerDiscordId || null }); setText(''); setPlayer('') }}
            className="px-3 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded">Add</button>
        </div>
      </div>
      <ul className="space-y-1.5">
        {quotes.map((q) => (
          <li key={q.id} className="flex items-center gap-3 px-3 py-2 rounded bg-white/[0.02] border border-white/5 text-sm">
            <span className="text-white/90 flex-1 truncate">“{q.text}”</span>
            <span className="text-blue-200/70 text-xs">— {q.author_name || q.author_username || q.author_discord_id}</span>
            {q.player_discord_id && <span className="text-[9px] uppercase font-bold text-purple-300 bg-purple-500/15 border border-purple-400/30 px-1.5 py-0.5 rounded">player quote</span>}
            <button onClick={() => onDelete(q.id)} className="text-red-300 hover:text-red-200 text-xs font-bold">✕</button>
          </li>
        ))}
        {!quotes.length && <li className="text-xs text-white/40 italic">No quotes yet.</li>}
      </ul>
    </section>
  )
}

function MontageCard({ montage, onAdd, onDelete, onToggle }) {
  const [youtubeUrl, setUrl] = useState('')
  const [title, setTitle] = useState('')
  return (
    <section className="p-5 rounded-2xl bg-white/[0.02] border border-white/10">
      <h2 className="text-sm font-black text-white tracking-wide mb-1">Homepage Montage</h2>
      <p className="text-[11px] text-white/40 mb-3">YouTube links shown as embeds on the homepage (max 2 active shown, after Meet the Teams).</p>
      <div className="flex gap-2 mb-3 flex-wrap">
        <input value={youtubeUrl} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://www.youtube.com/watch?v=…" className="flex-1 min-w-[220px] px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
        <button disabled={!youtubeUrl} onClick={() => { onAdd({ youtubeUrl, title: title || null }); setUrl(''); setTitle('') }}
          className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded">Add</button>
      </div>
      <ul className="space-y-1.5">
        {montage.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-3 py-2 rounded bg-white/[0.02] border border-white/5 text-sm">
            <span className={`w-2 h-2 rounded-full ${m.is_active ? 'bg-green-400' : 'bg-white/20'}`} />
            <span className="text-white/90 flex-1 truncate">{m.title || m.youtube_url}</span>
            <button onClick={() => onToggle(m.id, !m.is_active)} className="text-xs font-bold text-blue-200 hover:text-white">{m.is_active ? 'Disable' : 'Enable'}</button>
            <button onClick={() => onDelete(m.id)} className="text-red-300 hover:text-red-200 text-xs font-bold">✕</button>
          </li>
        ))}
        {!montage.length && <li className="text-xs text-white/40 italic">No videos yet.</li>}
      </ul>
    </section>
  )
}
