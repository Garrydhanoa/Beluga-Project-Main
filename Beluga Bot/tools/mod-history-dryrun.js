// Read-only preview of the old-history import: what would be imported and what
// couldn't be read. Writes nothing to Discord or the database. Run from Beluga Bot/.
//   node tools/mod-history-dryrun.js > ../../MOD_HISTORY_DRYRUN.txt
require('dotenv').config();
const { buildPlan } = require('../src/moderation/historyImport');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD = process.env.GUILD_ID;
const STRIKES = '1156814622070935636';
const SUSPENSIONS = '1156814622070935637';

async function get(path) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${TOKEN}` } });
        if (res.status === 429) {
            await new Promise((resolve) => setTimeout(resolve, (Number(res.headers.get('retry-after')) || 2) * 1000));
            continue;
        }
        if (!res.ok) throw new Error(`${path} returned ${res.status}`);
        return res.json();
    }
    throw new Error(`${path} kept rate limiting`);
}

async function messages(channelId) {
    const out = [];
    let before = '';
    for (;;) {
        const page = await get(`/channels/${channelId}/messages?limit=100${before}`);
        if (!page.length) break;
        for (const m of page) out.push({ id: m.id, content: m.content, timestamp: m.timestamp, authorName: m.author?.global_name || m.author?.username });
        before = `&before=${page[page.length - 1].id}`;
        if (page.length < 100) break;
    }
    return out;
}

async function bans() {
    const out = [];
    let after = '';
    for (;;) {
        const page = await get(`/guilds/${GUILD}/bans?limit=1000${after}`);
        out.push(...page.map((b) => ({ id: b.user.id, name: b.user.username, reason: b.reason })));
        if (page.length < 1000) break;
        after = `&after=${page[page.length - 1].user.id}`;
    }
    return out;
}

(async () => {
    const plan = buildPlan({ strikes: await messages(STRIKES), suspensions: await messages(SUSPENSIONS), bans: await bans() });
    const kinds = {};
    for (const c of plan.cases) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    console.log('OLD HISTORY IMPORT: DRY RUN (nothing has been written)');
    console.log(`Posts to import: ${plan.cases.length} ${JSON.stringify(kinds)}`);
    console.log(`Current bans: ${plan.bans.length}`);
    console.log(`Posts that could not be read: ${plan.skipped.length}`);
    console.log(`People with old strikes: ${plan.legacyStrikes.length}. None of these count; everyone starts at 0/3.`);
    console.log('\n--- OLD STRIKE COUNTS (shown on confirm cards only) ---');
    for (const [id, count] of plan.legacyStrikes.sort((a, b) => b[1] - a[1])) console.log(`${count}  ${id}`);
    console.log('\n--- POSTS THAT COULD NOT BE READ ---');
    for (const s of plan.skipped) console.log(`#${s.channel}: ${s.content.replace(/\s+/g, ' ').slice(0, 160)}`);
    console.log('\n--- EVERY IMPORTED POST ---');
    for (const c of plan.cases) console.log(`${String(c.createdAt).slice(0, 10)}  ${c.kind.padEnd(8)} ${c.strikeNumber ? `S${c.strikeNumber}` : '  '}  ${c.discordId}  ${c.actorName}: ${c.reason.slice(0, 120)}`);
    console.log('\n--- CURRENT BANS ---');
    for (const b of plan.bans) console.log(`${b.discordId}  ${b.targetName}: ${b.reason.slice(0, 120)}`);
})().catch((err) => { console.error(err); process.exit(1); });
