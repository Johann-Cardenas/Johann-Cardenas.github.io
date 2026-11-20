import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { specRows, specTSV } from '../js/specs.js';
import { setup } from '../js/model/perf.js';
import { applyChange } from '../js/state.js';
import { defaultParams } from '../js/state.js';

const c = JSON.parse(readFileSync(new URL('../data/components.json', import.meta.url), 'utf8'));
const g = JSON.parse(readFileSync(new URL('../data/geometry.json', import.meta.url), 'utf8'));
const parts = new Map(c.components.map((p) => [p.id, p]));
const P = defaultParams(g.fit_defaults);

test('GP5000 AS TR comes in 25 and 28, all black and black/cream', () => {
  for (const w of [25, 28]) for (const sfx of ['', '_cream']) {
    const p = parts.get(`tires_gp5000_as_tr_${w}${sfx}`);
    assert.ok(p, `${w}${sfx}`);
    assert.equal(p.provides.tire_width_mm, w);
    assert.equal(p.visual.sidewall, sfx ? 'cream' : 'black');
    assert.ok(Number.isFinite(p.perf.crr) && p.perf.crr_setup === 'tubeless');
  }
});

test('Superteam wheels pull in carbon pads; the Edge 1050 is a computer', () => {
  const r = applyChange(c.default_config, 'wheels', 'wheels_superteam_50c', c);
  assert.deepEqual(r.also, [{ slot: 'brake_pads', id: 'pads_black_prince' }]);
  assert.equal(parts.get('computer_edge1050').slot, 'computer');
  assert.equal(parts.get('wheels_superteam_50c').visual.depth, 50);
});

test('spec sheet compares with the installed part and keeps unknowns unknown', () => {
  const sh = specRows(parts.get('tires_gp5000_as_tr_28'), parts.get(c.default_config.tires));
  assert.ok(sh.compare);
  const crr = sh.rows.find((r) => r.key === 'crr');
  assert.equal(crr.a, 0.00366); assert.equal(crr.b, 0.0048); assert.equal(crr.cmp, 'better');
  const mass = sh.rows.find((r) => r.key === 'mass_each_g');
  assert.equal(mass.b, null); assert.equal(mass.cmp, '');
  const own = specRows(parts.get(c.default_config.wheels), parts.get(c.default_config.wheels));
  assert.equal(own.compare, false);
  assert.ok(specRows(parts.get('frameset_synapse_carbon_51_red')).rows.some((r) => r.key === 'bb_standard'));
  assert.equal(specTSV(parts.get('computer_edge1050'), null).split('\n')[0], 'Spec\tUnit\tGarmin Edge 1050 · silicone case bundle');
});

test('a tubeless drum Crr gets the butyl-tube penalty on a tubed bike', () => {
  const su = setup({ ...c.default_config, tires: 'tires_gp5000_as_tr_28' }, c, P);
  assert.ok(Math.abs(su.crr - (0.00366 + 0.0006)) < 1e-12);
  const tpu = setup({ ...c.default_config, tires: 'tires_gp5000_as_tr_28', tubes: 'tubes_tpu' }, c, P);
  assert.equal(tpu.crr, 0.00366);
});
