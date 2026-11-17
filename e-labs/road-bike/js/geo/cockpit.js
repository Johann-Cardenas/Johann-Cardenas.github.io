// Cockpit: spacers, stem, compact drop bar, tape, STI levers, cables, and what clamps to the bar.
// Everything here turns with the fork, except the frame end of each cable.
import * as T from 'three';
import { V, AX, sweep, spline, rod, lathe, plate, merge, place, lerp, smooth, boltHead, roundRect, filletPath } from './kit.js';

export function buildCockpit(B) {
  const { M, P, hp, fit } = B, up = B.up, steer = true;
  const base = V(...fit.stemBase), dir = V(...fit.stemDir), C = V(...fit.bar);
  const stemVis = B.part('stem')?.visual ?? {}, barVis = B.part('handlebar')?.visual ?? {};

  // ---- spacers, stem, top cap -----------------------------------------------------------------
  const sp = [];
  let h = 15;
  for (let left = P.spacers_mm; left > 0.5;) { const t = left >= 10 ? 10 : 5; sp.push(place(lathe([[14.4, 0.25], [17, 0.25], [17.6, 0.9], [17.6, t - 0.9], [17, t - 0.25], [14.4, t - 0.25]], 36), hp.ht.clone().addScaledVector(up, h), up)); h += t; left -= t; }
  if (sp.length) B.add('stem', merge(sp), M.carbon, { steer, name: 'Headset spacers' });
  const stemMat = M.aluBlack.clone(); stemMat.color.set(stemVis.color || '#17181a'); stemMat.name = 'stem';
  const clamp = place(lathe([[14.4, -20], [19, -20], [19.8, -18.5], [19.8, 18.5], [19, 20], [14.4, 20]], 40), base, up);
  const ext = sweep([base.clone().addScaledVector(dir, 12), base.clone().addScaledVector(dir, P.stem_length_mm * 0.5), C.clone().addScaledVector(dir, -14)], (u) => ({ a: lerp(15.5, 16.5, u), b: lerp(16, 17.5, u), n: 2.9 }), { seg: 28 });
  const barClamp = place(lathe([[16, -20], [20.5, -20], [21.2, -18.5], [21.2, 18.5], [20.5, 20], [16, 20]], 40), C);
  B.add('stem', merge([clamp, ext, barClamp]), stemMat, { steer, name: 'Stem' });
  // faceplate bolts (4), pinch bolts (2), top cap
  const stemUp = V(-dir.y, dir.x, 0), hw = [];
  for (const y of [-12.5, 12.5]) for (const z of [-15, 15]) hw.push(place(boltHead(6.5, 3), C.clone().addScaledVector(dir, 20.6).addScaledVector(stemUp, y).setZ(z), dir));
  for (const o of [-10, 10]) hw.push(place(boltHead(6.5, 3), base.clone().addScaledVector(dir, -16).addScaledVector(up, o).setZ(11), AX.z));
  const capAt = base.clone().addScaledVector(up, 20);
  hw.push(place(boltHead(7, 2.4), capAt.clone().addScaledVector(up, 3.4), up));
  B.add('stem', merge(hw), M.bolt, { steer, name: 'Stem bolts' });
  B.add('stem', place(lathe([[0.01, 0], [16.5, 0], [17.4, 1], [16.5, 3.4], [0.01, 3.4]], 36), capAt, up), M.aluBlack, { steer, name: 'Top cap' });

  // ---- handlebar ------------------------------------------------------------------------------
  const W = P.bar_width_mm / 2, reach = B.geom.fit_defaults.bar_reach_mm, drop = B.geom.fit_defaults.bar_drop_mm;
  const barMat = barVis.carbon ? M.carbon : M.aluBlack;
  // centre -> tops -> ramp -> hook -> drop end  (x forward, y up, z lateral)
  const shape = (s) => [[0, 0, 0], [0, 0, W - 46], [3, 0, W - 22], [20, -1.5, W - 5], [46, -4.5, W], [reach - 4, -8, W], [reach + 11, -27, W], [reach + 9, -58, W],
    [reach - 9, -(drop - 33), W], [reach - 40, -(drop - 9), W], [reach - 76, -drop, W], [reach - 112, -drop - 1, W]].map(([x, y, z]) => V(C.x + x, C.y + y, s * z));
  const taper = (z) => lerp(15.9, 11.9, smooth((Math.abs(z) - 42) / 26));
  B.barPaths = {};
  for (const s of [-1, 1]) {
    const path = spline(shape(s), 110);
    B.barPaths[s] = path;
    B.add('handlebar', sweep(path, (u, i) => taper(path[i].z), { seg: 22, side: AX.y, transport: true, cap: false }), barMat, { steer, name: 'Handlebar' });
    // tape from the shoulder to the end, and the plug
    const i0 = path.findIndex((p) => Math.abs(p.z) > 66), tp = path.slice(i0);
    const thick = (B.part('tape')?.visual?.thick ?? 2) + 11.9;
    B.add('tape', sweep(tp, thick, { seg: 20, side: AX.y, transport: true, cap: false }), M.tape, { steer, name: 'Bar tape' });
    const end = path[path.length - 1], tan = end.clone().sub(path[path.length - 2]).normalize();
    B.add('tape', place(lathe([[0.01, 0], [thick, 0], [thick + 0.6, 1.5], [thick - 1, 4], [0.01, 4.6]], 24), end, tan), M.plastic, { steer, name: 'Bar-end plug' });
    B.add('tape', sweep([path[i0].clone(), path[i0 + 1].clone()], thick + 0.5, { seg: 20, side: AX.y, cap: false }), M.plasticGloss, { steer, name: 'Finishing tape' });
  }

  buildLevers(B, C, W, reach);
  B.barClamp = C; B.stemDir = dir;
}

function buildLevers(B, C, W, reach) {
  const { M } = B, steer = true, vis = B.part('shifters')?.visual ?? {};
  B.leverPorts = {};
  for (const s of [-1, 1]) {
    const o = (x, y, dz = 0) => V(C.x + x, C.y + y, s * (W + dz));
    // hood body: from the bar clamp band up and forward to the horn
    const body = sweep(spline([o(reach - 28, -11), o(reach - 2, -5), o(reach + 24, 0), o(reach + 43, 9), o(reach + 52, 25), o(reach + 53, 40)], 34),
      (u) => ({ a: lerp(16, 19.5, smooth(u / 0.3)) * lerp(1, 0.36, smooth((u - 0.45) / 0.55)), b: lerp(15, 16.5, smooth(u / 0.3)) * lerp(1, 0.46, smooth((u - 0.5) / 0.5)), n: 2.6 }), { seg: 26, capRound: true });
    B.add('shifters', body, M.hood, { steer, name: 'Lever hood' });
    // brake lever blade, pivoting at the front of the body
    const blade = sweep(spline([o(reach + 44, 6), o(reach + 55, -18), o(reach + 56, -50), o(reach + 49, -84, 3), o(reach + 39, -112, 7)], 30),
      (u) => ({ a: lerp(5.5, 3.4, u), b: lerp(10, 7.5, u), n: 2.9 }), { seg: 16, capRound: true });
    const paddle = sweep(spline([o(reach + 37, -8, -6), o(reach + 45, -38, -8), o(reach + 42, -70, -8)], 16), (u) => ({ a: 2.3, b: lerp(7.5, 5.5, u), n: 2.6 }), { seg: 12, capRound: true });
    const lm = M.aluBlack.clone(); lm.color.set(vis.lever || '#22242a'); lm.name = 'lever';
    B.add('shifters', merge([blade, paddle]), lm, { steer, name: 'Brake lever and shift paddle' });
    B.add('shifters', rod(o(reach + 44, 6, -11.5), o(reach + 44, 6, 11.5), 2.4), M.bolt, { steer, name: 'Lever pivot' });
    // clamp band on the bar
    const band = B.barPaths[s].filter((p) => p.x > C.x + reach - 12 && p.y > C.y - 26 && p.y < C.y - 6);
    if (band.length > 1) B.add('shifters', sweep([band[0], band[band.length - 1]], 13.4, { seg: 18, side: AX.z, cap: false }), M.steel, { steer, name: 'Clamp band' });
    B.leverPorts[s] = o(-2, 9, -W + 52); // where both cables leave the tape, beside the stem
  }
}

/** Cables and housing. Bar-side points turn with the steering; frame-side points do not. */
export function buildCables(B, ends) {
  const { M, hp } = B, FA = B.frameAxes, C = B.barClamp, col = M.housing;
  const sp = (p) => B.steerPoint(p);
  const run = (pts, r, mat, name, n = 60) => B.add('cables', sweep(spline(pts, n), r, { seg: 8, side: AX.z, transport: true }), mat, { name });
  const wire = (pts, name) => B.add('cables', sweep(filletPath(pts, 8, 4), 0.65, { seg: 6, side: AX.y, transport: true, cap: false }), M.steel, { name });
  const port = (s, dy = 0) => sp(V(C.x + 4, C.y + 6 + dy, s * 50));
  const lead = (s, dx, dy) => sp(V(C.x + dx, C.y + dy, s * 44));
  // front brake: from the left lever, forward of the head tube, down to the caliper
  if (ends.front) run([port(-1), lead(-1, 46, 4), sp(V(C.x + 62, C.y - 58, -6)), sp(ends.front.clone().add(V(4, 60, 0))), sp(ends.front)], 2.5, col, 'Front brake housing');
  // rear brake: from the right lever, along the left underside of the top tube
  if (ends.rear) {
    const a = FA.ttFront.clone().add(V(-30, -19, -13)), m = FA.ttMid.clone().add(V(0, -17, -15)), b = FA.ttRear.clone().add(V(40, -12, -12));
    run([port(1), lead(1, 48, 10), sp(V(C.x + 50, C.y - 30, 6)), a.clone().add(V(55, -6, 6)), a, m, b, b.clone().add(V(-52, -6, 12)), ends.rear.clone().add(V(14, 44, 0)), ends.rear], 2.5, col, 'Rear brake housing', 110);
  }
  // shift housings to the down-tube stops
  const stop = (s) => FA.dtTop.clone().addScaledVector(FA.dtDir, -57.5).add(V(0, 0, s * 25.5));
  for (const s of [-1, 1]) run([port(s, -6), lead(s, 52, -12), sp(V(C.x + 66, C.y - 70, s * 30)), stop(s).add(V(46, 34, s * 8)), stop(s)], 2.1, col, s > 0 ? 'Rear shift housing' : 'Front shift housing');
  // bare wires down the down tube, under the bottom bracket
  const under = (s) => V(6, -37, s * 9), start = (s) => stop(s).addScaledVector(FA.dtDir, -5);
  if (B.rdCable) {
    const cs = B.rdCable.stop;
    wire([start(1), V(34, -30, 22), under(1), V(-30, -22, 30), cs], 'Rear derailleur wire');
    run([cs, cs.clone().add(V(-70, -22, 12)), B.rdCable.adj.clone().add(V(-34, -22, 4)), B.rdCable.adj.clone().add(V(-16, 2, 0)), B.rdCable.adj], 2.1, col, 'Rear derailleur housing', 40);
    B.add('cables', rod(cs, cs.clone().add(V(9, 1.6, 0)), 3.3), M.aluBlack, { name: 'Chainstay cable stop' });
  }
  if (B.fdCable) wire([start(-1), V(34, -30, -22), under(-1), V(-16, -22, -4), V(-22, 18, 4), B.fdCable.clamp], 'Front derailleur wire');
  B.add('cables', plate(roundRect(26, 9, 3), 30).rotateX(Math.PI / 2).translate(4, -36.5, 0), M.plastic, { name: 'Bottom-bracket cable guide' });
}

/** Clip-on aerobar, front light on an out-front mount, and the computer that shares the mount. */
export function buildBarAccessories(B) {
  const { M } = B, C = B.barClamp, steer = true;
  if (B.cfg.aerobar) {
    const g = [], pads = [];
    for (const s of [-1, 1]) {
      const z = s * 62;
      g.push(sweep(spline([V(C.x - 30, C.y + 26, z), V(C.x + 60, C.y + 26, z), V(C.x + 190, C.y + 30, z * 0.9), V(C.x + 250, C.y + 58, z * 0.82), V(C.x + 268, C.y + 92, z * 0.8)], 40), 11.1, { seg: 16, capRound: true }));
      g.push(rod(V(C.x, C.y + 4, z), V(C.x, C.y + 26, z), 11, 11, 16));
      g.push(rod(V(C.x - 12, C.y + 26, z), V(C.x - 12, C.y + 60, s * 92), 5));
      const pad = plate(roundRect(92, 74, 22), 12, { bevel: 3 }); pad.rotateX(Math.PI / 2); pad.translate(C.x - 12, C.y + 66, s * 96); pads.push(pad);
    }
    B.add('aerobar', merge(g), M.aluBlack, { steer, name: 'Aerobar extensions' });
    B.add('aerobar', merge(pads), M.rubber, { steer, name: 'Arm pads' });
  }
  const hasMount = B.cfg.light || B.cfg.computer;
  if (hasMount) {
    const z = 30, m = [rod(V(C.x, C.y, z - 7), V(C.x, C.y, z + 7), 17.6, 17.6, 28),
      sweep(spline([V(C.x + 12, C.y + 3, z), V(C.x + 50, C.y + 6, z * 0.6), V(C.x + 82, C.y + 8, 0)], 20), { a: 4.5, b: 9, n: 3 }, { seg: 14, capRound: true }),
      rod(V(C.x + 84, C.y + 2, 0), V(C.x + 84, C.y + 13, 0), 16, 16, 24)];
    B.add(B.cfg.light ? 'light' : 'computer', merge(m), M.aluBlack, { steer, name: 'Out-front mount' });
  }
  if (B.cfg.light) {
    const c = V(C.x + 96, C.y - 17, 0);
    const body = plate(roundRect(46, 30, 9), 100, { bevel: 2.5 }); body.rotateY(Math.PI / 2); body.translate(c.x, c.y, c.z);
    B.add('light', body, M.aluDark, { steer, name: 'Light body' });
    const lens = plate(roundRect(40, 24, 7), 3); lens.rotateY(Math.PI / 2); lens.translate(c.x + 51, c.y, 0);
    B.add('light', lens, M.lens, { steer, name: 'Lens', shadow: false });
    B.add('light', rod(V(C.x + 84, C.y - 2, 0), V(C.x + 84, C.y + 2, 0), 12, 12, 20), M.plastic, { steer, name: 'Light bracket' });
  }
  if (B.cfg.computer) {
    const c = V(C.x + 84, C.y + 19, 0);
    const body = plate(roundRect(86, 58, 9), 14, { bevel: 2 }); body.rotateX(-Math.PI / 2); body.translate(c.x + 4, c.y, 0);
    B.add('computer', body, M.plasticGloss, { steer, name: 'Computer' });
    const scr = plate(roundRect(70, 46, 3), 0.6); scr.rotateX(-Math.PI / 2); scr.translate(c.x + 6, c.y + 7.2, 0);
    B.add('computer', scr, M.screen, { steer, name: 'Screen', shadow: false });
  }
}
