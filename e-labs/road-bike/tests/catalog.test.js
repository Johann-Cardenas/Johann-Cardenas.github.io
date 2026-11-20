import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalog } from '../tools/build_catalog.mjs';
import { checkConfig } from '../js/compat.js';
import { applyChange, decodeConfig, encodeConfig, decodeParams, defaultParams, summarize } from '../js/state.js';

const c = JSON.parse(readFileSync(new URL('../data/components.json', import.meta.url), 'utf8'));
const g = JSON.parse(readFileSync(new URL('../data/geometry.json', import.meta.url), 'utf8'));
const parts = new Map(c.components.map((p) => [p.id, p]));

test('committed catalog matches its generator (run tools/build_catalog.mjs after editing it)', () => {
  assert.deepEqual(c, JSON.parse(JSON.stringify(buildCatalog())));
});

test('every candidate carries its evidence; unknowns are null, never zero', () => {
  for (const p of c.components) {
    assert.ok('CLSM'.includes(p.confidence), p.id);
    assert.ok(p.mass_g === null || p.mass_g > 0, p.id);
    assert.ok(p.price_usd === null || p.price_usd > 0, p.id);
    if (p.mass_g !== null) assert.ok(p.mass_source, `${p.id} has a mass without a source`);
    if (p.upgrade) assert.ok(p.upgrade.tier >= 1 && p.upgrade.tier <= 5 && p.upgrade.why, p.id);
  }
});

test('every bundle applies to the installed build without an interface error', () => {
  for (const b of c.bundles) {
    const errs = checkConfig({ ...c.default_config, ...b.set }, parts).filter((i) => i.level === 'error');
    assert.deepEqual(errs, [], b.id);
  }
});

test('a change that breaks an interface pulls in the one part that repairs it', () => {
  assert.deepEqual(applyChange(c.default_config, 'crankset', 'crank_105_r7000_50_34', c).also, [{ slot: 'bottom_bracket', id: 'bb_bb30_to_shimano' }]);
  assert.deepEqual(applyChange(c.default_config, 'wheels', 'wheels_hunt_50_carbon', c).also, [{ slot: 'brake_pads', id: 'pads_black_prince' }]);
  assert.deepEqual(applyChange(c.default_config, 'tires', 'tires_gp5000_25', c).also, []);
});

test('Tiagra 4700 cannot be indexed by ST-5700 and nothing repairs that', () => {
  const r = applyChange(c.default_config, 'rear_derailleur', 'rd_4700_gs', c);
  assert.ok(r.blocked && r.blocked[0].msg.includes('11-speed'));
});

test('an 11-32 cassette is clean with the GS derailleur and warned without it', () => {
  const warn = (cfg) => checkConfig(cfg, parts).filter((i) => i.slot === 'rear_derailleur' && i.level === 'warn').length;
  assert.equal(warn({ ...c.default_config, cassette: 'cassette_hg500_11_32' }), 2);
  assert.equal(warn({ ...c.default_config, cassette: 'cassette_hg500_11_32', rear_derailleur: 'rd_5701_gs' }), 0);
  assert.equal(warn({ ...c.default_config, cassette: 'cassette_hg500_11_34', rear_derailleur: 'rd_5701_gs' }), 1); // 34T > 32T; wrap 16 + 23 = 39T is within rating
});

test('a wide rim makes a tyre measure wider, and that is reported', () => {
  const is = checkConfig({ ...c.default_config, wheels: 'wheels_hunt_4season_aero', tires: 'tires_gp5000_25' }, parts);
  assert.ok(is.some((i) => i.slot === 'tires' && /26\.6 mm/.test(i.msg)));
});

test('parameters round-trip through the URL; defaults are not written; bad values are ignored', () => {
  const P = { ...defaultParams(g.fit_defaults), stem_length_mm: 110, paint: 'stealth', decals: false };
  const hash = encodeConfig({ ...c.default_config, tires: 'tires_gp5000_25' }, c, P, g.fit_defaults, 'gearing');
  assert.equal(hash, '#tires=tires_gp5000_25&p.paint=stealth&p.decals=0&p.stem_length_mm=110&view=gearing');
  assert.deepEqual(decodeParams(hash, g.fit_defaults), P);
  assert.equal(decodeConfig(hash, c).tires, 'tires_gp5000_25');
  const bad = decodeParams('#p.stem_length_mm=999&p.paint=neon&p.c1=red&p.nope=1', g.fit_defaults);
  assert.deepEqual(bad, defaultParams(g.fit_defaults));
  assert.equal(encodeConfig(c.default_config, c, defaultParams(g.fit_defaults), g.fit_defaults), '#');
});

test('purchase cost counts every new part and is null if any price is unknown', () => {
  const s = summarize({ ...c.default_config, tires: 'tires_gp5000_25', chain: 'chain_cn6701' }, c);
  assert.equal(s.cost_usd, 140 + 35);
  assert.equal(summarize({ ...c.default_config, wheels: 'wheels_hunt_50_carbon' }, c).cost_usd, null);
});
