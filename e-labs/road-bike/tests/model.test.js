import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hardpoints, derive, fit } from '../js/model/derived.js';
import { gearTable, steps, range, capacityNeeded, chainLinks, sequence, rollout } from '../js/model/gearing.js';
import { power, speed, airDensity, compare } from '../js/model/physics.js';
import { tubeSection, solveFrame, buildModel, loadCases, analyse, stiffness } from '../js/model/frame-fe.js';
import { beltPath } from '../js/model/belt.js';

const geom = JSON.parse(readFileSync(new URL('../data/geometry.json', import.meta.url), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} +- ${tol}, got ${a}`);

test('hardpoints reproduce the stored values and the Python generator', () => {
  const hp = hardpoints(geom);
  for (const [k, v] of Object.entries(geom.hardpoints_mm)) v.forEach((x, i) => near(hp[k][i], x, 0.06, k));
});

test('derived geometry: effective top tube, trail and wheelbase', () => {
  const d = derive(geom, { tireWidth: 23, crank: 170 });
  near(d.effective_top_tube_mm, 520.1, 0.1);
  near(d.wheelbase_mm, 973.8, 0.1);
  near(d.trail_mm, (334 * Math.cos(72 * Math.PI / 180) - 50) / Math.sin(72 * Math.PI / 180), 1e-9);
  near(d.axle_to_crown_mm, 371.7, 0.5);
  assert.ok(d.spindle_to_tire_mm > 60 && d.spindle_to_tire_mm < 110);
  assert.equal(derive(geom).spindle_to_tire_mm, null, 'no crank length, no clearance figure');
});

test('fit: a longer stem moves the bar along the stem axis only', () => {
  const p = geom.fit_defaults, a = fit(geom, p), b = fit(geom, { ...p, stem_length_mm: p.stem_length_mm + 10 });
  near(Math.hypot(b.bar[0] - a.bar[0], b.bar[1] - a.bar[1]), 10, 1e-9);
  near(Math.hypot(a.saddle[0], a.saddle[1]), p.saddle_height_mm, 1e-9);
});

test('gearing: 50/34 x 11-28', () => {
  const cogs = [11, 12, 13, 14, 15, 17, 19, 21, 24, 28], rings = [50, 34];
  const rows = gearTable({ rings, cogs, tireWidth: 23, cadence: 90 });
  assert.equal(rows.length, 20);
  const top = rows.find((r) => r.ring === 50 && r.cog === 11);
  near(top.development_m, (50 / 11) * rollout(23), 1e-12);
  near(top.speed_kmh, 51.5, 0.3); // 4.545 x 2.0986 m x 90 rpm
  assert.equal(capacityNeeded(rings, cogs), 33);
  near(range(rings, cogs).pct, (50 / 11) / (34 / 28) * 100, 1e-9);
  assert.ok(steps(cogs).every((s) => s.pct > 6 && s.pct < 17.5));
  assert.ok(rows.find((r) => r.ring === 50 && r.cog === 28).cross, 'big-big is cross-chained');
  assert.ok(rows.find((r) => r.ring === 34 && r.cog === 11).cross, 'small-small is cross-chained');
  assert.ok(!rows.find((r) => r.ring === 50 && r.cog === 15).cross);
  assert.ok(sequence(rows).length < 20);
  const n = chainLinks({ rings, cogs, chainstay: 410 });
  assert.ok(n % 2 === 0 && n >= 104 && n <= 110, `chain links ${n}`);
});

test('power model: closed form, inverse, monotonic', () => {
  const o = { cda: 0.32, crr: 0.005, mass: 85, rho: 1.2, eta: 1, grade: 0 };
  near(power({ ...o, v: 10 }), 0.5 * 1.2 * 0.32 * 1000 + 0.005 * 85 * 9.80665 * 10, 1e-9);
  near(power({ ...o, v: speed({ ...o, P: 200 }) }), 200, 1e-6);
  assert.ok(speed({ ...o, P: 200, grade: 0.05 }) < speed({ ...o, P: 200 }));
  near(airDensity(15, 0), 1.225, 0.002);
  const c = compare({ ...o, P: 200 }, { ...o, P: 200, crr: 0.004 });
  assert.ok(c.dt_s < 0 && c.dP_W < 0);
  near(c.dP_W, -0.001 * 85 * 9.80665 * c.v0, 1e-6);
});

test('beam element: cantilever bending, torsion and extension match closed forms', () => {
  const sec = tubeSection(15, 11, 2), E = 70000, G = 27000, L = 500, n = 5;
  const nodes = Array.from({ length: n + 1 }, (_, i) => [i * L / n, 0, 0]);
  const elements = Array.from({ length: n }, (_, i) => ({ n1: i, n2: i + 1, E, G, sec, member: 'm' }));
  const fixed = [0, 1, 2, 3, 4, 5].map((d) => [0, d]);
  const tip = n * 6;
  let s = solveFrame({ nodes, elements, fixed, loads: [[n, 1, -100]] });
  near(s.u[tip + 1], -100 * L ** 3 / (3 * E * sec.Iz), 1e-9, 'bending y');
  near(s.results[0].ends[0].Mz, 100 * L, 1e-6, 'root moment');
  s = solveFrame({ nodes, elements, fixed, loads: [[n, 2, 100]] });
  near(s.u[tip + 2], 100 * L ** 3 / (3 * E * sec.Iy), 1e-9, 'bending z');
  assert.ok(sec.Iz > sec.Iy, 'the taller axis is the stiffer one');
  s = solveFrame({ nodes, elements, fixed, loads: [[n, 3, 5000]] });
  near(s.u[tip + 3], 5000 * L / (G * sec.J), 1e-12, 'torsion');
  s = solveFrame({ nodes, elements, fixed, loads: [[n, 0, 1000]] });
  near(s.u[tip], 1000 * L / (E * sec.A), 1e-12, 'extension');
  // a circular thin tube: Bredt J approaches 2 pi r^3 t
  const thin = tubeSection(20, 20, 0.2);
  near(thin.J / (2 * Math.PI * 19.9 ** 3 * 0.2), 1, 1e-6);
  near(thin.Iy, thin.Iz, 1e-9);
});

test('beam element: an inclined member gives the same tip deflection as an axis-aligned one', () => {
  const sec = tubeSection(12, 9, 1.5), E = 65000, G = 25000, L = 400;
  const c = Math.cos(0.7), sn = Math.sin(0.7);
  const s = solveFrame({ nodes: [[0, 0, 0], [L * c, L * sn, 0]], elements: [{ n1: 0, n2: 1, E, G, sec, member: 'm' }], fixed: [0, 1, 2, 3, 4, 5].map((d) => [0, d]), loads: [[1, 0, -50 * sn], [1, 1, 50 * c]] });
  near(Math.hypot(s.u[6], s.u[7]), 50 * L ** 3 / (3 * E * sec.Iz), 1e-9);
});

test('frame model: every load case is in equilibrium and symmetric where it should be', () => {
  const model = buildModel(geom, { fitPts: fit(geom, geom.fit_defaults) });
  const lcs = loadCases(model, { mass_kg: 75 });
  for (const [id, lc] of Object.entries(lcs)) {
    const r = analyse(model, lc);
    r.equilibrium.forEach((e) => near(e, 0, 1e-6 * lc.ref * 1000, id));
    assert.ok(Number.isFinite(r.peak) && r.peak > 0, id);
  }
  const seated = analyse(model, lcs.seated), n = model.named;
  near(seated.disp(n.BB)[2], 0, 1e-9, 'symmetric load, no lateral motion');
  near(seated.disp(n.RD_L)[1], seated.disp(n.RD_R)[1], 1e-9);
  assert.ok(seated.disp(n.SADDLE)[1] < 0 && seated.disp(n.BB)[1] < 0);
  assert.ok(Math.abs(analyse(model, lcs.pedalling).disp(n.BB)[2]) > 1e-4, 'pedalling load is asymmetric');
});

test('frame model: thicker walls are stiffer and heavier; results are in a physical range', () => {
  const fp = fit(geom, geom.fit_defaults);
  const a = buildModel(geom, { fitPts: fp }), b = buildModel(geom, { fitPts: fp, laminate: { wallScale: 1.5 } });
  const sa = stiffness(a), sb = stiffness(b);
  assert.ok(sb.bb_N_per_mm > sa.bb_N_per_mm && sb.torsion_Nm_per_deg > sa.torsion_Nm_per_deg);
  assert.ok(b.tubeMass_g > a.tubeMass_g * 1.3);
  assert.ok(a.tubeMass_g > 500 && a.tubeMass_g < 2500, `tube mass ${a.tubeMass_g}`);
  assert.ok(sa.bb_N_per_mm > 20 && sa.bb_N_per_mm < 2000, `bb ${sa.bb_N_per_mm}`);
  assert.ok(sa.torsion_Nm_per_deg > 20 && sa.torsion_Nm_per_deg < 400, `torsion ${sa.torsion_Nm_per_deg}`);
  const double = stiffness(buildModel(geom, { fitPts: fp, laminate: { E: 130000 } }));
  assert.ok(double.torsion_Nm_per_deg > sa.torsion_Nm_per_deg * 1.5, 'modulus drives stiffness');
});

test('belt path: two equal pulleys, and a derailleur S-bend closes on itself', () => {
  const two = beltPath([{ c: [0, 0], r: 10, s: -1 }, { c: [100, 0], r: 10, s: -1 }]);
  near(two.length, 2 * 100 + 2 * Math.PI * 10, 1e-9);
  const cs = [[0, 0], [-360, -40], [-385, 5], [-404, 72]];
  const s = beltPath([{ c: cs[0], r: 101, s: -1 }, { c: cs[1], r: 22.5, s: -1 }, { c: cs[2], r: 22.5, s: 1 }, { c: cs[3], r: 42, s: -1 }]);
  const a = s.at(0), b = s.at(s.length);
  near(a.x, b.x, 1e-6); near(a.y, b.y, 1e-6);
  for (let d = 0; d < s.length; d += 12.7) { const p = s.at(d), q = s.at(d + 12.7); assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= 12.7 + 1e-6); }
  // every straight run is tangent: perpendicular to the radius where it leaves the circle
  s.tang.forEach((t, i) => near((t.p1[0] - cs[i][0]) * Math.cos(t.dir) + (t.p1[1] - cs[i][1]) * Math.sin(t.dir), 0, 1e-6));
});
