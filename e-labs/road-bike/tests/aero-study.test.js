import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pairCases, weightedDelta, roadGains, YAW_WEIGHTS } from '../js/model/study.js';
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
