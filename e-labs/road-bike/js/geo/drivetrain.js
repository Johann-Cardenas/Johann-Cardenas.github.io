// Drivetrain: crankset, chainrings, bottom bracket, cassette, chain, derailleurs, pedals.
// Sprockets have real 1/2 in pitch tooth forms. The chain is laid pin by pin along the solved path
// through the derailleur, counted in pitches (one roller seat per tooth on a sprocket, 12.7 mm on a
// straight run), so every roller sits in a seat, the loop closes on a whole number of links, and the
// cage angle is whatever takes up exactly that many. The sprockets the chain is on are clocked so
// their seats meet the rollers, and turn at the rate the chain feeds them.
//
// Installed parts (owner photos, reference/photos/): FSA Gossamer BB30 50/34 crank, 110 mm BCD,
// five-bolt spider with the drive arm between two arms; black rings with machined silver window
// bevels and white print; Shimano 105 5700 rear derailleur with a black body and silver outer cage.
import * as T from 'three';
import { V, lathe, plate, rod, sweep, spline, merge, place, rad, lerp, smooth, linkShape, circlePath, sprocketShape, pitchRadius, tipRadius, beltPath, PITCH, ROLLER, boltHead, roundRect, canvasTexture } from './kit.js';
import { chainLinks } from '../model/gearing.js';

const COG_PITCH = 3.95, RING_GAP = 7.0, PULLEY_T = 11, BCD_R = 55, RING_T = 2.2;
const TAU = Math.PI * 2;
const mod = (a, m) => ((a % m) + m) % m;
const rootRadius = (N) => pitchRadius(N) - ROLLER / 2;

// ---- layout --------------------------------------------------------------------------------------
/** Length of a belt path in pitches: teeth wrapped on each sprocket, pitches on each straight run. */
function pitchMap(path, teeth) {
  const segU = path.segs.map((sg) => (sg.kind === 'arc' ? (sg.sweep * teeth[sg.i]) / TAU : sg.len / PITCH));
  const start = []; let U = 0;
  for (const u of segU) { start.push(U); U += u; }
  function at(u) {
    u = mod(u, U);
    let k = segU.length - 1;
    for (let i = 0; i < segU.length; i++) if (u < start[i] + segU[i]) { k = i; break; }
    const sg = path.segs[k], f = segU[k] ? (u - start[k]) / segU[k] : 0;
    if (sg.kind === 'arc') {
      const C = path.circles[sg.i], a = sg.a0 + C.s * sg.sweep * f;
      return { x: C.c[0] + C.r * Math.cos(a), y: C.c[1] + C.r * Math.sin(a), on: sg.i, f };
    }
    return { x: lerp(sg.t.p1[0], sg.t.p2[0], f), y: lerp(sg.t.p1[1], sg.t.p2[1], f), on: -1, from: sg.i, f };
  }
  return { U, segU, start, at };
}

export function drivetrainLayout(B) {
  const crank = B.part('crankset'), cas = B.part('cassette'), rd = B.part('rear_derailleur');
  const rings = [crank?.provides?.ring_big ?? 50, crank?.provides?.ring_small ?? 34];
  const cogs = cas?.visual?.cogs ?? [11, 12, 13, 14, 15, 17, 19, 21, 24, 28];
  const cl = B.geom.interfaces.chainline_mm;
  const ringZ = [cl + RING_GAP / 2, cl - RING_GAP / 2];
  const cogZ = cogs.map((_, i) => cl + ((cogs.length - 1) / 2 - i) * COG_PITCH);
  const ri = B.P.ring === 'small' ? 1 : 0, ci = Math.min(cogs.length - 1, Math.max(0, Math.round(B.P.cog)));
  const { ra, bb } = B.hp, rp = pitchRadius(PULLEY_T), cage = rd?.visual?.cage ?? 60;
  // guide pulley tracks the cassette profile below the selected cog; the slant parallelogram and the
  // B-tension leave ~6 mm on the largest cog and open the gap toward the smallest
  const cmax = Math.max(...cogs), gap = 6 + 0.55 * (cmax - cogs[ci]);
  const guide = V(ra.x + 6, ra.y - (tipRadius(cogs[ci]) + gap + tipRadius(PULLEY_T)), cogZ[ci]);
  const links = chainLinks({ rings, cogs, chainstay: B.geom.chainstay_mm });
  // travel order: ring -> tension pulley -> guide pulley -> cog (the chain's own direction of motion)
  const teeth = [rings[ri], PULLEY_T, PULLEY_T, cogs[ci]];
  const pathFor = (alpha) => {
    const circles = [
      { c: [bb.x, bb.y], r: pitchRadius(rings[ri]), s: -1 },
      { c: [guide.x + cage * Math.cos(alpha), guide.y + cage * Math.sin(alpha)], r: rp, s: -1 },
      { c: [guide.x, guide.y], r: rp, s: 1 },
      { c: [ra.x, ra.y], r: pitchRadius(cogs[ci]), s: -1 },
    ];
    const p = beltPath(circles); p.circles = circles; p.map = pitchMap(p, teeth);
    return p;
  };
  // The cage spring takes up slack by swinging the tension pulley rearward: the loop grows as alpha falls.
  const aTaut = rad(-28), aSlack = rad(-172);
  let lo = aSlack, hi = aTaut, state = 'ok';
  if (pathFor(aTaut).map.U > links) { lo = hi = aTaut; state = 'short'; }
  else if (pathFor(aSlack).map.U < links) { lo = hi = aSlack; state = 'slack'; }
  else for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (pathFor(mid).map.U > links) lo = mid; else hi = mid; }
  const alpha = (lo + hi) / 2, path = pathFor(alpha), pm = path.map;
  // Tooth registration. A pin at pitch coordinate u sits on circle i at angle a0 + s (u - u0) 2pi/N.
  // p0 puts pins exactly in the ring's seats (ring seats are at 2pi k/N in its own frame); each other
  // sprocket is then clocked to wherever its seats have to be for the same pins.
  const p0 = pm.start[0] + mod((path.segs[0].a0 * teeth[0]) / TAU, 1);
  const seatOf = (i) => mod(path.segs[2 * i].a0 + path.circles[i].s * (p0 - pm.start[2 * i]) * TAU / teeth[i], TAU / teeth[i]);
  return {
    rings, cogs, ringZ, cogZ, ri, ci, guide, tension: V(guide.x + cage * Math.cos(alpha), guide.y + cage * Math.sin(alpha), cogZ[ci]), alpha, cage, path, links, state, rp,
    U: pm.U, pitchAt: pm.at, p0, teeth, ringR: pitchRadius(rings[ri]), seat: { tension: seatOf(1), guide: seatOf(2), cog: seatOf(3) },
  };
}

// ---- local geometry helpers ----------------------------------------------------------------------
const smin = (a, b, k) => { if (!isFinite(b)) return a; if (!isFinite(a)) return b; const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

/** Connect closed loops of [x,y,z] (same count, counter-clockwise in XY) into one surface. Face normal = (next loop - this loop) x (CCW tangent). */
function loft(loops) {
  const n = loops[0].length, pos = [], idx = [];
  for (const L of loops) for (const p of L) pos.push(p[0], p[1], p[2]);
  for (let r = 0; r < loops.length - 1; r++) for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n, a = r * n + i, a1 = r * n + i1, b = (r + 1) * n + i, b1 = (r + 1) * n + i1;
    idx.push(a, b, a1, a1, b, b1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const at = (pts, z) => pts.map(([x, y]) => [x, y, z]);
const pathOf = (pts) => { const p = new T.Path(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; };

/**
 * Hole outline of a ring with tabs: a circle of radius rw, with a tab reaching in to each mounting point
 * (round end of half-width hw centred at radius tabR, sides flaring by `flare`), filleted into the band.
 * Star-shaped about the centre, so it is sampled as r(theta). Returns CCW [x,y][].
 */
function tabbedContour(rw, tabs, tabR, hw, flare, k = 6, n = 360) {
  const tf = Math.tan(flare);
  const inTab = (x, y) => Math.hypot(x - tabR, y) <= hw || (x >= tabR && Math.abs(y) <= hw + (x - tabR) * tf);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU; let rt = Infinity;
    for (const b of tabs) {
      const c = Math.cos(a - b), s = Math.sin(a - b);
      if (c <= 0) continue;
      let r0 = Math.max(0, tabR - hw - 0.5), hit = -1;
      for (let r = r0; r < rw + 4; r += 0.4) if (inTab(r * c, r * s)) { hit = r; break; }
      if (hit < 0) continue;
      let lo = hit - 0.4, hi = hit;
      for (let j = 0; j < 10; j++) { const m = (lo + hi) / 2; if (inTab(m * c, m * s)) hi = m; else lo = m; }
      rt = Math.min(rt, hi);
    }
    const r = smin(rw, rt, k);
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

/** Star outline: hub disc plus tapered arms with round ends (spiders). Returns r(theta) samples. */
function starRadii(hub, arms, armR, w0, w1, k = 5, n = 240) {
  const inArm = (x, y) => Math.hypot(x - armR, y) <= w1 || (x >= 0 && x <= armR && Math.abs(y) <= lerp(w0, w1, x / armR));
  const r = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU; let best = 0;
    for (const b of arms) {
      const c = Math.cos(a - b), s = Math.sin(a - b);
      if (c <= 0) continue;
      let hit = -1;
      for (let q = armR + w1 + 0.5; q > 0; q -= 0.4) if (inArm(q * c, q * s)) { hit = q; break; }
      if (hit < 0) continue;
      let lo = hit, hi = hit + 0.4;
      for (let j = 0; j < 10; j++) { const m = (lo + hi) / 2; if (inArm(m * c, m * s)) lo = m; else hi = m; }
      best = Math.max(best, lo);
    }
    r.push(smax(hub, best, k));
  }
  return r;
}

/** Offset a CCW contour outward (away from the centre) by d along its smoothed normals. */
function offsetContour(C, d) {
  const n = C.length;
  return C.map((p, i) => {
    const a = C[(i - 1 + n) % n], b = C[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [p[0] + (ty / l) * d, p[1] - (tx / l) * d];
  });
}

/** Convex hull of sampled circles [[x, y, r], ...] (monotone chain), CCW. */
function hullOfCircles(circles, per = 28) {
  const pts = [];
  for (const [x, y, r] of circles) for (let i = 0; i < per; i++) { const a = (i / per) * TAU; pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** Resample a closed polyline so no edge is longer than step. */
function densify(pts, step) {
  const out = [];
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length], k = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step)); for (let j = 0; j < k; j++) out.push([lerp(p[0], q[0], j / k), lerp(p[1], q[1], j / k)]); });
  return out;
}
const shapeOf = (pts) => { const s = new T.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; };

/**
 * A printed graphic that follows the outer face of a swept superelliptical bar (crank arm, derailleur
 * link). Same frame as kit.sweep: N = B x t with B = +Z projected. `side` -1 puts it on the -B face.
 */
function faceRibbon(path, sec, { u0 = 0, u1 = 1, frac = 0.6, lift = 0.06, side = 1, flipV = false, nu = 48, nv = 10 } = {}) {
  const lens = [0];
  for (let i = 1; i < path.length; i++) lens.push(lens[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = lens[lens.length - 1];
  const sample = (u) => {
    const d = u * total; let i = 1;
    while (i < lens.length - 1 && lens[i] < d) i++;
    const f = (d - lens[i - 1]) / Math.max(lens[i] - lens[i - 1], 1e-9);
    return { p: path[i - 1].clone().lerp(path[i], f), t: path[i].clone().sub(path[i - 1]).normalize() };
  };
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    const u = lerp(u0, u1, i / nu), { p, t } = sample(u), s = sec(u);
    const Bv = V(0, 0, 1).addScaledVector(t, -t.z).normalize(), N = Bv.clone().cross(t).normalize();
    for (let j = 0; j <= nv; j++) {
      const w = lerp(-frac, frac, j / nv) * s.a, h = s.b * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(w / s.a), s.n)), 1 / s.n) + lift;
      const q = p.clone().addScaledVector(N, w).addScaledVector(Bv, side * h);
      pos.push(q.x, q.y, q.z); uv.push(i / nu, flipV ? 1 - j / nv : j / nv);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const decalMat = (map, { metal = 0.2, rough = 0.45 } = {}) => new T.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.35, roughness: rough, metalness: metal, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: 'drivetrain_print' });

/** Text set around a circle, tops outward, reading clockwise (as the rings are printed). Context in mm, y up. */
function arcText(c, str, phiDeg, r, size, { font = '600 {s}px "Helvetica Neue", Arial, sans-serif', color = '#ecedee', track = 0.12 } = {}) {
  c.font = font.replace('{s}', size); c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
  const ws = [...str].map((ch) => c.measureText(ch).width + track * size);
  let phi = rad(phiDeg) + ws.reduce((a, b) => a + b, 0) / (2 * r);
  [...str].forEach((ch, i) => {
    const pc = phi - ws[i] / (2 * r);
    c.save(); c.translate(r * Math.cos(pc), r * Math.sin(pc)); c.rotate(pc - Math.PI / 2); c.scale(1, -1); c.fillText(ch, 0, 0); c.restore();
    phi -= ws[i] / r;
  });
}
/** Square texture over [-R, R]^2 in mm with y up, matching RingGeometry's planar UVs. */
function ringPrint(R, px, draw) {
  return canvasTexture(px, px, (c, w) => { c.translate(w / 2, w / 2); c.scale(w / (2 * R), -w / (2 * R)); draw(c); }, { flipY: true });
}

// ---- crankset ------------------------------------------------------------------------------------
const CRANK_STYLE = {
  gossamer: { bolts: [36, 108, 180, 252, 324], arm: 'GOSSAMER' },     // drive arm sits between two spider arms
  hollowgram: { bolts: [36, 108, 180, 252, 324], arm: 'HOLLOWGRAM' },
  r7000: { bolts: [0, 84, 180, 276], arm: '105' },                    // 4-arm 110 asymmetric, one bolt behind the arm
};

/** Chainring with tabbed windows whose edges are machined to a bright chamfer (FSA style). */
function chainring(N, { rw, bw, tabs, hw }) {
  const zf = RING_T / 2, zb = -RING_T / 2, zm = zb + 0.6;
  const C = tabbedContour(rw, tabs, BCD_R, hw, rad(14), 7, 360), O = offsetContour(C, bw);
  const s = sprocketShape(N);
  s.holes.push(pathOf(O));
  for (const b of tabs) s.holes.push(circlePath(BCD_R * Math.cos(b), BCD_R * Math.sin(b), 4.2, true, 16));
  return {
    black: merge([plate(s, RING_T), loft([at(O, zb), at(C, zb)])]),
    bevel: merge([loft([at(C, zm), at(O, zf)]), loft([at(C, zb), at(C, zm)])]),
    band: [Math.max(...O.map(([x, y]) => Math.hypot(x, y))), rootRadius(N)],
  };
}

function armSection(style) {
  const k = style === 'hollowgram' ? 1.1 : style === 'r7000' ? 1.15 : 1;
  return (u) => ({ a: lerp(15.5 * k, 10.6, Math.pow(u, 0.85)), b: lerp(8.3, 6.5, u), n: 3.6 });
}
function armPath(len, z0, z1) { return spline([V(0, 0, z0), V(len * 0.25, 0, lerp(z0, z1, 0.3)), V(len * 0.7, 0, lerp(z0, z1, 0.8)), V(len, 0, z1)], 30); }
function crankArm(len, z0, z1, style) {
  // local: root on the spindle axis, pedal eye at +X
  const sz = Math.sign(z1) || 1;
  const arm = sweep(armPath(len, z0, z1), armSection(style), { seg: 28, capRound: true });
  const eye = place(lathe([[4.8, -7.2], [13, -7.2], [14, -5.6], [14, 5.6], [13, 7.2], [4.8, 7.2]], 32), V(len, 0, z1));
  const boss = place(lathe(sz > 0 ? [[15.2, -10], [19.5, -10], [21.5, -8], [21.5, 6.5], [19.5, 9], [15.2, 9]] : [[15.2, -9], [19.5, -9], [21.5, -6.5], [21.5, 8], [19.5, 10], [15.2, 10]], 40), V(0, 0, z0));
  return merge([arm, eye, boss]);
}

function armGraphic(label, accent) {
  return canvasTexture(1024, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = accent; c.lineWidth = 6;
    // long frame along both edges, closed at the pedal end, open into the label box at the root
    c.beginPath(); c.moveTo(0.47 * w, 0.14 * h); c.lineTo(0.95 * w, 0.14 * h); c.quadraticCurveTo(0.985 * w, 0.5 * h, 0.95 * w, 0.86 * h); c.lineTo(0.47 * w, 0.86 * h); c.stroke();
    c.lineWidth = 4; c.strokeRect(0.03 * w, 0.2 * h, 0.44 * w, 0.6 * h);
    c.fillStyle = '#f1f2f2'; c.font = '700 54px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const sp = label.length > 8 ? 4 : 9, chars = [...label], ws = chars.map((ch) => c.measureText(ch).width + sp);
    let x = 0.25 * w - ws.reduce((a, b) => a + b, 0) / 2;
    chars.forEach((ch, i) => { c.fillText(ch, x + ws[i] / 2, 0.52 * h); x += ws[i]; });
  }, { flipY: true });
}

export function buildCrankset(B, L) {
  const { M } = B, part = B.part('crankset'), vis = part?.visual ?? {}, bbv = B.part('bottom_bracket')?.visual ?? {};
  const style = CRANK_STYLE[vis.style] ? vis.style : 'gossamer', S = CRANK_STYLE[style];
  const len = B.P.crank_length_mm, G = B.pivot('crankset', B.hp.bb, { key: 'crank' });
  const armMat = M.aluBlack.clone(); armMat.color.set(vis.arm || '#17181a'); armMat.roughness = 0.34; armMat.metalness = 0.55; armMat.name = 'crank_arm';
  const ringMat = M.aluBlack.clone(); ringMat.color.set(vis.ring || '#1b1c1f'); ringMat.roughness = 0.4; ringMat.metalness = 0.5; ringMat.name = 'ring';
  const bevelMat = M.aluSilver.clone(); bevelMat.color.set('#d2d5d9'); bevelMat.roughness = 0.22; bevelMat.name = 'ring_bevel';
  const accent = vis.accent || '#d9d9d6', bolts = S.bolts.map(rad), [zBig, zSmall] = L.ringZ;

  // drive arm points along +X at crank_deg = 0; the left arm is opposite
  const z0 = 57, z1 = 67;
  B.addTo(G, crankArm(len, z0, z1, style), armMat, 'Drive-side crank arm');
  const left = crankArm(len, -51, -67, style); left.rotateZ(Math.PI);
  B.addTo(G, left, armMat, 'Left crank arm');
  const sec = armSection(style), uA = 23 / len, uB = (len - 15.5) / len;
  const gfx = decalMat(armGraphic(S.arm, accent), { metal: 0.35, rough: 0.35 });
  B.addTo(G, faceRibbon(armPath(len, z0, z1), sec, { u0: uA, u1: uB, frac: 0.66, lift: 0.05 }), gfx, 'Crank arm graphic', false);
  const lg = faceRibbon(armPath(len, -51, -67), sec, { u0: uA, u1: uB, frac: 0.66, lift: 0.05, side: -1, flipV: true }); lg.rotateZ(Math.PI);
  B.addTo(G, lg, gfx, 'Crank arm graphic', false);

  // spider: hub plus one arm per bolt, between the rings, rising to the drive arm's boss at the centre
  const nA = 240, rb = starRadii(27, bolts, BCD_R, 12.5, 8.8, 6, nA);
  const zLo = zSmall + RING_T / 2 + 0.02, zHi = zBig - RING_T / 2 - 0.02, zHub = z0 - 2;
  const zTop = (r) => lerp(zHub, zHi, smooth((r - 21) / 24));
  const ring = (f, z) => rb.map((R, i) => { const a = (i / nA) * TAU, r = lerp(15.2, R, f); return [r * Math.cos(a), r * Math.sin(a), z(r)]; });
  const top = []; for (let j = 0; j <= 16; j++) top.push(ring(j / 16, zTop));
  B.addTo(G, merge([loft(top), loft([ring(1, () => zLo), ring(0, () => zLo)]), loft([ring(1, zTop), ring(1, () => zLo)]), loft([ring(0, () => zLo), ring(0, zTop)])]), armMat, 'Spider');

  // rings
  const big = chainring(L.rings[0], { rw: rootRadius(L.rings[0]) - 12.5, bw: 3.2, tabs: bolts, hw: 9.5 });
  const small = chainring(L.rings[1], { rw: rootRadius(L.rings[1]) - 8.8, bw: 2.4, tabs: bolts, hw: 8.6 });
  B.addTo(G, place(big.black, V(0, 0, zBig)), ringMat, `${L.rings[0]}T chainring`);
  B.addTo(G, place(big.bevel, V(0, 0, zBig)), bevelMat, `${L.rings[0]}T chainring`);
  B.addTo(G, place(small.black, V(0, 0, zSmall)), ringMat, `${L.rings[1]}T chainring`);
  B.addTo(G, place(small.bevel, V(0, 0, zSmall)), bevelMat, `${L.rings[1]}T chainring`);
  // shift pins and ramps on the outer face of the big ring
  const pins = [-133, -91, 44, 87].map((d) => place(lathe([[0.01, 0], [1.6, 0], [1.6, 0.5], [1.1, 0.9], [0.01, 0.9]], 14), V((big.band[1] - 3.2) * Math.cos(rad(d)), (big.band[1] - 3.2) * Math.sin(rad(d)), zBig + RING_T / 2)));
  B.addTo(G, merge(pins), M.aluSilver, 'Shift pins');

  // printing (white): positions read off the owner's photo, relative to the drive arm
  if (style === 'gossamer') {
    const [b0, b1] = big.band, rm = (b0 + b1) / 2, hs = Math.min(4.6, (b1 - b0) * 0.62);
    const tBig = ringPrint(b1, 1536, (c) => {
      arcText(c, '110mm BCD', -80, rm, hs); arcText(c, 'N10', 29, rm, hs);
      arcText(c, `${L.rings[0]}/${L.rings[1]}T`, 63, rm, hs);
      arcText(c, 'FULL SPEED AHEAD', 137, rm, hs * 1.05, { font: 'italic 800 {s}px "Arial Black", Arial, sans-serif', track: 0.16 });
    });
    B.addTo(G, place(new T.RingGeometry(b0, b1, 200, 1), V(0, 0, zBig + RING_T / 2 + 0.04)), decalMat(tBig), 'Chainring print', false);
    const [s0, s1] = small.band, sm = (s0 + s1) / 2, ss = Math.min(3.8, (s1 - s0) * 0.62);
    const tSm = ringPrint(s1, 1024, (c) => {
      arcText(c, '110mm BCD', -77, sm, ss); arcText(c, `${L.rings[1]}T N10`, 53, sm, ss);
      arcText(c, 'FSA', 137, sm, ss * 1.25, { font: 'italic 900 {s}px "Arial Black", Arial, sans-serif', track: 0.04 });
      arcText(c, '///', 125, sm, ss * 1.1, { font: 'italic 900 {s}px Arial, sans-serif', track: 0.05 });
    });
    B.addTo(G, place(new T.RingGeometry(s0, s1, 160, 1), V(0, 0, zSmall + RING_T / 2 + 0.04)), decalMat(tSm), 'Chainring print', false);
  }

  // chainring bolts: flanged alloy nuts on the big ring, bolt heads behind the small ring
  const nuts = [], back = [], sockets = [];
  for (const b of bolts) {
    const x = BCD_R * Math.cos(b), y = BCD_R * Math.sin(b);
    nuts.push(place(lathe([[2.4, 0], [5.3, 0], [5.3, 0.7], [4.5, 1.8], [2.4, 1.8]], 24), V(x, y, zBig + RING_T / 2)));
    sockets.push(place(new T.CylinderGeometry(2.45, 2.45, 1.0, 6).rotateX(Math.PI / 2), V(x, y, zBig + RING_T / 2 + 1.25)));
    back.push(place(lathe([[0.01, 0], [5, 0], [5, -0.8], [4.2, -2.2], [0.01, -2.2]], 24), V(x, y, zSmall - RING_T / 2)));
    back.push(rod(V(x, y, zSmall), V(x, y, zBig), 4, 4, 14));
  }
  B.addTo(G, merge(nuts), M.aluSilver, 'Chainring bolts');
  B.addTo(G, merge(back), M.bolt, 'Chainring bolts');
  B.addTo(G, merge(sockets), M.hole, 'Chainring bolts', false);

  // BB30 spindle: 30 mm alloy, pressed into the drive arm and showing flush in its boss
  const sp = style === 'r7000' ? 12 : 15;
  B.addTo(G, rod(V(0, 0, -59), V(0, 0, z0 + 8.6), sp, sp, 40), M.aluMachined, 'Spindle');
  B.addTo(G, place(new T.CircleGeometry(sp - 3.6, 32), V(0, 0, z0 + 8.65)), M.hole, 'Spindle bore', false);
  // non-drive fixing bolt with its self-extracting cap
  B.addTo(G, place(lathe([[0.01, 0], [12, 0], [12.5, -0.8], [12.5, -2.6], [11.5, -3.3], [0.01, -3.3]], 36), V(0, 0, -60.5)), armMat, 'Crank bolt cap');
  B.addTo(G, place(new T.CylinderGeometry(4.2, 4.2, 0.6, 6).rotateX(Math.PI / 2), V(0, 0, -63.9)), M.hole, 'Crank bolt cap', false);

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
    const P = spdsl(), mir = (g) => { g = g.clone(); if (s < 0) { g.scale(1, 1, -1); flip(g); } return g; };
    B.addTo(G, mir(P.body), vis.carbon ? M.carbon : M.plasticGloss, 'Pedal body');
    B.addTo(G, mir(P.plate), M.aluSilver, 'Wear plate');
    B.addTo(G, mir(P.binding), M.aluBlack, 'Binding');
    B.addTo(G, mir(P.screw), M.bolt, 'Tension screw');
    B.addTo(G, mir(P.axle), M.steel, 'Pedal axle');
    B.addTo(G, mir(P.cap), M.aluDark, 'Pedal end cap');
    if (vis.style === 'assioma') {
      B.addTo(G, rod(V(0, 0, s * 1), V(0, 0, s * 20), 13.5, 13.5, 28), M.plasticGloss, 'Power sensor');
      B.addTo(G, rod(V(0, 0, s * 20), V(0, 0, s * 20.6), 9, 9, 24), M.lensRed, 'Sensor LED ring');
    }
    G.rotation.z = rad(-12);
    out.push(G);
  }
  return out;
}
/**
 * Shimano SPD-SL road pedal, drive side (outboard +z), x forward, y up, axle centre at the origin.
 * Wide platform with the stainless wear plate on top, a keel that wraps the axle housing and sweeps
 * up into the nose, the front cleat hook, the spring-loaded rear binding with its tension screw,
 * and the spindle with its bearing collar and outboard end cap. Built once and shared.
 */
let SPDSL = null;
function spdsl() {
  if (SPDSL) return SPDSL;
  const top = 12.5;
  // plan outline (x, lateral): broad rounded nose, straight outboard edge, notch clear of the crank
  const plan = new T.Shape();
  plan.moveTo(-30, 18); plan.lineTo(12, 11); plan.quadraticCurveTo(39, 11, 40, 37); plan.quadraticCurveTo(39, 63, 16, 64);
  plan.lineTo(-30, 57); plan.quadraticCurveTo(-36, 56, -36, 50); plan.lineTo(-36, 24); plan.quadraticCurveTo(-36, 18, -30, 18);
  plan.holes.push(roundRect(10, 22, 4, -22, 39)); // window ahead of the binding
  const onTop = (shape, y0, y1, o = {}) => { const g = plate(shape, y1 - y0, o); g.rotateX(Math.PI / 2); g.translate(0, y1, 0); return g; };
  const across = (shape, z0, z1, o = {}) => { const g = plate(shape, z1 - z0, o); g.translate(0, 0, z0); return g; };
  // side profile of the keel: housing round the axle, underside sweeping up into the nose and the binding
  const keel = new T.Shape();
  keel.moveTo(37, 7); keel.quadraticCurveTo(33, 1, 20, -3); keel.quadraticCurveTo(11, -11.5, 0, -11.5);
  keel.quadraticCurveTo(-12, -11.5, -19, -5); keel.lineTo(-29, 3); keel.lineTo(-29, 7); keel.closePath();
  const hook = new T.Shape(); // front cleat hook, a raised lip with a lip folded back over the cleat
  hook.moveTo(26, 0); hook.lineTo(36, 0); hook.quadraticCurveTo(39, 0, 38.5, 3); hook.lineTo(37, 4.2); hook.lineTo(24, 4.2); hook.lineTo(24, 3); hook.lineTo(27, 2.6); hook.closePath();
  const hookG = across(hook, 21, 57, { bevel: 0.6 }); hookG.translate(0, top - 0.4, 0);
  const body = merge([
    onTop(plan, top - 6, top, { bevel: 1.5, curve: 12 }),
    across(keel, 22, 56, { bevel: 3, curve: 10 }),
    hookG,
    place(lathe([[6.4, 6], [10.5, 12], [11, 17], [0.01, 17]], 32), V()), // housing boss on the inboard face
  ]);
  // wear plate: stainless, front half of the platform
  const wp = new T.Shape();
  wp.moveTo(-8, 22); wp.lineTo(17, 22); wp.quadraticCurveTo(24, 22, 24, 30); wp.lineTo(24, 48); wp.quadraticCurveTo(24, 56, 17, 56); wp.lineTo(-8, 56); wp.closePath();
  const plateG = onTop(wp, top - 0.2, top + 0.9, { bevel: 0.3 });
  // rear binding: claw rising behind the platform with its lip over the cleat's tail, spring barrel below
  const claw = new T.Shape();
  claw.moveTo(-43, 2); claw.lineTo(-32, 2); claw.lineTo(-32, top); claw.lineTo(-27, top + 1); claw.lineTo(-27, top + 3.4);
  claw.lineTo(-37, top + 3.8); claw.quadraticCurveTo(-44, top + 3, -44, 8); claw.closePath();
  const binding = merge([across(claw, 20, 58, { bevel: 0.8 }), rod(V(-35, 1, 19), V(-35, 1, 59), 3.6, 3.6, 18)]);
  const screw = place(boltHead(5.2, 2.6), V(-44.6, 6, 39), V(-1, 0, 0));
  // spindle: exposed steel from the crank to the bearing collar, end cap on the outboard face
  const axle = merge([lathe([[0.01, 0], [7.4, 0], [7.4, 1.2], [6.2, 2], [6.2, 6.4], [0.01, 6.4]], 28)]);
  const cap = lathe([[0.01, 61], [8.6, 61], [8.6, 64.5], [7.6, 66], [0.01, 66]], 6);
  return (SPDSL = { body, plate: plateG, binding, screw, axle, cap });
}

/** Reverse the triangle winding after a mirror so the faces still point outward. */
function flip(g) {
  const n = g.index ? g.index.count : g.attributes.position.count, idx = [];
  for (let k = 0; k < n; k += 3) { const a = g.index ? [g.index.getX(k), g.index.getX(k + 1), g.index.getX(k + 2)] : [k, k + 1, k + 2]; idx.push(a[0], a[2], a[1]); }
  g.setIndex(idx); g.computeVertexNormals();
}

// ---- cassette ------------------------------------------------------------------------------------
// Loose steel cogs on plastic spacers; the three largest riveted to a five-arm alloy carrier (CS-5700).
export function buildCassette(B, L) {
  const { M } = B, G = B.pivot('cassette', B.hp.ra, { key: 'rear' }), nC = L.cogs.length;
  const carrierFrom = nC >= 3 && L.cogs[nC - 3] >= 19 ? nC - 3 : nC;
  const arms = [0, 1, 2, 3, 4].map((k) => (k * TAU) / 5 + 0.3);
  const armR = carrierFrom < nC ? rootRadius(L.cogs[carrierFrom]) - 4.8 : 0;
  const steel = [], spacers = [];
  L.cogs.forEach((N, i) => {
    const rot = i === L.ci ? L.seat.cog : i * 0.41, s = sprocketShape(N), R = pitchRadius(N);
    if (i >= carrierFrom) {
      const local = arms.map((a) => a - rot);
      s.holes.push(pathOf(tabbedContour(rootRadius(N) - 6.2, local, armR, 4.4, rad(10), 3, 240)));
      for (const b of local) s.holes.push(circlePath(armR * Math.cos(b), armR * Math.sin(b), 1.6, true, 10));
    } else {
      s.holes.push(circlePath(0, 0, 16.2, true, 36));
      if (N >= 17) { const k = 6, rr = (R + 16) / 2 - 1, hr = Math.min(2.6, (R - 24) * 0.3); if (hr > 1) for (let j = 0; j < k; j++) { const a = (j * TAU) / k; s.holes.push(circlePath(rr * Math.cos(a), rr * Math.sin(a), hr, true, 14)); } }
      if (i + 1 < nC) spacers.push(lathe([[16.4, L.cogZ[i + 1] + 0.86], [19.6, L.cogZ[i + 1] + 0.86], [19.6, L.cogZ[i] - 0.86], [16.4, L.cogZ[i] - 0.86], [16.4, L.cogZ[i + 1] + 0.86]], 36));
    }
    const g = plate(s, 1.75, { bevel: 0.22 }); g.rotateZ(rot); g.translate(0, 0, L.cogZ[i]);
    steel.push(g);
  });
  B.addTo(G, merge(steel), M.steel, 'Cassette sprockets');
  if (spacers.length) B.addTo(G, merge(spacers), M.plastic, 'Cassette spacers');
  if (carrierFrom < nC) {
    const z0 = L.cogZ[nC - 1] - 0.9, z1 = L.cogZ[carrierFrom] + 0.9, nA = 200;
    const rr = starRadii(19.5, arms, armR, 5.2, 4.2, 3, nA);
    const s = shapeOf(rr.map((r, i) => [r * Math.cos((i / nA) * TAU), r * Math.sin((i / nA) * TAU)]));
    s.holes.push(circlePath(0, 0, 16.2, true, 36));
    B.addTo(G, place(plate(s, z1 - z0, { bevel: 0.3 }), V(0, 0, (z0 + z1) / 2)), M.aluDark, 'Sprocket carrier');
    B.addTo(G, merge(arms.map((a) => rod(V(armR * Math.cos(a), armR * Math.sin(a), z0 - 0.5), V(armR * Math.cos(a), armR * Math.sin(a), z1 + 0.5), 1.5, 1.5, 10))), M.aluSilver, 'Carrier rivets');
  }
  const zOut = L.cogZ[0], zIn = L.cogZ[nC - 1];
  B.addTo(G, lathe([[16, zIn - 1.5], [16.2, zIn - 1.5], [16.2, zOut + 1], [16, zOut + 1]], 36), M.aluDark, 'Cassette carrier');
  B.addTo(G, lathe([[9.6, zOut + 1], [15.8, zOut + 1], [16.4, zOut + 2], [15.4, zOut + 3.4], [9.6, zOut + 3.4]], 36), M.aluSilver, 'Lockring');
  return G;
}

// ---- chain ---------------------------------------------------------------------------------------
export function buildChain(B, L) {
  const { M } = B, vis = B.part('chain')?.visual ?? {}, n = L.links;
  const outerMat = M.steel.clone(); outerMat.color.set(vis.plate || '#8f9398'); outerMat.roughness = 0.32; outerMat.name = 'chain_outer';
  const innerMat = M.steel.clone(); innerMat.color.set(vis.inner || '#7c8085').multiplyScalar(0.5); innerMat.roughness = 0.45; innerMat.name = 'chain_inner';
  const rollerMat = innerMat.clone(); rollerMat.color.multiplyScalar(0.85); rollerMat.name = 'chain_roller';
  // 10-speed plates: outer plates waisted harder than the inner ones; 0.8 mm stock
  const outerG = plate(linkShape(PITCH, 3.85, 3.85, 0.66), 0.8, { bevel: 0.14 });
  const innerG = plate(linkShape(PITCH, 4.15, 4.15, 0.76), 0.8, { bevel: 0.14 });
  const nPairs = Math.ceil(n / 2);
  const outer = new T.InstancedMesh(outerG, outerMat, nPairs * 2), inner = new T.InstancedMesh(innerG, innerMat, nPairs * 2);
  const rg = new T.CylinderGeometry(3.85, 3.85, 2.2, 16); rg.rotateX(Math.PI / 2);
  const pg = new T.CylinderGeometry(1.7, 1.7, 5.95, 10); pg.rotateX(Math.PI / 2);
  const roller = new T.InstancedMesh(merge([rg, pg]), rollerMat, n);
  for (const m of [outer, inner, roller]) { m.castShadow = true; m.receiveShadow = true; m.userData.slot = 'chain'; m.userData.part = 'Chain'; m.frustumCulled = false; }
  const holder = B.holder('chain', new T.Group());
  holder.add(outer, inner, roller);
  // lateral position: constant on a sprocket, linear along a straight run between two
  const zOf = [L.ringZ[L.ri], L.cogZ[L.ci], L.cogZ[L.ci], L.cogZ[L.ci]];
  const zAt = (p) => (p.on >= 0 ? zOf[p.on] : lerp(zOf[p.from], zOf[(p.from + 1) % 4], p.f));
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), one = new T.Vector3(1, 1, 1), pos = new T.Vector3();
  const pins = Array.from({ length: n + 1 }, () => ({ x: 0, y: 0, z: 0 }));
  const Nr = L.rings[L.ri], step = L.U / n;
  function setPhase(phase) {
    const delta = phase / L.ringR; // crank angle the caller turned through
    const p = L.p0 + (delta * Nr) / TAU;
    for (let k = 0; k <= n; k++) { const s = L.pitchAt(p + k * step); pins[k].x = s.x; pins[k].y = s.y; pins[k].z = zAt(s); }
    for (let k = 0; k < n; k++) {
      const a = pins[k], b = pins[k + 1], ang = Math.atan2(b.y - a.y, b.x - a.x), yaw = Math.atan2(b.z - a.z, Math.hypot(b.x - a.x, b.y - a.y));
      q.setFromEuler(e.set(0, -yaw, ang, 'ZYX'));
      const off = k % 2 ? 1.55 : 2.52, mesh = k % 2 ? inner : outer, j = k >> 1;
      mesh.setMatrixAt(j * 2, m4.compose(pos.set(a.x, a.y, a.z + off), q, one));
      mesh.setMatrixAt(j * 2 + 1, m4.compose(pos.set(a.x, a.y, a.z - off), q, one));
      roller.setMatrixAt(k, m4.compose(pos.set(a.x, a.y, a.z), q, one));
    }
    outer.instanceMatrix.needsUpdate = inner.instanceMatrix.needsUpdate = roller.instanceMatrix.needsUpdate = true;
    // the jockey wheels turn with the chain (guide anticlockwise, tension clockwise seen from the drive side)
    if (L.pulleys) {
      L.pulleys.guide.rotation.z = L.seat.guide + (delta * Nr) / PULLEY_T;
      L.pulleys.tension.rotation.z = L.seat.tension - (delta * Nr) / PULLEY_T;
    }
  }
  outer.count = nPairs * 2; inner.count = Math.floor(n / 2) * 2;
  setPhase(0);
  return { setPhase, length: L.path.length };
}

// ---- rear derailleur -----------------------------------------------------------------------------
function jockeyWheel() {
  const s = sprocketShape(PULLEY_T, { relief: 0.5 }); s.holes.push(circlePath(0, 0, 12.4, true, 36));
  const web = new T.Shape(); web.absarc(0, 0, 13, 0, TAU, false);
  web.holes.push(circlePath(0, 0, 6.2, true, 20));
  for (let k = 0; k < 6; k++) { const a = (k * TAU) / 6; web.holes.push(circlePath(9.4 * Math.cos(a), 9.4 * Math.sin(a), 2.1, true, 12)); }
  return merge([plate(s, 2.2, { bevel: 0.25 }), plate(web, 1.5, { bevel: 0.2 }), lathe([[4.4, -3.7], [6.4, -3.7], [6.6, -3.2], [6.6, 3.2], [6.4, 3.7], [4.4, 3.7], [4.4, -3.7]], 28)]);
}

function rdGraphic() {
  return canvasTexture(512, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#e9eaeb'; c.textBaseline = 'middle';
    c.font = '700 40px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'left'; c.fillText('SHIMANO', 0.08 * w, 0.24 * h);
    c.font = 'italic 900 150px "Arial Black", Arial, sans-serif'; c.textAlign = 'center'; c.fillText('105', 0.52 * w, 0.64 * h);
  }, { flipY: true });
}

export function buildRearDerailleur(B, L) {
  const { M } = B, slot = 'rear_derailleur', vis = B.part(slot)?.visual ?? {};
  const mtb = vis.style === 'mtb';
  const body = M.aluBlack.clone(); body.color.set(vis.color || '#1a1b1e'); body.roughness = 0.34; body.metalness = 0.5; body.name = 'rd_body';
  const cageMat = M.aluSilver.clone(); cageMat.color.set(mtb ? '#2f3237' : '#8d9298'); cageMat.roughness = 0.46; cageMat.name = 'rd_cage';
  const zc = L.cogZ[L.ci], g = L.guide, t = L.tension, hang = B.hanger;
  const zH = B.geom.interfaces.rear_oln_mm / 2 + 5;
  const ang = Math.atan2(t.y - g.y, t.x - g.x), ca = Math.cos(ang), sa = Math.sin(ang);
  const local = (x, y) => [(x - g.x) * ca + (y - g.y) * sa, -(x - g.x) * sa + (y - g.y) * ca];

  // cage pivot (p-knuckle axis) behind and above the guide pulley, as on Shimano road cages
  const P = V(g.x - 24, g.y + 13, 0), Pl = local(P.x, P.y);
  const cagePlate = (circles, z, depth, win) => {
    // hull of the pulley ends, waisted between the pulleys
    const s = shapeOf(densify(hullOfCircles(circles), 1.5).map(([u, v]) => { const f = u > 0 && u < L.cage ? Math.sin((Math.PI * u) / L.cage) ** 2 : 0; return [u, v * (1 - 0.22 * f)]; }));
    if (win) { const w = roundRect(L.cage * 0.34, 7, 3.4, L.cage * 0.52, 0); s.holes.push(new T.Path(w.getPoints(6))); }
    const p = plate(s, depth, { bevel: 0.3 }); p.rotateZ(ang); p.translate(g.x, g.y, z);
    return p;
  };
  // outer plate brushed alloy (with the window), inner plate black
  B.add(slot, cagePlate([[Pl[0], Pl[1], 10], [0, 0, 16.5], [L.cage, 0, 19.5]], zc + 5.1, 1.7, true), cageMat, { name: 'Outer cage plate' });
  B.add(slot, cagePlate([[Pl[0] * 0.5, Pl[1] * 0.5, 9], [0, 0, 15], [L.cage, 0, 18.5]], zc - 5.0, 1.4, false), body, { name: 'Inner cage plate' });

  // jockey wheels on their own pivots so they turn with the chain (driven from the chain's setPhase)
  const gp = B.pivot(slot, V(g.x, g.y, zc), { key: 'rdPulley' }), tp = B.pivot(slot, V(t.x, t.y, zc), { key: 'rdPulley' });
  B.addTo(gp, jockeyWheel(), M.plastic, 'Guide pulley'); B.addTo(tp, jockeyWheel(), M.plastic, 'Tension pulley');
  gp.rotation.z = L.seat.guide; tp.rotation.z = L.seat.tension;
  L.pulleys = { guide: gp, tension: tp };
  const pb = [];
  for (const c of [g, t]) {
    pb.push(rod(V(c.x, c.y, zc - 6.4), V(c.x, c.y, zc + 6.6), 2.4, 2.4, 14));
    pb.push(place(boltHead(7.2, 1.7), V(c.x, c.y, zc + 5.9)), place(lathe([[0.01, 0], [3.6, 0], [3.6, -1.1], [0.01, -1.1]], 16), V(c.x, c.y, zc - 5.7)));
    pb.push(place(lathe([[2.5, -3.75], [4.3, -3.75], [4.3, 3.75], [2.5, 3.75]], 18), V(c.x, c.y, zc)));
  }
  B.add(slot, merge(pb), M.bolt, { name: 'Pulley bolts' });

  // b-knuckle: barrel on the hanger bolt with a body dropping forward to the upper link pivots
  const Bk = V(hang.x + 3, hang.y - 5, zH + 9);
  const bk = [place(lathe([[0.01, 0], [10.5, 0], [11.8, 1.5], [11.8, 15], [10, 17], [0.01, 17]], 32), V(hang.x, hang.y, zH)),
    sweep([V(hang.x - 4, hang.y + 3, zH + 9), V(hang.x + 2, hang.y - 9, zH + 9)], (u) => ({ a: lerp(11, 12.5, u), b: 8.4, n: 3.2 }), { seg: 20, capRound: true })];
  B.add(slot, merge(bk), body, { name: 'B-knuckle' });
  B.add(slot, place(lathe([[0.01, 0], [8.6, 0], [9.1, 0.7], [9.1, 2.3], [8.3, 3.1], [0.01, 3.1]], 32), V(hang.x, hang.y, zH + 17)), M.aluSilver, { name: 'Mounting bolt' });
  B.add(slot, place(new T.CylinderGeometry(2.6, 2.6, 0.8, 6).rotateX(Math.PI / 2), V(hang.x, hang.y, zH + 20.0)), M.hole, { name: 'Mounting bolt', shadow: false });

  // p-knuckle on the cage pivot, outboard of the outer plate, with a nose up to the lower link pivots
  const pz = zc + 6.0, Pk = V(P.x - 1, P.y + 4, pz + 8);
  B.add(slot, merge([place(lathe([[0.01, 0], [9.5, 0], [11, 1.6], [11, 11], [9.5, 13.6], [0.01, 13.6]], 32), V(P.x, P.y, pz)),
    sweep([V(P.x + 2, P.y - 4, pz + 7), Pk], { a: 10.5, b: 6.4, n: 3 }, { seg: 14, capRound: true })]), body, { name: 'P-knuckle' });
  B.add(slot, place(lathe([[0.01, 0], [4.2, 0], [4.2, 1.2], [3.4, 1.8], [0.01, 1.8]], 20), V(P.x, P.y, pz + 13.6)), M.aluSilver, { name: 'Cage pivot cap' });

  // slant parallelogram: the broad outer link carries the print; the inner link sits behind it
  const a0 = Bk.clone().add(V(0, 0, 4)), a1 = Pk.clone().add(V(0, 0, 4));
  const ext = a1.clone().sub(a0).normalize().multiplyScalar(4);
  const linkPath = [a0.clone().sub(ext), a1.clone().add(ext)], linkSec = { a: mtb ? 13.5 : 12.5, b: 3.6, n: 4 };
  B.add(slot, sweep(linkPath, linkSec, { seg: 24, capRound: true }), body, { name: 'Outer link' });
  B.add(slot, sweep([Bk.clone().add(V(-8, -4, -6)), Pk.clone().add(V(-8, -4, -6))], { a: 5.5, b: 3, n: 3 }, { seg: 16, capRound: true }), M.aluDark, { name: 'Inner link' });
  if (!mtb) {
    const linkLen = linkPath[0].distanceTo(linkPath[1]);
    const segPath = [linkPath[1], linkPath[1].clone().lerp(linkPath[0], 0.5), linkPath[0]]; // read from the p-knuckle up
    B.add(slot, faceRibbon(segPath, () => linkSec, { u0: 0.14, u1: 0.86, frac: 0.8, lift: 0.05, nu: Math.max(8, Math.round(linkLen)) }), decalMat(rdGraphic()), { name: 'Outer link print', shadow: false });
  }

  // barrel adjuster and the last loop of housing from the chainstay stop; inner wire to the clamp
  const adj = V(hang.x - 14, hang.y + 2, zH + 9), stop = V(B.hp.ra.x + 95, B.hp.ra.y - 30, 56);
  B.add(slot, rod(adj, adj.clone().add(V(-11, 5, 0)), 3.4, 3, 12), M.aluBlack, { name: 'Barrel adjuster' });
  const clamp = Bk.clone().add(V(-2, -6, 9));
  B.add(slot, merge([rod(adj, clamp, 0.6, 0.6, 6), place(lathe([[0.01, 0], [3.6, 0], [3.6, 1.6], [0.01, 1.6]], 16), clamp.clone().add(V(0, 0, 3)))]), M.steel, { name: 'Cable clamp' });
  B.rdCable = { adj: adj.clone().add(V(-11, 5, 0)), stop, clamp };
}

// ---- front derailleur ----------------------------------------------------------------------------
function arcBand(r0, r1, a0, a1, n = 26) {
  const s = new T.Shape();
  for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); if (i) s.lineTo(r1 * Math.cos(a), r1 * Math.sin(a)); else s.moveTo(r1 * Math.cos(a), r1 * Math.sin(a)); }
  for (let i = n; i >= 0; i--) { const a = lerp(a0, a1, i / n); s.lineTo(r0 * Math.cos(a), r0 * Math.sin(a)); }
  s.closePath();
  return s;
}
/** Geometry built in a local frame (x, y, z) laid onto the world axes ex, ey, ez at origin o. */
function orient(g, ex, ey, ez, o) {
  g.applyMatrix4(new T.Matrix4().makeBasis(ex, ey, ez).setPosition(o));
  return g;
}

// FD-5700 in the black finish the rest of the group has: anodised outer plate printed SHIMANO 105,
// polished steel inner plate, black body on the seat-tube braze-on tab, parallelogram links,
// a cable-anchor arm pulled from below, and the two limit screws on top of the body.
export function buildFrontDerailleur(B, L) {
  const { M } = B, slot = 'front_derailleur', Z = V(0, 0, 1);
  const black = M.aluBlack.clone(); black.color.set('#16171a'); black.roughness = 0.3; black.metalness = 0.55; black.name = 'fd_black';
  const inner = M.steel.clone(); inner.roughness = 0.22; inner.name = 'fd_inner';
  const Rt = tipRadius(L.rings[0]), z = L.ringZ[L.ri];
  const zo = z + 6.2, zi = z - 6.4, a0 = rad(73), a1 = rad(117), r0 = Rt + 2.5;
  const topR = (a) => Rt + lerp(13, 25, smooth((a - a0) / (a1 - a0)));
  const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  // outer plate: a band over the big ring, deepest at the tail, both ends rounded
  const outerS = new T.Shape(), n = 40;
  outerS.moveTo(...pol(r0, a0));
  for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); if (i === 0) continue; outerS.lineTo(...pol(r0, a)); }
  const cap = (a, rFrom, rTo, dir) => { // half-round end from radius rFrom to rTo at angle a, bulging along the tangent (dir +1 = toward the tail)
    const c = (rFrom + rTo) / 2, h = (rTo - rFrom) / 2, hb = Math.abs(h), u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a) * dir, Math.cos(a) * dir];
    for (let k = 1; k < 12; k++) { const t = -Math.PI / 2 + (k / 12) * Math.PI; outerS.lineTo(c * u[0] + h * Math.sin(t) * u[0] + hb * Math.cos(t) * v[0], c * u[1] + h * Math.sin(t) * u[1] + hb * Math.cos(t) * v[1]); }
  };
  cap(a1, r0, topR(a1), 1);
  for (let i = n; i >= 0; i--) outerS.lineTo(...pol(topR(lerp(a0, a1, i / n)), lerp(a0, a1, i / n)));
  cap(a0, topR(a0), r0, -1); // nose: from the top edge back down to the start
  outerS.closePath();
  const outer = B.add(slot, place(plate(outerS, 1.9, { bevel: 0.5, curve: 4 }), V(0, 0, zo)), black, { name: 'Outer cage plate' });
  // SHIMANO 105 on the outer face, reading front to back as seen from the drive side
  const aD = lerp(a0, a1, 0.5), rD = (r0 + topR(aD)) / 2 - 0.5, print = new T.PlaneGeometry(30, 15);
  print.rotateZ(aD - Math.PI / 2); print.translate(...pol(rD, aD), zo + 1.95);
  B.add(slot, print, decalMat(rdGraphic(), { metal: 0.3, rough: 0.4 }), { name: 'Outer plate print', shadow: false });
  // steel inner plate reaches below the tooth tips to lift the chain; bridges close the cage at nose and tail
  const geos = [place(plate(arcBand(Rt - 11, Rt + 13, a0 + rad(3), a1 - rad(4)), 1.4, { bevel: 0.3 }), V(0, 0, zi - 1.4))];
  for (const [a, r] of [[a1 + rad(1.5), (r0 + topR(a1)) / 2], [a0 + rad(1), Rt + 9.5]]) {
    const p = V(...pol(r, a), 0);
    geos.push(sweep([p.clone().setZ(zi - 0.6), p.clone().setZ(zo + 0.6)], { a: 2.6, b: 4.2, n: 3 }, { seg: 14, side: V(Math.cos(a), Math.sin(a), 0) }));
  }
  B.add(slot, merge(geos), inner, { name: 'Inner cage plate' });

  // braze-on tab on the front of the seat tube, found on the frame mesh itself
  const sA = B.frameAxes.sAxis, fr = B.frameAxes.sFront; // sA x Z = fr, so (sA, Z, fr) is a right-handed frame
  const mount = B.hp.bb.clone().addScaledVector(sA, Rt + 44).setZ(0);
  const tube = outer.parent?.children.find((c) => c.isMesh && c.userData?.part === 'Seat tube');
  let S = mount.clone().addScaledVector(fr, 19);
  if (tube) {
    const rc = new T.Raycaster(mount.clone().addScaledVector(fr, 200), fr.clone().negate());
    const probe = new T.Mesh(tube.geometry, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    const hit = rc.intersectObject(probe, false)[0]; if (hit) S = hit.point.setZ(0);
  }
  const at = (u, f, zz) => S.clone().addScaledVector(sA, u).addScaledVector(fr, f).setZ(zz); // u up the tube, f forward of its face
  B.add(slot, orient(plate(roundRect(40, 15, 7), 3.2, { bevel: 0.8 }), sA, Z, fr, at(0, -1.2, 0)), black, { name: 'Braze-on tab' });
  // body: mounting ear on the tab, block running outboard to the links, knuckle carrying the link pins
  const bodyG = [
    orient(plate(roundRect(24, 18, 6), 7, { bevel: 1.5 }), sA, Z, fr, at(-2, 2, 0)),
    orient(plate(roundRect(22, 20, 6), 11, { bevel: 2 }), sA, Z, fr, at(-6, 3, 15)),
    rod(at(-15, 9.5, 22), at(-15, 9.5, 34), 6.5, 6.5, 24),
  ];
  B.add(slot, merge(bodyG), black, { name: 'Derailleur body' });
  B.add(slot, place(boltHead(8.6, 3.6), at(-2, 9.2, 0), fr), M.bolt, { name: 'Mounting bolt' });
  // high and low limit screws on top of the body
  B.add(slot, merge([10, 20].map((zz) => place(boltHead(4.2, 2.2), at(6.8, 8.5, zz), sA))), M.aluSilver, { name: 'Limit screws' });
  // parallelogram: wide outer link to the top of the outer plate, narrower inner link to the inner plate
  const am = rad(97), cageTopO = V(...pol(topR(am) - 3, am), zo + 1.2), cageTopI = V(...pol(Rt + 11, am + rad(3)), zi - 1);
  const pO = at(-15, 9.5, 34), pI = at(-16, 5, 12);
  B.add(slot, sweep(spline([pO, pO.clone().lerp(cageTopO, 0.5).addScaledVector(Z, 2.5), cageTopO], 16), { a: 2.5, b: 9, n: 3.2 }, { seg: 16, side: fr, capRound: true }), black, { name: 'Outer link' });
  B.add(slot, sweep(spline([pI, pI.clone().lerp(cageTopI, 0.5), cageTopI], 14), { a: 2, b: 6, n: 3 }, { seg: 14, side: fr, capRound: true }), inner, { name: 'Inner link' });
  const pin = (p, r) => place(lathe([[0.01, 0], [r, 0], [r, 1], [r - 0.6, 1.6], [0.01, 1.6]], 16), p);
  B.add(slot, merge([pin(pO.clone().setZ(pO.z + 2.4), 3), pin(cageTopO.clone().setZ(cageTopO.z + 2.4), 2.8)]), M.aluSilver, { name: 'Link pins' });
  // cable-anchor arm off the back of the outer link, cable pulled up from under the bottom bracket
  const armRoot = pO.clone().lerp(cageTopO, 0.3), anchor = armRoot.clone().addScaledVector(fr, -20).addScaledVector(sA, -3).setZ(armRoot.z - 1);
  B.add(slot, sweep([armRoot, anchor], { a: 2.6, b: 4.5, n: 3 }, { seg: 14, side: sA, capRound: true }), black, { name: 'Cable arm' });
  B.add(slot, merge([place(boltHead(6.5, 2.6), anchor.clone().setZ(anchor.z + 2.4), Z), place(plate(roundRect(9, 7, 2), 1.2), anchor.clone().setZ(anchor.z + 2.4), Z, Math.atan2(fr.y, fr.x))]), M.bolt, { name: 'Cable anchor bolt' });
  B.fdCable = { clamp: anchor.clone() };
}