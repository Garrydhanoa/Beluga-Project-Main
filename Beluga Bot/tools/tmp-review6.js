process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config();
const RB=require('../src/utils/ruleBook');
(async()=>{
 const rb=new RB({lazy:true}); await rb.ensureLoaded();
 for(const term of ['match admin streamer host','eligibility ranked games','eligible 25 games','sal-lock games requirement']){
  const f=rb.searchRules(term)||[];
  console.log('=== '+term); for(const r of f.slice(0,3)) console.log(JSON.stringify(r).slice(0,900));
 }
 process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
