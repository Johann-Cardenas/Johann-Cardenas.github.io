// Geometry kit: the handful of solid-building operations every component uses.
// Units are millimetres. Frame: BB origin, +X forward, +Y up, +Z drive side.
import * as T from 'three';

export const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
export const AX = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const rad = (d) => d * Math.PI / 180;

/** Sample a smooth curve through control points. Returns Vector3[]. */
export function spline(points, n = 48, { closed = false, tension = 0.5 } = {}) {
  const c = new T.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : V(...p))), closed, 'catmullrom', tension);
  return c.getSpacedPoints(n);
}

/** Polyline with rounded corners (fillet radius r), for cables and bent rod. */
export function filletPath(points, r, per = 8) {
  const P = points.map((p) => (p.isVector3 ? p : V(...p)));
  const out = [P[0].clone()];
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const d1 = a.clone().sub(b), d2 = c.clone().sub(b);
    const rr = Math.min(r, d1.length() * 0.48, d2.length() * 0.48);
    const p1 = b.clone().addScaledVector(d1.normalize(), rr), p2 = b.clone().addScaledVector(d2.normalize(), rr);
    for (let k = 0; k <= per; k++) {
      const t = k / per;
      out.push(p1.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(b, 2 * t * (1 - t)).addScaledVector(p2, t * t));
    }
  }
  out.push(P[P.length - 1].clone());
  return out;
}

function ringXY(a, b, n, phi) {
  const c = Math.cos(phi), s = Math.sin(phi), e = 2 / n;
  return [a * Math.sign(c) * Math.abs(c) ** e, b * Math.sign(s) * Math.abs(s) ** e];
}

/**
 * Sweep a superelliptical section along a path.
 *  path     Vector3[] (already sampled)
 *  section  (u, i) => radius | {a, b, n, rot, dx, dy}; `a` is the half-size along the section's N
 *           axis, `b` along its B axis. u is the arc-length fraction.
 *  side     reference for the B axis (default +Z). With `transport`, the frame is carried along
 *           the path instead of re-projected, which is what a path that turns through `side` needs.
 * UV: u along the path, v around the section (v = 0.25 is +B).
 */
export function sweep(path, section, { seg = 28, side = AX.z, transport = false, cap = true, capRound = false } = {}) {
  const n = path.length, pos = [], uv = [], idx = [];
  const len = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = len[n - 1] || 1;
  let Bprev = null;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const t = path[Math.min(i + 1, n - 1)].clone().sub(path[Math.max(i - 1, 0)]).normalize();
    let B = (transport && Bprev ? Bprev : side).clone();
    B.addScaledVector(t, -B.dot(t));
    if (B.lengthSq() < 0.04) { B = (Bprev || AX.y).clone(); B.addScaledVector(t, -B.dot(t)); }
    B.normalize(); Bprev = B;
    const N = B.clone().cross(t).normalize();
    const u = len[i] / total;
    let s = typeof section === 'function' ? section(u, i) : section;
    if (typeof s === 'number') s = { a: s, b: s };
    const { a, b = a, n: ex = 2, rot = 0, dx = 0, dy = 0 } = s;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    rings.push({ c: path[i], N, B, t, a, b });
    for (let j = 0; j <= seg; j++) {
      const [x0, y0] = ringXY(a, b, ex, (j / seg) * Math.PI * 2);
      const x = x0 * cr - y0 * sr + dx, y = x0 * sr + y0 * cr + dy;
      pos.push(path[i].x + N.x * x + B.x * y, path[i].y + N.y * x + B.y * y, path[i].z + N.z * x + B.z * y);
      uv.push(u, j / seg);
    }
  }
  const w = seg + 1;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const p = i * w + j, q = p + w;
    idx.push(p, p + 1, q, p + 1, q + 1, q);
  }
  if (cap) for (const end of [0, n - 1]) {
    const r = rings[end], dir = end === 0 ? -1 : 1;
    const bulge = capRound ? Math.min(r.a, r.b) * 0.55 : 0;
    const base = pos.length / 3;
    if (bulge) { // one intermediate ring gives a domed end
      for (let j = 0; j <= seg; j++) {
        const k = (end * w + j) * 3;
        pos.push(lerp(r.c.x, pos[k], 0.62) + r.t.x * dir * bulge * 0.72, lerp(r.c.y, pos[k + 1], 0.62) + r.t.y * dir * bulge * 0.72, lerp(r.c.z, pos[k + 2], 0.62) + r.t.z * dir * bulge * 0.72);
        uv.push(end ? 1 : 0, j / seg);
      }
      for (let j = 0; j < seg; j++) {
        const p = end * w + j, q = base + j;
        if (dir > 0) idx.push(p, p + 1, q, p + 1, q + 1, q); else idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
    const rim = bulge ? base : end * w, centre = pos.length / 3;
    pos.push(r.c.x + r.t.x * dir * bulge, r.c.y + r.t.y * dir * bulge, r.c.z + r.t.z * dir * bulge); uv.push(end ? 1 : 0, 0.5);
    for (let j = 0; j < seg; j++) { if (dir > 0) idx.push(rim + j, rim + j + 1, centre); else idx.push(rim + j + 1, rim + j, centre); }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Weld the normals across the v seam so the tube shades as one surface.
  const nrm = g.attributes.normal;
  for (let i = 0; i < n; i++) {
    const p = i * w, q = p + seg;
    const x = nrm.getX(p) + nrm.getX(q), y = nrm.getY(p) + nrm.getY(q), z = nrm.getZ(p) + nrm.getZ(q);
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(p, x / l, y / l, z / l); nrm.setXYZ(q, x / l, y / l, z / l);
  }
  return g;
}

/** Straight round bar between two points (optionally tapered). */
export function rod(a, b, r, r2 = r, seg = 20) {
  a = a.isVector3 ? a : V(...a); b = b.isVector3 ? b : V(...b);
  const g = new T.CylinderGeometry(r2, r, a.distanceTo(b), seg, 1);
  g.applyQuaternion(new T.Quaternion().setFromUnitVectors(AX.y, b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Solid of revolution about the Z axis. Profile is [[radius, z], ...]. */
export function lathe(profile, seg = 72) {
  const g = new T.LatheGeometry(profile.map(([r, z]) => new T.Vector2(Math.max(r, 0.0001), z)), seg);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Extrude a 2D shape (in XY) along Z, centred on z = 0. */
export function plate(shape, depth, { bevel = 0, curve = 10 } = {}) {
  const g = new T.ExtrudeGeometry(shape, {
    depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curve, steps: 1,
  });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  return g;
}

export function circlePath(cx, cy, r, cw = true, n = 24) {
  const p = new T.Path();
  for (let i = 0; i <= n; i++) {
    const a = (cw ? -1 : 1) * (i / n) * Math.PI * 2;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i) p.lineTo(x, y); else p.moveTo(x, y);
  }
  return p;
}

export function roundRect(w, h, r, cx = 0, cy = 0) {
  const s = new T.Shape(), x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
  return s;
}

/** Closed shape from a polar function r(theta). */
export function polarShape(fn, n = 180) {
  const s = new T.Shape();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = fn(a);
    if (i) s.lineTo(r * Math.cos(a), r * Math.sin(a)); else s.moveTo(r * Math.cos(a), r * Math.sin(a));
  }
  s.closePath();
  return s;
}

/** Two discs joined by a waisted web: chain plates, links, caliper arms. */
export function linkShape(len, r1, r2 = r1, waist = 0.72) {
  const s = new T.Shape(), n = 14;
  const w = Math.min(r1, r2) * waist;
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + (i / n) * Math.PI; const x = r1 * Math.cos(a), y = r1 * Math.sin(a); if (i) s.lineTo(x, y); else s.moveTo(x, y); }
  s.quadraticCurveTo(len / 2, -w, len + r2 * Math.cos(-Math.PI / 2), r2 * Math.sin(-Math.PI / 2));
  for (let i = 1; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI; s.lineTo(len + r2 * Math.cos(a), r2 * Math.sin(a)); }
  s.quadraticCurveTo(len / 2, w, 0, r1);
  return s;
}

// ---- Roller-chain sprockets (ISO 606 / ANSI B29.1, 1/2 in pitch) -------------------------------
export const PITCH = 12.7, ROLLER = 7.75;
export const pitchRadius = (N) => PITCH / (2 * Math.sin(Math.PI / N));
export const tipRadius = (N) => (PITCH * (0.6 + 1 / Math.tan(Math.PI / N))) / 2;

/** Sprocket outline with real roller seats and tooth tips. */
export function sprocketShape(N, { relief = 0 } = {}) {
  const R = pitchRadius(N), Ro = tipRadius(N) - relief, rr = ROLLER / 2 + 0.12;
  const s = new T.Shape();
  let first = true;
  const add = (x, y) => { if (first) { s.moveTo(x, y); first = false; } else s.lineTo(x, y); };
  const seat = rad(62), tip = Math.min(0.55 / Ro, Math.PI / N * 0.22);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2, cx = R * Math.cos(th), cy = R * Math.sin(th);
    for (let k = 0; k <= 6; k++) {
      const d = seat - (k / 6) * 2 * seat, a = th + Math.PI + d;
      add(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    }
    const mid = th + Math.PI / N;
    add(Ro * Math.cos(mid - tip), Ro * Math.sin(mid - tip));
    add(Ro * Math.cos(mid + tip), Ro * Math.sin(mid + tip));
  }
  s.closePath();
  return s;
}

export { beltPath } from '../model/belt.js';

// ---- Canvas textures ----------------------------------------------------------------------------
export function canvasTexture(w, h, draw, { repeat, flipY = false, aniso = 8, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c);
  t.flipY = flipY; t.anisotropy = aniso;
  if (srgb) t.colorSpace = T.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

/** Merge geometries that share a material into one draw call. */
export function merge(list) {
  const geos = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0; for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return out;
}

/** Place a geometry: rotate its local Z onto `axis`, then translate. Returns the geometry. */
export function place(g, at, axis = null, spin = 0) {
  if (spin) g.rotateZ(spin);
  if (axis) g.applyQuaternion(new T.Quaternion().setFromUnitVectors(AX.z, axis.clone().normalize()));
  g.translate(at.x, at.y, at.z);
  return g;
}

/** Hex socket cap bolt head, axis along +Z, seated at z = 0. */
export function boltHead(d = 5, h = 4) {
  const head = new T.CylinderGeometry(d / 2, d / 2, h, 18); head.rotateX(Math.PI / 2); head.translate(0, 0, h / 2);
  const socket = new T.CylinderGeometry(d * 0.26, d * 0.26, 0.3, 6); socket.rotateX(Math.PI / 2); socket.translate(0, 0, h + 0.1);
  return merge([head, socket]);
}
