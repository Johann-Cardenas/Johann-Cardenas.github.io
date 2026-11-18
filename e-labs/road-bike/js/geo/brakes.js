// Dual-pivot rim calipers. Built in a local frame on the mounting bolt: +Z along the bolt away
// from the frame, +Y toward the rim, +X lateral. The reach is solved so the pads meet the brake track.
//
// Shape follows the owner's BR-5700 photos: a broad gloss-black main arm on the centre bolt that
// carries the white SHIMANO / 105 print, runs out to a round cable-anchor boss on the cable side and
// down the far side to its pad; behind it the secondary arm on the offset pivot, with a tower that
// holds the knurled silver barrel adjuster and the quick-release lever; cartridge pad holders with
// silver hex fixing nuts outside the arm ends.
import * as T from 'three';
import { V, sweep, spline, rod, merge, lathe, boltHead, plate, polarShape, lerp, smooth, canvasTexture } from './kit.js';

/** Arm print as a texture on the sweep (u along the arm, v round the section; v = 0.25 is +Z). */
function armPrint(M, color, logo, rotate) {
  const W = 1024, H = 256;
  const tex = canvasTexture(W, H, (c) => {
    c.fillStyle = color; c.fillRect(0, 0, W, H);
    if (rotate) { c.translate(W, H); c.rotate(Math.PI); }
    // u: 1 px = ~0.1 mm along the arm; v: 1 px = ~0.18 mm across, so glyphs are widened by 1.8
    c.fillStyle = '#efefec'; c.textBaseline = 'middle'; c.textAlign = 'left';
    c.save(); c.translate(300, H * 0.29); c.scale(1.8, 1); c.transform(1, 0, -0.22, 1, 0, 0);
    c.font = `italic 900 ${logo.length > 3 ? 26 : 38}px "Arial Black", Arial, sans-serif`;
    c.lineWidth = 2; c.strokeStyle = '#efefec'; c.strokeText(logo, 0, 0); c.fillText(logo, 0, 0);
    const lw = c.measureText(logo).width * 1.8; c.restore();
    c.save(); c.translate(300 + lw * 0.42, H * 0.18); c.scale(1.8, 1);
    c.font = '700 13px Arial, sans-serif'; c.fillText('SHIMANO', 0, 0); c.restore();
  }, {});
  M.textures.push(tex);
  return tex;
}

export function buildCaliper(B, mount, axle, { steer, cableSide }) {
  const { M } = B, bp = B.part('brakes'), vis = bp?.visual ?? {}, padVis = B.part('brake_pads')?.visual ?? {};
  const Zl = mount.axis.clone().normalize();
  const toAxle = axle.clone().sub(mount.bolt);
  const Yl = toAxle.clone().addScaledVector(Zl, -toAxle.dot(Zl)).normalize();
  const Xl = Yl.clone().cross(Zl).normalize();
  const k = 21; // arm plane offset from the mounting face
  // reach: |bolt + k Zl + r Yl - axle| = brake-track radius
  const d = mount.bolt.clone().addScaledVector(Zl, k).sub(axle), b = d.dot(Yl), c = d.lengthSq() - B.brakeTrackR ** 2;
  const reach = -b - Math.sqrt(Math.max(b * b - c, 0));
  const cs = Math.sign(Xl.z || 1) * cableSide; // +1 puts the cable on local +X
  const basis = new T.Matrix4().makeBasis(Xl, Yl, Zl).setPosition(mount.bolt);
  const L = (x, y, z = k) => V(cs * x, y, z);
  const xp = B.rimWidth / 2 + 7.5;
  const kM = k + 3.5, kC = k - 4.5;              // main arm in front, secondary arm behind
  const name = bp?.name || '', logo = /ultegra/i.test(name) ? 'ULTEGRA' : '105';
  const color = B.P.f_caliper && B.P.f_caliper !== 'auto' ? B.P.f_caliper : vis.color || '#1b1c1f';
  const xform = (list) => { for (const g of list) g.applyMatrix4(basis); return list; };

  // ---- main arm: cable-anchor boss -> over the centre bolt -> down the far side to its pad
  const mainPath = spline([L(xp + 13, -2, kM), L(xp + 3, -5.5, kM), L(8, -5, kM), L(-5, -3, kM), L(-xp + 2, 2.5, kM), L(-xp - 5.5, 14, kM),
    L(-xp - 6, reach - 22, kM - 1), L(-xp - 3.5, reach - 7, kM - 2.5), L(-xp - 2.5, reach, kM - 3)], 64);
  const mainSec = (u) => ({ a: u < 0.32 ? lerp(5.6, 9.6, smooth(u / 0.32)) : lerp(9.6, 5.2, smooth((u - 0.32) / 0.6)), b: lerp(3.9, 3.1, u), n: 3.8 });
  const mainArm = sweep(mainPath, mainSec, { seg: 24, side: V(0, 0, 1), capRound: true });
  const anchorBoss = lathe([[0.01, kM - 4.5], [6.6, kM - 4.5], [7, kM - 3.2], [7, kM + 3], [6.2, kM + 4.3], [0.01, kM + 4.3]], 28).translate(cs * (xp + 13), -2, 0);
  // ---- secondary arm: offset-pivot boss -> across to the cable side -> down to its pad; tower to the barrel
  const cPath = spline([L(-17, -12.5, kC), L(-4, -16.5, kC), L(10, -15, kC), L(xp + 3.5, -8, kC), L(xp + 7, 9, kC),
    L(xp + 6, reach - 21, kC + 0.5), L(xp + 3.5, reach - 7, kC + 1.5), L(xp + 2.5, reach, kC + 2)], 56);
  const cArm = sweep(cPath, (u) => ({ a: u < 0.4 ? lerp(5.5, 7, smooth(u / 0.4)) : lerp(7, 5, smooth((u - 0.4) / 0.6)), b: 3.2, n: 3.2 }), { seg: 20, side: V(0, 0, 1), capRound: true });
  const tower = sweep(spline([L(xp + 2, -9, kC), L(xp + 6, -17, kC + 1.5), L(xp + 8, -24, kC + 3)], 14), (u) => ({ a: lerp(5.5, 4.6, u), b: 3.4, n: 3 }), { seg: 16, side: V(0, 0, 1), capRound: true });
  const pivotBoss = lathe([[0.01, kC - 4], [6.2, kC - 4], [6.5, kC + 3.4], [5.4, kC + 4.4], [0.01, kC + 4.6]], 24).translate(cs * -17, -12.5, 0);
  // mounting bracket round the centre bolt (frame side)
  const back = lathe([[3.1, -1], [8, -1], [8.6, 1], [8.6, kC - 4], [6.5, kC - 2.5], [3.1, kC - 2.5]], 28);
  const sepArm = [cArm, tower, pivotBoss, back];
  xform([mainArm, anchorBoss, ...sepArm]);

  const mainMat = new T.MeshPhysicalMaterial({ color: 0xffffff, map: armPrint(M, color, logo, cs < 0), roughness: 0.3, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.15, name: 'caliper_main' });
  const armMat = M.aluBlack.clone(); armMat.color.set(color); armMat.roughness = 0.32; armMat.metalness = 0.45; armMat.name = 'caliper';
  B.add('brakes', mainArm, mainMat, { steer, name: 'Caliper main arm' });
  B.add('brakes', merge([anchorBoss, ...sepArm]), armMat, { steer, name: 'Caliper secondary arm and bracket' });

  // ---- hardware: centre bolt, offset pivot, centring screw, cable anchor bolt and washer
  const hw = [rod(V(0, 0, -6), V(0, 0, kM - 4), 3.1)];
  hw.push(rod(L(-17, -12.5, kC - 6), L(-17, -12.5, kC + 4.8), 2.4), lathe([[0.01, 0], [3.4, 0], [3.4, 1.2], [2.6, 1.8], [0.01, 1.9]], 18).translate(cs * -17, -12.5, kC + 4.4));
  hw.push(rod(L(-xp + 1, -3, kM), L(-xp + 2.6, -8.6, kM), 1.5, 1.5, 10), rod(L(-xp + 2.6, -8.6, kM), L(-xp + 2.9, -9.8, kM), 2.2, 2.2, 12)); // spring-centring screw on the arm's shoulder
  hw.push(lathe([[2.6, 0], [6.4, 0], [6.4, 0.9], [2.6, 0.9]], 24).translate(cs * (xp + 13), -2, kM + 4.3));
  hw.push(boltHead(7.4, 3.2).translate(cs * (xp + 13), -2, kM + 5.2));
  B.add('brakes', merge(xform(hw)), M.bolt, { steer, name: 'Pivot, centring and anchor bolts' });

  // ---- barrel adjuster (knurled silver, on top of the tower) and the quick-release lever
  const bTop = -38, bx = xp + 8, bz = kC + 3;
  const knurl = plate(polarShape((a) => 4.6 + 0.28 * Math.cos(a * 22), 132), 9);
  knurl.rotateX(Math.PI / 2); knurl.translate(cs * bx, -29.5, bz);       // plate extrudes along Z; turn it onto Y
  const barrel = merge([knurl, rod(L(bx, -24, bz), L(bx, -25, bz), 3.6, 4.6, 20), rod(L(bx, -34, bz), L(bx, bTop, bz), 3.3, 3.3, 18)]);
  const qr = sweep(spline([L(bx + 3, -25, bz + 4.5), L(bx + 8, -18, bz + 5.5), L(bx + 10, -6, bz + 5), L(bx + 9, 2, bz + 4)], 14),
    (u) => ({ a: lerp(3.6, 2.8, u) + 0.9 * smooth((u - 0.7) / 0.3), b: 1.5, n: 2.6 }), { seg: 12, side: V(0, 0, 1), capRound: true });
  const qrPivot = rod(L(bx + 3, -25, bz - 1), L(bx + 3, -25, bz + 6.5), 2.6, 2.6, 16);
  xform([barrel, qr, qrPivot]);
  B.add('brakes', barrel, M.aluSilver, { steer, name: 'Barrel adjuster' });
  B.add('brakes', merge([qr, qrPivot]), armMat, { steer, name: 'Brake quick-release lever' });

  // ---- cartridge holders, black pads, silver hex fixing nuts outside the arm ends
  const holders = [], pads = [], nuts = [];
  for (const s of [-1, 1]) {
    const along = (x, y, len) => [V(x, y, k - len / 2), V(x, y, k + len / 2)];
    const h = sweep(along(s * (xp - 0.6), reach, 47), { a: 2.3, b: 5.25, n: 5 }, { seg: 20, capRound: true });
    const lip = new T.BoxGeometry(2.4, 2.2, 47); lip.translate(s * (xp - 3.2), reach - 4.6, k); // the holder's retaining lip
    const post = rod(V(s * (xp + 1.6), reach, k), V(s * (xp + 3), reach, k), 4.4, 4.4, 16);   // shoe washer against the arm
    const p = sweep(along(s * (xp - 4.4), reach, 43), { a: 2.8, b: 4.2, n: 6 }, { seg: 20 });
    holders.push(h, lip, post); pads.push(p);
    nuts.push(lathe([[2.4, 0], [4.5, 0], [4.7, 0.6], [4.7, 5.2], [4.3, 5.8], [2.4, 5.8]], 6).rotateY(s * Math.PI / 2).translate(s * (xp + 2.4), reach, k));
    nuts.push(rod(V(s * (xp - 0.6), reach, k + 23.6), V(s * (xp - 0.6), reach, k + 25), 1.6, 1.6, 10));        // cartridge pin screw
  }
  const hg = merge(xform(holders)), pg = merge(xform(pads)), ng = merge(xform(nuts));
  B.add('brakes', hg, armMat, { steer, name: 'Pad holders' });
  B.add('brakes', ng, M.chrome, { steer, name: 'Pad fixing nuts' });
  const padMat = M.rubber.clone(); padMat.color.set(B.P.f_pad && B.P.f_pad !== 'auto' ? B.P.f_pad : padVis.color || '#1c1c1c'); padMat.name = 'pad';
  B.add('brake_pads', pg, padMat, { steer, name: 'Brake pads' });
  // where the housing ends, in world coordinates
  return { adjuster: L(bx, bTop, bz).applyMatrix4(basis), reach };
}
