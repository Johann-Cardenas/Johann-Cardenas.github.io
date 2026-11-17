// Wheels and tyres: rim section, laced spokes, hubs, quick releases, valve, labelled tyre.
// Each wheel is built about its own axle (local origin) so it can spin.
import * as T from 'three';
import { V, AX, lathe, rod, sweep, spline, merge, place, rad, lerp } from './kit.js';
import { ringText, tireTexture } from './materials.js';

export const BSD_R = 311;          // ETRTO 622 bead seat radius
export const RIM_OUTER_R = 316.5;  // top of the hook
export const TRACK_H = 10.5;       // machined brake track height

function rimProfile(depth, width) {
  const Ro = RIM_OUTER_R, rt = Ro - TRACK_H - 0.8, rn = Ro - depth, h = width / 2;
  const side = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; side.push([lerp(rn + 0.6, rt, t), lerp(2.6, h, Math.pow(t, depth > 35 ? 0.42 : 0.6))]); }
  // counter-clockwise in (r, z): nose, out along -z, across the hooks, back along +z
  const p = [[rn, 0]];
  for (const [r, z] of side) p.push([r, -z]);
  p.push([Ro, -h], [Ro, -h + 1.7], [Ro - 5.2, -h + 2.2], [Ro - 5.2, h - 2.2], [Ro, h - 1.7], [Ro, h]);
  for (const [r, z] of [...side].reverse()) p.push([r, z]);
  p.push([rn, 0]);
  return { p, rt, rn };
}

function tireProfile(R, w, rimW) {
  const rc = R - w / 2, p = [], h = rimW / 2 - 1.2;
  p.push([RIM_OUTER_R - 2.5, -h]);
  for (let i = 0; i <= 26; i++) {
    const a = rad(-138 + (276 * i) / 26);
    p.push([rc + (w / 2) * Math.cos(a) * 1.0, (w / 2) * Math.sin(a) * 1.02]);
  }
  p.push([RIM_OUTER_R - 2.5, h]);
  return p;
}

/** Spoke end points for one wheel. Returns [{hub: V, rim: V}], local to the axle. */
function lacing(n, cross, flangeR, zL, zR, rimR) {
  const out = [];
  if (cross === 'g3') { // Campagnolo/Fulcrum triplets: two drive-side tangential, one non-drive radial
    const groups = n / 3, d = rad(4.4);
    for (let g = 0; g < groups; g++) {
      const a = (g / groups) * Math.PI * 2;
      out.push({ hub: pol(flangeR, a, zL), rim: pol(rimR, a, 0) });
      for (const s of [-1, 1]) out.push({ hub: pol(flangeR + 2, a + s * (d + rad(38)), zR), rim: pol(rimR, a + s * d, 0) });
    }
    return out;
  }
  const m = n / 2;
  for (let side = 0; side < 2; side++) for (let i = 0; i < m; i++) {
    const a = ((2 * i + side) / n) * Math.PI * 2;
    const k = cross * (i % 2 ? -1 : 1);
    out.push({ hub: pol(flangeR, a + (k * Math.PI * 2) / m, side ? zR : zL), rim: pol(rimR, a, 0) });
  }
  return out;
}
const pol = (r, a, z) => V(r * Math.cos(a), r * Math.sin(a), z);

function spokeMesh(list, mat, bladed) {
  const geo = new T.CylinderGeometry(1, 1, 1, 8, 1);
  const inst = new T.InstancedMesh(geo, mat, list.length), m = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3();
  list.forEach((s, i) => {
    const d = s.rim.clone().sub(s.hub), len = d.length(), y = d.clone().normalize();
    let z = AX.z.clone().addScaledVector(y, -y.z).normalize();
    const x = y.clone().cross(z).normalize(); z = x.clone().cross(y);
    q.setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
    sc.set(bladed ? 1.15 : 0.95, len, bladed ? 0.45 : 0.95);
    inst.setMatrixAt(i, m.compose(s.hub.clone().add(s.rim).multiplyScalar(0.5), q, sc));
  });
  inst.castShadow = true;
  return inst;
}

function quickRelease(B, slot, origin, half, front) {
  const g = [], steer = front;
  g.push(rod(V(0, 0, -half - 9), V(0, 0, half + 9), 2.5));
  // adjusting nut (drive side) and cam housing with lever (non-drive side)
  g.push(lathe([[2.5, half + 5.6], [9.5, half + 5.6], [9.5, half + 9], [6.5, half + 15], [2.5, half + 15]], 24));
  g.push(lathe([[2.5, -half - 17], [7.5, -half - 17], [9.5, -half - 12], [9.5, -half - 5.6], [2.5, -half - 5.6]], 24));
  const dir = front ? V(-0.25, 1, 0).normalize() : V(0.75, 0.66, 0).normalize();
  const z = -half - 15, a = V(0, 0, z), b = V(dir.x * 30, dir.y * 30, z - 6), c = V(dir.x * 64, dir.y * 64, z - 2);
  const lever = sweep(spline([a, b, c], 16), (u) => ({ a: lerp(5.5, 6.5, u), b: lerp(4, 2.2, u), n: 2.6 }), { seg: 14, side: AX.z, capRound: true });
  const grp = B.pivot('wheels', origin, { steer, key: 'static' });
  B.addTo(grp, merge(g), B.M.steel, 'Quick-release skewer');
  B.addTo(grp, lever, B.M.aluBlack, 'Quick-release lever');
}

export function buildWheels(B) {
  const { M, hp } = B, vis = B.part('wheels')?.visual ?? {}, tv = B.part('tires')?.visual ?? {};
  const tireW = B.tireW, R = B.R, width = vis.width ?? 20.8;
  const carbon = vis.rim === 'carbon', track = vis.track ?? 'alloy';
  const rimMat = carbon ? M.carbon : M.aluBlack, hubMat = vis.hub === 'silver' ? M.aluSilver : M.aluBlack;
  const tireMat = tireTexture(M, { label: tv.label, sidewall: tv.sidewall });
  B.rimWidth = width;

  for (const front of [true, false]) {
    const axle = front ? hp.fa : hp.ra, steer = front, key = front ? 'front' : 'rear';
    const depth = (!front && vis.depthRear) || vis.depth || 24;
    const n = (vis.spokes ?? [16, 20])[front ? 0 : 1], cross = (vis.cross ?? [0, 2])[front ? 0 : 1];
    const half = (front ? B.geom.interfaces.front_oln_mm : B.geom.interfaces.rear_oln_mm) / 2;
    const W = B.pivot('wheels', axle, { steer, key }), Tg = B.pivot('tires', axle, { steer, key });
    const { p, rt, rn } = rimProfile(depth, width);

    // rim body, machined brake tracks, decals
    B.addTo(W, lathe(p, 160), rimMat, 'Rim');
    if (track === 'alloy') {
      const h = width / 2 + 0.06;
      B.addTo(W, merge([lathe([[rt + 0.4, -h], [RIM_OUTER_R - 0.5, -h]], 160), lathe([[RIM_OUTER_R - 0.5, h], [rt + 0.4, h]], 160)]), M.aluMachined, 'Brake track');
    }
    if (vis.decal && B.P.decals !== false && depth >= 22) {
      const r1 = rt - 1.2, r0 = Math.max(rn + 2.5, rt - (depth > 35 ? 26 : 13));
      const zAt = (r) => { const t = (r - rn - 0.6) / (rt - rn - 0.6); return lerp(2.6, width / 2, Math.pow(Math.max(t, 0), depth > 35 ? 0.42 : 0.6)) + 0.08; };
      const rep = depth > 35 ? 3 : 4;
      const opts = { repeat: rep, mirror: true, size: depth > 35 ? 0.78 : 0.74, accent: vis.decalAccent };
      B.addTo(W, lathe([[r1, zAt(r1)], [r0, zAt(r0)]], 160), ringText(M, vis.decal, vis.decalColor || '#ffffff', opts), 'Rim decal', false);
      B.addTo(W, lathe([[r0, -zAt(r0)], [r1, -zAt(r1)]], 160), ringText(M, vis.decal, vis.decalColor || '#ffffff', opts), 'Rim decal', false);
    }

    // hub
    const fr = front ? 19 : 24, zL = front ? -34 : -36, zR = front ? 34 : 20;
    const body = front
      ? [[0.01, -half], [8.5, -half], [8.5, -half + 6], [11, -half + 9], [11, zL - 3.5], [fr + 2.5, zL - 2], [fr + 2.5, zL + 2], [12.5, zL + 6], [11.5, 0], [12.5, zR - 6], [fr + 2.5, zR - 2], [fr + 2.5, zR + 2], [11, zR + 3.5], [11, half - 9], [8.5, half - 6], [8.5, half], [0.01, half]]
      : [[0.01, -half], [9.5, -half], [9.5, -half + 7], [12, -half + 10], [12, zL - 3.5], [fr + 2.5, zL - 2], [fr + 2.5, zL + 2], [15, zL + 7], [14, -6], [16, zR - 7], [fr + 2.5, zR - 2], [fr + 2.5, zR + 2], [17.4, zR + 3.5], [17.4, half - 5.5], [9.5, half - 5.5], [9.5, half], [0.01, half]];
    B.addTo(W, lathe(body, 48), hubMat, 'Hub');

    // spokes and nipples
    const spokes = lacing(n, cross, fr, zL, zR, rn + 1.5);
    W.add(tag(spokeMesh(spokes, vis.hub === 'silver' ? M.steel : M.aluBlack, vis.bladed), 'wheels', 'Spokes'));
    const nip = new T.InstancedMesh(new T.CylinderGeometry(1.9, 1.9, 9, 6), M.aluSilver, spokes.length), mt = new T.Matrix4(), q = new T.Quaternion();
    spokes.forEach((s, i) => {
      const d = s.rim.clone().sub(s.hub).normalize();
      q.setFromUnitVectors(AX.y, d);
      nip.setMatrixAt(i, mt.compose(s.rim.clone().addScaledVector(d, -3), q, new T.Vector3(1, 1, 1)));
    });
    W.add(tag(nip, 'wheels', 'Spoke nipples'));

    // valve, between two spokes
    const va = rad(front ? 252 : 236) + Math.PI / n, vd = V(Math.cos(va), Math.sin(va), 0);
    const valve = [rod(vd.clone().multiplyScalar(rn + 2), vd.clone().multiplyScalar(rn - 30), 3), rod(vd.clone().multiplyScalar(rn - 1), vd.clone().multiplyScalar(rn - 4), 5, 5, 6), rod(vd.clone().multiplyScalar(rn - 30), vd.clone().multiplyScalar(rn - 38), 2, 1.6)];
    B.addTo(W, merge(valve), M.brass, 'Valve');

    // tyre
    B.addTo(Tg, lathe(tireProfile(R, tireW, width), 200), tireMat, 'Tyre');
    quickRelease(B, 'wheels', axle, half, front);
  }
}

function tag(mesh, slot, name) { mesh.userData.slot = slot; mesh.userData.part = name; mesh.receiveShadow = true; return mesh; }
