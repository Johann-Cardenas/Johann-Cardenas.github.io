// Steady-state road-cycling power model. Pure functions, no DOM.
//   P * eta = 0.5 rho CdA (v + w)^2 v + Crr m g cos(theta) v + m g sin(theta) v
// The standard point-mass balance (Martin et al., 1998, J. Appl. Biomech. 14:276-291) without
// the wheel-rotation and bearing terms, which are small against the uncertainty in CdA.
export const G = 9.80665;

/** Air density from temperature and altitude (ISA barometric formula, dry air). */
export function airDensity(tempC = 20, altitude_m = 220) {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * altitude_m, 5.25588);
  return p / (287.05 * (tempC + 273.15));
}

export function resistances({ v, cda, crr, mass, grade = 0, rho = 1.2, wind = 0 }) {
  const th = Math.atan(grade), va = v + wind;
  return {
    aero: 0.5 * rho * cda * va * Math.abs(va) * v,
    rolling: crr * mass * G * Math.cos(th) * v,
    gravity: mass * G * Math.sin(th) * v,
  };
}

/** Rider power (W) needed to hold speed v (m/s). */
export function power(o) {
  const r = resistances(o);
  return (r.aero + r.rolling + r.gravity) / (o.eta ?? 0.975);
}

/** Speed (m/s) held by rider power P. Bisection: power() is monotonic in v for v + wind > 0. */
export function speed(o) {
  let lo = 0, hi = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (power({ ...o, v: mid }) < o.P) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Seconds to cover a distance at constant power. */
export const timeFor = (o, distance_m) => distance_m / speed(o);

/**
 * Compare two set-ups at the same rider power.
 * Returns speeds, the time difference over `distance_m`, and the power difference at the baseline speed.
 */
export function compare(base, alt, distance_m = 40000) {
  const v0 = speed(base), v1 = speed(alt);
  return {
    v0, v1,
    dt_s: distance_m / v1 - distance_m / v0,
    dP_W: power({ ...alt, v: v0 }) - base.P,
  };
}
