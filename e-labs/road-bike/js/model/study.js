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

/** Pair the baseline and variant cases by yaw (same lattice spacing). */
export function pairCases(cases, variantCad) {
  const base = cases.filter((c) => (c.cad ?? BASE_CAD) === BASE_CAD), up = cases.filter((c) => c.cad === variantCad);
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
export function roadGains(catalog, P, upCfg, dCdA, { km = 40, speeds = [25, 32, 40] } = {}) {
  const pos = P.position === 'aero' ? 'drops' : P.position;
  const PP = { ...P, position: pos };
  const b = setup(catalog.default_config, catalog, PP), u = setup(upCfg, catalog, PP);
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
