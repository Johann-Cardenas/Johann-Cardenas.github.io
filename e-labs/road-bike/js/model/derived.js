// Derived frame geometry and rider-fit coordinates. Pure functions, no DOM.
// Frame: BB origin, +X forward, +Y up, +Z drive side, millimetres.
const rad = (d) => d * Math.PI / 180;

/** ETRTO 622 bead seat radius plus the tyre section height (taken equal to its width). */
export const BEAD_SEAT_R = 311;
export const wheelRadius = (tireWidth) => BEAD_SEAT_R + tireWidth;

/** Hardpoints from the catalog geometry (same construction as tools/hardpoints.py). */
export function hardpoints(g) {
  const ha = rad(g.head_angle_deg), sa = rad(g.seat_angle_deg);
  const ht = [g.reach_mm, g.stack_mm, 0];
  const hb = [ht[0] + g.head_tube_mm * Math.cos(ha), ht[1] - g.head_tube_mm * Math.sin(ha), 0];
  const front = (ht[1] - g.bb_drop_mm) * Math.cos(ha) / Math.sin(ha) + ht[0] + g.fork_rake_mm / Math.sin(ha);
  return {
    BB_CENTER: [0, 0, 0],
    REAR_AXLE: [-Math.sqrt(g.chainstay_mm ** 2 - g.bb_drop_mm ** 2), g.bb_drop_mm, 0],
    FRONT_AXLE: [front, g.bb_drop_mm, 0],
    HT_TOP: ht,
    HT_BOTTOM: hb,
    ST_TOP: [-g.seat_tube_mm * Math.cos(sa), g.seat_tube_mm * Math.sin(sa), 0],
  };
}

/** Steering-axis unit vectors: `up` along the steerer, `fwd` perpendicular to it, pointing forward. */
export function steerAxes(g) {
  const ha = rad(g.head_angle_deg);
  return { up: [-Math.cos(ha), Math.sin(ha), 0], fwd: [Math.sin(ha), Math.cos(ha), 0] };
}

export function derive(g, { tireWidth = 23, crank = null } = {}) {
  const hp = hardpoints(g), ha = rad(g.head_angle_deg), sa = rad(g.seat_angle_deg);
  const R = wheelRadius(tireWidth);
  const trail = (R * Math.cos(ha) - g.fork_rake_mm) / Math.sin(ha);
  const frontCenter = Math.hypot(hp.FRONT_AXLE[0], hp.FRONT_AXLE[1]);
  const dAxis = (hp.FRONT_AXLE[0] - hp.HT_BOTTOM[0]) * Math.cos(ha) - (hp.FRONT_AXLE[1] - hp.HT_BOTTOM[1]) * Math.sin(ha);
  return {
    wheelbase_mm: hp.FRONT_AXLE[0] - hp.REAR_AXLE[0],
    front_center_mm: frontCenter,
    rear_center_mm: g.chainstay_mm,
    trail_mm: trail,
    mechanical_trail_mm: trail * Math.sin(ha),
    wheel_flop_mm: trail * Math.sin(ha) * Math.cos(ha),
    bb_height_mm: R - g.bb_drop_mm,
    effective_top_tube_mm: g.reach_mm + g.stack_mm / Math.tan(sa),
    axle_to_crown_mm: dAxis,
    wheel_radius_mm: R,
    // Pedal spindle to tyre with the crank horizontal; shoe overhang is not assumed.
    spindle_to_tire_mm: crank == null ? null : frontCenter - R - crank,
    stack_reach_ratio: g.stack_mm / g.reach_mm,
  };
}

/**
 * Rider contact points from the fit parameters.
 *  saddle_height_mm  BB centre to saddle top, measured along the seat-tube line
 *  saddle_setback_mm extra rearward shift of the saddle reference from that line
 *  spacers_mm, stem_length_mm, stem_angle_deg (relative to perpendicular-to-steerer; negative drops)
 */
export function fit(g, p) {
  const hp = hardpoints(g), sa = rad(g.seat_angle_deg), ax = steerAxes(g);
  const saddle = [-p.saddle_height_mm * Math.cos(sa) - (p.saddle_setback_mm || 0), p.saddle_height_mm * Math.sin(sa), 0];
  const cap = 15, clampH = 40; // headset top cover; stem steerer clamp height
  const rise = cap + (p.spacers_mm || 0) + clampH / 2;
  const stemBase = [hp.HT_TOP[0] + ax.up[0] * rise, hp.HT_TOP[1] + ax.up[1] * rise, 0];
  const a = rad(p.stem_angle_deg || 0);
  const dir = [ax.fwd[0] * Math.cos(a) + ax.up[0] * Math.sin(a), ax.fwd[1] * Math.cos(a) + ax.up[1] * Math.sin(a), 0];
  const bar = [stemBase[0] + dir[0] * p.stem_length_mm, stemBase[1] + dir[1] * p.stem_length_mm, 0];
  return {
    saddle, stemBase, stemDir: dir, bar,
    bar_reach_mm: bar[0], bar_stack_mm: bar[1],
    saddle_to_bar_drop_mm: saddle[1] - bar[1],
    saddle_to_bar_reach_mm: bar[0] - saddle[0],
    saddle_behind_bb_mm: -saddle[0],
  };
}
