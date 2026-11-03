process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config();
const {Client}=require('pg');
(async()=>{
const c=new Client({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s,p)=>(await c.query(s,p)).rows;
console.log('PERSONAS cols', (await q(`select column_name from information_schema.columns where table_name='ai_personas'`)).map(r=>r.column_name).join(','));
console.table(await q(`select p.*, m.username, m.display_name from ai_personas p left join discord_members m on m.discord_id=p.discord_id`).catch(e=>[{e:e.message}]));
console.table(await q(`select distinct actor_name, actor_id from higgen_logs where action in ('ai.replied','ai.joined_chat') and occurred_at>'2026-10-31 19:20Z'`));
console.table(await q(`select discord_id, username, display_name from discord_members where discord_id in (select distinct actor_id from higgen_logs where action='ai.replied') or username ilike '%garry%'`).catch(e=>[{e:e.message}]));
const lk=await q(`select occurred_at,actor_name,duration_ms,outcome,summary,details,error_message from higgen_logs where action='ai.data_lookup' order by occurred_at`);
for(const x of lk){console.log(x.occurred_at.toISOString(),x.outcome,x.duration_ms,'|',(x.details||[]).map(p=>p[0]+'='+String(p[1]).replace(/\s+/g,' ').slice(0,260)).join(' || '),x.error_message||'');}
console.table(await q(`select * from mod_claude_usage order by day,purpose`));
console.table(await q(`select balance_usd,spent_usd,state,alert_sent,last_error,day_key,day_spent_usd,day_alert_sent,balance_set_at from mod_claude_account`));
console.table(await q(`select source,direction,count(*),min(created_at),max(created_at) from dm_messages where created_at>'2026-10-31 19:20' group by 1,2`));
await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
