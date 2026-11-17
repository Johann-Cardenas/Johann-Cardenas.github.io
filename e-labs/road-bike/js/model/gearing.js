// Drivetrain arithmetic. Pure functions, no DOM.
import { wheelRadius } from './derived.js';

export const PITCH_MM = 12.7;
export const rollout = (tireWidth) => 2 * Math.PI * wheelRadius(tireWidth) / 1000; // metres per wheel turn

/** Every ring x cog combination. Chain angle uses the 10-speed cog pitch and a 43.5 mm chainline. */
export function gearTable({ rings, cogs, tireWidth = 23, cadence = 90, chainstay = 410, cogPitch = 3.95, ringPitch = 7.0 }) {
  const circ = rollout(tireWidth), rows = [];
  const cogs_ = [...cogs].sort((a, b) => a - b), n = cogs_.length;
  rings.forEach((ring, ri) => {
    cogs_.forEach((cog, ci) => {
      const ratio = ring / cog;
      // lateral offset between ring and cog; the smallest cog is outboard
      const order = [...rings].sort((a, b) => a - b).indexOf(ring); // the largest ring is outboard
      const zRing = (order - (rings.length - 1) / 2) * ringPitch;
      const zCog = ((n - 1) / 2 - ci) * cogPitch;
      const skew = Math.atan2(Math.abs(zRing - zCog), chainstay) * 180 / Math.PI;
      rows.push({
        ring, cog, ratio,
        development_m: ratio * circ,
        gear_inches: ratio * 2 * wheelRadius(tireWidth) / 25.4,
        speed_kmh: ratio * circ * cadence * 60 / 1000,
        skew_deg: skew,
        cross: skew > 2.3,
      });
    });
  });
  return rows;
}

/** Percentage jump between neighbouring cogs, smallest first. */
export function steps(cogs) {
  const c = [...cogs].sort((a, b) => a - b);
  return c.slice(1).map((v, i) => ({ from: c[i], to: v, pct: (v / c[i] - 1) * 100 }));
}

/** Shift sequence: distinct ratios in order, each with the combination that gives it the straightest chain. */
export function sequence(rows, tol = 0.02) {
  const sorted = [...rows].sort((a, b) => a.ratio - b.ratio), out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.ratio / last.ratio - 1 < tol) { if (r.skew_deg < last.skew_deg) out[out.length - 1] = r; } else out.push(r);
  }
  return out;
}

export function range(rings, cogs) {
  const lo = Math.min(...rings) / Math.max(...cogs), hi = Math.max(...rings) / Math.min(...cogs);
  return { lo, hi, pct: (hi / lo) * 100 };
}

/** Chain wrap the rear derailleur must take up. */
export const capacityNeeded = (rings, cogs) => (Math.max(...rings) - Math.min(...rings)) + (Math.max(...cogs) - Math.min(...cogs));

/**
 * Chain length by the big-big rule: wrap the largest ring and largest cog directly (no derailleur),
 * then add one full link pair (two pitches). Returns a whole even number of pitches.
 */
export function chainLinks({ rings, cogs, chainstay = 410 }) {
  const F = Math.max(...rings), R = Math.max(...cogs), C = chainstay / PITCH_MM;
  // exact open-belt length in pitches for two sprockets
  const rf = F / (2 * Math.PI), rr = R / (2 * Math.PI); // pitch radii in pitches (approximation N*p = 2*pi*r)
  const b = Math.asin(Math.min(1, (rf - rr) / C));
  const L = 2 * C * Math.cos(b) + (Math.PI + 2 * b) * rf + (Math.PI - 2 * b) * rr;
  let links = Math.ceil(L) + 2;
  if (links % 2) links += 1;
  return links;
}

export const cadenceAt = (speed_kmh, ratio, tireWidth = 23) => (speed_kmh * 1000 / 60) / (ratio * rollout(tireWidth));
