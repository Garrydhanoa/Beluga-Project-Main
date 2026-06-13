/**
 * Screenshot a list of routes from the local dev server (dev tool, not deployed).
 * Uses the system Edge via puppeteer-core — no browser download.
 *
 * Run: node scripts/screenshot-routes.js [baseUrl] [outDir] [route ...]
 * Defaults: http://localhost:3100, ./screenshots, a standard public-route list.
 */
const fs = require('fs')
const path = require('path')

const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const DEFAULT_ROUTES = [
  '/', '/standings', '/schedules', '/players', '/power-rankings',
  '/leaderboards', '/applications', '/rulebook', '/teams',
]

async function main() {
  const puppeteer = await import('puppeteer-core')
  const [baseUrl = 'http://localhost:3100', outDir = 'screenshots', ...routes] = process.argv.slice(2)
  const targets = routes.length ? routes : DEFAULT_ROUTES
  const exe = EDGE_PATHS.find((p) => fs.existsSync(p))
  if (!exe) throw new Error('Edge not found — install Edge/Chrome or adjust EDGE_PATHS')
  fs.mkdirSync(outDir, { recursive: true })

  // Edge detaches from puppeteer.launch on some installs — spawn it ourselves
  // with a DevTools port and connect.
  const { spawn } = require('child_process')
  const os = require('os')
  const port = 9222 + Math.floor(Math.random() * 500)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-shot-'))
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
  const failures = []
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const page = await browser.newPage()
    await page.setViewport({ width: viewport.width, height: viewport.height })
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
    for (const route of targets) {
      errors.length = 0
      const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^a-z0-9-]+/gi, '_')
      try {
        const res = await page.goto(baseUrl + route, { waitUntil: 'networkidle2', timeout: 60000 })
        await new Promise((r) => setTimeout(r, 5000)) // let client DB fetches resolve + paint
        // Scroll through to trigger framer-motion whileInView sections (otherwise
        // off-screen content stays at opacity 0 and looks like empty space).
        await page.evaluate(async () => {
          const step = window.innerHeight * 0.8
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y)
            await new Promise((r) => setTimeout(r, 150))
          }
          window.scrollTo(0, 0)
        })
        await new Promise((r) => setTimeout(r, 600))
        await page.screenshot({ path: path.join(outDir, `${slug}.${viewport.name}.png`), fullPage: true })
        const status = res ? res.status() : '???'
        const errNote = errors.length ? `  ⚠️ ${errors.length} js error(s): ${errors[0].slice(0, 160)}` : ''
        console.log(`${status === 200 ? '✅' : '❌'} [${viewport.name}] ${route} → ${status}${errNote}`)
        if (status !== 200 || errors.length) failures.push({ route, viewport: viewport.name, status, errors: [...errors] })
      } catch (e) {
        console.log(`❌ [${viewport.name}] ${route} → ${e.message.slice(0, 120)}`)
        failures.push({ route, viewport: viewport.name, error: e.message })
      }
    }
    await page.close()
  }
  await browser.close().catch(() => {})
  proc.kill()
  fs.writeFileSync(path.join(outDir, 'failures.json'), JSON.stringify(failures, null, 2))
  console.log(`\n${failures.length ? `⚠️ ${failures.length} route/viewport issue(s)` : '✅ all routes clean'} — screenshots in ${outDir}/`)
}

main().catch((e) => { console.error(e); process.exit(1) })
