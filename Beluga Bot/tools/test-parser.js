/**
 * Validates seriesParser.parseSeries against the operator's real groups.
 * Run: node tools/test-parser.js   (needs BALLCHASING_API_KEY; see explore tool)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'beluga-league-main', '.env') });
if (!process.env.BALLCHASING_API_KEY) {
    for (const [k, v] of Object.entries(process.env)) {
        if (k.toLowerCase() === 'ballchasing_api_key' && v) { process.env.BALLCHASING_API_KEY = v; break; }
    }
}

const { parseSeries } = require('../src/stats/seriesParser');
const EXAMPLES = require('./example-groups');

function sev(issues, s) { return issues.filter((i) => i.severity === s).map((i) => i.code); }

async function main() {
    for (const ex of EXAMPLES) {
        // eslint-disable-next-line no-await-in-loop
        const r = await parseSeries({ groupUrl: ex.url, format: ex.format });
        const head = `${ex.label} [${ex.format}]`;
        if (r.fatal) {
            console.log(`❌ FATAL  ${head}\n    ${sev(r.issues, 'reject').join(',')} — ${r.issues[0]?.message}`);
            continue;
        }
        const rejects = sev(r.issues, 'reject');
        const warns = sev(r.issues, 'warn');
        const infos = sev(r.issues, 'info');
        const t0 = r.teams[0].players.length;
        const t1 = r.teams[1].players.length;
        const status = r.ok ? (r.complete ? '✅ OK/complete' : '⚠️  OK/incomplete') : '⛔ REJECT';
        console.log(
            `${status}  ${head}\n` +
            `    score ${r.seriesScore.label} (name ${r.nameScore || '—'}, match ${r.nameMatchesComputed}) | games ${r.uniqueReplayCount} | roster ${t0}v${t1}\n` +
            `    reject:[${rejects.join(',')}] warn:[${warns.join(',')}] info:[${infos.join(',')}]`
        );
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
