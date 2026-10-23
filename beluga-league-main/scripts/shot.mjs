/**
 * Screenshot a local page over Edge/CDP, and report any console errors or
 * uncaught exceptions the page threw (hydration errors show up here).
 *
 *   node scripts/shot.mjs <url> <outfile.png> [width] [height]
 *
 * Requires Edge already listening on 9222:
 *   msedge --remote-debugging-port=9222 --headless=new
 */
import { writeFileSync } from 'node:fs'
import { WebSocket } from 'ws'

const [, , url, out, wArg, hArg] = process.argv
const width = Number(wArg) || 1600
const height = Number(hArg) || 1200

const targets = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json())
let page = targets.find((t) => t.type === 'page')
if (!page) {
  page = await fetch(`http://127.0.0.1:9222/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
let id = 0
const pending = new Map()
const problems = []

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}

ws.on('message', (raw) => {
  const msg = JSON.parse(raw)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(`EXCEPTION: ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`)
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    problems.push(`CONSOLE: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`)
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.push(`LOG: ${msg.params.entry.text}`)
  }
})

await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: width < 700,
})

await send('Page.navigate', { url })
await new Promise((r) => setTimeout(r, Number(process.env.SHOT_WAIT || 2500)))

// Settle scroll-triggered animations. Pages here use framer-motion `whileInView`,
// which leaves elements at opacity 0 until the IntersectionObserver fires; a cold
// capture can otherwise photograph an empty page.
await send('Runtime.evaluate', {
  expression: `(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 700));
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 700));
  })()`,
  awaitPromise: true,
})
await new Promise((r) => setTimeout(r, 900))

// Measure the real content so the capture isn't cropped, and check for
// horizontal overflow (the page body must never scroll sideways).
const metrics = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.documentElement.scrollHeight
  })`,
  returnByValue: true,
})
const m = JSON.parse(metrics.result.value)

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width, height: Math.min(m.scrollH, 4000), scale: 1 },
})
writeFileSync(out, Buffer.from(shot.data, 'base64'))

console.log(`saved ${out}  (${width}x${Math.min(m.scrollH, 4000)})`)
console.log(`overflow: scrollWidth=${m.scrollW} clientWidth=${m.clientW}${m.scrollW > m.clientW ? '  ** HORIZONTAL OVERFLOW **' : '  ok'}`)
if (problems.length) {
  console.log(`\n${problems.length} page problem(s):`)
  for (const p of [...new Set(problems)].slice(0, 12)) console.log(`  - ${p}`)
} else {
  console.log('no console errors or exceptions')
}
ws.close()
process.exit(0)
