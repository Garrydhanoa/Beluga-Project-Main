process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config();
const {Client}=require('pg');
(async()=>{
const c=new Client({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s,p)=>(await c.query(s,p)).rows;
const users=['garrydhanoa639','mecto1627.','figgbot','tranquelity','cyan_._.1_1','clucthypoo','brenden02957'];
const ids=await q(`select discord_id,username from discord_members where username = any($1)`,[users]);
console.table(ids);
console.log((await q(`select season_id,is_playoff,count(*) from stats_player_season group by 1,2 order by 1,2`)));
const base=`with t as (select discord_id, sum(games) g, sum(goals) go, sum(assists) a, sum(saves) sv, sum(shots) sh, sum(score) sc, sum(demos_inflicted) di, sum(demos_taken) dt, sum(mvps) mv, sum(beluga_score) bs, count(distinct season_id) seasons from stats_player_season where is_playoff=$1 and discord_id is not null group by 1 having sum(games)>0),
 r as (select *, (sc*25+go*30+a*15+sv*20+sh*5+di*5)/100.0/g bpg_formula, bs/g::numeric bs_over_g from t)
 select *, rank() over (order by bpg_formula desc) filter_rank_all from r`;
const all=await q(base,[false]);
const nine=all.filter(r=>r.g>=9);
const rank=(id,key)=>{const s=[...nine].sort((a,b)=>b[key]-a[key]);return s.findIndex(r=>r.discord_id===id)+1;};
const avg=k=>nine.reduce((s,r)=>s+Number(r[k])/r.g,0)/nine.length;
console.log('players >=9 games',nine.length,'all',all.length,'avg gpg',avg('go').toFixed(2),'avg svpg',avg('sv').toFixed(2),'avg bpg formula',(nine.reduce((s,r)=>s+Number(r.bpg_formula),0)/nine.length).toFixed(2),'avg bs/g',(nine.reduce((s,r)=>s+Number(r.bs_over_g),0)/nine.length).toFixed(2));
for(const {discord_id,username} of ids){const r=all.find(x=>x.discord_id===discord_id); if(!r){console.log(username,'NO ROW');continue;}
 console.log(username,{g:r.g,go:r.go,a:r.a,sv:r.sv,sh:r.sh,sc:r.sc,di:r.di,dt:r.dt,mv:r.mv,seasons:r.seasons,bpg:Number(r.bpg_formula).toFixed(2),bs_g:Number(r.bs_over_g).toFixed(2),scpg:(r.sc/r.g).toFixed(1),rank_formula:rank(discord_id,'bpg_formula'),rank_bs_g:rank(discord_id,'bs_over_g')});}
const po=await q(base,[true]);
for(const {discord_id,username} of ids){const r=po.find(x=>x.discord_id===discord_id); if(r) console.log('PLAYOFF',username,{g:r.g,go:r.go,a:r.a,sv:r.sv,sc:r.sc,mv:r.mv});}
// barry percentile check
await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
