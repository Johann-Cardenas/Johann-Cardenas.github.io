import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {checkConfig} from '../js/compat.js';import {decodeConfig,encodeConfig,summarize} from '../js/state.js';
const c=JSON.parse(readFileSync(new URL('../data/components.json',import.meta.url),'utf8'));const parts=new Map(c.components.map(p=>[p.id,p]));
test('installed has no errors and unknown clearance is visible',()=>{const i=checkConfig(c.default_config,parts);assert.equal(i.filter(i=>i.level==='error').length,0);assert.ok(i.some(i=>i.slot==='tires'&&i.level==='info'));});
test('11–32 produces two derailleur warnings',()=>{const i=checkConfig({...c.default_config,cassette:'cassette_hg500_11_32'},parts);assert.equal(i.filter(i=>i.slot==='rear_derailleur'&&i.level==='warn').length,2);});
test('disc wheelset is blocked',()=>{const p=new Map(parts);p.set('disc',{slot:'wheels',name:'Disc wheel',requires:[{key:'brake_type',op:'eq',value:'disc'}]});assert.ok(checkConfig({...c.default_config,wheels:'disc'},p).some(i=>i.level==='error'));});
test('URL state rejects mismatched slots and unknown IDs',()=>{for(const hash of ['#wheels=rd_5700_ss','#wheels=bad','#bad=x'])assert.deepEqual(decodeConfig(hash,c),c.default_config);});
test('partial state merges required defaults and optional removal roundtrips',()=>{const cfg=decodeConfig('#light=none',c);assert.ok(cfg.frameset);assert.equal(cfg.light,undefined);assert.deepEqual(decodeConfig(encodeConfig(cfg,c),c),cfg);});
test('unknown masses never become complete totals; unchanged deltas are zero',()=>{const s=summarize(c.default_config,c);assert.equal(s.totalMass_g,null);assert.equal(s.deltaMass_g,0);assert.equal(s.deltaCdA_m2,null);});

test('conflicting providers cannot silently overwrite interfaces',()=>{
 const p=new Map(parts);p.set('conflict',{slot:'light',name:'Bad interface',provides:{brake_type:'disc'}});
 const cfg={...c.default_config,light:'conflict'};
 for(const config of [cfg,Object.fromEntries(Object.entries(cfg).reverse())])assert.ok(checkConfig(config,p).some(i=>i.level==='error'&&i.msg.includes('Conflicting brake_type')));
});
test('matching providers are allowed and numeric comparisons reject strings',()=>{
 const p=new Map(parts);p.set('matching',{slot:'light',name:'Matching',provides:{brake_type:'rim'}});
 assert.equal(checkConfig({...c.default_config,light:'matching'},p).filter(i=>i.level==='error').length,0);
 p.set('bad-number',{slot:'light',name:'Bad number',provides:{tire_max_mm:'25'}});
 assert.ok(checkConfig({...c.default_config,light:'bad-number'},p).some(i=>i.level==='error'));
});
test('duplicate URL parameters are rejected instead of last value winning',()=>{
 assert.deepEqual(decodeConfig('#cassette=cassette_cs5700_11_28&cassette=cassette_hg500_11_32',c),c.default_config);
 assert.deepEqual(decodeConfig('#light=none&light=none',c),c.default_config);
});
test('URL refuses physical errors but retains warnings and unresolved measurements',()=>{
 const cat=structuredClone(c);cat.components.push({id:'disc',slot:'wheels',name:'Disc wheel',requires:[{key:'brake_type',op:'eq',value:'disc'}]});
 assert.deepEqual(decodeConfig('#wheels=disc',cat),c.default_config);
 assert.equal(decodeConfig('#cassette=cassette_hg500_11_32',c).cassette,'cassette_hg500_11_32');
 assert.equal(decodeConfig('#tires=tires_gp5000_as_tr_25',c).tires,'tires_gp5000_as_tr_25');
 assert.deepEqual(decodeConfig('#frameset=none',c),c.default_config);
});
test('proposal deltas do not fabricate unknown mass or price',()=>{
 const cfg={...c.default_config,tires:'tires_gp5000_28'};const s=summarize(cfg,c);
 assert.equal(s.deltaMass_g,null);assert.equal(s.deltaPrice_usd,null);
 const gears=summarize({...c.default_config,cassette:'cassette_hg500_11_32'},c);
 assert.equal(gears.gearMin,34/32);assert.equal(gears.gearMax,50/11);
});
