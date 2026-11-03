// Builds a Beluga Insider packet without writing anything. Reads Discord and the
// database only. Run from Beluga Bot/.
//   node tools/insider-packet.js                       what Tuesday's run would see now
//   node tools/insider-packet.js --season 8 --week 5 --as-of 2026-08-23T21:27:39Z
//   add --out <file> to save it, --public-only to leave out the private extras
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;

const fs = require('fs');
const { pool } = require('../src/utils/database');
const { DEFAULT_SETTINGS } = require('../src/insider/insiderSchema');
const { resolvePeriod, buildPacket, seasonById } = require('../src/insider/collect');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? null : process.argv[i + 1];
}

(async () => {
    const seasonId = arg('season');
    const week = arg('week');
    const asOf = arg('as-of');
    let period;
    if (seasonId) {
        const to = new Date(asOf);
        period = {
            season: await seasonById(Number(seasonId)),
            week: Number(week),
            edition: 'season',
            phase: 'regular',
            from: new Date(to.getTime() - WEEK_MS),
            to,
            asOf,
        };
    } else {
        period = await resolvePeriod(new Date());
    }

    const { packet, refused } = await buildPacket(period, {
        guildId: process.env.GUILD_ID,
        settings: DEFAULT_SETTINGS,
        publicOnly: process.argv.includes('--public-only'),
    });

    const json = JSON.stringify(packet);
    const out = arg('out');
    if (out) fs.writeFileSync(out, json);

    console.log('meta', JSON.stringify(packet.meta));
    console.log('chat totals', JSON.stringify(packet.chat.totals), 'gaps', JSON.stringify(packet.chat.gaps));
    console.log('channels read:', packet.chat.channels.map((c) => `${c.channel} (${c.lines.length}${c.quotable ? '' : ', not quotable'})`).join(', '));
    console.log('refused:', refused.length, 'channels');
    console.log('transactions', packet.transactions.moves.length, 'mass-drops', packet.transactions.massDrops, 'salary moves', packet.salaryMoves.length, 'past issues', packet.pastIssues.length);
    for (const d of packet.league?.divisions || []) {
        console.log(`${d.division}: ${d.results.length} results, ${d.standings.length} teams, GotW ${d.gameOfWeek ? `${d.gameOfWeek.home} ${d.gameOfWeek.score} ${d.gameOfWeek.away}` : 'none'}, PotW ${d.playerOfWeek?.player || 'none'}, ${d.nextWeek.length} next week`);
    }
    console.log('team emoji', packet.emoji.teams.length, 'general emoji', packet.emoji.general.length);
    console.log('packet size', json.length, 'chars, about', Math.round(json.length / 3.5), 'tokens');
    await pool.end();
})().catch((err) => {
    console.error('FAILED', err);
    process.exit(1);
});
