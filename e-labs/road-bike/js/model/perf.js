// Turns a configuration and the rider inputs into the inputs of the power model, and records
// where each number came from. Pure, no DOM.
import { airDensity, power, speed, resistances } from './physics.js';
import { summarize } from '../state.js';

/** Typical drag areas by position. Published ranges, not measured for this rider. */
export const POSITIONS = {
  tops: { cda: 0.40, label: 'Tops' },
  hoods: { cda: 0.36, label: 'Hoods' },
  drops: { cda: 0.32, label: 'Drops' },
  aero: { cda: 0.27, label: 'Aerobars' },
};
export const CDA_SOURCE = 'Typical ranges for road positions (Debraux et al., 2011, Sports Biomechanics 10:197–218). An estimate, not a measurement of this rider.';
export const ASSUMED_BIKE_KG = 8.8;
export const GENERIC_CRR = 0.0045;
export const ETA = 0.975;

export function setup(cfg, catalog, P) {
  const parts = new Map(catalog.components.map((p) => [p.id, p]));
  const notes = [];
  const tire = parts.get(cfg.tires), tube = parts.get(cfg.tubes);
  let crr = tire?.perf?.crr, crrBasis = tire?.perf?.crr_basis ?? null;
  if (!Number.isFinite(crr)) { crr = GENERIC_CRR; crrBasis = 'No drum-test figure for this tyre; a generic clincher value is used, so no rolling-resistance gain is claimed.'; notes.push(crrBasis); }
  if (Number.isFinite(tube?.perf?.crr_factor)) crr *= tube.perf.crr_factor;
  // A tubeless drum figure on a bike that runs inner tubes: add the tube's loss (butyl here).
  if (tire?.perf?.crr_setup === 'tubeless' && Number.isFinite(tire?.perf?.crr) && Number.isFinite(tube?.perf?.crr_add_tubeless)) {
    crr += tube.perf.crr_add_tubeless;
    crrBasis = `${crrBasis} Plus ${tube.perf.crr_add_tubeless} for the butyl tube.`;
  }
  let pos = P.position;
  if (pos === 'aero' && !cfg.aerobar) { pos = 'drops'; notes.push('No aerobar fitted: the drops position is used.'); }
  const cda = POSITIONS[pos].cda;
  const weighed = P.bike_kg > 0;
  let bike = weighed ? P.bike_kg : ASSUMED_BIKE_KG;
  const sum = summarize(cfg, catalog);
  if (sum.changedCount) {
    if (sum.deltaMass_g == null) notes.push('The mass change of this proposal is unknown for at least one part, so bike mass is left unchanged.');
    else bike += sum.deltaMass_g / 1000;
  }
  if (!weighed) notes.push(`Bike mass is assumed (${ASSUMED_BIKE_KG} kg) until the bike is weighed (M16).`);
  const mass = P.rider_kg + P.kit_kg + bike;
  return { cda, crr, crrBasis, position: pos, bike_kg: bike, bikeWeighed: weighed, mass, rho: airDensity(P.temp_c, P.altitude_m), eta: ETA, grade: P.grade_pct / 100, notes, deltaMass_g: sum.deltaMass_g };
}

/** Speed at the rider's power, the split of that power, and a power-speed curve. */
export function evaluate(su, P) {
  const o = { cda: su.cda, crr: su.crr, mass: su.mass, rho: su.rho, eta: su.eta, grade: su.grade };
  const v = speed({ ...o, P: P.power_w }), r = resistances({ ...o, v });
  const curve = [];
  for (let kmh = 10; kmh <= 60; kmh += 1) curve.push([kmh, power({ ...o, v: kmh / 3.6 })]);
  return { v, kmh: v * 3.6, split: { aero: r.aero / su.eta, rolling: r.rolling / su.eta, gravity: r.gravity / su.eta, drivetrain: P.power_w * (1 - su.eta) }, curve, o };
}
