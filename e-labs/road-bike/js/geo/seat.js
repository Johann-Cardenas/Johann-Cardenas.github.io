// Seatpost, saddle, bottle cages and bottles, rear light.
import * as T from 'three';
import { V, AX, sweep, spline, rod, lathe, plate, merge, place, lerp, smooth, boltHead, roundRect } from './kit.js';

export function buildSeat(B) {
  const { M, hp, fit } = B, FA = B.frameAxes, sA = FA.sAxis;
  const S = V(...fit.saddle), pv = B.part('seatpost')?.visual ?? {}, sv = B.part('saddle')?.visual ?? {};
  const railY = S.y - 50, clampC = V(S.x + 6, railY, 0);
  // post: up the seat-tube axis to just under the clamp, then a short head to the cradle
  const tTop = (railY - 14 - hp.bb.y) / sA.y, top = hp.bb.clone().addScaledVector(sA, tTop), low = hp.st.clone().addScaledVector(sA, -70);
  const postMat = (pv.style === 'leaf' ? M.carbon : M.aluBlack).clone(); postMat.color.set(pv.color || '#17181a'); postMat.name = 'seatpost';
  const post = [rod(low, top, 13.6, 13.6, 32)];
  post.push(sweep([top.clone().addScaledVector(sA, -6), top.clone().lerp(clampC, 0.55).add(V(0, 2, 0)), clampC.clone().add(V(0, -3, 0))], (u) => ({ a: lerp(13.6, 9, u), b: lerp(13.6, 15, u), n: 2.6 }), { seg: 24, capRound: true }));
  B.add('seatpost', merge(post), postMat, { name: 'Seatpost' });
  if (pv.style === 'leaf') B.add('seatpost', rod(low.clone().addScaledVector(FA.sFront, -13.7), top.clone().addScaledVector(FA.sFront, -13.7), 0.5, 0.5, 4), M.hole, { name: 'Leaf split', shadow: false });
  // two-bolt cradle
  const cradle = [rod(clampC.clone().setZ(-21), clampC.clone().setZ(21), 9.5, 9.5, 20)];
  for (const s of [-1, 1]) { const p = plate(roundRect(46, 9, 3), 7, { bevel: 0.8 }); p.translate(clampC.x, railY + 3, s * 22); cradle.push(p); }
  B.add('seatpost', merge(cradle), M.aluBlack, { name: 'Saddle clamp' });
  B.add('seatpost', merge([-17, 17].map((x) => merge([rod(V(clampC.x + x, railY - 16, 0), V(clampC.x + x, railY + 4, 0), 2.6), place(boltHead(7, 3), V(clampC.x + x, railY - 16, 0), V(0, -1, 0))]))), M.bolt, { name: 'Clamp bolts' });

  // saddle: stations [x, half-width, top drop]; x is measured forward from the saddle reference point
  const Wd = (sv.width ?? 155) / 2, Lg = sv.length ?? 270, short = sv.style === 'short';
  const st = short
    ? [[-0.50, 0.56, 5], [-0.46, 0.80, 7], [-0.36, 1.0, 6], [-0.18, 0.93, 3], [0.02, 0.62, 1], [0.20, 0.42, 0], [0.38, 0.36, 0], [0.47, 0.30, -2], [0.50, 0.17, -5]]
    : [[-0.50, 0.55, 5], [-0.46, 0.78, 7], [-0.37, 1.0, 6], [-0.22, 0.94, 3], [-0.04, 0.64, 1], [0.12, 0.40, 0], [0.30, 0.27, 0], [0.44, 0.23, -1], [0.49, 0.17, -3], [0.50, 0.11, -5]];
  const path = [], secs = [];
  for (let i = 0; i < st.length - 1; i++) for (let k = 0; k < 6; k++) {
    const t = k / 6, a = st[i], b = st[i + 1], e = smooth(t);
    const f = (i + t) / (st.length - 1), th = lerp(15, 9.5, smooth(f)) * lerp(0.55, 1, smooth(f / 0.12));
    path.push(V(S.x + 12 + lerp(a[0], b[0], t) * Lg, S.y - th + lerp(a[2], b[2], e) * 0.9 - 2, 0));
    secs.push({ a: th, b: lerp(a[1], b[1], e) * Wd, n: 2.25 });
  }
  const last = st[st.length - 1]; path.push(V(S.x + 12 + last[0] * Lg, S.y - 7 + last[2] * 0.9 - 2, 0)); secs.push({ a: 6, b: last[1] * Wd, n: 2.25 });
  const shell = sweep(path, (u, i) => secs[i], { seg: 34, capRound: true });
  B.add('saddle', shell, M.saddle, { name: 'Saddle' });
  if (short) B.add('saddle', plate(roundRect(Lg * 0.46, 15, 7.5), 2).rotateX(-Math.PI / 2).translate(S.x + 12 + Lg * 0.02, S.y - 0.6, 0), M.hole, { name: 'Pressure-relief cut-out', shadow: false });
  const rails = [];
  for (const s of [-1, 1]) rails.push(sweep(spline([V(S.x + 12 - Lg * 0.34, S.y - 20, s * Wd * 0.55), V(clampC.x - 46, railY, s * 22), V(clampC.x + 46, railY, s * 22), V(S.x + 12 + Lg * 0.40, S.y - 14, s * 9)], 30), 3.5, { seg: 10 }));
  B.add('saddle', merge(rails), M.steel, { name: 'Saddle rails' });
  B.saddleNose = V(S.x + 12 + Lg * 0.5, S.y, 0);
  B.seatpostTop = top;

  if (B.cfg.rear_light) {
    const p = hp.st.clone().addScaledVector(sA, Math.max(60, tTop - B.geom.seat_tube_mm - 95)).addScaledVector(FA.sFront, -30);
    const body = plate(roundRect(40, 98, 14), 20, { bevel: 2.5 }); body.rotateY(Math.PI / 2); body.rotateZ(Math.atan2(sA.y, sA.x) - Math.PI / 2); body.translate(p.x, p.y, 0);
    B.add('rear_light', body, M.plasticGloss, { name: 'Radar tail light' });
    const lens = plate(roundRect(30, 30, 9), 2); lens.rotateY(Math.PI / 2); lens.rotateZ(Math.atan2(sA.y, sA.x) - Math.PI / 2); lens.translate(p.x - 10.5 * -FA.sFront.x, p.y - 10.5 * -FA.sFront.y + 24, 0);
    B.add('rear_light', lens, M.lensRed, { name: 'Tail light lens', shadow: false });
    B.add('rear_light', rod(p.clone().addScaledVector(FA.sFront, 12).setZ(-12), p.clone().addScaledVector(FA.sFront, 12).setZ(12), 15, 15, 20), M.rubber, { name: 'Seatpost mount' });
  }
}

export function buildCages(B) {
  if (!B.cfg.cages) return;
  const { M, hp } = B, FA = B.frameAxes, vis = B.part('cages')?.visual ?? {};
  const mat = M.plastic.clone(); mat.color.set(vis.color || '#17181a'); mat.name = 'cage';
  const tubes = [
    { a: B.bosses.down[0], dir: FA.dtDir, out: FA.dtUp, r: 25 },
    { a: B.bosses.seat[0], dir: FA.sAxis, out: FA.sFront, r: 19 },
  ];
  for (const t of tubes) {
    const O = t.a.clone().addScaledVector(t.out, t.r), R = 37.5; // bottle radius
    const L = (along, out, z = 0) => O.clone().addScaledVector(t.dir, along).addScaledVector(t.out, out).setZ(z);
    const g = [sweep([L(-26, 2), L(118, 2)], { a: 2.2, b: 9, n: 3 }, { seg: 12, side: AX.z, capRound: true })];
    for (const s of [-1, 1]) {
      // wing that wraps the bottle, and the lower hoop that catches its base
      g.push(sweep(spline([L(96, 3, s * 8), L(92, R * 0.55, s * R * 0.92), L(60, R * 1.25, s * R * 0.86), L(34, R * 1.72, s * R * 0.5), L(26, R * 1.95, 0)], 30), { a: 2.4, b: 4.6, n: 3 }, { seg: 10, side: t.dir, transport: true, capRound: true }));
      g.push(sweep(spline([L(-22, 3, s * 7), L(-24, R * 0.6, s * R * 0.8), L(-22, R * 1.35, s * R * 0.55), L(-18, R * 1.6, 0)], 24), { a: 2.4, b: 4.2, n: 3 }, { seg: 10, side: t.dir, transport: true, capRound: true }));
    }
    B.add('cages', merge(g), mat, { name: 'Bottle cage' });
    B.add('cages', merge([0, 64].map((d) => place(boltHead(8, 2.4), L(d - 0, 4.2), t.out))), M.bolt, { name: 'Cage bolts' });
    if (B.P.bottles) {
      const prof = [[0.01, -24], [34, -24], [R, -19], [R, 96], [R - 2.5, 104], [R - 2.5, 112], [R, 118], [R, 132], [30, 150], [19, 156], [19, 163], [0.01, 163]];
      const axis = t.dir.clone(), c = O.clone().addScaledVector(t.out, R + 2.5);
      B.add('cages', place(lathe(prof, 40), c, axis), M.bottle, { name: 'Bottle' });
      B.add('cages', place(lathe([[0.01, 163], [17, 163], [18, 166], [14, 178], [9, 186], [0.01, 186]], 28), c, axis), M.plasticGloss, { name: 'Bottle cap' });
    }
  }
}
