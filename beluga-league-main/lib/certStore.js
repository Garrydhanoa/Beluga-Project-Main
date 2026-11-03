// GM / AGM rulebook certification (S11).
//
// Applicant side: the link-only /gm-test and /agm-test pages (Discord login).
// Staff side: the super-admin Tests tab inside higgenlogs. The bot reads the
// same tables (Beluga Bot/src/certs/) to post the no-ping staff notice, tally
// Salary Crew ✅/❌ reactions (advisory) and grant roles once a super admin
// approves. Tables are created in leagueSchema.js (mirrored in the bot).
//
// Grading is SERVER-SIDE only: the correct answers never leave this module
// except through the super-admin attempt detail.

import { randomInt } from 'crypto'
import { query, getPool } from './db'
import { ensureLeagueSchema } from './leagueSchema'
import { getActiveSeason } from './leagueStore'
import { CERT_SEED } from './certQuestionsSeed'

export const CERT_TESTS = {
  gm: { key: 'gm', short: 'GM', title: 'General Manager', path: '/gm-test' },
  agm: { key: 'agm', short: 'AGM', title: 'Assistant General Manager', path: '/agm-test' },
}
export const isCertTest = (t) => Object.prototype.hasOwnProperty.call(CERT_TESTS, t)

export const ACK_STATEMENTS = [
  'I have read the current Beluga League rulebook.',
  'I will educate my captains and players on the rulebook.',
  'I understand that not knowing a rule is not an excuse.',
]

const SETTINGS_KEY = 'certification'
export const DEFAULT_SETTINGS = {
  passPct: 90,
  noticeChannelId: '1299015210702737429', // Salary Crew roster-alert channel
  gmRoleId: '1419411413809631314',        // generic "GM" role
  agmRoleId: '',                          // generic AGM role — set once it exists
  gmOpen: false,
  agmOpen: false,
  gmQuestionCount: 0,                     // questions per attempt, drawn at random from the
  agmQuestionCount: 0,                    // enabled pool for that test; 0 = all of them
}

// ── setup ────────────────────────────────────────────────────────────────────

let seeded = false
async function ensureCert() {
  await ensureLeagueSchema()
  if (seeded) return
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE cert_questions IN EXCLUSIVE MODE')
    const n = await client.query('SELECT COUNT(*)::int AS n FROM cert_questions')
    if (n.rows[0].n === 0) {
      for (const q of CERT_SEED) {
        await client.query(
          `INSERT INTO cert_questions (prompt, kind, options, correct_index, rule_ref, for_gm, for_agm, enabled, sort_order, updated_by)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, TRUE, $8, 'seed')`,
          [q.prompt, q.kind, JSON.stringify(q.options), q.correct, q.rule, q.gm, q.agm, q.sort]
        )
      }
    }
    await client.query('COMMIT')
    seeded = true
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Wake the bot (it also polls). */
async function notifyBot() {
  await query('NOTIFY cert_actions').catch(() => {})
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const num = (v) => (v == null ? null : Number(v))
const roundPct = (score, total) => (total ? Math.round((score / total) * 10000) / 100 : 0)

// Rule refs shown to someone who failed: "2.2 (S11)" → "2.2", de-duplicated, in rulebook order.
function sortRules(refs) {
  const key = (r) => String(r).replace(/[^\d.]/g, '').split('.').filter(Boolean).map((n) => n.padStart(3, '0')).join('.') || String(r)
  const clean = refs.filter(Boolean).map((r) => String(r).replace(/\s*\(.*\)\s*$/, '').trim())
  return [...new Set(clean)].sort((a, b) => key(a).localeCompare(key(b)))
}

// ── settings ─────────────────────────────────────────────────────────────────

export async function getCertSettings() {
  await ensureCert()
  const r = await query('SELECT value FROM site_config WHERE key = $1', [SETTINGS_KEY])
  return { ...DEFAULT_SETTINGS, ...(r.rows[0]?.value || {}) }
}

export async function saveCertSettings(patch) {
  const cur = await getCertSettings()
  const next = { ...cur }
  if (patch.passPct !== undefined) {
    const p = Number(patch.passPct)
    if (!Number.isFinite(p) || p < 1 || p > 100) throw Object.assign(new Error('Pass mark must be between 1 and 100.'), { status: 400 })
    next.passPct = p
  }
  for (const k of ['noticeChannelId', 'gmRoleId', 'agmRoleId']) {
    if (patch[k] !== undefined) {
      const v = String(patch[k] || '').trim()
      if (v && !/^\d{15,22}$/.test(v)) throw Object.assign(new Error(`${k} must be a Discord ID (digits only).`), { status: 400 })
      next[k] = v
    }
  }
  for (const k of ['gmOpen', 'agmOpen']) if (patch[k] !== undefined) next[k] = Boolean(patch[k])
  for (const k of ['gmQuestionCount', 'agmQuestionCount']) {
    if (patch[k] !== undefined) {
      const n = Number(patch[k] || 0)
      if (!Number.isInteger(n) || n < 0 || n > 500) throw Object.assign(new Error('Questions per attempt must be a whole number (0 = all).'), { status: 400 })
      next[k] = n
    }
  }
  await query(
    `INSERT INTO site_config (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(next)]
  )
  return next
}

// ── events (permanent timeline; higgen_logs keeps 30 days) ───────────────────

const EVENT_WORDS = {
  opened: 'opened the test page',
  started: 'started the test',
  answered: 'answered a question',
  left: 'left the test page',
  returned: 'came back to the test',
  submitted: 'submitted the test',
  passed: 'passed the test',
  failed: 'did not pass the test',
  retake_requested: 'asked for another attempt',
  attempts_granted: 'was granted extra attempts',
  retake_dismissed: 'had their retake request dismissed',
  decision_queued: 'had their request decided in the admin panel',
  crew_vote: 'got a Salary Crew vote',
  approved: 'was approved — roles given',
  denied: 'was denied',
  role_failed: 'could not be given their roles',
  error: 'hit an error',
}
export const certEventWords = (e) => EVENT_WORDS[e] || String(e).replace(/_/g, ' ')

export async function recordCertEvent({ seasonId = null, attemptId = null, discordId = null, username = null, test = null, event, details = [], ip = null }) {
  try {
    // Leave/return fire on every tab switch — collapse rapid repeats.
    if ((event === 'left' || event === 'returned') && attemptId) {
      const last = await query(
        `SELECT event, created_at FROM cert_events WHERE attempt_id = $1 ORDER BY id DESC LIMIT 1`, [attemptId]
      )
      const row = last.rows[0]
      if (row && row.event === event && Date.now() - new Date(row.created_at).getTime() < 15000) return false
    }
    await query(
      `INSERT INTO cert_events (season_id, attempt_id, discord_id, username, test, event, details, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [seasonId, attemptId, discordId ? String(discordId) : null, username, test, event, JSON.stringify(details || []), ip]
    )
    return true
  } catch {
    return false
  }
}

// ── applicant side ───────────────────────────────────────────────────────────

async function activeSeasonRow() {
  const s = await getActiveSeason()
  return s ? { id: s.id, number: s.seasonNumber ?? s.season_number, name: s.name } : null
}

export async function listSeasonFranchises(seasonId) {
  if (!seasonId) return []
  const r = await query(
    `SELECT f.id, f.name, f.color,
            ARRAY_AGG(DISTINCT t.division) AS divisions
     FROM team_franchises f
     JOIN teams t ON t.franchise_id = f.id AND t.season_id = $1 AND t.is_active = TRUE
     GROUP BY f.id
     ORDER BY f.name`,
    [seasonId]
  )
  return r.rows.map((x) => ({ id: x.id, name: x.name, color: x.color || null, divisions: x.divisions || [] }))
}

async function attemptsAllowed(seasonId, discordId, test) {
  const r = await query(
    `SELECT COALESCE(SUM(extra), 0)::int AS extra FROM cert_grants WHERE season_id = $1 AND discord_id = $2 AND test = $3`,
    [seasonId, String(discordId), test]
  )
  return 1 + (r.rows[0]?.extra || 0)
}

function publicQuestions(snapshot) {
  return (snapshot || []).map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind, options: q.options }))
}

/** Everything the test page needs for one signed-in person. Never includes answers. */
export async function getApplicantState({ discordId, test }) {
  await ensureCert()
  const settings = await getCertSettings()
  const season = await activeSeasonRow()
  const open = Boolean(settings[`${test}Open`])
  if (!season) return { season: null, open: false, franchises: [], attempts: [], passPct: settings.passPct }

  const flag = test === 'agm' ? 'for_agm' : 'for_gm'
  const [franchises, attemptsRes, allowed, retake, pool] = await Promise.all([
    listSeasonFranchises(season.id),
    query(
      `SELECT a.*, r.status AS request_status, r.decision_note
       FROM cert_attempts a LEFT JOIN cert_requests r ON r.attempt_id = a.id
       WHERE a.season_id = $1 AND a.discord_id = $2 AND a.test = $3 ORDER BY a.id`,
      [season.id, String(discordId), test]
    ),
    attemptsAllowed(season.id, discordId, test),
    query(
      `SELECT id, status, created_at FROM cert_retake_requests
       WHERE season_id = $1 AND discord_id = $2 AND test = $3 ORDER BY id DESC LIMIT 1`,
      [season.id, String(discordId), test]
    ),
    query(`SELECT COUNT(*)::int AS n FROM cert_questions WHERE enabled = TRUE AND ${flag} = TRUE`),
  ])
  const enabledCount = pool.rows[0]?.n || 0
  const perAttempt = Number(settings[`${test}QuestionCount`]) || 0

  const rows = attemptsRes.rows
  const current = rows.find((a) => a.status === 'in_progress') || null
  const submitted = rows.filter((a) => a.status === 'submitted')
  const latest = submitted[submitted.length - 1] || null
  const used = rows.length
  // A passed attempt whose request was not denied ends the line: they're done.
  const passedLive = submitted.find((a) => a.passed && a.request_status !== 'denied') || null

  let latestResult = null
  if (latest) {
    const snap = latest.questions || []
    const wrongRules = latest.passed ? [] : sortRules(snap.filter((q) => latest.answers?.[q.id] !== q.correct).map((q) => q.ruleRef))
    latestResult = {
      id: latest.id,
      passed: Boolean(latest.passed),
      score: latest.score,
      total: latest.total,
      pct: num(latest.pct),
      franchiseName: latest.franchise_name,
      submittedAt: latest.submitted_at,
      requestStatus: latest.request_status || null,
      decisionNote: latest.request_status === 'denied' ? (latest.decision_note || null) : null,
      reviewSections: wrongRules,
    }
  }

  return {
    season,
    open,
    passPct: settings.passPct,
    questionCount: perAttempt > 0 ? Math.min(perAttempt, enabledCount) : enabledCount,
    franchises: franchises.map(({ id, name, divisions }) => ({ id, name, divisions })),
    ackStatements: ACK_STATEMENTS,
    attemptsUsed: used,
    attemptsAllowed: allowed,
    canStart: open && !current && !passedLive && used < allowed,
    done: Boolean(passedLive),
    current: current
      ? {
          id: current.id,
          franchiseId: current.franchise_id,
          franchiseName: current.franchise_name,
          startedAt: current.started_at,
          questions: publicQuestions(current.questions),
          answers: current.answers || {},
        }
      : null,
    latestResult,
    retakeRequest: retake.rows[0] ? { id: retake.rows[0].id, status: retake.rows[0].status, createdAt: retake.rows[0].created_at } : null,
  }
}

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

export async function startAttempt({ discordId, username, test, franchiseId, ip, userAgent }) {
  await ensureCert()
  const state = await getApplicantState({ discordId, test })
  if (!state.season) throw fail('There is no active season.')
  if (!state.open) throw fail('This test is not open right now.', 403)
  if (state.current) return { attemptId: state.current.id, resumed: true }
  if (state.done) throw fail('You have already passed this test this season.', 409)
  if (!state.canStart) throw fail('You have no attempts left. You can ask staff for another attempt.', 403)
  const franchise = state.franchises.find((f) => f.id === Number(franchiseId))
  if (!franchise) throw fail('Pick one of this season’s franchises.')

  const flag = test === 'agm' ? 'for_agm' : 'for_gm'
  const qs = await query(
    `SELECT id, prompt, kind, options, correct_index, rule_ref FROM cert_questions
     WHERE enabled = TRUE AND ${flag} = TRUE ORDER BY sort_order, id`
  )
  if (!qs.rows.length) throw fail('This test has no questions yet.', 503)
  const settings = await getCertSettings()
  const perAttempt = Number(settings[`${test}QuestionCount`]) || 0

  // Frozen snapshot: shuffled questions, shuffled options (True/False stays put),
  // and the correct option's NEW index — later edits never change this attempt.
  const drawn = shuffle(qs.rows)
  const picked = perAttempt > 0 && perAttempt < drawn.length ? drawn.slice(0, perAttempt) : drawn
  const snapshot = picked.map((q) => {
    const opts = (Array.isArray(q.options) ? q.options : []).map((text, i) => ({ text: String(text), i }))
    const order = q.kind === 'tf' ? opts : shuffle(opts)
    return {
      id: q.id,
      prompt: q.prompt,
      kind: q.kind,
      options: order.map((o) => o.text),
      correct: order.findIndex((o) => o.i === q.correct_index),
      ruleRef: q.rule_ref || null,
    }
  })

  let row
  try {
    const ins = await query(
      `INSERT INTO cert_attempts (season_id, discord_id, username, test, franchise_id, franchise_name, questions, total, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10) RETURNING id`,
      [state.season.id, String(discordId), username || null, test, franchise.id, franchise.name, JSON.stringify(snapshot), snapshot.length, ip || null, userAgent ? String(userAgent).slice(0, 300) : null]
    )
    row = ins.rows[0]
  } catch (err) {
    // Two tabs racing → the unique open-attempt index wins; resume the other one.
    if (err.code === '23505') {
      const cur = await getApplicantState({ discordId, test })
      if (cur.current) return { attemptId: cur.current.id, resumed: true }
    }
    throw err
  }
  await recordCertEvent({
    seasonId: state.season.id, attemptId: row.id, discordId, username, test, event: 'started', ip,
    details: [['Franchise', franchise.name], ['Questions', String(snapshot.length)], ['Attempt', `${state.attemptsUsed + 1} of ${state.attemptsAllowed}`]],
  })
  return { attemptId: row.id, resumed: false, franchiseName: franchise.name, total: snapshot.length, season: state.season, attemptNo: state.attemptsUsed + 1, allowed: state.attemptsAllowed }
}

async function loadOwnOpenAttempt(attemptId, discordId, test) {
  const r = await query(
    `SELECT * FROM cert_attempts WHERE id = $1 AND discord_id = $2 AND test = $3`,
    [Number(attemptId), String(discordId), test]
  )
  const a = r.rows[0]
  if (!a) throw fail('Attempt not found.', 404)
  if (a.status !== 'in_progress') throw fail('This attempt has already been submitted.', 409)
  return a
}

export async function saveAnswer({ discordId, username, test, attemptId, questionId, choice, ip }) {
  await ensureCert()
  const a = await loadOwnOpenAttempt(attemptId, discordId, test)
  const q = (a.questions || []).find((x) => x.id === Number(questionId))
  if (!q) throw fail('That question is not part of this attempt.')
  const c = Number(choice)
  if (!Number.isInteger(c) || c < 0 || c >= q.options.length) throw fail('Invalid answer.')
  const prev = a.answers?.[q.id]
  await query(
    `UPDATE cert_attempts SET answers = answers || jsonb_build_object($2::text, $3::int), last_active_at = NOW() WHERE id = $1`,
    [a.id, String(q.id), c]
  )
  const answered = Object.keys({ ...(a.answers || {}), [q.id]: c }).length
  await recordCertEvent({
    seasonId: a.season_id, attemptId: a.id, discordId, username, test, event: 'answered', ip,
    details: [
      ['Question', q.prompt.slice(0, 200)],
      ['Picked', q.options[c]],
      ...(prev != null && prev !== c ? [['Changed from', q.options[prev]]] : []),
      ['Progress', `${answered} of ${a.questions.length} answered`],
    ],
  })
  return { ok: true, answered }
}

export async function touchAttemptEvent({ discordId, username, test, attemptId, event, ip }) {
  await ensureCert()
  if (!['left', 'returned', 'opened'].includes(event)) throw fail('Unknown event.')
  let a = null
  if (attemptId) {
    const r = await query(`SELECT id, season_id, status, answers, questions FROM cert_attempts WHERE id = $1 AND discord_id = $2 AND test = $3`, [Number(attemptId), String(discordId), test])
    a = r.rows[0] || null
    if (a && a.status !== 'in_progress') a = null
  }
  const season = a ? { id: a.season_id } : await activeSeasonRow()
  const details = a ? [['Progress', `${Object.keys(a.answers || {}).length} of ${(a.questions || []).length} answered`]] : []
  const wrote = await recordCertEvent({ seasonId: season?.id ?? null, attemptId: a?.id ?? null, discordId, username, test, event, ip, details })
  if (a && event === 'returned') await query('UPDATE cert_attempts SET last_active_at = NOW() WHERE id = $1', [a.id]).catch(() => {})
  return { wrote, attemptId: a?.id ?? null, progress: details[0]?.[1] || null }
}

export async function submitAttempt({ discordId, username, test, attemptId, signature, acknowledged, ip }) {
  await ensureCert()
  const a = await loadOwnOpenAttempt(attemptId, discordId, test)
  const ack = Array.isArray(acknowledged) ? acknowledged : []
  if (ACK_STATEMENTS.some((_, i) => ack[i] !== true)) throw fail('Tick all three statements before submitting.')
  const sig = String(signature || '').trim().slice(0, 80)
  if (sig.length < 2) throw fail('Type your name as your signature.')

  const settings = await getCertSettings()
  const snap = a.questions || []
  const answers = a.answers || {}
  const score = snap.filter((q) => answers[q.id] === q.correct).length
  const total = snap.length
  const pct = roundPct(score, total)
  const passed = pct >= Number(settings.passPct)

  const upd = await query(
    `UPDATE cert_attempts
     SET status = 'submitted', score = $2, total = $3, pct = $4, passed = $5, signature = $6,
         acknowledged = $7::jsonb, submitted_at = NOW(), last_active_at = NOW()
     WHERE id = $1 AND status = 'in_progress' RETURNING id`,
    [a.id, score, total, pct, passed, sig, JSON.stringify(ACK_STATEMENTS.map((text) => ({ text, agreed: true })))]
  )
  if (!upd.rows.length) throw fail('This attempt has already been submitted.', 409)

  if (passed) {
    await query(
      `INSERT INTO cert_requests (attempt_id, season_id, discord_id, username, test, franchise_id, franchise_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (attempt_id) DO NOTHING`,
      [a.id, a.season_id, String(discordId), username || a.username, test, a.franchise_id, a.franchise_name]
    )
    await notifyBot()
  }
  const unanswered = snap.filter((q) => answers[q.id] == null).length
  const wrongRules = passed ? [] : sortRules(snap.filter((q) => answers[q.id] !== q.correct).map((q) => q.ruleRef))
  await recordCertEvent({
    seasonId: a.season_id, attemptId: a.id, discordId, username, test, event: passed ? 'passed' : 'failed', ip,
    details: [
      ['Score', `${score} of ${total} (${pct}%)`],
      ['Pass mark', `${settings.passPct}%`],
      ['Franchise', a.franchise_name || '—'],
      ['Unanswered', String(unanswered)],
      ['Signed as', sig],
    ],
  })
  return { passed, score, total, pct, passPct: settings.passPct, reviewSections: wrongRules, franchiseName: a.franchise_name }
}

export async function requestRetake({ discordId, username, test, note, ip }) {
  await ensureCert()
  const state = await getApplicantState({ discordId, test })
  if (!state.season) throw fail('There is no active season.')
  if (state.current) throw fail('You already have a test in progress.')
  if (state.done) throw fail('You have already passed this test.')
  if (state.attemptsUsed < state.attemptsAllowed) throw fail('You still have an attempt available.')
  if (state.retakeRequest?.status === 'pending') throw fail('Your request is already with staff.', 409)
  const r = await query(
    `INSERT INTO cert_retake_requests (season_id, discord_id, username, test, attempt_id, note)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [state.season.id, String(discordId), username || null, test, state.latestResult?.id || null, note ? String(note).slice(0, 300) : null]
  )
  await recordCertEvent({
    seasonId: state.season.id, attemptId: state.latestResult?.id || null, discordId, username, test, event: 'retake_requested', ip,
    details: [
      ['Last score', state.latestResult ? `${state.latestResult.score} of ${state.latestResult.total} (${state.latestResult.pct}%)` : '—'],
      ['Attempts used', `${state.attemptsUsed} of ${state.attemptsAllowed}`],
      ...(note ? [['Their note', String(note).slice(0, 300)]] : []),
    ],
  })
  await notifyBot()
  return { ok: true, id: r.rows[0].id }
}

// ── super-admin side ─────────────────────────────────────────────────────────

const nameSql = `COALESCE(dm.display_name, dm.username)`

export async function listCertSeasons() {
  await ensureCert()
  const r = await query(
    `SELECT s.id, s.season_number, s.name, s.status,
            (SELECT COUNT(*)::int FROM cert_attempts a WHERE a.season_id = s.id) AS attempts
     FROM seasons s ORDER BY s.season_number DESC`
  )
  return r.rows.map((x) => ({ id: x.id, number: x.season_number, name: x.name, status: x.status, attempts: x.attempts }))
}

async function holdersOf(roleId) {
  if (!roleId) return []
  const r = await query(
    `SELECT m.discord_id, ${nameSql} AS name FROM discord_member_roles m
     LEFT JOIN discord_members dm ON dm.discord_id = m.discord_id WHERE m.role_id = $1 ORDER BY 2`,
    [roleId]
  ).catch(() => ({ rows: [] }))
  return r.rows.map((x) => ({ discordId: x.discord_id, name: x.name || x.discord_id }))
}

export async function getAdminOverview({ seasonId = null } = {}) {
  await ensureCert()
  const settings = await getCertSettings()
  const seasons = await listCertSeasons()
  const active = seasons.find((s) => s.status === 'active') || seasons[0] || null
  const sid = Number(seasonId) || active?.id || null

  const [requests, attempts, retakes, grants, events, questions] = await Promise.all([
    query(
      `SELECT r.*, a.score, a.total, a.pct, a.signature, a.submitted_at, ${nameSql} AS member_name, dm.avatar_url,
              f.gm_role_id, (to_jsonb(f) ->> 'agm_role_id') AS agm_role_id
       FROM cert_requests r
       JOIN cert_attempts a ON a.id = r.attempt_id
       LEFT JOIN discord_members dm ON dm.discord_id = r.discord_id
       LEFT JOIN team_franchises f ON f.id = r.franchise_id
       WHERE r.season_id = $1 ORDER BY (r.status IN ('pending','approve_failed','deny_failed')) DESC, r.id DESC`,
      [sid]
    ),
    query(
      `SELECT a.id, a.discord_id, a.username, a.test, a.franchise_name, a.status, a.score, a.total, a.pct, a.passed,
              a.started_at, a.last_active_at, a.submitted_at, a.signature,
              jsonb_array_length(a.questions) AS question_count,
              (SELECT COUNT(*)::int FROM jsonb_object_keys(a.answers)) AS answered,
              (SELECT COUNT(*)::int FROM cert_events e WHERE e.attempt_id = a.id AND e.event = 'left') AS times_left,
              r.status AS request_status, ${nameSql} AS member_name, dm.avatar_url
       FROM cert_attempts a
       LEFT JOIN cert_requests r ON r.attempt_id = a.id
       LEFT JOIN discord_members dm ON dm.discord_id = a.discord_id
       WHERE a.season_id = $1 ORDER BY a.id DESC`,
      [sid]
    ),
    query(
      `SELECT t.*, ${nameSql} AS member_name FROM cert_retake_requests t
       LEFT JOIN discord_members dm ON dm.discord_id = t.discord_id
       WHERE t.season_id = $1 ORDER BY (t.status = 'pending') DESC, t.id DESC`,
      [sid]
    ),
    query(
      `SELECT g.*, ${nameSql} AS member_name FROM cert_grants g
       LEFT JOIN discord_members dm ON dm.discord_id = g.discord_id
       WHERE g.season_id = $1 ORDER BY g.id DESC`,
      [sid]
    ),
    query(
      `SELECT e.*, ${nameSql} AS member_name FROM cert_events e
       LEFT JOIN discord_members dm ON dm.discord_id = e.discord_id
       WHERE e.season_id = $1 OR ($1::int IS NULL AND e.season_id IS NULL)
       ORDER BY e.id DESC LIMIT 400`,
      [sid]
    ),
    listQuestions(),
  ])

  // Who currently holds each requested franchise's GM / AGM role (from the bot's
  // role mirror) — so a conflict is visible before approving.
  const holderCache = new Map()
  const holders = async (roleId) => {
    if (!roleId) return []
    if (!holderCache.has(roleId)) holderCache.set(roleId, await holdersOf(roleId))
    return holderCache.get(roleId)
  }
  const reqs = []
  for (const r of requests.rows) {
    const roleId = r.test === 'agm' ? r.agm_role_id : r.gm_role_id
    reqs.push({
      id: r.id, attemptId: r.attempt_id, discordId: r.discord_id, name: r.member_name || r.username || r.discord_id,
      avatarUrl: r.avatar_url || null, test: r.test, franchiseId: r.franchise_id, franchiseName: r.franchise_name,
      status: r.status, score: r.score, total: r.total, pct: num(r.pct), signature: r.signature,
      submittedAt: r.submitted_at, createdAt: r.created_at,
      crewApprovals: r.crew_approvals || [], crewDenials: r.crew_denials || [],
      decidedByName: r.decided_by_name, decidedAt: r.decided_at, decisionNote: r.decision_note,
      rolesGranted: r.roles_granted || [], result: r.result,
      noticePosted: Boolean(r.notice_message_id), noticeFailed: r.notice_failed,
      franchiseRoleId: roleId || null,
      currentHolders: await holders(roleId),
    })
  }

  return {
    settings,
    seasons,
    seasonId: sid,
    requests: reqs,
    attempts: attempts.rows.map((a) => ({
      id: a.id, discordId: a.discord_id, name: a.member_name || a.username || a.discord_id, avatarUrl: a.avatar_url || null,
      test: a.test, franchiseName: a.franchise_name, status: a.status, score: a.score, total: a.total, pct: num(a.pct),
      passed: a.passed, startedAt: a.started_at, lastActiveAt: a.last_active_at, submittedAt: a.submitted_at,
      questionCount: a.question_count, answered: a.answered, timesLeft: a.times_left, requestStatus: a.request_status || null,
      signature: a.signature,
    })),
    retakes: retakes.rows.map((t) => ({
      id: t.id, discordId: t.discord_id, name: t.member_name || t.username || t.discord_id, test: t.test, note: t.note,
      status: t.status, createdAt: t.created_at, resolvedByName: t.resolved_by_name, resolvedAt: t.resolved_at,
    })),
    grants: grants.rows.map((g) => ({
      id: g.id, discordId: g.discord_id, name: g.member_name || g.discord_id, test: g.test, extra: g.extra,
      reason: g.reason, grantedByName: g.granted_by_name, createdAt: g.created_at,
    })),
    events: events.rows.map((e) => ({
      id: e.id, attemptId: e.attempt_id, discordId: e.discord_id, name: e.member_name || e.username || e.discord_id,
      test: e.test, event: e.event, words: certEventWords(e.event), details: Array.isArray(e.details) ? e.details : [],
      createdAt: e.created_at,
    })),
    questions,
  }
}

export async function getAttemptDetail(attemptId) {
  await ensureCert()
  const r = await query(
    `SELECT a.*, ${nameSql} AS member_name FROM cert_attempts a
     LEFT JOIN discord_members dm ON dm.discord_id = a.discord_id WHERE a.id = $1`,
    [Number(attemptId)]
  )
  const a = r.rows[0]
  if (!a) throw fail('Attempt not found.', 404)
  const ev = await query(`SELECT * FROM cert_events WHERE attempt_id = $1 ORDER BY id`, [a.id])
  const answers = a.answers || {}
  return {
    id: a.id, discordId: a.discord_id, name: a.member_name || a.username || a.discord_id, test: a.test,
    franchiseName: a.franchise_name, status: a.status, score: a.score, total: a.total, pct: num(a.pct), passed: a.passed,
    signature: a.signature, acknowledged: a.acknowledged, startedAt: a.started_at, submittedAt: a.submitted_at,
    ip: a.ip, userAgent: a.user_agent,
    questions: (a.questions || []).map((q, i) => ({
      n: i + 1, id: q.id, prompt: q.prompt, options: q.options, correct: q.correct, ruleRef: q.ruleRef,
      chosen: answers[q.id] ?? null, right: answers[q.id] === q.correct,
    })),
    events: ev.rows.map((e) => ({ id: e.id, event: e.event, words: certEventWords(e.event), details: e.details || [], createdAt: e.created_at })),
  }
}

export async function decideRequest({ requestId, decision, note, actor }) {
  await ensureCert()
  if (!['approve', 'deny'].includes(decision)) throw fail('Unknown decision.')
  const next = decision === 'approve' ? 'approving' : 'denying'
  const r = await query(
    `UPDATE cert_requests SET status = $2, decided_by = $3, decided_by_name = $4, decided_at = NOW(),
            decision_note = $5, result = NULL, updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'approve_failed', 'deny_failed') RETURNING *`,
    [Number(requestId), next, actor?.discordId || null, actor?.name || null, note ? String(note).slice(0, 500) : null]
  )
  const row = r.rows[0]
  if (!row) throw fail('That request was already decided.', 409)
  await recordCertEvent({
    seasonId: row.season_id, attemptId: row.attempt_id, discordId: row.discord_id, username: row.username, test: row.test,
    event: 'decision_queued',
    details: [['Decision', decision === 'approve' ? 'Approve' : 'Deny'], ['By', actor?.name || '—'], ...(note ? [['Note', String(note).slice(0, 300)]] : [])],
  })
  await notifyBot()
  return row
}

export async function grantAttempts({ seasonId, discordId, test, extra, reason, actor, retakeRequestId = null }) {
  await ensureCert()
  const n = Number(extra)
  if (!Number.isInteger(n) || n < 1 || n > 10) throw fail('Grant between 1 and 10 attempts.')
  if (!isCertTest(test)) throw fail('Unknown test.')
  await query(
    `INSERT INTO cert_grants (season_id, discord_id, test, extra, reason, granted_by, granted_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [Number(seasonId), String(discordId), test, n, reason ? String(reason).slice(0, 300) : null, actor?.discordId || null, actor?.name || null]
  )
  // Resolve any pending retake request for this person (and refresh its notice).
  await query(
    `UPDATE cert_retake_requests SET status = 'granted', resolved_by = $4, resolved_by_name = $5, resolved_at = NOW(), notice_synced = FALSE
     WHERE season_id = $1 AND discord_id = $2 AND test = $3 AND status = 'pending'${retakeRequestId ? ' AND id = $6' : ''}`,
    retakeRequestId
      ? [Number(seasonId), String(discordId), test, actor?.discordId || null, actor?.name || null, Number(retakeRequestId)]
      : [Number(seasonId), String(discordId), test, actor?.discordId || null, actor?.name || null]
  )
  await recordCertEvent({
    seasonId: Number(seasonId), discordId, test, event: 'attempts_granted',
    details: [['Extra attempts', String(n)], ['By', actor?.name || '—'], ...(reason ? [['Reason', String(reason).slice(0, 300)]] : [])],
  })
  await notifyBot()
  return { ok: true }
}

export async function dismissRetake({ retakeRequestId, actor }) {
  await ensureCert()
  const r = await query(
    `UPDATE cert_retake_requests SET status = 'dismissed', resolved_by = $2, resolved_by_name = $3, resolved_at = NOW(), notice_synced = FALSE
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [Number(retakeRequestId), actor?.discordId || null, actor?.name || null]
  )
  const row = r.rows[0]
  if (!row) throw fail('That request was already handled.', 409)
  await recordCertEvent({ seasonId: row.season_id, discordId: row.discord_id, username: row.username, test: row.test, event: 'retake_dismissed', details: [['By', actor?.name || '—']] })
  await notifyBot()
  return row
}

// ── question bank ────────────────────────────────────────────────────────────

function mapQuestion(q) {
  return {
    id: q.id, prompt: q.prompt, kind: q.kind, options: Array.isArray(q.options) ? q.options : [],
    correctIndex: q.correct_index, ruleRef: q.rule_ref || '', forGm: q.for_gm, forAgm: q.for_agm,
    enabled: q.enabled, sortOrder: q.sort_order, updatedBy: q.updated_by, updatedAt: q.updated_at,
  }
}

export async function listQuestions() {
  await ensureCert()
  const r = await query(`SELECT * FROM cert_questions ORDER BY sort_order, id`)
  return r.rows.map(mapQuestion)
}

function cleanQuestion(input) {
  const kind = input.kind === 'tf' ? 'tf' : 'mc'
  const options = kind === 'tf'
    ? ['True', 'False']
    : (Array.isArray(input.options) ? input.options : []).map((o) => String(o || '').trim()).filter(Boolean).slice(0, 6)
  const prompt = String(input.prompt || '').trim().slice(0, 600)
  const correct = Number(input.correctIndex)
  if (prompt.length < 5) throw fail('Write the question first.')
  if (options.length < 2) throw fail('A multiple-choice question needs at least two options.')
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw fail('Mark which option is correct.')
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw fail('Two options are identical.')
  return {
    prompt, kind, options, correct,
    ruleRef: String(input.ruleRef || '').trim().slice(0, 40) || null,
    forGm: input.forGm !== false, forAgm: input.forAgm !== false,
    enabled: input.enabled !== false,
  }
}

export async function saveQuestion(input, actor) {
  await ensureCert()
  const q = cleanQuestion(input)
  if (input.id) {
    const r = await query(
      `UPDATE cert_questions SET prompt = $2, kind = $3, options = $4::jsonb, correct_index = $5, rule_ref = $6,
              for_gm = $7, for_agm = $8, enabled = $9, updated_by = $10, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [Number(input.id), q.prompt, q.kind, JSON.stringify(q.options), q.correct, q.ruleRef, q.forGm, q.forAgm, q.enabled, actor?.name || null]
    )
    if (!r.rows[0]) throw fail('Question not found.', 404)
    return mapQuestion(r.rows[0])
  }
  const r = await query(
    `INSERT INTO cert_questions (prompt, kind, options, correct_index, rule_ref, for_gm, for_agm, enabled, sort_order, updated_by)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, COALESCE((SELECT MAX(sort_order) FROM cert_questions), 0) + 10, $9) RETURNING *`,
    [q.prompt, q.kind, JSON.stringify(q.options), q.correct, q.ruleRef, q.forGm, q.forAgm, q.enabled, actor?.name || null]
  )
  return mapQuestion(r.rows[0])
}

/** Quick toggles from the list (enabled / GM / AGM) without re-validating the body. */
export async function setQuestionFlags(id, flags, actor) {
  await ensureCert()
  const sets = []
  const vals = [Number(id)]
  for (const [k, col] of [['enabled', 'enabled'], ['forGm', 'for_gm'], ['forAgm', 'for_agm']]) {
    if (flags[k] !== undefined) { vals.push(Boolean(flags[k])); sets.push(`${col} = $${vals.length}`) }
  }
  if (!sets.length) throw fail('Nothing to change.')
  vals.push(actor?.name || null)
  const r = await query(
    `UPDATE cert_questions SET ${sets.join(', ')}, updated_by = $${vals.length}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    vals
  )
  if (!r.rows[0]) throw fail('Question not found.', 404)
  return mapQuestion(r.rows[0])
}

export async function moveQuestion(id, direction) {
  await ensureCert()
  const list = await listQuestions()
  const i = list.findIndex((q) => q.id === Number(id))
  const j = direction === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= list.length) return list
  const order = list.map((q) => q.id)
  ;[order[i], order[j]] = [order[j], order[i]]
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    for (let k = 0; k < order.length; k++) {
      await client.query('UPDATE cert_questions SET sort_order = $2 WHERE id = $1', [order[k], (k + 1) * 10])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return listQuestions()
}

export async function deleteQuestion(id) {
  await ensureCert()
  // Past attempts keep their own frozen copy, so deleting never rewrites history.
  const r = await query('DELETE FROM cert_questions WHERE id = $1 RETURNING prompt', [Number(id)])
  if (!r.rows[0]) throw fail('Question not found.', 404)
  return { ok: true, prompt: r.rows[0].prompt }
}
