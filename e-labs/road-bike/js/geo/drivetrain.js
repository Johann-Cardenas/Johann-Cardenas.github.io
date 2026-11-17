// Drivetrain: crankset, chainrings, bottom bracket, cassette, chain, derailleurs, pedals.
// Sprockets have real 1/2 in pitch tooth forms; the chain is laid link by link along the solved
// path through the derailleur, and the cage angle is whatever takes up the chain's actual length.
import * as T from 'three';
import { V, AX, lathe, plate, rod, sweep, spline, merge, place, rad, lerp, linkShape, circlePath, polarShape, sprocketShape, pitchRadius, tipRadius, beltPath, PITCH, boltHead, roundRect, filletPath } from './kit.js';
import { chainLinks } from '../model/gearing.js';

const COG_PITCH = 3.95, RING_GAP = 7.0, PULLEY_T = 11;

export function drivetrainLayout(B) {
  const crank = B.part('crankset'), cas = B.part('cassette'), rd = B.part('rear_derailleur');
  const rings = [crank?.provides?.ring_big ?? 50, crank?.provides?.ring_small ?? 34];
  const cogs = cas?.visual?.cogs ?? [11, 12, 13, 14, 15, 17, 19, 21, 24, 28];
  const cl = B.geom.interfaces.chainline_mm;
  const ringZ = [cl + RING_GAP / 2, cl - RING_GAP / 2];
  const cogZ = cogs.map((_, i) => cl + ((cogs.length - 1) / 2 - i) * COG_PITCH);
  const ri = B.P.ring === 'small' ? 1 : 0, ci = Math.min(cogs.length - 1, Math.max(0, Math.round(B.P.cog)));
  const { ra, bb } = B.hp, rp = pitchRadius(PULLEY_T), cage = rd?.visual?.cage ?? 60;
  // guide pulley tracks the cassette profile, a fixed gap below the selected cog
  const guide = V(ra.x + 7, ra.y - (tipRadius(cogs[ci]) + 9 + tipRadius(PULLEY_T)), cogZ[ci]);
  const links = chainLinks({ rings, cogs, chainstay: B.geom.chainstay_mm });
  const pathFor = (alpha) => beltPath([
    { c: [bb.x, bb.y], r: pitchRadius(rings[ri]), s: -1 },
    { c: [guide.x + cage * Math.cos(alpha), guide.y + cage * Math.sin(alpha)], r: rp, s: -1 },
    { c: [guide.x, guide.y], r: rp, s: 1 },
    { c: [ra.x, ra.y], r: pitchRadius(cogs[ci]), s: -1 },
  ]);
  // The cage spring takes up slack by swinging the tension pulley rearward: path length rises as alpha falls.
  const target = links * PITCH, aTaut = rad(-28), aSlack = rad(-172);
  let lo = aSlack, hi = aTaut, state = 'ok';
  if (pathFor(aTaut).length > target) { lo = hi = aTaut; state = 'short'; }
  else if (pathFor(aSlack).length < target) { lo = hi = aSlack; state = 'slack'; }
  else for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (pathFor(mid).length > target) lo = mid; else hi = mid; }
  const alpha = (lo + hi) / 2, path = pathFor(alpha);
  return { rings, cogs, ringZ, cogZ, ri, ci, guide, tension: V(guide.x + cage * Math.cos(alpha), guide.y + cage * Math.sin(alpha), cogZ[ci]), alpha, cage, path, links, state, rp };
}

// ---- crankset ------------------------------------------------------------------------------------
function ringGeometry(N, big) {
  const s = sprocketShape(N), root = pitchRadius(N) - 4.2, bcd = 55;
  if (big) {
    const tab = rad(11);
    const inner = polarShape((a) => {
      let d = Math.PI; for (let k = 0; k < 5; k++) { let x = Math.abs(a - (k * 2 * Math.PI) / 5); x = Math.min(x, 2 * Math.PI - x); d = Math.min(d, x); }
      const t = Math.min(1, d / tab);
      return lerp(bcd - 7, root - 13, t * t * (3 - 2 * t));
    }, 200);
    s.holes.push(new T.Path(inner.getPoints()));
  } else s.holes.push(circlePath(0, 0, bcd - 7, true, 60));
  for (let k = 0; k < 5; k++) { const a = (k * 2 * Math.PI) / 5; s.holes.push(circlePath(bcd * Math.cos(a), bcd * Math.sin(a), 4.1, true, 12)); }
  return plate(s, 2.3, { bevel: 0.35 });
}

function crankArm(len, z0, z1, style) {
  // local: root on the spindle axis, pedal eye at +X
  const path = [V(0, 0, z0), V(len * 0.25, 0, lerp(z0, z1, 0.3)), V(len * 0.7, 0, lerp(z0, z1, 0.8)), V(len, 0, z1)];
  const fat = style === 'hollowgram' ? 1.12 : style === 'r7000' ? 1.2 : 1;
  const arm = sweep(spline(path, 30), (u) => ({ a: lerp(19 * fat, 12.5, Math.pow(u, 0.8)), b: lerp(8.5 * (style === 'gossamer' ? 1 : 1.2), 6.6, u), n: 3.0 }), { seg: 24, capRound: true });
  const eye = place(lathe([[4.8, -7.2], [13.5, -7.2], [14, -5], [14, 5], [13.5, 7.2], [4.8, 7.2]], 28), V(len, 0, z1));
  const boss = place(lathe([[0.01, -9], [21, -9], [23, -6], [23, 6], [21, 9], [0.01, 9]], 36), V(0, 0, z0));
  return merge([arm, eye, boss]);
}

export function buildCrankset(B, L) {
  const { M } = B, part = B.part('crankset'), vis = part?.visual ?? {}, bbv = B.part('bottom_bracket')?.visual ?? {};
  const len = B.P.crank_length_mm, G = B.pivot('crankset', B.hp.bb, { key: 'crank' });
  const armMat = vis.style === 'hollowgram' ? M.aluDark : M.aluBlack;
  // drive arm points along +X at crank_deg = 0; the left arm is opposite
  B.addTo(G, crankArm(len, 57, 67, vis.style), armMat, 'Drive-side crank arm');
  const left = crankArm(len, -51, -67, vis.style); left.rotateZ(Math.PI);
  B.addTo(G, left, armMat, 'Left crank arm');
  // spider: four arms plus the crank arm itself carry the 110 mm bolt circle
  const spider = polarShape((a) => {
    let r = 30;
    for (let k = 1; k < 5; k++) { let x = Math.abs(a - (k * 2 * Math.PI) / 5); x = Math.min(x, 2 * Math.PI - x); r = Math.max(r, lerp(63, 30, Math.min(1, (x / rad(vis.style === 'r7000' ? 26 : 18)) ** 2.2))); }
    return r;
  }, 220);
  B.addTo(G, place(plate(spider, 5, { bevel: 0.6 }), V(0, 0, L.ringZ[0] - RING_GAP / 2)), armMat, 'Spider');
  // rings
  const ringMat = M.aluBlack.clone(); ringMat.color.set(vis.ring || '#1b1c1f'); ringMat.name = 'ring';
  B.addTo(G, place(ringGeometry(L.rings[0], true), V(0, 0, L.ringZ[0])), ringMat, `${L.rings[0]}T chainring`);
  B.addTo(G, place(ringGeometry(L.rings[1], false), V(0, 0, L.ringZ[1])), ringMat, `${L.rings[1]}T chainring`);
  const bolts = [];
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5, p = V(55 * Math.cos(a), 55 * Math.sin(a), 0);
    bolts.push(place(boltHead(9, 2.2), p.clone().setZ(L.ringZ[0] + 1.3)), rod(p.clone().setZ(L.ringZ[1] - 2.6), p.clone().setZ(L.ringZ[0] + 1.3), 4));
  }
  B.addTo(G, merge(bolts), M.bolt, 'Chainring bolts');
  // spindle and self-extracting bolt caps
  const sp = vis.style === 'r7000' ? 12 : 15;
  B.addTo(G, rod(V(0, 0, -58), V(0, 0, 62), sp, sp, 32), M.aluMachined, 'Spindle');
  B.addTo(G, merge([place(lathe([[0.01, 0], [11, 0], [12, 1.2], [12, 2.6], [5, 3.2], [0.01, 3.2]], 28), V(0, 0, 66)), place(lathe([[0.01, -3.2], [5, -3.2], [12, -2.6], [12, -1.2], [11, 0], [0.01, 0]], 28), V(0, 0, -60))]), M.aluBlack, 'Crank bolt caps');

  // bottom bracket (does not turn)
  const w = B.geom.interfaces.bb_shell_width_mm / 2;
  if (bbv.style === 'outboard') {
    B.add('bottom_bracket', merge([lathe([[sp + 0.5, w], [23, w], [23.5, w + 2], [23.5, w + 10], [20, w + 11.5], [sp + 0.5, w + 11.5]], 40), lathe([[sp + 0.5, -w - 11.5], [20, -w - 11.5], [23.5, -w - 10], [23.5, -w - 2], [23, -w], [sp + 0.5, -w]], 40)]), M.aluDark, { name: 'Outboard bearing cups' });
  } else {
    B.add('bottom_bracket', merge([lathe([[sp + 0.4, w - 1], [20.8, w - 1], [20.8, w + 0.6], [sp + 0.4, w + 1.8]], 40), lathe([[sp + 0.4, -w - 1.8], [20.8, -w - 0.6], [20.8, -w + 1], [sp + 0.4, -w + 1]], 40)]), M.aluDark, { name: 'BB30 bearing shields' });
  }
  return G;
}

// ---- pedals --------------------------------------------------------------------------------------
export function buildPedals(B) {
  const { M } = B, vis = B.part('pedals')?.visual ?? {}, len = B.P.crank_length_mm, out = [];
  for (const s of [1, -1]) {
    const G = B.pivot('pedals', B.hp.bb, { key: s > 0 ? 'pedalR' : 'pedalL' });
    G.userData.crankLen = len; G.userData.sign = s; G.userData.z = s * 74;
    const body = new T.Shape(); // plan outline: x fore-aft, y lateral (outboard +)
    body.moveTo(34, 10); body.quadraticCurveTo(38, 38, 22, 62); body.lineTo(-30, 66); body.quadraticCurveTo(-46, 66, -50, 52);
    body.lineTo(-52, 14); body.quadraticCurveTo(-50, 4, -38, 4); body.lineTo(26, 4); body.quadraticCurveTo(33, 4, 34, 10);
    const bg = plate(body, 11, { bevel: 1.4 }); bg.rotateX(Math.PI / 2); bg.translate(0, -3, 0);
    if (s < 0) bg.scale(1, 1, -1), flip(bg);
    B.addTo(G, bg, vis.carbon ? M.carbon : M.plasticGloss, 'Pedal body');
    const pl = plate(roundRect(46, 40, 4, -4, 34), 1.2); pl.rotateX(Math.PI / 2); pl.translate(0, 3.4, 0); if (s < 0) pl.scale(1, 1, -1), flip(pl);
    B.addTo(G, pl, M.steel, 'Wear plate');
    const claw = plate(roundRect(14, 48, 3, -46, 34), 9, { bevel: 1 }); claw.rotateX(Math.PI / 2); claw.translate(0, 2, 0); if (s < 0) claw.scale(1, 1, -1), flip(claw);
    B.addTo(G, claw, M.aluBlack, 'Binding');
    B.addTo(G, rod(V(0, 0, 0), V(0, 0, s * 52), 6.5, 4.5, 18), M.steel, 'Pedal axle');
    if (vis.style === 'assioma') {
      B.addTo(G, rod(V(0, 0, s * 1), V(0, 0, s * 20), 13.5, 13.5, 28), M.plasticGloss, 'Power sensor');
      B.addTo(G, rod(V(0, 0, s * 20), V(0, 0, s * 20.6), 9, 9, 24), M.lensRed, 'Sensor LED ring');
    }
    G.rotation.z = rad(-12);
    out.push(G);
  }
  return out;
}
/** Reverse the triangle winding after a mirror so the faces still point outward. */
function flip(g) {
  const n = g.index ? g.index.count : g.attributes.position.count, idx = [];
  for (let k = 0; k < n; k += 3) { const a = g.index ? [g.index.getX(k), g.index.getX(k + 1), g.index.getX(k + 2)] : [k, k + 1, k + 2]; idx.push(a[0], a[2], a[1]); }
  g.setIndex(idx); g.computeVertexNormals();
}

// ---- cassette ------------------------------------------------------------------------------------
export function buildCassette(B, L) {
  const { M } = B, G = B.pivot('cassette', B.hp.ra, { key: 'rear' }), geos = [];
  L.cogs.forEach((N, i) => {
    const s = sprocketShape(N), R = pitchRadius(N);
    s.holes.push(circlePath(0, 0, 16.2, true, 28));
    if (N >= 19) { const k = N >= 24 ? 6 : 5, rr = R * 0.6, hr = Math.min(R * 0.2, (R - 26) * 0.42); for (let j = 0; j < k; j++) { const a = (j * 2 * Math.PI) / k; s.holes.push(circlePath(rr * Math.cos(a), rr * Math.sin(a), hr, true, 18)); } }
    const g = plate(s, 1.75, { bevel: 0.25 }); g.rotateZ(i * 0.41); g.translate(0, 0, L.cogZ[i]);
    geos.push(g);
  });
  B.addTo(G, merge(geos), M.steel, 'Cassette sprockets');
  const zOut = L.cogZ[0], zIn = L.cogZ[L.cogs.length - 1];
  B.addTo(G, lathe([[16, zIn - 1.5], [19.5, zIn - 1.5], [19.5, zOut + 1], [16, zOut + 1]], 36), M.aluDark, 'Cassette carrier');
  B.addTo(G, lathe([[9.6, zOut + 1], [15.8, zOut + 1], [16.4, zOut + 2], [15.4, zOut + 3.4], [9.6, zOut + 3.4]], 36), M.aluSilver, 'Lockring');
  return G;
}

// ---- chain ---------------------------------------------------------------------------------------
export function buildChain(B, L) {
  const { M } = B, vis = B.part('chain')?.visual ?? {}, n = L.links;
  const outerMat = M.steel.clone(); outerMat.color.set(vis.plate || '#8f9398'); const innerMat = M.steel.clone(); innerMat.color.set(vis.inner || '#70747a');
  const pl = plate(linkShape(PITCH, 4.15, 4.15, 0.6), 0.85);
  const outer = new T.InstancedMesh(pl, outerMat, n), inner = new T.InstancedMesh(pl, innerMat, n);
  const rg = new T.CylinderGeometry(3.85, 3.85, 2.2, 14); rg.rotateX(Math.PI / 2);
  const pg = new T.CylinderGeometry(1.75, 1.75, 5.9, 8); pg.rotateX(Math.PI / 2);
  const roller = new T.InstancedMesh(merge([rg, pg]), innerMat, n);
  for (const m of [outer, inner, roller]) { m.castShadow = true; m.userData.slot = 'chain'; m.userData.part = 'Chain'; m.frustumCulled = false; }
  const holder = B.holder('chain', new T.Group());
  holder.add(outer, inner, roller);
  // lateral position: constant on a sprocket, linear along a straight run between two
  const zOf = [L.ringZ[L.ri], L.cogZ[L.ci], L.cogZ[L.ci], L.cogZ[L.ci]];
  const zAt = (p) => (p.on >= 0 ? zOf[p.on] : lerp(zOf[p.from], zOf[(p.from + 1) % 4], p.f));
  const m4 = new T.Matrix4(), q = new T.Quaternion(), one = new T.Vector3(1, 1, 1), pos = new T.Vector3();
  function setPhase(phase) {
    const pins = [];
    for (let k = 0; k <= n; k++) { const p = L.path.at(phase + k * (L.path.length / n)); pins.push({ x: p.x, y: p.y, z: zAt(p) }); }
    for (let k = 0; k < n; k++) {
      const a = pins[k], b = pins[k + 1], ang = Math.atan2(b.y - a.y, b.x - a.x), yaw = Math.atan2(b.z - a.z, PITCH);
      q.setFromEuler(new T.Euler(0, -yaw, ang, 'ZYX'));
      const off = k % 2 ? 1.55 : 2.5, mesh = k % 2 ? inner : outer, j = k >> 1;
      mesh.setMatrixAt(j * 2, m4.compose(pos.set(a.x, a.y, a.z + off), q, one));
      mesh.setMatrixAt(j * 2 + 1, m4.compose(pos.set(a.x, a.y, a.z - off), q, one));
      roller.setMatrixAt(k, m4.compose(pos.set(a.x, a.y, a.z), q, one));
    }
    outer.instanceMatrix.needsUpdate = inner.instanceMatrix.needsUpdate = roller.instanceMatrix.needsUpdate = true;
  }
  outer.count = inner.count = Math.ceil(n / 2) * 2;
  setPhase(0);
  return { setPhase, length: L.path.length };
}

// ---- rear derailleur -----------------------------------------------------------------------------
export function buildRearDerailleur(B, L) {
  const { M } = B, slot = 'rear_derailleur', vis = B.part(slot)?.visual ?? {};
  const body = M.aluBlack.clone(); body.color.set(vis.color || '#1a1b1e');
  const zc = L.cogZ[L.ci], g = L.guide, t = L.tension, hang = B.hanger;
  const zH = B.geom.interfaces.rear_oln_mm / 2 + 5;
  const mtb = vis.style === 'mtb';
  // b-knuckle on the hanger bolt
  const bk = [place(lathe([[0.01, 0], [10.5, 0], [11.5, 1.5], [11.5, 13], [9, 16], [0.01, 16]], 28), V(hang.x, hang.y, zH)),
    place(boltHead(8, 2.4), V(hang.x, hang.y, zH + 16))];
  const kneeA = V(hang.x + 3, hang.y - 13, zH + 9);
  bk.push(sweep([V(hang.x, hang.y, zH + 8), kneeA], (u) => ({ a: lerp(9, 7.5, u), b: 6.5, n: 3 }), { seg: 16, capRound: true }));
  B.add(slot, merge(bk), body, { name: 'B-knuckle' });
  // p-knuckle beside the guide pulley; the slant parallelogram joins the two
  const pk = V(g.x + 3, g.y + 15, zc + 15);
  const pkGeo = [place(lathe([[0.01, -9], [12, -9], [13.5, -7], [13.5, 6], [11, 9], [0.01, 9]], 28), pk),
    sweep([pk, V(g.x, g.y, zc + 7)], (u) => ({ a: lerp(10, 7, u), b: 6, n: 2.8 }), { seg: 14, capRound: true })];
  B.add(slot, merge(pkGeo), body, { name: 'P-knuckle' });
  const links = [];
  for (const o of [-6.5, 6.5]) {
    const d = pk.clone().sub(kneeA).normalize(), n = V(-d.y, d.x, 0).normalize();
    links.push(sweep([kneeA.clone().addScaledVector(n, o), pk.clone().addScaledVector(n, o)], { a: 2.4, b: mtb ? 8.5 : 7, n: 3.2 }, { seg: 12, capRound: true }));
  }
  B.add(slot, merge(links), M.aluSilver, { name: 'Parallelogram links' });
  // cage plates
  const ang = Math.atan2(t.y - g.y, t.x - g.x);
  const cagePlate = (z, r) => { const s = linkShape(L.cage, r, r, 0.66); s.holes.push(circlePath(0, 0, 2.6, true, 10)); s.holes.push(circlePath(L.cage, 0, 2.6, true, 10)); const p = plate(s, 1.5, { bevel: 0.2 }); p.rotateZ(ang); return place(p, V(g.x, g.y, z)); };
  B.add(slot, merge([cagePlate(zc + 4.6, 12.5), cagePlate(zc - 4.6, 11.5)]), body, { name: 'Cage plates' });
  // pulleys
  const pul = () => { const s = sprocketShape(PULLEY_T, { relief: 0.4 }); s.holes.push(circlePath(0, 0, 4.2, true, 12)); for (let k = 0; k < 5; k++) { const a = (k * 2 * Math.PI) / 5; s.holes.push(circlePath(11.5 * Math.cos(a), 11.5 * Math.sin(a), 3.2, true, 10)); } return plate(s, 2.1, { bevel: 0.2 }); };
  B.add(slot, merge([place(pul(), V(g.x, g.y, zc)), place(pul(), V(t.x, t.y, zc))]), M.plastic, { name: 'Jockey wheels' });
  B.add(slot, merge([rod(V(g.x, g.y, zc - 6), V(g.x, g.y, zc + 8), 2.5), rod(V(t.x, t.y, zc - 6), V(t.x, t.y, zc + 6.5), 2.5), place(boltHead(6.5, 1.6), V(t.x, t.y, zc + 5.4))]), M.bolt, { name: 'Pulley bolts' });
  // barrel adjuster and the last loop of housing from the chainstay stop
  const adj = V(hang.x - 14, hang.y + 2, zH + 9), stop = V(B.hp.ra.x + 95, B.hp.ra.y - 30, 56);
  B.add(slot, rod(adj, adj.clone().add(V(-11, 5, 0)), 3.4, 3, 12), M.aluBlack, { name: 'Barrel adjuster' });
  B.rdCable = { adj: adj.clone().add(V(-11, 5, 0)), stop, clamp: kneeA.clone().add(V(4, -6, 0)) };
}

// ---- front derailleur ----------------------------------------------------------------------------
function arcBand(r0, r1, a0, a1, n = 26) {
  const s = new T.Shape();
  for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); if (i) s.lineTo(r1 * Math.cos(a), r1 * Math.sin(a)); else s.moveTo(r1 * Math.cos(a), r1 * Math.sin(a)); }
  for (let i = n; i >= 0; i--) { const a = lerp(a0, a1, i / n); s.lineTo(r0 * Math.cos(a), r0 * Math.sin(a)); }
  s.closePath();
  return s;
}
export function buildFrontDerailleur(B, L) {
  const { M } = B, slot = 'front_derailleur';
  const Rt = tipRadius(L.rings[0]), z = L.ringZ[L.ri], a0 = rad(76), a1 = rad(114);
  const geos = [
    place(plate(arcBand(Rt + 1.5, Rt + 15, a0, a1), 1.6, { bevel: 0.3 }), V(0, 0, z + 6.2)),
    place(plate(arcBand(Rt - 13, Rt + 14, a0 + rad(2), a1 - rad(1)), 1.6, { bevel: 0.3 }), V(0, 0, z - 6.2)),
  ];
  // bridges at the tail and the nose close the cage over the chain
  for (const a of [a0 + rad(1.5), a1 - rad(1.5)]) geos.push(rod(V((Rt + 12.5) * Math.cos(a), (Rt + 12.5) * Math.sin(a), z - 6.2), V((Rt + 12.5) * Math.cos(a), (Rt + 12.5) * Math.sin(a), z + 6.2), 2));
  B.add(slot, merge(geos), M.aluSilver, { name: 'Derailleur cage' });
  // body on the braze-on tab
  const sA = B.frameAxes.sAxis, mount = B.hp.bb.clone().addScaledVector(sA, Rt + 46), fr = B.frameAxes.sFront;
  const bodyC = mount.clone().addScaledVector(fr, 4).setZ(28);
  const bg = plate(roundRect(30, 36, 6), 22, { bevel: 1.5 }); bg.rotateZ(Math.atan2(sA.y, sA.x) - Math.PI / 2);
  B.add(slot, place(bg, bodyC), M.aluBlack, { name: 'Derailleur body' });
  const armTop = bodyC.clone().addScaledVector(sA, -10), armBot = V((Rt + 13) * Math.cos(rad(101)), (Rt + 13) * Math.sin(rad(101)), z + 3);
  B.add(slot, merge([sweep([armTop.clone().setZ(34), armBot.clone().setZ(z + 6)], { a: 6, b: 2.4, n: 3 }, { seg: 12 }), sweep([armTop.clone().setZ(22), armBot.clone().setZ(z - 5)], { a: 6, b: 2.4, n: 3 }, { seg: 12 })]), M.aluSilver, { name: 'Derailleur links' });
  B.add(slot, sweep([mount.clone().addScaledVector(sA, -16).setZ(0), mount.clone().addScaledVector(sA, 16).setZ(0)], { a: 20, b: 20.5, n: 2 }, { seg: 28, cap: false }), M.aluBlack, { name: 'Braze-on tab' });
  B.fdCable = { clamp: bodyC.clone().addScaledVector(sA, 16).setZ(16) };
}
