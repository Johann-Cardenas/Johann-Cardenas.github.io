import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {checkConfig} from '../js/compat.js';import {decodeConfig,encodeConfig,summarize} from '../js/state.js';
const c=JSON.parse(readFileSync(new URL('../data/components.json',import.meta.url),'utf8'));const parts=new Map(c.components.map(p=>[p.id,p]));
test('installed has no errors and unknown clearance is visible',()=>{const i=checkConfig(c.default_config,parts);assert.equal(i.filter(i=>i.level==='error').length,0);assert.ok(i.some(i=>i.slot==='tires'&&i.level==='info'));});
test('11–32 produces two derailleur warnings',()=>{const i=checkConfig({...c.default_config,cassette:'cassette_hg500_11_32'},parts);assert.equal(i.filter(i=>i.slot==='rear_derailleur'&&i.level==='warn').length,2);});
test('disc wheelset is blocked',()=>{const p=new Map(parts);p.set('disc',{slot:'wheels',name:'Disc wheel',requires:[{key:'brake_type',op:'eq',value:'disc'}]});assert.ok(checkConfig({...c.default_config,wheels:'disc'},p).some(i=>i.level==='error'));});
test('URL state rejects mismatched slots and unknown IDs',()=>{for(const hash of ['#wheels=rd_5700_ss','#wheels=bad','#bad=x'])assert.deepEqual(decodeConfig(hash,c),c.default_config);});
test('partial state merges required defaults and optional removal roundtrips',()=>{const cfg=decodeConfig('#light=none',c);assert.ok(cfg.frameset);assert.equal(cfg.light,undefined);assert.deepEqual(decodeConfig(encodeConfig(cfg,c),c),cfg);});
test('unknown masses never become complete totals; unchanged deltas are zero',()=>{const s=summarize(c.default_config,c);assert.equal(s.totalMass_g,null);assert.equal(s.deltaMass_g,0);assert.equal(s.deltaCdA_m2,null);});
