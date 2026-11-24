import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pairCases, weightedDelta, roadGains, YAW_WEIGHTS, barryWeights, spokeModel, matrixStudy, MATRIX, matrixGrid, referenceConfig, MATRIX_YAWS, deltaNoise, Q_TUNNEL, REPEAT_N, wattsOf } from '../js/model/study.js';
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
  // restricted to a yaw set, every build is weighted over exactly those angles
  const only = matrixStudy(cases, c, P, { yaws: [0] });
  assert.deepEqual(only.rows.find((x) => x.key === 'st28').yaws, [0]);
  assert.ok(Math.abs(only.rows.find((x) => x.key === 'st28').dTunnel + 0.002) < 1e-12);
});

test('matrix grid: cells, deltas at the same yaw, the shared yaws and progress', () => {
  const se = { drag_se_N: 0.1 };
  const mk = (key, yaw, CdA, extra = {}) => ({ case: key + yaw, yaw_deg: yaw, dx_mm: 8, CdA_m2: CdA, drag_N: CdA * Q_TUNNEL, side_force_N: -yaw, protocol: 'standard', cad: MATRIX.find((m) => m.key === key).cad, uncertainty: se, ...extra });
  const cases = [mk('fu23', 0, 0.110), mk('fu23', 5, 0.130), mk('fu23', -5, 0.131), mk('st28', 0, 0.105), mk('st28', 5, 0.124), mk('fu25', 0, 0.1102),
    mk('st28', -5, 0.12, { protocol: 'static' })]; // a static case is never a matrix cell
  const g = matrixGrid(cases);
  assert.deepEqual(g.yaws, MATRIX_YAWS);
  assert.equal(g.total, 42); assert.equal(g.done, 6); assert.equal(g.builds, 3); assert.equal(g.complete, false);
  assert.deepEqual(g.common, [0]); // fu25 has only 0 deg so far
  const row = (k) => g.rows.find((r) => r.key === k), cell = (k, y) => row(k).cells[g.yaws.indexOf(y)];
  assert.equal(row('st23').done, 0);
  assert.equal(cell('st28', -5).case, null);
  assert.ok(Math.abs(cell('st28', 5).dCdA + 0.006) < 1e-12);
  assert.equal(cell('fu23', 0).dCdA, null); // the baseline is not compared with itself
  // noise: two batch-mean errors of the pair, never below the run-to-run repeatability
  assert.ok(Math.abs(cell('st28', 0).noise - 2 * Math.hypot(0.1, 0.1) / Q_TUNNEL) < 1e-15);
  assert.ok(Math.abs(deltaNoise({}, {}) - REPEAT_N / Q_TUNNEL) < 1e-15);
  assert.ok(Math.abs(cell('fu25', 0).dCdA) < cell('fu25', 0).noise); // 0.2 cm2 is inside the noise
  // an off-sweep angle that was run gets its own column
  assert.deepEqual(matrixGrid([...cases, mk('fu23', 20, 0.2)]).yaws, [...MATRIX_YAWS, 20]);
  // without the installed build there is nothing to share
  assert.deepEqual(matrixGrid(cases.filter((x) => !x.case.startsWith('fu23'))).common, []);
  assert.ok(Math.abs(wattsOf(0.001) - 0.5 * 1.204 * 0.001 * (40 / 3.6) ** 3) < 1e-12);
});

test('matrix road gains use the tunnel reference build, not whatever tyre is fitted now', () => {
  const ref = referenceConfig(c);
  assert.equal(ref.tires, 'tires_rubino_pro_23');
  assert.notEqual(c.default_config.tires, ref.tires); // the real bike has moved on to the Corsa N.EXT
  const mk = (key, CdA) => ({ case: key, yaw_deg: 0, dx_mm: 8, CdA_m2: CdA, drag_N: CdA * 74.3, side_force_N: 0, protocol: 'standard', cad: MATRIX.find((m) => m.key === key).cad, drag_by_group_N: {} });
  const st = matrixStudy([mk('fu23', 0.126), mk('st23', 0.126)], c, P);
  const at40 = (k) => st.rows.find((r) => r.key === k).gain.at.find((x) => x.kmh === 40);
  // same Rubino tyres as the reference: no rolling difference, and the reference row is exactly zero
  assert.ok(Math.abs(at40('fu23').saved_W) < 1e-9);
  assert.ok(Math.abs(at40('st23').rolling_W) < 0.5); // only the carbon-wheel mass differs
});
