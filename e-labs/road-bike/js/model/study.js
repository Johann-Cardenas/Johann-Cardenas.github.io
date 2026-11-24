// Upgrade study: the installed bike against a variant run through the same wind tunnel, then both
// put through the road power model. Pure, no DOM.
//
//   aero     ΔCdA per yaw from paired tunnel cases (same lattice, same inflow, only the parts differ)
//   rolling  Crr of each set-up from the catalog (tubeless drum figures + the butyl-tube penalty)
//   mass     catalog masses; unknown stays unknown (bike mass is then left unchanged and said so)
import { setup, evaluate, POSITIONS } from './perf.js';
import { power } from './physics.js';

export const BASE_CAD = 'data/cad/parts';

/**
 * Share of riding time at each yaw angle, used to average the tunnel deltas. An assumption, not a
 * measurement: road riding at 30-40 km/h with a 10-15 km/h wind spends most of its time inside 10°.
 */
export const YAW_WEIGHTS = { 0: 0.35, 5: 0.35, 10: 0.2, 15: 0.1 };
export const YAW_BASIS = 'Assumed time at yaw for 30–40 km/h with a 10–15 km/h wind: 35 % at 0°, 35 % at 5°, 20 % at 10°, 10 % at 15°.';

/**
 * The tunnel reads drag high at 8 mm (sphere: Cd 0.60 at 24 cells per diameter and 0.69 at 12 against
 * 0.47–0.50), so a drag difference is scaled by 0.70–1.00, centre 0.85. The rims are only ~3 cells wide.
 */
export const RESOLUTION = { lo: 0.70, mid: 0.85, hi: 1.0, basis: 'Tunnel bias from the sphere check: a 0.49 Cd reads 0.60 at 24 cells per diameter and 0.69 at 12, so measured differences are scaled by 0.70–1.00 (centre 0.85).' };

const proto = (c) => c.protocol ?? 'static';
/** Pair a baseline and a variant by yaw (same lattice spacing and protocol). */
export function pairCases(cases, variantCad, { baseCad = BASE_CAD, protocol = 'static' } = {}) {
  const base = cases.filter((c) => (c.cad ?? BASE_CAD) === baseCad && proto(c) === protocol), up = cases.filter((c) => c.cad === variantCad && proto(c) === protocol);
  const rows = [];
  for (const u of up) {
    const b = base.find((c) => c.yaw_deg === u.yaw_deg && c.dx_mm === u.dx_mm);
    if (!b) continue;
    const groups = Object.fromEntries(Object.keys(u.drag_by_group_N).map((g) => [g, u.drag_by_group_N[g] - (b.drag_by_group_N[g] ?? 0)]));
    rows.push({ yaw: u.yaw_deg, base: b, up: u, dCdA: u.CdA_m2 - b.CdA_m2, dDrag: u.drag_N - b.drag_N, dSide: u.side_force_N - b.side_force_N, groups,
      se: Math.hypot(u.uncertainty?.drag_se_N ?? 0, b.uncertainty?.drag_se_N ?? 0) || null });
  }
  return rows.sort((a, b) => a.yaw - b.yaw);
}

/** Yaw-weighted ΔCdA over the yaws that were run (weights renormalised). Null without any pair. */
export function weightedDelta(rows, weights = YAW_WEIGHTS) {
  const use = rows.filter((r) => weights[r.yaw] != null);
  if (!use.length) return null;
  const w = use.reduce((a, r) => a + weights[r.yaw], 0);
  return { dCdA: use.reduce((a, r) => a + weights[r.yaw] * r.dCdA, 0) / w, yaws: use.map((r) => r.yaw), coverage: w };
}

/**
 * Road gains of `upCfg` over the installed build at the rider's inputs P, with the bike's ΔCdA added
 * to the variant (rider + bike CdA from the position table). Returns the speed at P.power_w, time over
 * `km`, and the watts saved at a few speeds split into aero and rolling.
 */
export function roadGains(catalog, P, upCfg, dCdA, { km = 40, speeds = [25, 32, 40], baseCfg = catalog.default_config } = {}) {
  const pos = P.position === 'aero' ? 'drops' : P.position;
  const PP = { ...P, position: pos };
  const b = setup(baseCfg, catalog, PP), u = setup(upCfg, catalog, PP);
  u.cda = b.cda + dCdA;
  const eb = evaluate(b, P), eu = evaluate(u, P);
  const o = (su) => ({ cda: su.cda, crr: su.crr, mass: su.mass, rho: su.rho, eta: su.eta, grade: su.grade });
  const at = speeds.map((kmh) => {
    const v = kmh / 3.6, pb = power({ ...o(b), v }), pu = power({ ...o(u), v });
    const aero = 0.5 * b.rho * dCdA * v ** 3 / b.eta, roll = (u.crr * u.mass - b.crr * b.mass) * 9.80665 * Math.cos(Math.atan(b.grade)) * v / b.eta;
    return { kmh, base_W: pb, up_W: pu, saved_W: pb - pu, aero_W: -aero, rolling_W: -roll };
  });
  return {
    position: POSITIONS[pos].label, cdaBase: b.cda, cdaUp: u.cda, crrBase: b.crr, crrUp: u.crr, crrBasis: u.crrBasis,
    massBase: b.mass, massUp: u.mass, massKnown: u.deltaMass_g != null, deltaMass_g: u.deltaMass_g,
    kmhBase: eb.kmh, kmhUp: eu.kmh, dt_s: km * 1000 / (eu.kmh / 3.6) - km * 1000 / (eb.kmh / 3.6), km, at, notes: [...new Set([...b.notes, ...u.notes])],
  };
}

/** Seconds lost per extra 100 g on a climb (P.power_w, `grade` %, `km` long), everything else held. */
export function climbPer100g(catalog, P, { grade = 6, km = 5 } = {}) {
  const su = setup(catalog.default_config, catalog, { ...P, grade_pct: grade });
  const t = (m) => km * 1000 / evaluate({ ...su, mass: m }, P).v;
  return t(su.mass + 0.1) - t(su.mass);
}

// ---- the standard-protocol matrix: two wheelsets x three tyre widths -------------------------------

export const MATRIX = [
  { key: 'fu23', wheels: 'wheels_fulcrum_racing_15c', tires: 'tires_rubino_pro_23', label: 'Fulcrum · 23', wheelset: 'Fulcrum Racing 15C', tyre: 23 },
  { key: 'fu25', wheels: 'wheels_fulcrum_racing_15c', tires: 'tires_gp5000_as_tr_25', label: 'Fulcrum · 25', wheelset: 'Fulcrum Racing 15C', tyre: 25 },
  { key: 'fu28', wheels: 'wheels_fulcrum_racing_15c', tires: 'tires_gp5000_as_tr_28', label: 'Fulcrum · 28', wheelset: 'Fulcrum Racing 15C', tyre: 28 },
  { key: 'st23', wheels: 'wheels_superteam_50c', tires: 'tires_rubino_pro_23', label: 'Superteam · 23', wheelset: 'Superteam 50', tyre: 23 },
  { key: 'st25', wheels: 'wheels_superteam_50c', tires: 'tires_gp5000_as_tr_25', label: 'Superteam · 25', wheelset: 'Superteam 50', tyre: 25 },
  { key: 'st28', wheels: 'wheels_superteam_50c', tires: 'tires_gp5000_as_tr_28', label: 'Superteam · 28', wheelset: 'Superteam 50', tyre: 28 },
].map((m) => ({ ...m, cad: 'data/cad/variants/' + m.key + '/parts' }));
export const MATRIX_BASE = 'fu23';

/** Catalog configuration of a matrix build: carbon rims bring carbon pads with them. */
export function matrixConfig(m, catalog) {
  return { ...catalog.default_config, wheels: m.wheels, tires: m.tires, ...(m.wheels === 'wheels_superteam_50c' ? { brake_pads: 'pads_black_prince' } : {}) };
}

/**
 * The build the tunnel compares against: Fulcrum Racing 15C on Rubino Pro 23, as photographed and as
 * run in the wind tunnel, with every other part as fitted now. Tunnel ΔCdA and rolling ΔCrr are both
 * taken against it, so a tyre change on the real bike does not mix two baselines.
 */
export function referenceConfig(catalog) {
  return matrixConfig(MATRIX.find((m) => m.key === MATRIX_BASE), catalog);
}

// erf, Abramowitz-Stegun 7.1.26 (|error| < 1.5e-7)
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
/**
 * Time at yaw after Barry (2018): at 30 mph, 70 % of riding is below 10° and 90 % below 16°. Both fit a
 * half-normal |yaw| with sigma 9.7°; yaw grows as the rider slows, so sigma scales with 48.3 / speed.
 * Each tested angle takes the probability of its ±2.5° bin; beyond the sweep is dropped and the rest
 * renormalised. A sweep with only one side folds the other side onto it.
 */
export const BARRY_BASIS = 'Barry (2018): at 30 mph riders spend 70 % of the time below 10° yaw and 90 % below 16°, which a half-normal with σ 9.7° matches; σ is scaled to the test speed (11.7° at 40 km/h). Each angle takes its ±2.5° bin; the tail past the sweep is dropped.';
export function barryWeights(yaws, kmh = 40) {
  const sig = 9.7 * 48.28 / kmh, P = (a) => erf(a / (sig * Math.SQRT2)); // P(|yaw| < a)
  const signed = yaws.some((y) => y < 0), w = {};
  for (const y of yaws) {
    const a = Math.abs(y), band = a === 0 ? P(2.5) : P(a + 2.5) - P(a - 2.5);
    w[y] = a === 0 ? band : signed ? band / 2 : band;
  }
  const tot = Object.values(w).reduce((s, v) => s + v, 0);
  for (const y of yaws) w[y] /= tot;
  return w;
}

/**
 * Spokes, by blade element. 1-2 mm spokes do not resolve on an 8 mm lattice, so the tunnel leaves them
 * out and this adds them back for every build alike. Each spoke is radial from the hub flange to the
 * rim bed; at every station the air relative to the spinning spoke splits into the in-plane part (the
 * blade's edge, or the round spoke) and the crossflow from yaw (the blade's flat). Returns the drag
 * along the apparent wind and the power it takes to keep the spokes turning.
 */
export const SPOKE = { roundD: 2.0e-3, roundCd: 1.1, bladeT: 0.9e-3, bladeEdgeCd: 0.6, bladeW: 2.3e-3, bladeFlatCd: 1.2, hubR: 0.02,
  basis: 'Blade element over radial spokes: round 2.0 mm Cd 1.1; bladed 0.9 × 2.3 mm, Cd 0.6 on the edge (in-plane flow) and 1.2 on the flat (crossflow). Cylinder and flat-plate values from the literature; an estimate, not a measurement.' };
export function spokeModel(vis, { U = 40 / 3.6, yaw = 0, tireW = 23, rho = 1.204 } = {}) {
  const b = Math.abs(yaw) * Math.PI / 180, Rw = (311 + tireW) / 1000, Vg = U * Math.cos(b), om = -Vg / Rw;
  const air = [-U * Math.cos(b), 0, U * Math.sin(b)], wdir = air.map((x) => x / U);
  const kT = vis.bladed ? SPOKE.bladeEdgeCd * SPOKE.bladeT : SPOKE.roundCd * SPOKE.roundD;
  const kZ = vis.bladed ? SPOKE.bladeFlatCd * SPOKE.bladeW : SPOKE.roundCd * SPOKE.roundD;
  let drag = 0, rot = 0;
  const spokes = vis.spokes ?? [20, 24];
  for (const w of [0, 1]) {
    const n = spokes[w], depth = (w && vis.depthRear) || vis.depth || 24, rRim = (316.5 - depth) / 1000, N = 24, dl = (rRim - SPOKE.hubR) / N;
    for (let ph = 0; ph < 4; ph++) for (let k = 0; k < n; k++) {
      const th = 2 * Math.PI * (k + ph / 4) / n, c = Math.cos(th), s = Math.sin(th);
      for (let j = 0; j < N; j++) {
        const r = SPOKE.hubR + (j + 0.5) * dl, vs = [-om * r * s, om * r * c, 0];
        const rel = [air[0] - vs[0], air[1] - vs[1], air[2] - vs[2]];
        const vt = -rel[0] * s + rel[1] * c, vz = rel[2];
        const ft = 0.5 * rho * kT * vt * Math.abs(vt) * dl, F = [ft * -s, ft * c, 0.5 * rho * kZ * vz * Math.abs(vz) * dl];
        drag += (F[0] * wdir[0] + F[1] * wdir[1] + F[2] * wdir[2]) / 4;
        rot -= (F[0] * vs[0] + F[1] * vs[1]) / 4;
      }
    }
  }
  const q = 0.5 * rho * U * U;
  return { drag_N: drag, rot_W: rot, cda_m2: drag / q + rot / (q * U) };
}

/**
 * The whole matrix against the installed build (Fulcrum + 23), standard protocol only. For every build:
 * yaw-weighted tunnel CdA over the angles both builds have, the spoke model at the same angles, and the
 * road result at the rider's inputs (tunnel differences scaled by RESOLUTION.mid; the spoke model is not).
 */
export function matrixStudy(cases, catalog, P, { kmh = 40, protocol = 'standard', yaws: only = null } = {}) {
  const parts = new Map(catalog.components.map((p) => [p.id, p]));
  const std = cases.filter((c) => (c.protocol ?? 'static') === protocol);
  const of = (m) => std.filter((c) => c.cad === m.cad).sort((a, b) => a.yaw_deg - b.yaw_deg);
  const base = MATRIX.find((m) => m.key === MATRIX_BASE), baseCases = of(base), ref = referenceConfig(catalog);
  if (!baseCases.length) return null;
  const rows = [];
  for (const m of MATRIX) {
    const mc = of(m), yaws = mc.map((c) => c.yaw_deg).filter((y) => baseCases.some((b) => b.yaw_deg === y) && (!only || only.includes(y)));
    if (!yaws.length) { rows.push({ ...m, missing: true }); continue; }
    const w = barryWeights(yaws, kmh), at = (list, y) => list.find((c) => c.yaw_deg === y);
    const vis = parts.get(m.wheels).visual, bvis = parts.get(base.wheels).visual;
    let cda = 0, bcda = 0, sp = 0, bsp = 0, side = 0, bside = 0, var2 = 0;
    for (const y of yaws) {
      if (m.key !== MATRIX_BASE) var2 += w[y] ** 2 * ((at(mc, y).uncertainty?.drag_se_N ?? 0) ** 2 + (at(baseCases, y).uncertainty?.drag_se_N ?? 0) ** 2);
      cda += w[y] * at(mc, y).CdA_m2; bcda += w[y] * at(baseCases, y).CdA_m2;
      side += w[y] * Math.abs(at(mc, y).side_force_N); bside += w[y] * Math.abs(at(baseCases, y).side_force_N);
      sp += w[y] * spokeModel(vis, { yaw: y, tireW: m.tyre }).cda_m2; bsp += w[y] * spokeModel(bvis, { yaw: y, tireW: base.tyre }).cda_m2;
    }
    const dTunnel = cda - bcda, dSpokes = sp - bsp, dCdA = dTunnel * RESOLUTION.mid + dSpokes;
    const cfg = matrixConfig(m, catalog);
    const g = roadGains(catalog, P, cfg, dCdA, { baseCfg: ref }), gAir = roadGains(catalog, P, ref, dCdA, { baseCfg: ref });
    let price = 0;
    for (const k of ['wheels', 'tires', 'brake_pads']) if (cfg[k] !== ref[k]) price += parts.get(cfg[k])?.price_usd ?? NaN;
    // two standard errors of the weighted tunnel difference (batch means, yaws independent), as it reaches dCdA
    const se2 = 2 * Math.sqrt(var2) / Q_TUNNEL * RESOLUTION.mid;
    rows.push({ ...m, yaws, weights: w, cda, dTunnel, dSpokes, dCdA, se2, side, dSide: side - bside, cases: mc, gain: g, kmhAir: gAir.kmhUp - gAir.kmhBase, price });
  }
  return { rows, base: baseCases, kmh };
}

// ---- the matrix as a grid: what has been run, and each cell against the installed build -------------

/** The full sweep: −15° to +15° in 5° steps. */
export const MATRIX_YAWS = [-15, -10, -5, 0, 5, 10, 15];
/** Dynamic pressure at the tunnel speed (40 km/h, 20 °C), Pa: turns a force into a drag area. */
export const Q_TUNNEL = 0.5 * 1.204 * (40 / 3.6) ** 2;
/** Two independent runs of the installed build at 0° differ by this much drag (N). */
export const REPEAT_N = 0.041;

/**
 * Smallest drag-area difference (m²) the tunnel can tell apart for a pair of cases: two standard errors
 * of the pair (batch means over each averaging window), never less than the run-to-run repeatability.
 */
export function deltaNoise(a, b, q = Q_TUNNEL) {
  const se = Math.hypot(a?.uncertainty?.drag_se_N ?? 0, b?.uncertainty?.drag_se_N ?? 0);
  return Math.max(2 * se, REPEAT_N) / q;
}

/**
 * Build × yaw grid of the standard-protocol matrix. Every cell holds its case (or null while it waits in
 * the queue) and, where the installed build ran at the same yaw, the difference to it. Yaws are the
 * standard sweep plus any other angle that was run. `common` lists the yaws that every build with any
 * result shares with the installed build: the only fair basis for ranking while the matrix fills in.
 */
export function matrixGrid(cases, { protocol = 'standard', builds = MATRIX, base = MATRIX_BASE } = {}) {
  const std = cases.filter((c) => (c.protocol ?? 'static') === protocol);
  const yaws = [...new Set([...MATRIX_YAWS, ...std.filter((c) => builds.some((m) => m.cad === c.cad)).map((c) => c.yaw_deg)])].sort((a, b) => a - b);
  const at = (m, y) => std.find((c) => c.cad === m.cad && c.yaw_deg === y) ?? null;
  const bm = builds.find((m) => m.key === base);
  const rows = builds.map((m) => {
    const cells = yaws.map((y) => {
      const c = at(m, y), b = bm ? at(bm, y) : null;
      if (!c) return { yaw: y, case: null };
      const dCdA = b && m.key !== base ? c.CdA_m2 - b.CdA_m2 : null;
      return { yaw: y, case: c, CdA: c.CdA_m2, dCdA, noise: dCdA == null ? null : deltaNoise(c, b), dSide: dCdA == null ? null : Math.abs(c.side_force_N) - Math.abs(b.side_force_N) };
    });
    return { ...m, cells, done: cells.filter((x) => x.case).length };
  });
  const started = rows.filter((r) => r.done);
  const baseRow = rows.find((r) => r.key === base);
  const common = baseRow ? yaws.filter((y, i) => baseRow.cells[i].case && started.every((r) => r.cells[i].case)) : [];
  const done = rows.reduce((n, r) => n + r.done, 0), total = builds.length * MATRIX_YAWS.length;
  return { yaws, rows, common, done, total, builds: started.length, complete: done >= total };
}

/** Watts at `kmh` for a drag-area change (bike alone, no drivetrain loss). */
export const wattsOf = (dCdA, kmh = 40, rho = 1.204) => 0.5 * rho * dCdA * (kmh / 3.6) ** 3;
