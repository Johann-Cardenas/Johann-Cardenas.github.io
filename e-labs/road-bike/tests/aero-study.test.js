import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pairCases, weightedDelta, roadGains, YAW_WEIGHTS, barryWeights, spokeModel, matrixStudy, MATRIX } from '../js/model/study.js';
import { defaultParams } from '../js/state.js';

const c = JSON.parse(readFileSync(new URL('../data/components.json', import.meta.url), 'utf8'));
const g = JSON.parse(readFileSync(new URL('../data/geometry.json', import.meta.url), 'utf8'));
const P = defaultParams(g.fit_defaults);

test('study pairs cases by yaw, weights them, and splits the road gain', () => {
  const mk = (yaw, cad, CdA, wheel) => ({ case: `y${yaw}${cad ? 'v' : ''}`, yaw_deg: yaw, dx_mm: 8, CdA_m2: CdA, drag_N: CdA * 74.3, side_force_N: 0, cad, drag_by_group_N: { 'Front wheel': wheel, 'Rear wheel': 1 } });
  const cases = [mk(0, undefined, 0.10, 2), mk(10, undefined, 0.19, 3), mk(0, 'v', 0.098, 1.8), mk(10, 'v', 0.18, 2), mk(5, 'v', 0.12, 1)];
  const rows = pairCases(cases, 'v');
  assert.deepEqual(rows.map((r) => r.yaw), [0, 10]); // no baseline at 5 deg: not paired
  assert.ok(Math.abs(rows[0].groups['Front wheel'] + 0.2) < 1e-12);
  const wd = weightedDelta(rows);
  const w0 = YAW_WEIGHTS[0], w10 = YAW_WEIGHTS[10];
  assert.ok(Math.abs(wd.dCdA - (w0 * -0.002 + w10 * -0.01) / (w0 + w10)) < 1e-12);
  const cfg = { ...c.default_config, wheels: 'wheels_superteam_50c', tires: 'tires_gp5000_as_tr_28', brake_pads: 'pads_black_prince' };
  const g0 = roadGains(c, P, cfg, -0.004);
  assert.ok(g0.kmhUp > g0.kmhBase && g0.dt_s < 0);
  for (const r of g0.at) assert.ok(Math.abs(r.saved_W - (r.aero_W + r.rolling_W)) < 0.05, `split adds up at ${r.kmh}`);
  const flat = roadGains(c, P, c.default_config, 0);
  assert.ok(Math.abs(flat.kmhUp - flat.kmhBase) < 1e-9);
});

test('Barry yaw weights: sum to one, fold one side, split two sides evenly', () => {
  const one = barryWeights([0, 5, 10, 15]), two = barryWeights([-15, -10, -5, 0, 5, 10, 15]);
  for (const w of [one, two]) assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(Math.abs(two[5] - two[-5]) < 1e-15 && Math.abs(two[5] + two[-5] - one[5]) < 1e-12);
  assert.ok(one[5] > one[0] && one[5] > one[15]); // half-normal sigma ~11.7 deg at 40 km/h
  assert.ok(barryWeights([0, 15], 50)[0] > barryWeights([0, 15], 30)[0]); // faster riders see less yaw
});

test('spoke model: round spokes cost more than bladed, shorter spokes less', () => {
  const blade = (depth, n) => spokeModel({ spokes: [n, n], depth, bladed: true }).cda_m2;
  assert.ok(spokeModel({ spokes: [32, 32], depth: 20, bladed: false }).cda_m2 > 4 * blade(20, 32));
  assert.ok(blade(50, 24) < blade(24, 24));
  const r = spokeModel({ spokes: [32, 32], depth: 20, bladed: false });
  assert.ok(r.rot_W > 5 && r.rot_W < 25, `rotational loss ${r.rot_W} W for 64 round spokes at 40 km/h`);
});

test('matrix study weights every build against Fulcrum + 23 on the angles both have', () => {
  const mk = (key, yaw, CdA) => ({ case: key + yaw, yaw_deg: yaw, dx_mm: 8, CdA_m2: CdA, drag_N: CdA * 74.3, side_force_N: -yaw / 2, protocol: 'standard', cad: MATRIX.find((m) => m.key === key).cad, drag_by_group_N: {} });
  const cases = [mk('fu23', 0, 0.10), mk('fu23', 10, 0.18), mk('st28', 0, 0.098), mk('st28', 10, 0.16), mk('st25', 0, 0.097), mk('fu23', 5, 0.13),
    { ...mk('st28', 5, 0.01), protocol: 'static' }]; // a static case never mixes in
  const st = matrixStudy(cases, c, P);
  const r = Object.fromEntries(st.rows.map((x) => [x.key, x]));
  assert.ok(r.fu25.missing && r.st23.missing);
  assert.deepEqual(r.st28.yaws, [0, 10]);
  assert.equal(r.fu23.dTunnel, 0);
  const w = barryWeights([0, 10]);
  assert.ok(Math.abs(r.st28.dTunnel - (w[0] * -0.002 + w[10] * -0.02)) < 1e-12);
  assert.ok(r.st28.dSpokes < 0); // shorter spokes on the deep rim
  assert.ok(r.st28.gain.kmhUp > r.st28.gain.kmhBase);
  assert.equal(r.st28.price, 360 + 170 + 60);
});
