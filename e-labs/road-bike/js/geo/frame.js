// Frame, fork and headset. Sections come from data/geometry.json (tubes), which is illustrative
// until the tube measurements (M09) and reference photos replace it.
import * as T from 'three';
import { V, sweep, spline, lathe, plate, rod, lerp, smooth, place, linkShape, circlePath, boltHead, merge } from './kit.js';
import { tubePaint } from './materials.js';

const pick = (spec, u, k) => {
  if (spec.mid) return u <= 0.5 ? lerp(spec.start[k], spec.mid[k], smooth(u / 0.5)) : lerp(spec.mid[k], spec.end[k], smooth((u - 0.5) / 0.5));
  return lerp(spec.start[k], spec.end[k], u);
};
/** Section function for a tube spec, with a moulded flare where it meets its neighbours. */
function sectionOf(spec, { flare0 = 0, flare1 = 0, len0 = 0.1, len1 = 0.1 } = {}) {
  return (u) => {
    const f = 1 + flare0 * (1 - smooth(u / len0)) + flare1 * (1 - smooth((1 - u) / len1));
    return { a: pick(spec, u, 'a') * f, b: pick(spec, u, 'b') * f, n: pick(spec, u, 'n') };
  };
}

export function buildFrame(B) {
  const { hp, M, P, geom } = B, tb = geom.tubes;
  const { bb, ra, ht, hb, st } = hp, up = B.up, fwd = B.fwd;
  const sAxis = st.clone().sub(bb).normalize();
  const slot = 'frameset';

  // ---- main triangle -------------------------------------------------------------------------
  B.add(slot, sweep(spline([hb.clone().addScaledVector(up, -3), hb.clone().lerp(ht, 0.5), ht.clone().addScaledVector(up, 3)], 14),
    (u) => ({ a: pick(tb.head_tube, u, 'a'), b: pick(tb.head_tube, u, 'b') }), { seg: 44 }), tubePaint(M, P, 'head'), { name: 'Head tube' });

  const dtTop = hb.clone().addScaledVector(up, 34);
  B.add(slot, sweep(spline([bb, bb.clone().lerp(dtTop, 0.5).add(V(3, -3, 0)), dtTop], 40), sectionOf(tb.down_tube, { flare0: 0.10, flare1: 0.16, len0: 0.08, len1: 0.10 }), { seg: 40 }),
    tubePaint(M, P, 'down'), { name: 'Down tube' });

  const ttFront = ht.clone().addScaledVector(up, -26), ttRear = bb.clone().addScaledVector(sAxis, geom.seat_tube_mm - 30);
  const ttMid = ttRear.clone().lerp(ttFront, 0.5).add(V(1.5, 8, 0));
  B.add(slot, sweep(spline([ttRear, ttMid, ttFront], 40), (u) => sectionOf({ start: tb.top_tube.end, end: tb.top_tube.start }, { flare0: 0.22, flare1: 0.20, len0: 0.09, len1: 0.10 })(u), { seg: 36 }),
    tubePaint(M, P, 'top'), { name: 'Top tube' });

  B.add(slot, sweep(spline([bb, bb.clone().lerp(st, 0.5), st.clone().addScaledVector(sAxis, 6)], 36), sectionOf(tb.seat_tube, { flare0: 0.12, len0: 0.1 }), { seg: 36 }),
    tubePaint(M, P, 'seat'), { name: 'Seat tube' });

  // bottom-bracket shell (BB30: 68 mm wide, 42 mm bore)
  const w = geom.interfaces.bb_shell_width_mm / 2, bore = geom.interfaces.bb_bore_mm / 2;
  B.add(slot, lathe([[bore, -w], [bore + 5.5, -w], [bore + 8, -w + 4], [bore + 9, 0], [bore + 8, w - 4], [bore + 5.5, w], [bore, w]], 56), M.paint, { name: 'Bottom-bracket shell' });
  B.add(slot, lathe([[bore - 0.4, -w - 0.2], [bore - 0.4, w + 0.2]], 40), M.hole, { name: 'Bottom-bracket bore', shadow: false });

  // ---- rear triangle -------------------------------------------------------------------------
  const slope = (ra.y - bb.y) / (ra.x - bb.x);
  const csPaint = tubePaint(M, P, 'chainstay'), ssPaint = tubePaint(M, P, 'stay');
  const ssTop = bb.clone().addScaledVector(sAxis, geom.seat_tube_mm - 40);
  const dropTop = V(ra.x + 5, ra.y + 17, 0), dropFront = V(ra.x + 24, ra.y - 2, 0);
  const brakeR = B.brakeTrackR + geom.interfaces.brake_reach_mm;
  // brake bridge sits where the stay line is `brakeR` from the axle
  const stayDir = ssTop.clone().sub(dropTop).normalize();
  let tB = 0; for (let i = 0; i < 400; i++) { tB = i; if (dropTop.clone().addScaledVector(stayDir, i).distanceTo(ra) >= brakeR) break; }
  const bridge = dropTop.clone().addScaledVector(stayDir, tB);
  B.rearBrake = { bolt: bridge.clone(), axis: V(-stayDir.y, stayDir.x, 0).multiplyScalar(-1).normalize() }; // points rearward
  if (B.rearBrake.axis.x > 0) B.rearBrake.axis.negate();
  const perp = V(-stayDir.y, stayDir.x, 0);
  for (const s of [-1, 1]) {
    const cs = [[-6, 1, 21], [-42, 7, 28], [-88, 15, 33], [-210, 36, 47], [-320, 57, 59]].map(([x, y, z]) => V(x, y ?? -slope * x, s * z));
    cs.push(V(dropFront.x, dropFront.y, s * 63.5));
    B.add(slot, sweep(spline(cs, 44), sectionOf(tb.chainstay, { flare0: 0.2, len0: 0.07 }), { seg: 26 }), csPaint, { name: 'Chainstay' });
    const at = (f, z, off = 0) => ssTop.clone().lerp(dropTop, f).addScaledVector(perp, off).setZ(s * z);
    const ss = [at(0, 9), at(0.09, 19, 1), at(0.28, 29, 4), at(0.55, 43, 1), at(0.82, 56, -3), at(1, 62.5)];
    B.add(slot, sweep(spline(ss, 48), sectionOf(tb.seat_stay, { flare0: 0.35, len0: 0.08 }), { seg: 24 }), ssPaint, { name: 'Seat stay' });
    // dropout: plate from the stay ends to the axle slot
    const dz = s * (geom.interfaces.rear_oln_mm / 2 + 3);
    const sh = new T.Shape();
    sh.moveTo(dropFront.x - ra.x + 6, dropFront.y - ra.y + 7); sh.lineTo(dropTop.x - ra.x + 7, dropTop.y - ra.y + 6);
    sh.lineTo(dropTop.x - ra.x - 6, dropTop.y - ra.y + 4); sh.quadraticCurveTo(-16, 6, -13, -6);
    sh.quadraticCurveTo(-8, -14, 4, -13); sh.lineTo(dropFront.x - ra.x + 2, dropFront.y - ra.y - 8); sh.closePath();
    sh.holes.push(circlePath(0, 0, 5.2));
    B.add(slot, place(plate(sh, 6, { bevel: 0.6 }), V(ra.x, ra.y, dz)), M.aluBlack, { name: 'Rear dropout' });
  }
  // derailleur hanger (replaceable, drive side)
  B.hanger = V(ra.x - 8, ra.y - 28, 0);
  const hg = plate((() => { const s = linkShape(Math.hypot(8, 28), 11, 8.5, 0.8); s.holes.push(circlePath(0, 0, 5.2)); s.holes.push(circlePath(Math.hypot(8, 28), 0, 4.6)); return s; })(), 5, { bevel: 0.5 });
  g2(hg, Math.atan2(-28, -8)); B.add(slot, place(hg, V(ra.x, ra.y, geom.interfaces.rear_oln_mm / 2 + 2.5)), M.aluSilver, { name: 'Derailleur hanger' });
  // brake bridge
  B.add(slot, sweep([bridge.clone().setZ(-31), bridge.clone().setZ(-10), bridge.clone().setZ(10), bridge.clone().setZ(31)], (u) => ({ a: 6.5 + 2.5 * (1 - Math.abs(u - 0.5) * 2), b: 5.5 }), { seg: 18, side: perp, cap: false }), M.paint, { name: 'Brake bridge' });

  // seat clamp collar and bolt
  const collar = st.clone().addScaledVector(sAxis, 0);
  B.add(slot, sweep([collar.clone().addScaledVector(sAxis, -6), collar.clone().addScaledVector(sAxis, 7)], 19.6, { seg: 36 }), M.aluBlack, { name: 'Seat clamp' });
  const sBack = V(-sAxis.y, sAxis.x, 0); // rearward normal of the seat tube
  B.add(slot, rod(collar.clone().addScaledVector(sBack, 21).setZ(-9), collar.clone().addScaledVector(sBack, 21).setZ(9), 3.2), M.bolt, { name: 'Seat clamp bolt' });

  // bottle bosses and cable stops (small hardware that reads at close range)
  B.bosses = { down: [150, 214].map((d) => bb.clone().lerp(dtTop, d / bb.distanceTo(dtTop))), seat: [118, 182].map((d) => bb.clone().addScaledVector(sAxis, d)) };
  const dtDir = dtTop.clone().sub(bb).normalize(), dtUp = V(-dtDir.y, dtDir.x, 0);
  B.frameAxes = { dtDir, dtUp, sAxis, sFront: sBack.clone().negate(), dtTop, ttFront, ttRear, ttMid };
  const stops = [];
  for (const s of [-1, 1]) stops.push(place(rodZ(3.2, 9), dtTop.clone().addScaledVector(dtDir, -62).add(V(0, 0, s * 25.5)), dtDir));
  B.add(slot, merge(stops), M.aluBlack, { name: 'Cable stops' });
}

function g2(g, a) { g.rotateZ(a); return g; }
function rodZ(r, h) { const g = new T.CylinderGeometry(r, r, h, 14); g.rotateX(Math.PI / 2); return g; }

export function buildFork(B) {
  const { hp, M, P, geom } = B, tb = geom.tubes, { hb, ht, fa } = hp, up = B.up, fwd = B.fwd;
  const slot = 'frameset', steer = true;
  const L = B.derived.axle_to_crown_mm, rake = geom.fork_rake_mm;
  const at = (d, f, z) => hb.clone().addScaledVector(up, -d).addScaledVector(fwd, f).setZ(z);
  const bend = (d) => rake * Math.max(0, (d - 90) / (L - 90)) ** 2.1;
  const paint = tubePaint(M, P, 'fork');
  const dEnd = L - 17;
  for (const s of [-1, 1]) {
    const pts = [at(9, 0, 0), at(11, 0, s * 16), at(19, 0, s * 34), at(34, 0, s * 46), at(60, 0, s * 51)];
    for (const d of [110, 170, 230, 280, 320]) pts.push(at(d, bend(d), s * 52.5));
    pts.push(at(dEnd, bend(dEnd), s * 53));
    B.add(slot, sweep(spline(pts, 64), (u) => {
      const k = smooth(u / 0.16); // crown shoulder -> blade
      return { a: lerp(15, pick(tb.fork_blade, u, 'a'), k), b: lerp(23, pick(tb.fork_blade, u, 'b'), k), n: lerp(2.6, pick(tb.fork_blade, u, 'n'), k) };
    }, { seg: 28, side: fwd, transport: true, capRound: true }), paint, { steer, name: 'Fork blade' });
    // dropout
    const tip = at(dEnd, bend(dEnd), 0), len = tip.distanceTo(fa);
    const sh = linkShape(len, 7.5, 10.5, 0.85); sh.holes.push(circlePath(len, 0, 4.7));
    const g = plate(sh, 5.5, { bevel: 0.5 }); g.rotateZ(Math.atan2(fa.y - tip.y, fa.x - tip.x));
    B.add(slot, place(g, V(tip.x, tip.y, s * (geom.interfaces.front_oln_mm / 2 + 2.75))), M.aluBlack, { steer, name: 'Fork dropout' });
  }
  // crown, crown race and steerer
  B.add(slot, sweep([hb.clone().addScaledVector(up, 1), hb.clone().addScaledVector(up, -6), hb.clone().addScaledVector(up, -22)], (u) => ({ a: lerp(26, 20, u), b: lerp(26, 24, u), n: 2.3 }), { seg: 36, side: fwd }), M.paint, { steer, name: 'Fork crown' });
  const top = ht.clone().addScaledVector(up, 15 + P.spacers_mm + 40 + 1);
  B.add(slot, rod(hb, top, geom.interfaces.steerer_mm / 2, geom.interfaces.steerer_mm / 2, 28), M.carbonMatte, { steer, name: 'Steerer' });
  // headset top cover
  const cov = lathe([[26, 0], [25.5, 2], [20, 11], [17.6, 15], [14.4, 15]], 48);
  B.add(slot, place(cov, ht, up), M.aluBlack, { steer, name: 'Headset cover' });
  B.frontBrake = { bolt: hb.clone().addScaledVector(up, -14).addScaledVector(fwd, 23), axis: fwd.clone() };
  B.add(slot, place(boltHead(8, 3), B.frontBrake.bolt.clone().addScaledVector(fwd, -47), fwd.clone().negate()), M.bolt, { steer, name: 'Brake nut' });
}
