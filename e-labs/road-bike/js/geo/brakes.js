// Dual-pivot rim calipers. Built in a local frame on the mounting bolt: +Z along the bolt away
// from the frame, +Y toward the rim, +X lateral. The reach is solved so the pads meet the brake track.
import * as T from 'three';
import { V, sweep, spline, rod, merge, lathe, boltHead } from './kit.js';

export function buildCaliper(B, mount, axle, { steer, cableSide }) {
  const { M } = B, vis = B.part('brakes')?.visual ?? {}, padVis = B.part('brake_pads')?.visual ?? {};
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
  const xp = B.rimWidth / 2 + 7.5, sym = vis.style === 'r7000';

  const armSec = (w0, w1) => (u) => ({ a: (w0 + (w1 - w0) * u) / 2, b: 2.9, n: 4 });
  const opt = { seg: 16, side: V(0, 0, 1), capRound: true };
  // C arm: pad on the cable side, arching over the tyre to the offset pivot
  const cArm = sweep(spline([L(xp, reach + 3), L(xp + 7, reach - 15), L(xp + 10, reach - 33), L(27, sym ? -3 : -7), L(8, -18), L(-12, -14), L(-22, -4)], 44), armSec(9, 13), opt);
  // Y arm: other pad, through the centre bolt, out to the cable anchor
  const yArm = sweep(spline([L(-xp, reach + 3), L(-xp - 8, reach - 16), L(-xp - 8, reach - 33), L(-17, 3), L(0, 0), L(20, -6), L(xp + 16, 2)], 46), armSec(9, 12), opt);
  yArm.translate(0, 0, -6);
  const bolts = [rod(V(0, 0, -6), V(0, 0, k + 6), 3.1), boltHead(9, 2.6).translate(0, 0, k + 5), rod(L(-22, -4, k - 10), L(-22, -4, k + 4), 2.6), boltHead(7, 2).translate(cs * -22, -4, k + 3)];
  // cable anchor, barrel adjuster and quick-release cam
  const anchor = L(xp + 16, 2, k - 6), adj = L(xp + 12, -20, k);
  bolts.push(boltHead(7.5, 3).translate(anchor.x, anchor.y, anchor.z + 2.3));
  const barrel = merge([rod(adj, adj.clone().add(V(0, -15, 0)), 4.2, 3.6, 14), rod(adj.clone().add(V(0, -15, 0)), adj.clone().add(V(0, -19, 0)), 2.8, 2.8, 10)]);
  const qr = sweep([L(xp + 12, -16, k + 3.5), L(xp + 24, -22, k + 4.5), L(xp + 32, -36, k + 4)], (u) => ({ a: 4.5 - u, b: 1.6, n: 2.6 }), { seg: 10, capRound: true });
  const back = lathe([[3.1, -1], [9, -1], [10, 1], [10, k - 9], [6, k - 7], [3.1, k - 7]], 24);
  for (const g of [cArm, yArm, barrel, qr, back]) g.applyMatrix4(basis);
  const hw = merge(bolts); hw.applyMatrix4(basis);
  const armMat = M.aluBlack.clone(); armMat.color.set(vis.color || '#1b1c1f'); armMat.name = 'caliper';
  B.add('brakes', merge([cArm, yArm, back]), armMat, { steer, name: 'Caliper arms' });
  B.add('brakes', merge([barrel, qr]), M.aluBlack, { steer, name: 'Barrel adjuster and release' });
  B.add('brakes', hw, M.bolt, { steer, name: 'Pivot and anchor bolts' });

  // cartridge holders and pads, lying along the brake track
  const holders = [], pads = [];
  for (const s of [-1, 1]) {
    const h = new T.BoxGeometry(4.5, 10.5, 46); h.translate(s * (xp - 0.5), reach, k);
    const p = new T.BoxGeometry(5.6, 8.6, 42); p.translate(s * (xp - 5.2), reach, k);
    const post = rod(V(s * (xp + 1), reach, k), V(s * (xp + 7), reach, k), 3.2, 3.2, 10);
    holders.push(h, post); pads.push(p);
  }
  const hg = merge(holders), pg = merge(pads); hg.applyMatrix4(basis); pg.applyMatrix4(basis);
  B.add('brakes', hg, M.aluBlack, { steer, name: 'Pad holders' });
  const padMat = M.rubber.clone(); padMat.color.set(padVis.color || '#1c1c1c'); padMat.name = 'pad';
  B.add('brake_pads', pg, padMat, { steer, name: 'Brake pads' });
  // where the housing ends, in world coordinates
  return { adjuster: adj.clone().add(V(0, -19, 0)).applyMatrix4(basis), reach };
}
