import {checkConfig} from './compat.js';
// Optional slots are removed with slot=none. Invalid URLs return installed configuration.
export function decodeConfig(hash,catalog){
 const cfg={...catalog.default_config}, slots=new Map(catalog.slots.map(s=>[s.id,s])), parts=new Map(catalog.components.map(p=>[p.id,p]));
 const seen=new Set();
 const params=new URLSearchParams((hash??'').replace(/^#/,''));
 for(const [slot,id] of params){
  if(seen.has(slot))return {...catalog.default_config};seen.add(slot);
  const s=slots.get(slot); if(!s)return {...catalog.default_config};
  if(id==='none'&&s.optional){delete cfg[slot];continue;}
  if(parts.get(id)?.slot!==slot)return {...catalog.default_config};cfg[slot]=id;
 }
 return checkConfig(cfg,parts).some(i=>i.level==='error') ? {...catalog.default_config} : cfg;
}
export function encodeConfig(cfg,catalog){
 const full={...cfg};
 for(const s of catalog?.slots??[])if(s.optional&&!cfg[s.id])full[s.id]='none';
 return '#'+new URLSearchParams(full).toString();
}
export function summarize(cfg,catalog){
 const parts=new Map(catalog.components.map(p=>[p.id,p]));const selected=Object.values(cfg).map(id=>parts.get(id)).filter(Boolean);
 const knownMass=selected.filter(p=>Number.isFinite(p.mass_g));const unknownMass=selected.length-knownMass.length;
 const changed=catalog.slots.filter(s=>cfg[s.id]!==catalog.default_config[s.id]);
 const delta=(key)=>{let total=0;for(const s of changed){const a=parts.get(catalog.default_config[s.id]),b=parts.get(cfg[s.id]);if((a&&!Number.isFinite(a[key]))||(b&&!Number.isFinite(b[key])))return null;total+=(b?.[key]??0)-(a?.[key]??0);}return total;};
 const provided=Object.assign({},...selected.map(p=>p.provides));
 const gearMin=provided.ring_small/provided.cog_max,gearMax=provided.ring_big/provided.cog_min;
 return {knownMass_g:knownMass.reduce((a,p)=>a+p.mass_g,0),unknownMassCount:unknownMass,totalMass_g:unknownMass?null:knownMass.reduce((a,p)=>a+p.mass_g,0),deltaMass_g:delta('mass_g'),deltaPrice_usd:delta('price_usd'),gearMin:Number.isFinite(gearMin)?gearMin:null,gearMax:Number.isFinite(gearMax)?gearMax:null,deltaCdA_m2:null,changedCount:changed.length};
}
