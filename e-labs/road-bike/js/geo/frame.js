// Frame, fork and headset. Sections come from data/geometry.json (tubes); side-view heights are
// from the owner's photos, lateral widths are still assumptions until M09.
//
// The frame is one moulded carbon piece, so it is not built from tubes that interpenetrate. Each
// tube is a signed-distance body (a superelliptic section swept along a path); the bodies are
// joined with a smooth minimum, which is what puts a moulded fillet into every junction, and the
// joined field is meshed once with surface nets. The mesh is then split back into named parts by
// whichever tube is nearest, so picking and per-tube paint still work, while the normals come from
// the field's gradient and are identical on both sides of every split: no shading seam anywhere.
import * as T from 'three';
import { V, spline, lathe, plate, rod, lerp, smooth, place, linkShape, circlePath, boltHead, merge } from './kit.js';
import { tubePaint } from './materials.js';

const pick = (spec, u, k) => {
  if (spec.mid) return u <= 0.5 ? lerp(spec.start[k], spec.mid[k], smooth(u / 0.5)) : lerp(spec.mid[k], spec.end[k], smooth((u - 0.5) / 0.5));
  return lerp(spec.start[k], spec.end[k], u);
};
/** Section function for a tube spec. `flare` swells an end slightly; `tip` shrinks the part of an
 *  end that is buried in a neighbour so its cap cannot poke out of the far side. */
function sectionOf(spec, { flare0 = 0, flare1 = 0, len0 = 0.1, len1 = 0.1, tip0 = null, tip1 = null } = {}) {
  return (u) => {
    let f = 1 + flare0 * (1 - smooth(u / len0)) + flare1 * (1 - smooth((1 - u) / len1));
    if (tip0) f *= lerp(tip0[1], 1, smooth(u / tip0[0]));
    if (tip1) f *= lerp(tip1[1], 1, smooth((1 - u) / tip1[0]));
    return { a: pick(spec, u, 'a') * f, b: pick(spec, u, 'b') * f, n: pick(spec, u, 'n') };
  };
}

// ---- implicit bodies --------------------------------------------------------------------------
/**
 * A tube as a distance body. The section frame is built exactly as kit.sweep builds it (B from
 * `side`, N = B x t), so the UVs computed later match the paint layouts drawn for swept tubes:
 * u = arc-length fraction, v = position round the section (v = 0.25 is +B).
 */
function body(name, paint, pts, section, { side = V(0, 0, 1), transport = false, k = 12, capR = 1.5 } = {}) {
  const n = pts.length;
  const P = new Float64Array(n * 3), N = new Float64Array(n * 3), Bv = new Float64Array(n * 3), Ts = new Float64Array(n * 3);
  const A = new Float64Array(n), Bs = new Float64Array(n), E = new Float64Array(n), S = new Float64Array(n);
  let Bprev = null, maxR = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const t = pts[Math.min(i + 1, n - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
    let B = (transport && Bprev ? Bprev : side).clone();
    B.addScaledVector(t, -B.dot(t));
    if (B.lengthSq() < 0.04) { B = (Bprev || V(0, 1, 0)).clone(); B.addScaledVector(t, -B.dot(t)); }
    B.normalize(); Bprev = B;
    const Nv = B.clone().cross(t).normalize();
    P.set([pts[i].x, pts[i].y, pts[i].z], i * 3); N.set([Nv.x, Nv.y, Nv.z], i * 3); Bv.set([B.x, B.y, B.z], i * 3);
    if (i) S[i] = S[i - 1] + pts[i].distanceTo(pts[i - 1]);
    if (i < n - 1) { const d = pts[i + 1].clone().sub(pts[i]); const l = d.length() || 1; Ts.set([d.x / l, d.y / l, d.z / l], i * 3); }
  }
  const L = S[n - 1] || 1;
  for (let i = 0; i < n; i++) {
    let s = typeof section === 'function' ? section(S[i] / L) : section; if (typeof s === 'number') s = { a: s, b: s };
    A[i] = s.a; Bs[i] = s.b ?? s.a; E[i] = s.n ?? 2;
    maxR = Math.max(maxR, A[i], Bs[i]);
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[i * 3 + c]); hi[c] = Math.max(hi[c], P[i * 3 + c]); }
  }
  const pad = maxR * 1.42 + capR + 1;
  for (let c = 0; c < 3; c++) { lo[c] -= pad; hi[c] += pad; }
  // segments in chunks with bounding spheres, so a query tests only the chunks that can be nearest
  const C = 6, nc = Math.ceil((n - 1) / C), CS = new Float64Array(nc * 4);
  for (let c = 0; c < nc; c++) {
    const i0 = c * C, i1 = Math.min(i0 + C, n - 1);
    let cx = 0, cy = 0, cz = 0;
    for (let i = i0; i <= i1; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
    const m = i1 - i0 + 1; cx /= m; cy /= m; cz /= m;
    let r = 0; for (let i = i0; i <= i1; i++) r = Math.max(r, Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy, P[i * 3 + 2] - cz));
    CS.set([cx, cy, cz, r], c * 4);
  }
  return { name, paint, n, P, N, Bv, Ts, A, Bs, E, S, L, k, capR, lo, hi, C, nc, CS, lb: new Float64Array(nc), reach: maxR * 1.42 + capR };
}

/** Signed distance from (x,y,z) to a body; fills `o` with u and the local section coordinates. */
function query(b, x, y, z, o, cull = Infinity, r0 = -1, r1 = 0) {
  const { n, P, Ts, C, nc, CS, lb } = b;
  let best = Infinity, bi = 0, bt = 0, cmin = 0, lmin = Infinity;
  if (r0 >= 0) { // the caller already knows which segments can be nearest
    for (let i = r0; i < r1; i++) {
      const i3 = i * 3, ax = P[i3], ay = P[i3 + 1], az = P[i3 + 2];
      const dx = P[i3 + 3] - ax, dy = P[i3 + 4] - ay, dz = P[i3 + 5] - az;
      const ll = dx * dx + dy * dy + dz * dz || 1;
      let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / ll;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - ax - dx * t, ey = y - ay - dy * t, ez = z - az - dz * t;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < best) { best = d2; bi = i; bt = t; }
    }
    lmin = -Infinity;
  }
  for (let c = 0; c < nc && r0 < 0; c++) {
    const ux = x - CS[c * 4], uy = y - CS[c * 4 + 1], uz = z - CS[c * 4 + 2];
    const l = Math.sqrt(ux * ux + uy * uy + uz * uz) - CS[c * 4 + 3];
    lb[c] = l; if (l < lmin) { lmin = l; cmin = c; }
  }
  if (lmin - b.reach > cull) return lmin - b.reach;
  for (let c = -1; c < nc && r0 < 0; c++) {
    const cc = c < 0 ? cmin : c;
    if (c === cmin || (c >= 0 && lb[cc] > 0 && lb[cc] * lb[cc] >= best)) continue;
    const i1 = Math.min(cc * C + C, n - 1);
  for (let i = cc * C; i < i1; i++) {
    const i3 = i * 3, ax = P[i3], ay = P[i3 + 1], az = P[i3 + 2];
    const dx = P[i3 + 3] - ax, dy = P[i3 + 4] - ay, dz = P[i3 + 5] - az;
    const ll = dx * dx + dy * dy + dz * dz || 1;
    let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / ll;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - ax - dx * t, ey = y - ay - dy * t, ez = z - az - dz * t;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 < best) { best = d2; bi = i; bt = t; }
  }
  }
  const i3 = bi * 3, j3 = i3 + 3, t = bt, s = 1 - t;
  const qx = P[i3] * s + P[j3] * t, qy = P[i3 + 1] * s + P[j3 + 1] * t, qz = P[i3 + 2] * s + P[j3 + 2] * t;
  const rx = x - qx, ry = y - qy, rz = z - qz;
  const Nx = b.N[i3] * s + b.N[j3] * t, Ny = b.N[i3 + 1] * s + b.N[j3 + 1] * t, Nz = b.N[i3 + 2] * s + b.N[j3 + 2] * t;
  const Bx = b.Bv[i3] * s + b.Bv[j3] * t, By = b.Bv[i3 + 1] * s + b.Bv[j3 + 1] * t, Bz = b.Bv[i3 + 2] * s + b.Bv[j3 + 2] * t;
  const ln = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) || 1, lbn = Math.sqrt(Bx * Bx + By * By + Bz * Bz) || 1;
  const lx = (rx * Nx + ry * Ny + rz * Nz) / ln, ly = (rx * Bx + ry * By + rz * Bz) / lbn;
  const a = b.A[bi] * s + b.A[bi + 1] * t, bb = b.Bs[bi] * s + b.Bs[bi + 1] * t, ex = b.E[bi] * s + b.E[bi + 1] * t;
  const kx = Math.abs(lx) / a, ky = Math.abs(ly) / bb;
  const kk = ex === 2 ? Math.sqrt(kx * kx + ky * ky) : Math.pow(Math.pow(kx, ex) + Math.pow(ky, ex), 1 / ex), rr = Math.sqrt(lx * lx + ly * ly);
  const dr = kk > 1e-6 ? rr * (1 - 1 / kk) : -Math.min(a, bb);
  // flat, slightly rounded ends where the path stops
  let e = -Infinity;
  if (bi === 0 && bt === 0) e = -(rx * Ts[0] + ry * Ts[1] + rz * Ts[2]);
  else if (bi === n - 2 && bt === 1) { const k3 = (n - 2) * 3; e = rx * Ts[k3] + ry * Ts[k3 + 1] + rz * Ts[k3 + 2]; }
  let d = dr;
  if (e > -b.capR - 1) {
    const c = b.capR, px = dr + c, py = e + c;
    const qx = Math.max(px, 0), qy = Math.max(py, 0);
    d = Math.sqrt(qx * qx + qy * qy) + Math.min(Math.max(px, py), 0) - c;
  }
  if (o) { o.u = (b.S[bi] + bt * (b.S[bi + 1] - b.S[bi])) / b.L; o.lx = lx / a; o.ly = ly / bb; o.ex = ex; }
  return d;
}

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/** The joined field: smooth union of the bodies, minus the bores. Bodies are blended in order, each
 *  with its own fillet radius k. */
function field(bodies, holes = []) {
  const full = bodies.map((b) => ({ b, r0: -1, r1: 0 }));
  const f = (x, y, z, list = full) => {
    let d = 1e9;
    for (let i = 0; i < list.length; i++) {
      const { b, r0, r1 } = list[i];
      const ox = Math.max(b.lo[0] - x, 0, x - b.hi[0]), oy = Math.max(b.lo[1] - y, 0, y - b.hi[1]), oz = Math.max(b.lo[2] - z, 0, z - b.hi[2]);
      const bd = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const di = bd > 30 ? bd : query(b, x, y, z, null, 30, r0, r1);
      if (di - d >= b.k) continue;
      d = smin(d, di, b.k);
    }
    for (let i = 0; i < holes.length; i++) d = Math.max(d, -holes[i](x, y, z));
    return d;
  };
  /** Bodies that can matter within `r` of a point (blending order kept), each with the span of
   *  segments that can be nearest to any point within `D` of it. */
  f.near = (x, y, z, r, D) => {
    const out = [];
    for (const b of bodies) {
      if (query(b, x, y, z, null, r) > r) continue;
      const ds = [];
      let dmin = Infinity;
      for (let i = 0; i < b.n - 1; i++) {
        const i3 = i * 3, ax = b.P[i3], ay = b.P[i3 + 1], az = b.P[i3 + 2];
        const dx = b.P[i3 + 3] - ax, dy = b.P[i3 + 4] - ay, dz = b.P[i3 + 5] - az;
        let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz || 1);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dd = Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t);
        ds.push(dd); dmin = Math.min(dmin, dd);
      }
      let r0 = Infinity, r1 = -1;
      ds.forEach((dd, i) => { if (dd <= dmin + 2 * D) { r0 = Math.min(r0, i); r1 = Math.max(r1, i); } });
      out.push({ b, r0, r1: r1 + 1 });
    }
    return out;
  };
  return f;
}

/** Capped cylinder distance (negative inside) for bores. */
function cylinder(a, dir, r, l0, l1) {
  const d = dir.clone().normalize();
  return (x, y, z) => {
    const px = x - a.x, py = y - a.y, pz = z - a.z, s = px * d.x + py * d.y + pz * d.z;
    const qx = px - d.x * s, qy = py - d.y * s, qz = pz - d.z * s;
    const rr = Math.sqrt(qx * qx + qy * qy + qz * qz) - r, ax = Math.max(l0 - s, s - l1);
    const mr = Math.max(rr, 0), ma = Math.max(ax, 0);
    return Math.sqrt(mr * mr + ma * ma) + Math.min(Math.max(rr, ax), 0);
  };
}

/**
 * Surface nets over a sparse block grid: only 8^3 blocks that the coarse pass finds near the
 * surface are sampled. Vertices are projected onto the surface with Newton steps and take the
 * field's gradient as their normal.
 */
function surfaceNets(f, lo, hi, h) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 2, ny = Math.ceil((hi[1] - lo[1]) / h) + 2, nz = Math.ceil((hi[2] - lo[2]) / h) + 2;
  const S = 8, bx = Math.ceil(nx / S), by = Math.ceil(ny / S), bz = Math.ceil(nz / S);
  const blocks = new Array(bx * by * bz), sign = new Int8Array(bx * by * bz), near = [], lists = new Map();
  const half = Math.sqrt(3) * S * h * 0.5, rad = half * 1.3 + 2 * h;
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    const id = i + bx * (j + by * k), c = (S - 1) / 2;
    const d = f(lo[0] + (i * S + c) * h, lo[1] + (j * S + c) * h, lo[2] + (k * S + c) * h);
    if (Math.abs(d) > rad) { sign[id] = d < 0 ? -1 : 1; continue; }
    const arr = new Float32Array(S * S * S);
    const list = f.near(lo[0] + (i * S + c) * h, lo[1] + (j * S + c) * h, lo[2] + (k * S + c) * h, rad + 2 * half + 25, half + 1.5 * h);
    const at = (a2, b2, c2) => f(lo[0] + (i * S + a2) * h, lo[1] + (j * S + b2) * h, lo[2] + (k * S + c2) * h, list);
    // every other sample first; a sample next to one that is well clear of the surface only needs its sign
    for (let c2 = 0; c2 < S; c2 += 2) for (let b2 = 0; b2 < S; b2 += 2) for (let a2 = 0; a2 < S; a2 += 2) arr[a2 + S * (b2 + S * c2)] = at(a2, b2, c2);
    for (let c2 = 0; c2 < S; c2++) for (let b2 = 0; b2 < S; b2++) for (let a2 = 0; a2 < S; a2++) {
      if (!(a2 & 1) && !(b2 & 1) && !(c2 & 1)) continue;
      const pv = arr[(a2 & ~1) + S * ((b2 & ~1) + S * (c2 & ~1))];
      arr[a2 + S * (b2 + S * c2)] = Math.abs(pv) > 2.6 * h ? pv : at(a2, b2, c2);
    }
    blocks[id] = arr; near.push(id); lists.set(id, list);
  }
  const get = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= bx * S || j >= by * S || k >= bz * S) return 1e3;
    const id = (i >> 3) + bx * ((j >> 3) + by * (k >> 3)), b = blocks[id]; // S = 8
    return b ? b[(i & 7) | ((j & 7) << 3) | ((k & 7) << 6)] : sign[id] * 1e3;
  };
  const vmap = new Map(), pos = [], vlist = [], cv = new Float64Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const each = (fn) => {
    for (const id of near) {
      const i0 = (id % bx) * S, j0 = (((id / bx) | 0) % by) * S, k0 = ((id / (bx * by)) | 0) * S;
      for (let k = k0; k < k0 + S; k++) for (let j = j0; j < j0 + S; j++) for (let i = i0; i < i0 + S; i++) fn(i, j, k);
    }
  };
  each((i, j, k) => {
    let mask = 0;
    for (let c = 0; c < 8; c++) { cv[c] = get(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1)); if (cv[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) return;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [a, b] of EDGES) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += (a & 1) + t * ((b & 1) - (a & 1)); sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1)); sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
      m++;
    }
    vmap.set(i + nx * (j + ny * k), pos.length / 3);
    vlist.push(lists.get(((i / S) | 0) + bx * (((j / S) | 0) + by * ((k / S) | 0))));
    pos.push(lo[0] + (i + sx / m) * h, lo[1] + (j + sy / m) * h, lo[2] + (k + sz / m) * h);
  });
  // project onto the surface and take the gradient as the normal
  const nrm = new Float32Array(pos.length), e = h * 0.2;
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2];
    const L = vlist[v / 3];
    // one Newton step onto the surface; its gradient is the normal (the step is a fraction of a cell)
    const d = f(x, y, z, L), gx = (f(x + e, y, z, L) - d) / e, gy = (f(x, y + e, z, L) - d) / e, gz = (f(x, y, z + e, L) - d) / e;
    const g2 = gx * gx + gy * gy + gz * gz, gl = Math.sqrt(g2) || 1;
    nrm[v] = gx / gl; nrm[v + 1] = gy / gl; nrm[v + 2] = gz / gl;
    if (g2 > 1e-6) {
      const lim = h * 0.9, st = d / g2;
      x -= Math.max(-lim, Math.min(lim, st * gx)); y -= Math.max(-lim, Math.min(lim, st * gy)); z -= Math.max(-lim, Math.min(lim, st * gz));
    }
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
  }
  // one quad per sign-changing grid edge
  const tris = [], key = (i, j, k) => vmap.get(i + nx * (j + ny * k));
  const quad = (a, b, c, d, flip) => {
    if (a === undefined || b === undefined || c === undefined || d === undefined) return;
    const dist = (p, q) => Math.hypot(pos[p * 3] - pos[q * 3], pos[p * 3 + 1] - pos[q * 3 + 1], pos[p * 3 + 2] - pos[q * 3 + 2]);
    let t1, t2;
    if (dist(a, c) <= dist(b, d)) { t1 = [a, b, c]; t2 = [a, c, d]; } else { t1 = [a, b, d]; t2 = [b, c, d]; }
    if (flip) { t1.reverse(); t2.reverse(); }
    tris.push(...t1, ...t2);
  };
  each((i, j, k) => {
    const v0 = get(i, j, k), inside = v0 < 0;
    if (j > 0 && k > 0 && (get(i + 1, j, k) < 0) !== inside) quad(key(i, j - 1, k - 1), key(i, j, k - 1), key(i, j, k), key(i, j - 1, k), !inside);
    if (i > 0 && k > 0 && (get(i, j + 1, k) < 0) !== inside) quad(key(i - 1, j, k - 1), key(i - 1, j, k), key(i, j, k), key(i, j, k - 1), !inside);
    if (i > 0 && j > 0 && (get(i, j, k + 1) < 0) !== inside) quad(key(i - 1, j - 1, k), key(i, j - 1, k), key(i, j, k), key(i - 1, j, k), !inside);
  });
  // make every triangle face along its vertex normals (independent of the winding bookkeeping)
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const s = fx * (nrm[a] + nrm[b] + nrm[c]) + fy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + fz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]);
    if (s < 0) { const tmp = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = tmp; }
  }
  return { pos: Float32Array.from(pos), nrm, tris, vlist };
}

/** Split the joined mesh into one geometry per body (nearest body owns a triangle), with that
 *  body's UVs. The v seam is unwrapped per triangle; tubePaint textures repeat in v. */
function splitByBody(mesh, bodies) {
  const { pos, nrm, tris, vlist } = mesh, o = {}, nv = pos.length / 3;
  const out = bodies.map(() => ({ p: [], n: [], uv: [] }));
  // each vertex's nearest body, from the candidate list of the block it was made in
  const owner = new Int16Array(nv);
  for (let v = 0; v < nv; v++) {
    let bd = Infinity, bi = 0;
    for (const { b, r0, r1 } of vlist[v]) {
      const d = query(b, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], null, Infinity, r0, r1);
      if (d < bd) { bd = d; bi = b.idx; }
    }
    owner[v] = bi;
  }
  const cache = new Map();
  const uvOf = (v, bi) => {
    const kk = v * 64 + bi;
    let r = cache.get(kk);
    if (!r) {
      const e = vlist[v].find((l) => l.b.idx === bi);
      query(bodies[bi], pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], o, Infinity, e ? e.r0 : -1, e ? e.r1 : 0);
      const ex = o.ex / 2, sx = Math.sign(o.lx) * Math.abs(o.lx) ** ex, sy = Math.sign(o.ly) * Math.abs(o.ly) ** ex;
      let vv = Math.atan2(sy, sx) / (Math.PI * 2); if (vv < 0) vv += 1;
      r = [o.u, vv]; cache.set(kk, r);
    }
    return r;
  };
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const oa = owner[a], ob = owner[b], oc = owner[c];
    const bi = oa === ob || oa === oc ? oa : ob === oc ? ob : oa;
    const g = out[bi], uvs = [uvOf(a, bi), uvOf(b, bi), uvOf(c, bi)];
    const vmax = Math.max(uvs[0][1], uvs[1][1], uvs[2][1]), vmin = Math.min(uvs[0][1], uvs[1][1], uvs[2][1]);
    for (let k = 0; k < 3; k++) {
      const v = tris[t + k];
      g.p.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); g.n.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
      g.uv.push(uvs[k][0], vmax - vmin > 0.5 && uvs[k][1] < 0.5 ? uvs[k][1] + 1 : uvs[k][1]);
    }
  }
  return out.map((g, i) => {
    if (!g.p.length) return null;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(g.p, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(g.n, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(g.uv, 2));
    return { name: bodies[i].name, paint: bodies[i].paint, geo };
  }).filter(Boolean);
}

/** Mesh a set of bodies once per geometry (paint changes reuse the cached surface). */
const CACHE = new Map();
function monocoque(key, make, h) {
  let hit = CACHE.get(key);
  if (!hit) {
    const { bodies, holes = [] } = make();
    bodies.forEach((b, i) => { b.idx = i; });
    const lo = [0, 1, 2].map((c) => Math.min(...bodies.map((b) => b.lo[c]))), hi = [0, 1, 2].map((c) => Math.max(...bodies.map((b) => b.hi[c])));
    hit = splitByBody(surfaceNets(field(bodies, holes), lo, hi, h), bodies);
    if (CACHE.size > 6) CACHE.delete(CACHE.keys().next().value);
    CACHE.set(key, hit);
  }
  return hit.map((p) => ({ ...p, geo: p.geo.clone() }));
}

// ---- frame ------------------------------------------------------------------------------------
export function buildFrame(B) {
  const { hp, M, P, geom } = B, tb = geom.tubes;
  const { bb, ra, ht, hb, st } = hp, up = B.up;
  const sAxis = st.clone().sub(bb).normalize();
  const sBack = V(-sAxis.y, sAxis.x, 0); // rearward normal of the seat tube
  const slot = 'frameset';

  const dtTop = hb.clone().addScaledVector(up, 34);
  const ttFront = ht.clone().addScaledVector(up, -26), ttRear = bb.clone().addScaledVector(sAxis, geom.seat_tube_mm - 30);
  const ttMid = ttRear.clone().lerp(ttFront, 0.5).add(V(1.5, 8, 0));
  const ssTop = bb.clone().addScaledVector(sAxis, geom.seat_tube_mm - 44);
  const dropTop = V(ra.x + 5, ra.y + 17, 0), dropFront = V(ra.x + 24, ra.y - 2, 0);
  const brakeR = B.brakeTrackR + geom.interfaces.brake_reach_mm;
  // brake bridge sits where the stay line is `brakeR` from the axle
  const stayDir = ssTop.clone().sub(dropTop).normalize();
  let tB = 0; for (let i = 0; i < 400; i++) { tB = i; if (dropTop.clone().addScaledVector(stayDir, i).distanceTo(ra) >= brakeR) break; }
  const bridge = dropTop.clone().addScaledVector(stayDir, tB);
  B.rearBrake = { bolt: bridge.clone(), axis: V(-stayDir.y, stayDir.x, 0).multiplyScalar(-1).normalize() }; // points rearward
  if (B.rearBrake.axis.x > 0) B.rearBrake.axis.negate();
  const perp = V(-stayDir.y, stayDir.x, 0);
  const slope = (ra.y - bb.y) / (ra.x - bb.x);
  const w = geom.interfaces.bb_shell_width_mm / 2, bore = geom.interfaces.bb_bore_mm / 2;

  const key = JSON.stringify(['frame', hp, tb, geom.seat_tube_mm, geom.interfaces, B.brakeTrackR]);
  const parts = monocoque(key, () => {
    const bodies = [];
    // bottom-bracket shell (BB30: 68 mm wide, 42 mm bore); its outer skin is moulded into the tubes
    bodies.push(body('Bottom-bracket shell', 'bb', [V(0, 0, -w), V(0, 0, 0), V(0, 0, w)], bore + 9, { k: 6, capR: 2.5 }));
    bodies.push(body('Seat tube', 'seat', spline([bb, bb.clone().lerp(st, 0.5), st.clone().addScaledVector(sAxis, 5)], 60),
      sectionOf(tb.seat_tube, { flare0: 0.06, len0: 0.12 }), { k: 16, capR: 1.2 }));
    bodies.push(body('Down tube', 'down', spline([bb, bb.clone().lerp(dtTop, 0.5).add(V(3, -3, 0)), dtTop], 72),
      sectionOf(tb.down_tube, { flare0: 0.05, len0: 0.1, tip1: [0.05, 0.78] }), { k: 18 }));
    bodies.push(body('Head tube', 'head', spline([hb.clone().addScaledVector(up, -3), hb.clone().lerp(ht, 0.5), ht.clone().addScaledVector(up, 3)], 24),
      (u) => ({ a: pick(tb.head_tube, u, 'a'), b: pick(tb.head_tube, u, 'b') }), { k: 20, capR: 1.2 }));
    bodies.push(body('Top tube', 'top', spline([ttRear, ttMid, ttFront], 64),
      sectionOf({ start: tb.top_tube.end, end: tb.top_tube.start }, { flare0: 0.06, len0: 0.08, tip1: [0.05, 0.8] }), { k: 16 }));
    for (const s of [-1, 1]) {
      const cs = [[-6, 1, 21], [-42, 7, 28], [-88, 15, 33], [-210, 36, 47], [-320, 57, 59]].map(([x, y, z]) => V(x, y ?? -slope * x, s * z));
      cs.push(V(dropFront.x, dropFront.y, s * 63.5));
      bodies.push(body('Chainstay', 'chainstay', spline(cs, 64), sectionOf(tb.chainstay), { k: 14 }));
    }
    for (const s of [-1, 1]) {
      // the stays leave the seat tube as one broad, flat yoke and split just below the cluster
      const at = (f, z, off = 0) => ssTop.clone().lerp(dropTop, f).addScaledVector(perp, off).setZ(s * z);
      const ss = [at(0, 8), at(0.06, 14, 0.5), at(0.16, 23, 2.5), at(0.34, 32, 3.5), at(0.58, 44, 1), at(0.82, 56, -3), at(1, 62.5)];
      bodies.push(body('Seat stay', 'stay', spline(ss, 64), (u) => {
        const yoke = 1 - smooth(u / 0.2);
        return { a: pick(tb.seat_stay, u, 'a') + 9 * yoke, b: pick(tb.seat_stay, u, 'b') - 2 * yoke, n: pick(tb.seat_stay, u, 'n') + 0.4 * yoke };
      }, { k: 13 }));
    }
    bodies.push(body('Brake bridge', 'bridge', [-31, -16, 0, 16, 31].map((z) => bridge.clone().setZ(z)),
      (u) => ({ a: 6.5 + 2.5 * (1 - Math.abs(u - 0.5) * 2), b: 5.5 }), { side: perp, k: 6 }));
    const holes = [
      cylinder(V(0, 0, 0), V(0, 0, 1), bore, -w - 5, w + 5),
      cylinder(st, sAxis, 13.9, -12, 60), // seatpost bore
    ];
    return { bodies, holes };
  }, 1.9);
  const mats = {};
  for (const p of parts) {
    const mat = p.paint === 'bridge' ? M.paint : (mats[p.paint] ||= tubePaint(M, P, p.paint));
    B.add(slot, p.geo, mat, { name: p.name });
  }
  B.add(slot, lathe([[bore - 0.4, -w - 0.2], [bore - 0.4, w + 0.2]], 40), M.hole, { name: 'Bottom-bracket bore', shadow: false });

  // ---- rear dropouts and hanger ------------------------------------------------------------------
  for (const s of [-1, 1]) {
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

  // ---- seat clamp: a slim black band flush on the seat-tube top, bolt at the back ---------------
  const rTop = tb.seat_tube.end.a;
  const band = lathe([[rTop - 0.2, -7], [rTop + 0.9, -6.6], [rTop + 1.3, -5.4], [rTop + 1.3, 3.6], [rTop + 0.9, 4.8], [14.1, 5.3], [13.9, 4.6]], 48);
  B.add(slot, place(band, st.clone().addScaledVector(sAxis, 1.5), sAxis), M.aluBlack, { name: 'Seat clamp' });
  const ear = st.clone().addScaledVector(sAxis, 0.5).addScaledVector(sBack, rTop + 2.2);
  B.add(slot, rod(ear.clone().setZ(-6.5), ear.clone().setZ(6.5), 3.6, 3.6, 18), M.aluBlack, { name: 'Seat clamp' });
  B.add(slot, place(boltHead(5.4, 2.2), ear.clone().setZ(6.5), V(0, 0, 1)), M.bolt, { name: 'Seat clamp bolt' });

  // bottle bosses and cable stops (small hardware that reads at close range)
  B.bosses = { down: [215, 279].map((d) => bb.clone().lerp(dtTop, d / bb.distanceTo(dtTop))), seat: [118, 182].map((d) => bb.clone().addScaledVector(sAxis, d)) };
  const dtDir = dtTop.clone().sub(bb).normalize(), dtUp = V(-dtDir.y, dtDir.x, 0);
  B.frameAxes = { dtDir, dtUp, sAxis, sFront: sBack.clone().negate(), dtTop, ttFront, ttRear, ttMid };
  const stops = [];
  for (const s of [-1, 1]) stops.push(place(rodZ(3.2, 9), dtTop.clone().addScaledVector(dtDir, -62).add(V(0, 0, s * 25.5)), dtDir));
  B.add(slot, merge(stops), M.aluBlack, { name: 'Cable stops' });
}

function g2(g, a) { g.rotateZ(a); return g; }
function rodZ(r, h) { const g = new T.CylinderGeometry(r, r, h, 14); g.rotateX(Math.PI / 2); return g; }

// ---- fork ---------------------------------------------------------------------------------------
export function buildFork(B) {
  const { hp, M, P, geom } = B, tb = geom.tubes, { hb, ht, fa } = hp, up = B.up, fwd = B.fwd;
  const slot = 'frameset', steer = true;
  const L = B.derived.axle_to_crown_mm, rake = geom.fork_rake_mm;
  const at = (d, f, z) => hb.clone().addScaledVector(up, -d).addScaledVector(fwd, f).setZ(z);
  const bend = (d) => rake * Math.max(0, (d - 90) / (L - 90)) ** 2.1;
  const dEnd = L - 17;
  const key = JSON.stringify(['fork', hb, up, fwd, L, rake, tb.fork_blade]);
  const parts = monocoque(key, () => {
    const bodies = [body('Fork crown', 'crown', [hb.clone().addScaledVector(up, 1), hb.clone().addScaledVector(up, -8), hb.clone().addScaledVector(up, -20)],
      (u) => ({ a: lerp(25, 21, u), b: lerp(25.5, 22, u), n: 2.3 }), { side: fwd, k: 6, capR: 2 })];
    for (const s of [-1, 1]) {
      const pts = [at(9, 0, 0), at(11, 0, s * 16), at(19, 0, s * 34), at(34, 0, s * 46), at(60, 0, s * 51)];
      for (const d of [110, 170, 230, 280, 320]) pts.push(at(d, bend(d), s * 52.5));
      pts.push(at(dEnd, bend(dEnd), s * 53));
      bodies.push(body('Fork blade', s > 0 ? 'fork_drive' : 'fork_left', spline(pts, 90), (u) => {
        const k = smooth(u / 0.16); // crown shoulder -> blade
        return { a: lerp(15, pick(tb.fork_blade, u, 'a'), k), b: lerp(23, pick(tb.fork_blade, u, 'b'), k), n: lerp(2.6, pick(tb.fork_blade, u, 'n'), k) };
      }, { side: fwd, transport: true, k: 12, capR: 3 }));
    }
    return { bodies };
  }, 1.6);
  const mats = {};
  for (const p of parts) B.add(slot, p.geo, (mats[p.paint] ||= tubePaint(M, P, p.paint)), { steer, name: p.name });
  for (const s of [-1, 1]) {
    // dropout
    const tip = at(dEnd, bend(dEnd), 0), len = tip.distanceTo(fa);
    const sh = linkShape(len, 7.5, 10.5, 0.85); sh.holes.push(circlePath(len, 0, 4.7));
    const g = plate(sh, 5.5, { bevel: 0.5 }); g.rotateZ(Math.atan2(fa.y - tip.y, fa.x - tip.x));
    B.add(slot, place(g, V(tip.x, tip.y, s * (geom.interfaces.front_oln_mm / 2 + 2.75))), M.aluBlack, { steer, name: 'Fork dropout' });
  }
  // steerer
  const top = ht.clone().addScaledVector(up, 15 + P.spacers_mm + 40 + 1);
  B.add(slot, rod(hb, top, geom.interfaces.steerer_mm / 2, geom.interfaces.steerer_mm / 2, 28), M.carbonMatte, { steer, name: 'Steerer' });
  // headset top cover
  const cov = lathe([[26, 0], [25.5, 2], [20, 11], [17.6, 15], [14.4, 15]], 48);
  B.add(slot, place(cov, ht, up), M.aluBlack, { steer, name: 'Headset cover' });
  B.frontBrake = { bolt: hb.clone().addScaledVector(up, -14).addScaledVector(fwd, 23), axis: fwd.clone() };
  B.add(slot, place(boltHead(8, 3), B.frontBrake.bolt.clone().addScaledVector(fwd, -47), fwd.clone().negate()), M.bolt, { steer, name: 'Brake nut' });
}
