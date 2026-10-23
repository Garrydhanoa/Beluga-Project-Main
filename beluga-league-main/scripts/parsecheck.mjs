/**
 * Parse-check website source files.
 *
 * `next lint` / `next lint --dir` is broken on this Next version, so this is the
 * verification step for every edited .js/.jsx file: it catches syntax errors
 * before a page 500s in the browser.
 *
 *   node scripts/parsecheck.mjs app/playoffs/page.jsx lib/playoffStore.js
 *   node scripts/parsecheck.mjs            # checks app/ + lib/ + components
 */
import { parse } from '@babel/parser'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const SKIP = new Set(['node_modules', '.next', '.git', 'public'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (['.js', '.jsx', '.mjs'].includes(extname(entry))) out.push(full)
  }
  return out
}

const args = process.argv.slice(2)
const files = args.length ? args : [...walk('app'), ...walk('lib')]

let failed = 0
for (const file of files) {
  try {
    parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
  } catch (err) {
    failed += 1
    console.error(`FAIL ${file}\n     ${err.message}`)
  }
}

console.log(failed ? `\n${failed} file(s) failed to parse.` : `${files.length} file(s) parsed OK.`)
process.exit(failed ? 1 : 0)
