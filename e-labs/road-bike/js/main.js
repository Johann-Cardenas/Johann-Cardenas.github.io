import {checkConfig} from './compat.js';
import {decodeConfig,encodeConfig} from './state.js';
const $=s=>document.querySelector(s);
const groups=[['Frameset & paint',['frameset']],['Wheels',['wheels']],['Tyres',['tires']],['Drivetrain',['crankset','cassette','rear_derailleur','front_derailleur','chain','shifters']],['Brakes',['brakes']],['Cockpit',['stem','handlebar','tape','aerobar']],['Seat',['seatpost','saddle']],['Accessories',['pedals','cages','light','computer_mount']]];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
try{
const [geometry,catalog]=await Promise.all(['geometry','components'].map(async n=>{const r=await fetch(`data/${n}.json`);if(!r.ok)throw Error(`Cannot load ${n}`);return r.json()}));
const parts=new Map(catalog.components.map(p=>[p.id,p]));
let config=decodeConfig(location.hash,catalog)||{...catalog.default_config},installed=false,viewer;
function issuesHTML(issues){return issues.map(i=>`<p class="issue ${esc(i.level)}">${esc(i.msg)}</p>`).join('')}
function render(){
 const cfg=installed?catalog.default_config:config;
 document.querySelectorAll('nav a').forEach(a=>{a.hash=encodeConfig(config,catalog).slice(1)});
 const open=[...document.querySelectorAll('details[open]')].map(d=>d.dataset.group);
 $('#options').innerHTML=groups.map(([label,slots],i)=>`<details data-group="${i}" ${open.includes(String(i))?'open':''}><summary>${label}</summary>${catalog.slots.filter(s=>slots.includes(s.id)).map(s=>`<fieldset><legend>${esc(s.label)}</legend>${s.optional?`<label class="option"><input type="radio" name="${s.id}" value="" ${!cfg[s.id]?'checked':''} ${installed?'disabled':''}> None</label>`:''}${catalog.components.filter(p=>p.slot===s.id).map(p=>{const issues=checkConfig({...config,[s.id]:p.id},parts);const relevant=issues.filter(x=>x.slot===s.id);return `<label class="option"><input type="radio" name="${s.id}" value="${p.id}" ${cfg[s.id]===p.id?'checked':''} ${installed?'disabled':''}> ${esc(p.name)}<small>${p.confidence} · ${p.mass_g??'Unknown'} g · ${p.price_usd==null?'Price unknown':'$'+p.price_usd} · ${relevant.some(x=>x.level==='error')?'✕':relevant.length?'⚠':'✓'}</small><a href="spec.html#${p.id}">Details</a></label>`}).join('')}</fieldset>`).join('')}</details>`).join('');
 const selected=Object.values(cfg).map(id=>parts.get(id)).filter(Boolean),known=selected.filter(p=>Number.isFinite(p.mass_g));
 const changed=catalog.slots.filter(s=>cfg[s.id]!==catalog.default_config[s.id]);
 const delta=key=>{let total=0;for(const s of changed){const a=parts.get(cfg[s.id]),b=parts.get(catalog.default_config[s.id]);if((a&&!Number.isFinite(a[key]))||(b&&!Number.isFinite(b[key])))return 'Unknown';total+=(a?.[key]??0)-(b?.[key]??0)}return (total>=0?'+':'')+total};
 const vals=Object.assign({},...selected.map(p=>p.provides||{}));
 $('#totals').innerHTML=`<p>Known mass subtotal <strong>${known.reduce((n,p)=>n+p.mass_g,0).toLocaleString()} g</strong><br><small>${selected.length-known.length} parts have unknown mass; this is not whole-bike weight.</small></p><p>Δmass <strong>${delta('mass_g')} g</strong> · Δprice <strong>${delta('price_usd')} USD</strong></p><p>Gear ratio ${Number.isFinite(vals.ring_small/vals.cog_max)?(vals.ring_small/vals.cog_max).toFixed(2)+' – '+(vals.ring_big/vals.cog_min).toFixed(2):'Unknown'}<br>ΔCdA: <strong>not simulated</strong></p>`;
 $('#issues').innerHTML=issuesHTML(checkConfig(cfg,parts));
 $('#installed').setAttribute('aria-pressed',installed);$('#proposal').setAttribute('aria-pressed',!installed);
 viewer?.setConfig(cfg,catalog);
}
$('#options').addEventListener('change',e=>{if(e.target.type!=='radio')return;const next={...config};if(e.target.value)next[e.target.name]=e.target.value;else delete next[e.target.name];const issues=checkConfig(next,parts);if(issues.some(i=>i.level==='error')){render();$('#issues').innerHTML=issuesHTML(issues);$('#status').textContent='Change blocked: incompatible interfaces.';return}config=next;history.replaceState(null,'',encodeConfig(config,catalog));render()});
$('#installed').onclick=()=>{installed=true;render()};$('#proposal').onclick=()=>{installed=false;render()};
$('#reset').onclick=()=>{config={...catalog.default_config};installed=false;history.replaceState(null,'',encodeConfig(config,catalog));render()};
$('#share').onclick=async()=>{try{await navigator.clipboard.writeText(location.href.split('#')[0]+encodeConfig(config,catalog));$('#status').textContent='Build link copied.'}catch{$('#status').textContent='Copy the build link from your address bar.'}};
window.addEventListener('hashchange',()=>{config=decodeConfig(location.hash,catalog)||{...catalog.default_config};render()});
render();
try{const {createViewer}=await import('./viewer.js');viewer=createViewer($('#viewport'),geometry,slot=>{const i=groups.findIndex(g=>g[1].includes(slot));const d=document.querySelector(`[data-group="${i}"]`);if(d){d.open=true;d.scrollIntoView({block:'nearest'})}});render();$('#status').textContent='Provisional build ready. Unknown interfaces need measurement.';
$('#camera').onchange=e=>viewer.preset(e.target.value);
for(const [id,method] of [['explode','explode'],['geometry','overlay']])$('#'+id).onclick=e=>{const active=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',active);viewer[method](active)};
$('#png').onclick=()=>{const a=document.createElement('a');a.href=viewer.png();a.download='synapse-build.png';a.click()};
}catch(error){$('#status').textContent='3D viewer unavailable. Component selection and specifications remain available.';console.error(error)}
}catch(error){$('#status').textContent=`Unable to initialize: ${error.message}. Serve this folder over HTTP and reload.`;console.error(error)}
