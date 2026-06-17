/**
 * Local-only admin-panel screenshot tool. Injects a minted NextAuth session
 * cookie (env ADMIN_COOKIE) so director-gated pages render, then captures every
 * /admin/dashboard page. Flags auth redirects (page bounced to /admin or
 * /admin/denied) and client JS errors. Dev tool, NOT committed/deployed.
 *
 * Run: $env:ADMIN_COOKIE=<jwe>; node scripts/screenshot-admin.js [baseUrl] [outDir]
 */
const fs = require('fs')
const path = require('path')

const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const ADMIN_ROUTES = [
  '/admin/dashboard',
  '/admin/dashboard/matches',
  '/admin/dashboard/players',
  '/admin/dashboard/playoffs',
  '/admin/dashboard/rankings',
  '/admin/dashboard/schedule',
  '/admin/dashboard/season',
  '/admin/dashboard/seasons',
  '/admin/dashboard/site-content',
  '/admin/dashboard/teams',
  '/admin/dashboard/ticket-setup',
  '/admin/dashboard/tickets',
  '/admin/dashboard/transactions',
  '/admin/dashboard/weeks',
  '/admin/dashboard/applications',
  '/admin/dashboard/logs',
  '/admin/dashboard/notification',
]

async function main() {
  const puppeteer = await import('puppeteer-core')
  const [baseUrl = 'http://localhost:3100', outDir = 'screenshots/admin'] = process.argv.slice(2)
  const cookie = process.env.ADMIN_COOKIE
  if (!cookie) throw new Error('ADMIN_COOKIE env not set')
  const exe = EDGE_PATHS.find((p) => fs.existsSync(p))
  if (!exe) throw new Error('Edge not found')
  fs.mkdirSync(outDir, { recursive: true })

  const { spawn } = require('child_process')
  const os = require('os')
  const port = 9222 + Math.floor(Math.random() * 500)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-admin-shot-'))
  const proc = spawn(exe, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  ], { stdio: 'ignore', detached: false })

  let browser = null
  for (let i = 0; i < 40 && !browser; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }).catch(() => null)
  }
  if (!browser) { proc.kill(); throw new Error('could not connect to headless Edge') }

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  // Inject the director session cookie (http localhost → non-secure name).
  await page.setCookie({ name: 'next-auth.session-token', value: cookie, url: baseUrl, httpOnly: true, sameSite: 'Lax' })

  const results = []
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

  for (const route of ADMIN_ROUTES) {
    errors.length = 0
    const slug = route.replace(/^\/admin\/dashboard\/?/, '') || 'overview'
    const fname = slug.replace(/[^a-z0-9-]+/gi, '_')
    try {
      const res = await page.goto(baseUrl + route, { waitUntil: 'networkidle2', timeout: 60000 })
      await new Promise((r) => setTimeout(r, 3500)) // client admin fetches
      await page.evaluate(async () => {
        const step = window.innerHeight * 0.85
        for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)) }
        window.scrollTo(0, 0)
      })
      await new Promise((r) => setTimeout(r, 500))
      await page.screenshot({ path: path.join(outDir, `${fname}.png`), fullPage: true })
      const finalUrl = page.url()
      const status = res ? res.status() : '???'
      const redirected = !finalUrl.includes(route)
      const authBounced = /\/admin\/?$|\/admin\/denied/.test(finalUrl)
      const note = authBounced ? '  🚫 AUTH BOUNCE' : (redirected ? `  ↪ ${finalUrl.replace(baseUrl, '')}` : '')
      const errNote = errors.length ? `  ⚠️ ${errors.length} js err: ${errors[0].slice(0, 140)}` : ''
      console.log(`${status === 200 && !authBounced ? '✅' : '❌'} ${route} → ${status}${note}${errNote}`)
      results.push({ route, status, finalUrl: finalUrl.replace(baseUrl, ''), authBounced, errors: [...errors] })
    } catch (e) {
      console.log(`❌ ${route} → ${e.message.slice(0, 120)}`)
      results.push({ route, error: e.message })
    }
  }
  await page.close()
  await browser.close().catch(() => {})
  proc.kill()
  fs.writeFileSync(path.join(outDir, '_results.json'), JSON.stringify(results, null, 2))
  const bad = results.filter((r) => r.error || r.authBounced || r.status !== 200 || (r.errors && r.errors.length))
  console.log(`\n${bad.length ? `⚠️ ${bad.length} page(s) need attention` : '✅ all admin pages clean'} — shots in ${outDir}/`)
}

main().catch((e) => { console.error(e); process.exit(1) })
