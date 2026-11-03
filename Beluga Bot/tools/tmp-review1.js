process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config();
const {Client}=require('pg');
(async()=>{
const c=new Client({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
for (const t of ['higgen_logs','mod_claude_usage','mod_claude_account','dm_messages']){
 const r=await c.query(`select column_name,data_type from information_schema.columns where table_name=$1 order by ordinal_position`,[t]);
 console.log(t, r.rows.map(x=>x.column_name+':'+x.data_type).join(', '));
}
const r=await c.query(`select action,count(*),min(occurred_at),max(occurred_at) from higgen_logs where action like 'ai.%' and occurred_at>'2026-10-31 19:20Z' group by 1 order by 2 desc`);
console.table(r.rows);
await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
