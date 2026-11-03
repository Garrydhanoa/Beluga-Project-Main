process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config();
const {Client}=require('pg');
(async()=>{
const c=new Client({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(`select id,occurred_at,action,actor_name,actor_id,location,outcome,duration_ms,summary,details,error_message from higgen_logs where (action like 'ai.%') and occurred_at>'2026-10-31 19:20Z' and action<>'ai.data_lookup' order by occurred_at`);
for(const x of r.rows){
 const d=Array.isArray(x.details)?x.details.map(p=>`  ${p[0]}: ${String(p[1]).replace(/\n/g,' ⏎ ')}`).join('\n'):JSON.stringify(x.details);
 console.log(`#${x.id} ${x.occurred_at.toISOString()} ${x.action} | ${x.actor_name} | ${x.location} | ${x.outcome} ${x.duration_ms??''}\n  ${x.summary}\n${d}${x.error_message?'\n  ERR '+x.error_message:''}\n`);
}
const e=await c.query(`select action,count(*) from higgen_logs where occurred_at>'2026-10-31 19:20Z' and (action ilike '%ai%' or action ilike '%claude%' or summary ilike '%claude%') group by 1 order by 2 desc`);
console.table(e.rows);
await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
