process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config();
const {REST,Routes}=require('discord.js');
const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
const sf=t=>((BigInt(Date.parse(t))-1420070400000n)<<22n).toString();
async function dump(ch,from){
 let after=sf(from), all=[];
 for(;;){const b=await rest.get(Routes.channelMessages(ch),{query:new URLSearchParams({limit:'100',after})}); if(!b.length)break; b.sort((a,c)=>BigInt(a.id)<BigInt(c.id)?-1:1); all.push(...b); after=b[b.length-1].id; if(b.length<100)break;}
 return all;
}
(async()=>{
 const ch=process.argv[2], from=process.argv[3];
 const msgs=await dump(ch,from);
 const byId=new Map(msgs.map(m=>[m.id,m]));
 for(const m of msgs){
  const who=(m.author.id==='1411616714591834184'?'[BOT]':(m.member?.nick||m.author.global_name||m.author.username))+'('+m.author.username+')';
  const ref=m.message_reference?.message_id; const r=ref&&byId.get(ref);
  const rt=ref?` ↪${r?(r.author.id==='1411616714591834184'?'BOT':r.author.username):'?'}`:'';
  const ment=(m.mentions||[]).map(u=>u.username).join(',');
  const extra=[m.attachments?.length?`[${m.attachments.length} att]`:'',m.embeds?.length?`[emb:${m.embeds.map(e=>e.footer?.text||e.type).join('|')}]`:'',m.sticker_items?.length?'[sticker]':'',(m.reactions||[]).map(x=>(x.emoji.name)+x.count).join(' ')].filter(Boolean).join(' ');
  console.log(`${new Date(m.timestamp).toISOString().slice(5,19)} ${m.id.slice(-5)} ${who}${rt}${ment?' @'+ment:''}: ${(m.content||'').replace(/\n/g,' ⏎ ').slice(0,300)} ${extra}`);
 }
 console.error('count',msgs.length);
})().catch(e=>{console.error(e.message);process.exit(1)});
