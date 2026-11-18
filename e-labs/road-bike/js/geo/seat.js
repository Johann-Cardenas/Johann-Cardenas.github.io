// Seatpost, saddle, bottle cages and bottles, rear light.
import * as T from 'three';
import { finish } from './materials.js';
import { V, AX, sweep, spline, rod, lathe, plate, merge, place, lerp, smooth, rad, boltHead, roundRect } from './kit.js';

export function buildSeat(B) {
  const { M, hp, fit } = B, FA = B.frameAxes, sA = FA.sAxis;
  const S = V(...fit.saddle), pv = B.part('seatpost')?.visual ?? {}, sv = B.part('saddle')?.visual ?? {};
  const railY = S.y - 50, clampC = V(S.x + 6, railY, 0);
  // post: up the seat-tube axis to just under the clamp, then a short head to the cradle
  const tTop = (railY - 14 - hp.bb.y) / sA.y, top = hp.bb.clone().addScaledVector(sA, tTop), low = hp.st.clone().addScaledVector(sA, -70);
  let postMat = (pv.style === 'leaf' ? M.carbon : M.aluBlack).clone(); postMat.color.set(pv.color || '#17181a'); postMat.name = 'seatpost'; postMat = finish(postMat, B.P.f_post);
  const post = [rod(low, top, 13.6, 13.6, 32)];
  post.push(sweep([top.clone().addScaledVector(sA, -6), top.clone().lerp(clampC, 0.55).add(V(0, 2, 0)), clampC.clone().add(V(0, -3, 0))], (u) => ({ a: lerp(13.6, 9, u), b: lerp(13.6, 15, u), n: 2.6 }), { seg: 24, capRound: true }));
  B._fixedGroup = B.add('seatpost', merge(post), postMat, { name: 'Seatpost' }).parent; // for surface probes in buildCages
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
  if (sv.style === 'channel') B.add('saddle', plate(roundRect(Lg * 0.62, 13, 6.5), 1.2).rotateX(-Math.PI / 2).translate(S.x + 12 + Lg * 0.06, S.y - 0.9, 0), M.plasticGloss, { name: 'Centre channel', shadow: false });
  if (short) B.add('saddle', plate(roundRect(Lg * 0.46, 15, 7.5), 2).rotateX(-Math.PI / 2).translate(S.x + 12 + Lg * 0.02, S.y - 0.6, 0), M.hole, { name: 'Pressure-relief cut-out', shadow: false });
  const rails = [];
  for (const s of [-1, 1]) rails.push(sweep(spline([V(S.x + 12 - Lg * 0.34, S.y - 20, s * Wd * 0.55), V(clampC.x - 46, railY, s * 22), V(clampC.x + 46, railY, s * 22), V(S.x + 12 + Lg * 0.40, S.y - 14, s * 9)], 30), 3.5, { seg: 10 }));
  B.add('saddle', merge(rails), M.steel, { name: 'Saddle rails' });
  B.saddleNose = V(S.x + 12 + Lg * 0.5, S.y, 0);
  B.seatpostTop = top;

  if (B.cfg.rear_light) buildVaria(B, { top, tTop });
}

/**
 * Garmin Varia RTL515 (98.7 x 39.6 x 31.5 mm) on Garmin's seatpost mount: a moulded base that cups
 * the back of the post on a rubber pad, held by two rubber straps hooked over its side lugs, with a
 * wedge that brings the light back to vertical and a quarter-turn cradle on its rear face.
 */
function buildVaria(B, { top, tTop }) {
  const { M, hp } = B, FA = B.frameAxes, sA = FA.sAxis, back = FA.sFront.clone().negate(), Z = V(0, 0, 1);
  const rp = 13.6, exposed = tTop - hp.st.distanceTo(hp.bb);
  const tC = hp.st.distanceTo(hp.bb) + Math.min(Math.max(exposed * 0.45, 78), exposed - 72); // mount centre along the post
  const O = hp.bb.clone().addScaledVector(sA, tC); // on the post axis
  const hh = 26, hw = 14, pad = 1.2; // base half-height along the post, half-width, rubber pad
  // the base: front face is the post's cylinder (plus pad), rear face a vertical plane
  const ax = (v) => O.clone().addScaledVector(sA, v);
  const rearX = Math.min(...[-hh, hh].map((v) => ax(v).addScaledVector(back, rp + pad + 6).x)); // thinnest point 6 mm
  const front = (u, v) => { const z = u * hw, r = rp + pad, d = Math.sqrt(Math.max(r * r - z * z, 0)); return ax(v).addScaledVector(back, d).setZ(z); };
  const rear = (u, v) => { const p = front(u, v); return V(rearX, p.y, p.z); };
  const two = (m, col) => { const k = m.clone(); k.side = T.DoubleSide; if (col) k.color.set(col); return k; };
  B.add('rear_light', slab((u, v) => front(u, v * hh), (u, v) => rear(u, v * hh), 10, 8), two(M.plastic, 0x2c2e33), { name: 'Seatpost mount' });
  // rubber pad between the base and the post
  const pw = Math.min(hw, rp - 0.4);
  B.add('rear_light', slab((u, v) => ax(v * hh).addScaledVector(back, Math.sqrt(Math.max(rp * rp - (u * pw) ** 2, 0))).setZ(u * pw),
    (u, v) => front(u * pw / hw, v * hh), 10, 4), two(M.rubber), { name: 'Mount pad' });
  // strap lugs on both flanks, and the two straps round the front of the post
  const lugs = [], straps = [];
  for (const v of [-hh + 6, hh - 6]) {
    const mid = (front(1, v).x + rearX) / 2;
    for (const s of [-1, 1]) lugs.push(rod(V(mid, ax(v).y, s * (hw - 1)), V(mid, ax(v).y, s * (hw + 4.2)), 2.3, 2.6, 12));
    // from the lug on one flank, round the front of the post, to the other lug
    const r = rp + 1.4, lugZ = hw + 2.6, pts = [V(mid, ax(v).y, -lugZ)];
    for (let i = 0; i <= 18; i++) { const a = lerp(-rad(98), rad(98), i / 18); pts.push(ax(v).addScaledVector(back, -Math.cos(a) * r).addScaledVector(Z, Math.sin(a) * r)); }
    pts.push(V(mid, ax(v).y, lugZ));
    straps.push(sweep(spline(pts, 48), { a: 1.4, b: 3.2, n: 2.4 }, { seg: 10, side: sA, transport: true, capRound: true }));
  }
  B.add('rear_light', merge(lugs), M.plastic, { name: 'Strap lugs' });
  B.add('rear_light', merge(straps), M.rubber, { name: 'Mount straps' });
  // quarter-turn cradle on the rear face, light on it (vertical, lens facing back)
  const cy = O.y, cr = V(rearX, cy, 0);
  const ring = lathe([[11.4, 0], [15.6, 0], [15.6, 3.4], [15, 4.2], [11.4, 4.2]], 32); ring.rotateY(-Math.PI / 2); ring.translate(cr.x, cr.y, 0);
  B.add('rear_light', ring, M.plastic, { name: 'Light cradle' });
  const Lh = 98.7, Lw = 39.6, Ld = 31.5, fx = rearX - 4.2, c = V(fx - Ld / 2, cy - 8, 0);
  const body = rplate(Lw, Lh, 15, Ld, 3); body.rotateY(Math.PI / 2); body.translate(c.x, c.y, 0);
  B.add('rear_light', body, M.plasticGloss, { name: 'Radar tail light' });
  const face = rplate(Lw - 5, Lh - 6, 13, 1.2, 0.3); face.rotateY(Math.PI / 2); face.translate(c.x - Ld / 2 - 0.2, c.y, 0);
  const radarM = M.plasticGloss.clone(); radarM.color.set(0x050607); radarM.name = 'radar_window';
  B.add('rear_light', face, radarM, { name: 'Radar window', shadow: false });
  const lens = rplate(18, 34, 8, 1.6, 0.4); lens.rotateY(Math.PI / 2); lens.translate(c.x - Ld / 2 - 0.6, c.y - 18, 0);
  B.add('rear_light', lens, M.lensRed, { name: 'Tail light lens', shadow: false });
  B.add('rear_light', place(lathe([[0.01, 0], [4, 0], [4, 1.2], [0.01, 1.4]], 18), V(c.x + 2, c.y - Lh / 2, 0), V(0, -1, 0)), M.rubber, { name: 'Power button' });
}

/** Closed solid between two parametric surfaces f(u, v), g(u, v), u, v in [-1, 1]. */
function slab(f, g, nu = 8, nv = 8) {
  const pos = [], idx = [], grid = (fn) => { const o = pos.length / 3; for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = fn(-1 + 2 * i / nu, -1 + 2 * j / nv); pos.push(p.x, p.y, p.z); } return o; };
  const a = grid(f), b = grid(g), w = nu + 1, id = (o, i, j) => o + j * w + i;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    idx.push(id(a, i, j), id(a, i, j + 1), id(a, i + 1, j), id(a, i + 1, j), id(a, i, j + 1), id(a, i + 1, j + 1));
    idx.push(id(b, i, j), id(b, i + 1, j), id(b, i, j + 1), id(b, i + 1, j), id(b, i + 1, j + 1), id(b, i, j + 1));
  }
  const ring = [];
  for (let i = 0; i < nu; i++) ring.push([i, 0, i + 1, 0]);
  for (let j = 0; j < nv; j++) ring.push([nu, j, nu, j + 1]);
  for (let i = nu; i > 0; i--) ring.push([i, nv, i - 1, nv]);
  for (let j = nv; j > 0; j--) ring.push([0, j, 0, j - 1]);
  for (const [i0, j0, i1, j1] of ring) idx.push(id(a, i0, j0), id(a, i1, j1), id(b, i0, j0), id(a, i1, j1), id(b, i1, j1), id(b, i0, j0));
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const flat = geo.toNonIndexed(); flat.computeVertexNormals();
  return flat;
}

/** Rounded slab whose OUTER size is w x h x depth (ExtrudeGeometry's bevel grows the outline). */
function rplate(w, h, r, depth, bevel) {
  return plate(roundRect(w - 2 * bevel, h - 2 * bevel, Math.max(r - bevel, 0.5)), depth, { bevel, curve: 14 });
}

export function buildCages(B) {
  if (!B.cfg.cages) return;
  const { M, hp } = B, FA = B.frameAxes, vis = B.part('cages')?.visual ?? {};
  // glossy black alloy-tube cages, as in the owner's photos
  let mat = M.aluBlack.clone(); mat.color.set(vis.color || '#121315'); mat.roughness = 0.24; mat.metalness = 0.6; mat.name = 'cage'; mat = finish(mat, B.P.f_cage);
  // dark smoke insulated bottles with black collars and grey valves (owner's photos)
  const bottleM = M.bottle.clone(); bottleM.color.set(B.P.f_bottle && B.P.f_bottle !== 'auto' ? B.P.f_bottle : 0x3c4249); bottleM.transmission = 0.3; bottleM.roughness = 0.28; bottleM.thickness = 2; bottleM.name = 'bottle_smoke';
  const capM = M.plastic.clone(); capM.color.set(0x16171a); capM.name = 'bottle_cap';
  const valveM = M.plastic.clone(); valveM.color.set(0x9a9fa6); valveM.roughness = 0.5; valveM.name = 'bottle_valve';
  const surf = tubeSurface(B);
  const tubes = [
    { bosses: B.bosses.seat, dir: FA.sAxis, out: FA.sFront, part: 'Seat tube', fb: () => 21 },
    { bosses: B.bosses.down, dir: FA.dtDir, out: FA.dtUp, part: 'Down tube', fb: () => 26 },
  ];
  // bottle (21 oz class): radius 37, 214 mm to the shoulder of the cap, waist for the cage hoop
  const R = 37, prof = [[0.01, 0], [R - 5, 0], [R - 1.2, 1.5], [R, 6], [R, 104], [R - 2.6, 113], [R - 2.6, 128], [R, 137], [R, 160], [R - 4, 178], [R - 13, 194], [21, 202], [21, 207], [0.01, 207]];
  const rAt = (h) => { for (let i = 1; i < prof.length; i++) if (h <= prof[i][1]) { const [r0, h0] = prof[i - 1], [r1, h1] = prof[i]; return lerp(r0, r1, (h - h0) / Math.max(h1 - h0, 1e-6)); } return 21; };
  const hb = 34; // bottle base below the lower boss
  const ROD = { a: 2.9, b: 2.9, n: 2 }; // 5.8 mm round alloy tube
  const zr = 7, nR = ROD.a + 0.3, ax = 2 * nR + 0.3 + R; // spine rails either side of the bolts; bottle axis offset from the tube
  // cage frame on a tube: where the bosses (slid `sh` mm up the tube) meet its surface, measured on
  // the frame mesh itself, with the spine lifted wherever the tube is proud of the line between them
  const cageFrame = (t, sh) => {
    const b0 = t.bosses[0].clone().addScaledVector(t.dir, sh), b1 = t.bosses[1].clone().addScaledVector(t.dir, sh);
    const s0 = surf(t, b0), s1 = surf(t, b1);
    const e1 = s1.clone().sub(s0).normalize(), e2 = t.out.clone().addScaledVector(e1, -t.out.dot(e1)).normalize();
    let lift = 0;
    const span = s0.distanceTo(s1);
    for (const h of [-hb - 2, -hb / 2, span / 2, span + 12]) lift = Math.max(lift, surf(t, b0.clone().addScaledVector(e1, h)).sub(s0).dot(e2));
    return { e1, e2, span, O: s0.addScaledVector(e2, lift) };
  };
  // distance from p to the segment ab
  const segDist = (p, a, b) => { const ab = b.clone().sub(a), k = Math.min(Math.max(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0), 1); return p.distanceTo(a.clone().addScaledVector(ab, k)); };
  let placed = null; // the first bottle's axis, for the clearance check
  for (const t of tubes) {
    // B.bosses.down (150 / 214 mm from the BB) puts the down-tube bottle through the seat-tube bottle;
    // until the bosses are measured, the down-tube cage is slid up to the first position where the
    // two bottles clear each other by 3 mm (the bolts follow the cage).
    let sh = 0, F = cageFrame(t, 0);
    if (placed) {
      const clear = (F) => {
        for (let h = 0; h <= 235; h += 8) for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2, r = h > 205 ? 23 : rAt(h);
          const p = F.O.clone().addScaledVector(F.e1, h - hb).addScaledVector(F.e2, ax + r * Math.cos(a)).setZ(r * Math.sin(a));
          const q = V(p.x, p.y, 0), d = Math.hypot(segDist(q, placed[0], placed[1]), p.z);
          if (segDist(q, placed[0], placed[1]) < R + 3 && Math.abs(p.z) < R + 3 && d < R + 3) return false;
        }
        return true;
      };
      while (sh < 160 && !clear(F)) { sh += 4; F = cageFrame(t, sh); }
    }
    const { e1, e2, span, O } = F;
    placed ||= [O.clone().addScaledVector(e1, -hb).addScaledVector(e2, ax), O.clone().addScaledVector(e1, 235 - hb).addScaledVector(e2, ax)];
    const L = (h, n, z = 0) => O.clone().addScaledVector(e1, h).addScaledVector(e2, n).setZ(z);
    // point on a cylinder of radius r about the bottle axis, at height h (cage frame) and angle phi from the spine
    const W = (h, phi, r) => L(h, ax - r * Math.cos(phi), r * Math.sin(phi));
    const onBottle = (h, phi, gap = 0) => W(h, phi, rAt(h + hb) + ROD.a + gap);
    // Classic bent alloy-tube cage. One closed loop: down the two spine rails, out under the bottle's
    // base as the foot, up the front as the tongue, and across the top of the tongue into the bottle's
    // waist so it holds the bottle down. Two side arms leave the top of the spine, wrap the bottle at
    // the waist and drop to meet the tongue.
    const r = ROD.a, hf = -hb - r - 0.4, pT = Math.PI - 0.27, hT = 118 - hb, top = span + 14;
    const side = (s) => [
      L(top - 5, nR, s * zr), L(span / 2, nR, s * zr), L(-hb + 12, nR, s * zr),
      L(-hb + 1, nR + 1.2, s * (zr + 0.8)), L(hf + 0.6, nR + 7, s * (zr + 2.4)),
      L(hf, ax - 10, s * 10.4), L(hf, ax + R - 14, s * 10.4), L(hf + 1.6, ax + R - 4, s * 10.4),
      onBottle(-hb + 7, s * pT), onBottle(-hb + 30, s * pT), onBottle(hT - 34, s * pT), onBottle(hT - 10, s * pT),
      onBottle(hT - 1, s * (Math.PI - 0.12)),
    ];
    const loop = [...side(1), onBottle(hT + 0.5, Math.PI), ...side(-1).reverse(), L(top - 1.5, nR, -4), L(top, nR, 0), L(top - 1.5, nR, 4)];
    const g = [sweep(spline(loop, 220, { closed: true }), ROD, { seg: 12, side: e1, transport: true, cap: false })];
    for (const s of [-1, 1]) {
      const arm = [L(span - 4, nR, s * zr), L(span + 8, nR + 3, s * (zr + 5)), onBottle(hT - 10, s * rad(48)), onBottle(hT - 4, s * rad(86)),
        onBottle(hT - 8, s * rad(122)), onBottle(hT - 28, s * rad(148)), onBottle(hT - 50, s * (pT - 0.04))];
      g.push(sweep(spline(arm, 80), ROD, { seg: 12, side: e1, transport: true, capRound: true }));
    }
    // flattened backbone between the rails where the bolts go through
    g.push(sweep([L(-10, 1.1), L(span + 10, 1.1)], { a: 1.1, b: 9.6, n: 4 }, { seg: 16, side: AX.z, capRound: true }));
    B.add('cages', merge(g), mat, { name: 'Bottle cage' });
    // M5 cap screws through the backbone
    B.add('cages', merge([0, span].map((h) => place(boltHead(7.6, 2.6), L(h, 2.2), e2))), M.bolt, { name: 'Cage bolts' });
    if (B.P.bottles) {
      const base = L(-hb, ax), axis = e1.clone();
      B.add('cages', place(lathe(prof, 44), base, axis), bottleM, { name: 'Bottle' });
      const collar = [[0.01, 205], [22.4, 205], [23, 207], [23, 219], [21.5, 221], [12, 222], [0.01, 222]];
      B.add('cages', place(lathe(collar, 32), base, axis), capM, { name: 'Bottle cap' });
      const valve = [[0.01, 221], [11, 221], [11, 224], [9.6, 225], [9.6, 232], [6.8, 235.5], [0.01, 235.5]];
      B.add('cages', place(lathe(valve, 28), base, axis), valveM, { name: 'Bottle valve' });
    }
  }
}

/**
 * Returns surf(t, p): the point where the ray from far outside along -t.out through p (z = 0)
 * first meets the named frame tube. Falls back to an offset of t.fb when the mesh is not found.
 */
function tubeSurface(B) {
  const group = B._fixedGroup, rc = new T.Raycaster(), cache = new Map();
  const probe = (name) => {
    if (!cache.has(name)) {
      const m = group?.children.find((c) => c.userData?.part === name && c.isMesh);
      cache.set(name, m ? new T.Mesh(m.geometry, new T.MeshBasicMaterial({ side: T.DoubleSide })) : null);
    }
    return cache.get(name);
  };
  return (t, p) => {
    const mesh = probe(t.part);
    if (mesh) {
      rc.set(p.clone().setZ(0).addScaledVector(t.out, 200), t.out.clone().negate());
      const hit = rc.intersectObject(mesh, false)[0];
      if (hit) return hit.point.setZ(0);
    }
    return p.clone().setZ(0).addScaledVector(t.out, t.fb(p));
  };
}
