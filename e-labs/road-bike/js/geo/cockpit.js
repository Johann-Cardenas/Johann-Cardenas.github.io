// Cockpit: spacers, stem, compact drop bar, tape, STI levers, cables, and what clamps to the bar.
// Everything here turns with the fork, except the frame end of each cable.
import * as T from 'three';
import { finish } from './materials.js';
import { V, AX, sweep, spline, rod, lathe, plate, merge, place, lerp, smooth, rad, boltHead, roundRect, filletPath, circlePath, canvasTexture } from './kit.js';

export function buildCockpit(B) {
  const { M, P, hp, fit } = B, up = B.up, steer = true;
  const base = V(...fit.stemBase), dir = V(...fit.stemDir), C = V(...fit.bar);
  const stemVis = B.part('stem')?.visual ?? {}, barVis = B.part('handlebar')?.visual ?? {};

  // ---- spacers, stem, top cap -----------------------------------------------------------------
  const sp = [];
  let h = 15;
  for (let left = P.spacers_mm; left > 0.5;) { const t = left >= 10 ? 10 : 5; sp.push(place(lathe([[14.4, 0.25], [17, 0.25], [17.6, 0.9], [17.6, t - 0.9], [17, t - 0.25], [14.4, t - 0.25]], 36), hp.ht.clone().addScaledVector(up, h), up)); h += t; left -= t; }
  if (sp.length) B.add('stem', merge(sp), finish(M.carbon, P.f_spacer, { name: 'spacer' }), { steer, name: 'Headset spacers' });
  let stemMat = M.aluBlack.clone(); stemMat.color.set(stemVis.color || '#17181a'); stemMat.name = 'stem'; stemMat = finish(stemMat, P.f_stem);
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
  const barMat = finish(barVis.carbon ? M.carbon : M.aluBlack, P.f_bar, { name: 'handlebar' });
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
    B.add('tape', place(lathe([[0.01, 0], [thick, 0], [thick + 0.6, 1.5], [thick - 1, 4], [0.01, 4.6]], 24), end, tan), finish(M.plastic, P.f_plug, { name: 'plug' }), { steer, name: 'Bar-end plug' });
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
    // shift paddle nests right behind the brake blade and follows its curve, a little shorter
    const paddle = sweep(spline([o(reach + 43, -6, -1), o(reach + 48, -26, -1), o(reach + 49, -52, 0), o(reach + 43, -80, 2.5)], 20), (u) => ({ a: 2.2, b: lerp(7.5, 6, u), n: 2.6 }), { seg: 12, capRound: true });
    const lm = M.aluBlack.clone(); lm.color.set(vis.lever || '#22242a'); lm.name = 'lever';
    B.add('shifters', merge([blade, paddle]), lm, { steer, name: 'Brake lever and shift paddle' });
    B.add('shifters', rod(o(reach + 44, 6, -11.5), o(reach + 44, 6, 11.5), 2.4), M.bolt, { steer, name: 'Lever pivot' });
    // clamp band on the bar
    const band = B.barPaths[s].filter((p) => p.x > C.x + reach - 12 && p.y > C.y - 26 && p.y < C.y - 6);
    if (band.length > 1) B.add('shifters', sweep([band[0], band[band.length - 1]], 14.4, { seg: 18, side: AX.z }), M.aluBlack, { steer, name: 'Clamp band' }); // hidden under the hood, as on the real lever
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
  if (ends.front) run([port(-1), lead(-1, 40, 4), sp(V(C.x + 30, C.y - 56, -16)), sp(ends.front.clone().add(V(4, 60, 0))), sp(ends.front)], 2.5, col, 'Front brake housing');
  // rear brake: from the right lever, along the left underside of the top tube
  if (ends.rear) {
    const a = FA.ttFront.clone().add(V(-30, -19, -13)), m = FA.ttMid.clone().add(V(0, -17, -15)), b = FA.ttRear.clone().add(V(40, -12, -12));
    run([port(1), lead(1, 40, 10), sp(V(C.x + 28, C.y - 34, 22)), a.clone().add(V(55, -6, 6)), a, m, b, b.clone().add(V(-52, -6, 12)), ends.rear.clone().add(V(14, 44, 0)), ends.rear], 2.5, col, 'Rear brake housing', 110);
  }
  // shift housings to the down-tube stops
  const stop = (s) => FA.dtTop.clone().addScaledVector(FA.dtDir, -57.5).add(V(0, 0, s * 25.5));
  for (const s of [-1, 1]) run([port(s, -6), lead(s, 52, -12), sp(V(C.x + 32, C.y - 74, s * 34)), stop(s).add(V(46, 34, s * 8)), stop(s)], 2.1, col, s > 0 ? 'Rear shift housing' : 'Front shift housing');
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
  if (!(B.cfg.light || B.cfg.computer)) return;

  // ---- combo out-front mount --------------------------------------------------------------------
  // A hinged alloy clamp on the bar beside the stem, an arm forward to the centreline, a Garmin
  // quarter-turn cradle on top for the computer and a GoPro two-prong underneath. The light hangs
  // from a GoPro-to-Garmin adapter (three prongs, thumb screw) with its own quarter-turn cradle.
  const slot = B.cfg.light ? 'light' : 'computer';
  const zc = 30, cw = 14, rIn = 16.05, rOut = 21; // clamp centre (beside the stem), width, radii
  const H = V(C.x + 80, C.y + 3, 0); // mount head centre
  const mount = [], hw = [];
  // clamp band: upper half carries the arm, lower half swings on the rear hinge, closed by one bolt
  const hingeA = rad(122), gapA = rad(-62);
  const band = (a0, a1) => place(plate(arcShape(rIn, rOut, a0, a1), cw, { bevel: 0.6 }), V(C.x, C.y, zc));
  mount.push(band(gapA + rad(5), hingeA - rad(4)), band(hingeA + rad(4), gapA + rad(355)));
  // hinge knuckles (alternating) and pin
  const kn = V(C.x + Math.cos(hingeA) * (rOut + 1.2), C.y + Math.sin(hingeA) * (rOut + 1.2), 0);
  for (const [z0, z1] of [[zc - cw / 2, zc - 2.6], [zc - 2.2, zc + 2.2], [zc + 2.6, zc + cw / 2]]) mount.push(rod(kn.clone().setZ(z0), kn.clone().setZ(z1), 3.6, 3.6, 16));
  hw.push(rod(kn.clone().setZ(zc - cw / 2 - 0.8), kn.clone().setZ(zc + cw / 2 + 0.8), 1.6, 1.6, 10));
  // closing ears either side of the split, and the bolt through them along the tangent
  const radial = (a, r) => V(C.x + Math.cos(a) * r, C.y + Math.sin(a) * r, zc);
  for (const a of [gapA + rad(8), gapA - rad(8)]) {
    const ear = rplate(10, 5, 1.5, cw - 1, 0.5); ear.rotateZ(a); const p = radial(a, rOut + 3.5); ear.translate(p.x, p.y, p.z); mount.push(ear);
  }
  const tg = V(-Math.sin(gapA), Math.cos(gapA), 0), bc = radial(gapA, rOut + 4.2);
  hw.push(rod(bc.clone().addScaledVector(tg, -7), bc.clone().addScaledVector(tg, 6.5), 1.9, 1.9, 10), place(boltHead(6.5, 3.2), bc.clone().addScaledVector(tg, 6.2), tg));
  // arm: flat-topped beam from the clamp's front face to the head
  mount.push(sweep(spline([V(C.x + 14, C.y + 3, zc), V(C.x + 34, C.y + 3, zc - 2), V(C.x + 56, C.y + 3, 10), V(C.x + 72, C.y + 3, 1), V(H.x - 4, H.y, 0)], 30),
    (u) => ({ a: lerp(cw / 2 - 0.5, 6.5, u), b: lerp(6.5, 5.5, u), n: 3.4 }), { seg: 18, side: AX.y, capRound: true }));
  // head block, Garmin cradle on top, two GoPro prongs below
  const head = rplate(36, 32, 8, 11, 1.4); head.rotateX(Math.PI / 2); head.translate(H.x, H.y, 0); mount.push(head);
  const topY = H.y + 5.5, botY = H.y - 5.5;
  mount.push(...garminCradle(V(H.x, topY, 0), 1));
  const hole = V(H.x, botY - 8.5, 0);
  for (const z of [-3, 3]) mount.push(prong(hole, 10, 1, z));
  B.add(slot, merge(mount), M.aluBlack, { steer, name: 'Out-front mount' });
  // GoPro bolt (thumb screw on the drive side, square nut opposite)
  hw.push(rod(hole.clone().setZ(-9.5), hole.clone().setZ(9.5), 2.4, 2.4, 12));
  B.add(slot, merge(hw), M.bolt, { steer, name: 'Mount hardware' });

  if (B.cfg.light) {
    // adapter: three prongs interleaved with the mount's two, a body, and a downward cradle
    const ad = [];
    for (const z of [-6, 0, 6]) ad.push(prong(hole, 9, -1, z));
    const abY = hole.y - 12.5; // adapter body centre
    const body = rplate(30, 22, 6, 8, 1.2); body.rotateX(Math.PI / 2); body.translate(H.x, abY, 0); ad.push(body);
    ad.push(...garminCradle(V(H.x, abY - 4, 0), -1));
    ad.push(place(lathe([[0.01, 0], [7.5, 0], [7.8, 1], [7.8, 4], [7.5, 5], [0.01, 5]], 14), hole.clone().setZ(7.5), AX.z)); // thumb screw
    ad.push(place(plate(roundRect(8, 8, 1), 3), hole.clone().setZ(-9), AX.z)); // captive nut
    B.add('light', merge(ad), M.plastic, { steer, name: 'Light adapter' });
    buildEvo1300(B, V(H.x + 8, abY - 4 - 4.2, 0));
  }
  if (B.cfg.computer) buildEdge540(B, V(H.x - 4, topY + 4.2, 0));
}

/** Annular Garmin quarter-turn female cradle, floor at `at`, opening toward `dirY` (+1 up, -1 down). */
function garminCradle(at, dirY) {
  const ring = lathe([[11.4, 0], [15.6, 0], [15.6, 3.4], [15.0, 4.2], [11.4, 4.2]], 32);
  ring.rotateX(-Math.PI / 2); if (dirY < 0) ring.rotateX(Math.PI);
  ring.translate(at.x, at.y, at.z);
  const out = [ring];
  for (const a of [Math.PI / 2, -Math.PI / 2]) { // locking flanges the tab lugs slide under
    const f = plate(arcShape(9.6, 11.6, a - rad(28), a + rad(28)), 1.2); f.rotateX(-Math.PI / 2); f.translate(at.x, at.y + dirY * 3.6, at.z); out.push(f);
  }
  return out;
}

/** Male quarter-turn tab: short boss with two lugs, base at `at`, protruding along `dirY`. */
function garminTab(at, dirY) {
  const g = [];
  const boss = lathe([[0.01, 0], [10.9, 0], [10.9, 4.2], [0.01, 4.2]], 28); boss.rotateX(-Math.PI / 2); if (dirY < 0) boss.rotateX(Math.PI); boss.translate(at.x, at.y, at.z); g.push(boss);
  for (const a of [0, Math.PI]) { const l = plate(arcShape(10.4, 12.6, a - rad(22), a + rad(22)), 1.2); l.rotateX(-Math.PI / 2); l.translate(at.x, at.y + dirY * 3.4, at.z); g.push(l); }
  return g;
}

/** GoPro prong: plate in the x-y plane with the bolt hole at `hole`, reaching `len` up (dir +1) or down (-1). */
function prong(hole, len, dir, z) {
  const s = new T.Shape(), w = 6.2;
  s.moveTo(-w, 0); s.lineTo(-w, dir * len); s.lineTo(w, dir * len); s.lineTo(w, 0);
  s.absarc(0, 0, w, 0, -dir * Math.PI, dir > 0); s.closePath();
  s.holes.push(circlePath(0, 0, 2.6, true, 16));
  const g = plate(s, 2.8, { bevel: 0.3 }); g.translate(hole.x, hole.y, z);
  return g;
}

/** Rounded slab whose OUTER size is w x h x depth (ExtrudeGeometry's bevel grows the outline). */
function rplate(w, h, r, depth, bevel) {
  return plate(roundRect(w - 2 * bevel, h - 2 * bevel, Math.max(r - bevel, 0.5)), depth, { bevel, curve: 14 });
}

function arcShape(r0, r1, a0, a1, n = 40) {
  const s = new T.Shape();
  for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); if (i) s.lineTo(r1 * Math.cos(a), r1 * Math.sin(a)); else s.moveTo(r1 * Math.cos(a), r1 * Math.sin(a)); }
  for (let i = n; i >= 0; i--) { const a = lerp(a0, a1, i / n); s.lineTo(r0 * Math.cos(a), r0 * Math.sin(a)); }
  s.closePath();
  return s;
}

/**
 * Magicshine EVO 1300, an under-mount light: 94 x 42 x 34.5 mm (L x W x H), 154 g, anodised alloy
 * body, cut-off lens, quarter-turn tab on top, power button with battery LED on top behind the tab,
 * USB-C under a rubber flap at the back. `top` is the centre of the body's top face under the cradle.
 */
function buildEvo1300(B, top) {
  const { M } = B, steer = true, L = 94, W = 42, Ht = 34.5;
  const c = V(top.x, top.y - Ht / 2, 0), xf = c.x + L / 2, xr = c.x - L / 2, tabX = top.x - 8;
  const body = rplate(W, Ht, 11, L, 3); body.rotateY(Math.PI / 2); body.translate(c.x, c.y, 0);
  // shallow cooling grooves along both flanks are read as thin dark bands
  B.add('light', body, M.aluBlack, { steer, name: 'Light body' });
  const grooves = [];
  for (const y of [-4, 0, 4]) for (const s of [-1, 1]) { const g = plate(roundRect(L - 30, 1.4, 0.7), 0.6); g.translate(c.x - 4, c.y + y, s * (W / 2 + 0.05)); grooves.push(g); }
  B.add('light', merge(grooves), M.hole, { steer, name: 'Cooling grooves', shadow: false });
  // front: black bezel round the cut-off lens
  const bez = plate(roundRect(W - 4, Ht - 5, 9), 2.4); bez.rotateY(Math.PI / 2); bez.translate(xf + 0.6, c.y - 0.5, 0);
B.add('light', bez, M.plasticGloss, { steer, name: 'Lens bezel' });
  const lens = plate(roundRect(W - 10, Ht - 13, 6), 1.4); lens.rotateY(Math.PI / 2); lens.translate(xf + 1.6, c.y - 1.5, 0);
  B.add('light', lens, M.lens, { steer, name: 'Lens', shadow: false });
  // top: quarter-turn tab into the adapter cradle, power button with indicator ring
  B.add('light', merge(garminTab(V(tabX, top.y, 0), 1)), M.plastic, { steer, name: 'Light mount tab' });
  const bx = xr + 15;
  B.add('light', place(lathe([[0.01, 0], [5.2, 0], [5.2, 1.4], [4.6, 2.0], [0.01, 2.1]], 24), V(bx, top.y - 0.3, 0), AX.y), M.rubber, { steer, name: 'Power button' });
  const ledM = M.lens.clone(); ledM.color.set(0x7cf2a0); ledM.emissive.set(0x2fd36a); ledM.emissiveIntensity = 0.9; ledM.transmission = 0; ledM.name = 'battery_led';
  B.add('light', place(lathe([[5.3, 0], [6.4, 0], [6.4, 0.7], [5.3, 0.7]], 24), V(bx, top.y - 0.2, 0), AX.y), ledM, { steer, name: 'Battery indicator', shadow: false });
  // rear: USB-C port under a rubber flap
  const flap = rplate(15, 7, 3, 1.6, 0.4); flap.rotateY(Math.PI / 2); flap.translate(xr - 0.4, c.y - 6, 0);
  B.add('light', flap, M.rubber, { steer, name: 'USB-C cover' });
}

/** Garmin Edge 540: 85.1 x 51.0 x 20.3 mm, 2.6 in (246 x 322) display, seven buttons. `base` = centre of the back. */
function buildEdge540(B, base) {
  const { M } = B, steer = true, L = 85.1, W = 51, D = 20.3;
  const c = V(base.x, base.y + D / 2, 0);
  const body = rplate(L, W, 9, D, 3); body.rotateX(Math.PI / 2); body.translate(c.x, c.y, 0);
  B.add('computer', body, M.plasticGloss, { steer, name: 'Computer' });
  B.add('computer', merge(garminTab(V(base.x + 4, base.y, 0), -1)), M.plastic, { steer, name: 'Computer mount tab' });
  // display: 40 x 53 mm active area behind a flush glass, top of the screen facing forward
  const glass = plate(roundRect(L - 8, W - 6, 6), 0.8); glass.rotateX(Math.PI / 2); glass.translate(c.x + 1, c.y + D / 2 + 0.1, 0);
  B.add('computer', glass, M.plasticGloss, { steer, name: 'Screen glass' });
  const scr = new T.PlaneGeometry(53, 40); scr.rotateX(-Math.PI / 2); scr.rotateY(-Math.PI / 2); scr.translate(c.x + 9, c.y + D / 2 + 0.6, 0);
  B.add('computer', scr, screenMaterial(M), { steer, name: 'Screen', shadow: false });
  // buttons: two on the left flank, three on the right, lap and start/stop on the rider's edge
  const btn = [];
  const side = (x, s) => { const b = plate(roundRect(9, 3.5, 1.6), 1.6); b.translate(c.x + x, c.y, s * (W / 2 + 0.3)); btn.push(b); };
  side(26, -1); side(8, -1); side(24, 1); side(8, 1); side(-8, 1);
  for (const z of [-12, 12]) { const b = plate(roundRect(10, 3.5, 1.6), 1.6); b.rotateY(Math.PI / 2); b.translate(c.x - L / 2 - 0.3, c.y, z); btn.push(b); }
  B.add('computer', merge(btn), M.rubber, { steer, name: 'Computer buttons' });
}

let screenTex = null;
function screenMaterial(M) {
  if (!screenTex) {
    screenTex = canvasTexture(318, 240, (g, w, h) => {
      g.fillStyle = '#0d1114'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e8edf0'; g.strokeStyle = '#3a454c'; g.lineWidth = 2;
      g.font = 'bold 15px Arial'; g.fillText('14:32', 8, 17); g.fillRect(w - 34, 6, 24, 11);
      g.beginPath(); g.moveTo(0, 24); g.lineTo(w, 24); g.moveTo(0, 118); g.lineTo(w, 118); g.moveTo(w / 2, 118); g.lineTo(w / 2, h); g.stroke();
      g.font = '13px Arial'; g.fillStyle = '#8fa0aa'; g.fillText('SPEED  km/h', 10, 42); g.fillText('POWER  W', 10, 136); g.fillText('TIME', w / 2 + 10, 136);
      g.fillStyle = '#ffffff'; g.font = 'bold 64px Arial'; g.fillText('32.4', 70, 106);
      g.font = 'bold 42px Arial'; g.fillText('212', 18, 190); g.font = 'bold 34px Arial'; g.fillText('1:24', w / 2 + 18, 188);
      g.fillStyle = '#18a9a8'; g.fillRect(10, 210, 140, 12); g.fillStyle = '#c41230'; g.fillRect(w / 2 + 10, 210, 60, 12);
    }, { flipY: true });
  }
  const m = M.screen.clone(); m.map = screenTex; m.emissiveMap = screenTex; m.emissive.set(0xffffff); m.emissiveIntensity = 0.55; m.color.set(0xffffff); m.name = 'edge_screen';
  return m;
}
