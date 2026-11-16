export function checkConfig(cfg, parts) {
 const selected=Object.entries(cfg).map(([slot,id])=>({slot,id,part:parts.get(id)}));
 const provided=new Map(), issues=[];
 for(const {slot,part} of selected) for(const [k,v] of Object.entries(part?.provides??{})) provided.set(k,{value:v,slot});
 const n=k=>provided.get(k)?.value;
 if(['ring_big','ring_small','cog_max','cog_min'].map(n).every(Number.isFinite)) provided.set('capacity_needed',{value:n('ring_big')-n('ring_small')+n('cog_max')-n('cog_min'),slot:'derived'});
 const ops={eq:(a,b)=>a===b,in:(a,b)=>Array.isArray(b)&&b.includes(a),lte:(a,b)=>a<=b,gte:(a,b)=>a>=b};
 for(const {slot,id,part} of selected){
  if(!part||part.slot!==slot){issues.push({level:'error',slot,msg:`Invalid component ${id} for ${slot}`});continue;}
  for(const r of part.requires??[]){
   const provider=provided.get(r.key);
   if(!ops[r.op]){issues.push({level:'error',slot,msg:`Unsupported operator ${r.op}`});continue;}
   if(provider?.value==null){issues.push({level:'info',slot,msg:`${part.name}: ${r.key} not measured or verified yet`});continue;}
   if(!ops[r.op](provider.value,r.value)) issues.push({level:r.level??'error',slot,msg:r.msg??`${part.name}: requires ${r.key} ${r.op} ${r.value}; selected value ${provider.value}`});
  }
 }
 if(n('freehub')==='HG-11')issues.push({level:'info',slot:'cassette',msg:'10-speed cassette on HG-11 needs a verified 1.85 mm spacer.'});
 return issues;
}
