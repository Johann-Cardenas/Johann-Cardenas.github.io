// Result scenes shown in the viewer's custom layer: the CAD assembly (as built in SolidWorks),
// the wind tunnel (LBM-LES) and the Abaqus shell model. All geometry is in millimetres, bike frame.
import * as T from 'three';

// Packs are cached by path. Wind-tunnel cases (~5 MB each, 42 in the matrix) are kept least-recently-used
// so flipping between builds is instant without holding every case; a failed fetch is forgotten, so a
// case that lands later (the matrix fills in over days) loads on the next try.
const cache = new Map(), CFD_KEEP = 6;
export async function loadPack(base) {
  if (cache.has(base)) { const p = cache.get(base); cache.delete(base); cache.set(base, p); return p; }
  const p = Promise.all([fetch(base + '.json').then((r) => { if (!r.ok) throw new Error(base + '.json'); return r.json(); }),
    fetch(base + '.bin').then((r) => { if (!r.ok) throw new Error(base + '.bin'); return r.arrayBuffer(); })]);
  cache.set(base, p);
  p.catch(() => { if (cache.get(base) === p) cache.delete(base); });
  const cfd = [...cache.keys()].filter((k) => k.startsWith('data/cfd/'));
  for (const k of cfd.slice(0, Math.max(0, cfd.length - CFD_KEEP))) cache.delete(k);
  return p;
}

// ---- helpers -------------------------------------------------------------------------------------
const H2F = (() => { // IEEE half -> float
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    t[h] = e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + m / 1024);
  }
  return t;
})();
const half = (buf, off, n) => { const u = new Uint16Array(buf, off, n), f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = H2F[u[i]]; return f; };
const deq = (buf, off, n, offset, scale) => { const q = new Int16Array(buf, off, n * 3), out = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) out[i] = (q[i] + 32767) * scale[i % 3] + offset[i % 3]; return out; };

export const RAMPS = {
  stress: [[0.19, 0.28, 0.6], [0.16, 0.55, 0.72], [0.2, 0.72, 0.62], [0.62, 0.82, 0.38], [0.97, 0.78, 0.25], [0.93, 0.45, 0.17], [0.78, 0.14, 0.14]],
  speed: [[0.05, 0.03, 0.18], [0.23, 0.07, 0.42], [0.45, 0.12, 0.47], [0.69, 0.2, 0.39], [0.89, 0.35, 0.24], [0.98, 0.6, 0.12], [0.98, 0.88, 0.45]],
  loss: [[0.97, 0.97, 0.96], [0.83, 0.9, 0.93], [0.55, 0.76, 0.86], [0.27, 0.55, 0.75], [0.16, 0.33, 0.6], [0.14, 0.17, 0.42], [0.1, 0.06, 0.24]],
  vort: [[0.05, 0.06, 0.12], [0.1, 0.2, 0.36], [0.07, 0.4, 0.5], [0.13, 0.6, 0.55], [0.47, 0.78, 0.43], [0.86, 0.87, 0.3], [0.99, 0.96, 0.7]],
  // surface pressure: a CFD rainbow (after Google's Turbo), so suction, free stream and stagnation read apart at a glance
  cfd: [[0.19, 0.07, 0.23], [0.25, 0.32, 0.79], [0.24, 0.57, 0.99], [0.13, 0.8, 0.85], [0.3, 0.95, 0.55], [0.65, 0.99, 0.24], [0.93, 0.83, 0.21], [0.99, 0.56, 0.12], [0.89, 0.27, 0.04], [0.62, 0.08, 0.01]],
  // flow particles in |U|/U_inf 0-1.5: wake violet, free stream pale cyan, accelerated air amber; bright enough on the dark stage
  flow: [[0.55, 0.22, 0.85], [0.3, 0.38, 0.98], [0.16, 0.6, 0.95], [0.3, 0.8, 0.86], [0.98, 0.8, 0.35], [1.0, 0.45, 0.15]],
  // signed vorticity: clockwise blue, still air dark, anticlockwise red
  swirl: [[0.35, 0.75, 1.0], [0.12, 0.42, 0.85], [0.06, 0.12, 0.25], [0.07, 0.08, 0.1], [0.3, 0.08, 0.08], [0.88, 0.3, 0.16], [1.0, 0.78, 0.45]],
  cp: [[0.13, 0.28, 0.62], [0.33, 0.55, 0.8], [0.72, 0.84, 0.92], [0.97, 0.97, 0.96], [0.96, 0.79, 0.66], [0.87, 0.45, 0.33], [0.68, 0.11, 0.15]],
};
export function rampColor(name, t, out = [0, 0, 0]) {
  const r = RAMPS[name]; t = Math.min(1, Math.max(0, t)) * (r.length - 1);
  const i = Math.min(r.length - 2, Math.floor(t)), f = t - i;
  for (let k = 0; k < 3; k++) out[k] = r[i][k] + (r[i + 1][k] - r[i][k]) * f;
  return out;
}
/** rampColor for vertex colours of lit meshes, which three.js reads as linear. */
export function rampLinear(name, t, out = [0, 0, 0]) { rampColor(name, t, out); for (let k = 0; k < 3; k++) out[k] = out[k] ** 2.2; return out; }
export const rampCSS = (name) => `linear-gradient(to right, ${RAMPS[name].map((c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`).join(',')})`;

function geometryFrom(pos, idx) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setIndex(new T.BufferAttribute(idx, 1));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
const dispose = (o) => o.traverse((c) => { c.geometry?.dispose(); [].concat(c.material || []).forEach((m) => { m.map?.dispose(); m.dispose(); }); });

// ---- CAD -----------------------------------------------------------------------------------------
export async function cadScene(theme) {
  const [doc, buf] = await loadPack('data/cad/parts');
  const group = new T.Group(), parts = [];
  const edgeMat = new T.LineBasicMaterial({ color: theme === 'dark' ? 0x0b0d10 : 0x1b1f24, transparent: true, opacity: 0.42 });
  const centre = new T.Vector3();
  for (const p of doc.parts) {
    const pos = deq(buf, p.pos[0], p.pos[1], doc.offset, doc.scale);
    const g = geometryFrom(pos, new Uint32Array(buf, p.idx[0], p.idx[1]));
    const color = new T.Color(...p.color);
    const mat = new T.MeshStandardMaterial({ color, roughness: 0.5, metalness: p.slot === 'frameset' ? 0.05 : 0.35, envMapIntensity: 0.9 });
    const mesh = new T.Mesh(g, mat); mesh.castShadow = mesh.receiveShadow = true;
    const edges = new T.LineSegments(new T.EdgesGeometry(g, 28), edgeMat);
    const holder = new T.Group(); holder.add(mesh, edges);
    mesh.userData.pick = p;
    const c = new T.Vector3(...p.centroid);
    holder.userData = { part: p, mesh, edges, base: color.clone(), centroid: c, delay: 0 };
    parts.push(holder); group.add(holder); centre.add(c);
  }
  centre.divideScalar(parts.length);
  // the camera fits the assembled bike, not the parts' fly-in positions
  const bb = new T.Box3(); parts.forEach((h) => bb.union(h.userData.mesh.geometry.boundingBox));
  const bounds = new T.Mesh(new T.BoxGeometry(...bb.getSize(new T.Vector3()).toArray()), new T.MeshBasicMaterial());
  bounds.position.copy(bb.getCenter(new T.Vector3())); bounds.visible = false; group.add(bounds);
  parts.forEach((h, i) => { h.userData.dir = h.userData.centroid.clone().sub(centre).multiplyScalar(0.9); h.userData.delay = (i / parts.length) * 0.55; });
  let explode = 0, intro = 0, clay = false, selected = null;
  const apply = () => {
    for (const h of parts) {
      const k = Math.min(1, Math.max(0, (intro - h.userData.delay) / 0.45));
      const e = 1 - (1 - k) ** 3; // ease out
      h.position.copy(h.userData.dir).multiplyScalar(explode + (1 - e) * 1.4);
      h.visible = k > 0;
      const m = h.userData.mesh.material;
      m.color.copy(selected === h ? new T.Color(0x18a9a8) : clay ? new T.Color(theme === 'dark' ? 0xaab1ba : 0xd9dde2) : h.userData.base);
      m.emissive.setHex(selected === h ? 0x06302f : 0x000000);
    }
  };
  apply();
  return {
    group, parts, doc, bounds,
    animate(dt) { if (intro >= 1.2) return false; intro = Math.min(1.2, intro + dt); apply(); return true; },
    replay() { intro = 0; },
    setExplode(v) { explode = v; apply(); },
    setClay(v) { clay = v; apply(); },
    setEdges(v) { parts.forEach((h) => { h.userData.edges.visible = v; }); },
    select(part) { selected = parts.find((h) => h.userData.part === part) || null; apply(); return selected?.userData.part ?? null; },
    dispose: () => dispose(group),
  };
}

// ---- wind tunnel ---------------------------------------------------------------------------------
function sliceTexture(bytes, w, h, ramp, solid) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), img = x.createImageData(w, h), col = [0, 0, 0];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const s = j * w + i, d = ((h - 1 - j) * w + i) * 4;
    rampColor(ramp, bytes[s] / 255, col);
    img.data[d] = col[0] * 255; img.data[d + 1] = col[1] * 255; img.data[d + 2] = col[2] * 255;
    img.data[d + 3] = solid[s] ? 0 : 235;
  }
  x.putImageData(img, 0, 0);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.minFilter = T.LinearFilter; t.magFilter = T.LinearFilter; t.generateMipmaps = false;
  return t;
}

/**
 * Shared scales for the standard-protocol matrix. Each case quantises vorticity and the Q criterion over its
 * own range (up to its 99.5th percentile), which moves from build to build; re-expressed on one range, a
 * cut-plane colour and a vortex-surface level mean the same thing in every case, so A/B flips compare.
 */
export const VOL_REF = { vort: 300, q: 5500 };
/** The 16 mm flow volume (tunnel frame, mm): uint8 fields with ranges, solid bits, derived total-pressure loss. */
function volumeOf(cfd, buf) {
  const v = cfd.volume; if (!v) return null;
  const [nx, ny, nz] = v.n, N = nx * ny * nz, F = {};
  for (const [k, f] of Object.entries(v.fields)) F[k] = { q: new Uint8Array(buf, f.off, N), range: f.range };
  if (cfd.summary?.assumptions?.protocol === 'standard') for (const [k, top] of Object.entries(VOL_REF)) {
    const f = F[k]; if (!f || !(f.range[1] > f.range[0])) continue;
    const [r0, r1] = f.range, q = new Uint8Array(N), s = (r1 - r0) / top, o = r0 / top * 255;
    for (let i = 0; i < N; i++) q[i] = Math.min(255, Math.max(0, Math.round(o + f.q[i] * s)));
    F[k] = { q, range: [0, top] };
  }
  const sb = new Uint8Array(buf, v.solid, Math.ceil(N / 8));
  const solid = new Uint8Array(N); for (let i = 0; i < N; i++) solid[i] = (sb[i >> 3] >> (i & 7)) & 1;
  if (F.cp && F.speed) { // total-pressure loss 1 - Cp0, Cp0 = Cp + (|U|/U_inf)^2 of the mean flow
    const q = new Uint8Array(N), [c0, c1] = F.cp.range, [s0, s1] = F.speed.range;
    for (let i = 0; i < N; i++) { const cp = c0 + (F.cp.q[i] / 255) * (c1 - c0), sp = s0 + (F.speed.q[i] / 255) * (s1 - s0); q[i] = Math.max(0, Math.min(255, Math.round(((1 - cp - sp * sp) / 1.2) * 255))); }
    F.loss = { q, range: [0, 1.2] };
  }
  return { nx, ny, nz, N, d: v.dx_m * 1000, lo: v.lo_m.map((x) => x * 1000), F, solid };
}
export const FIELD_RAMP = { speed: 'speed', cp: 'cp', loss: 'loss', vort: 'vort' };
const AXES = { x: [2, 1], y: [0, 2], z: [0, 1] }; // plane normal -> [u axis, v axis]

/** A plane through the volume at a fraction t along an axis, as a textured quad in tunnel mm. */
function volumePlane(V) {
  const geo = new T.BufferGeometry(), pos = new Float32Array(12);
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mat = new T.MeshBasicMaterial({ transparent: true, side: T.DoubleSide, depthWrite: false, opacity: 0.94 });
  const mesh = new T.Mesh(geo, mat); mesh.renderOrder = -1; mesh.frustumCulled = false;
  const n = [V.nx, V.ny, V.nz], col = [0, 0, 0];
  let tex = null;
  const set = (axis, t, field) => {
    const a = { x: 0, y: 1, z: 2 }[axis], [ua, va] = AXES[axis], W = n[ua], H = n[va];
    const k = Math.min(n[a] - 1, Math.max(0, Math.round(t * (n[a] - 1))));
    const c = V.lo[a] + (k + 0.5) * V.d, u0 = V.lo[ua], u1 = V.lo[ua] + n[ua] * V.d, v0 = V.lo[va], v1 = V.lo[va] + n[va] * V.d;
    const corner = (u, v) => { const p = [0, 0, 0]; p[a] = c; p[ua] = u; p[va] = v; return p; };
    pos.set([...corner(u0, v0), ...corner(u1, v0), ...corner(u1, v1), ...corner(u0, v1)]); geo.attributes.position.needsUpdate = true; geo.computeBoundingSphere();
    const F = V.F[field] || V.F.speed, ramp = FIELD_RAMP[field] || 'speed', fade = field === 'vort' || field === 'loss', data = new Uint8Array(W * H * 4), st = [1, V.nx, V.nx * V.ny], idx = [0, 0, 0];
    idx[a] = k;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      idx[ua] = i; idx[va] = j;
      const g = idx[0] * st[0] + idx[1] * st[1] + idx[2] * st[2], o = (j * W + i) * 4;
      rampColor(ramp, F.q[g] / 255, col);
      data[o] = col[0] * 255; data[o + 1] = col[1] * 255; data[o + 2] = col[2] * 255; data[o + 3] = V.solid[g] ? 0 : fade ? Math.min(240, 70 + F.q[g] * 2.4) : 240;
    }
    tex?.dispose();
    tex = new T.DataTexture(data, W, H, T.RGBAFormat); tex.colorSpace = T.SRGBColorSpace; tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter; tex.needsUpdate = true;
    mat.map = tex; mat.needsUpdate = true;
    return c;
  };
  return { mesh, set, dispose: () => { tex?.dispose(); geo.dispose(); mat.dispose(); } };
}

/**
 * Surface nets over the volume: the boundary of {inside(i)} as a smooth triangle mesh in tunnel mm,
 * optionally coloured from a field through a ramp.
 */
function isoSurface(V, inside, colorBy) {
  const { nx, ny, nz, d, lo } = V, sy = nx, sz = nx * ny;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1, cell = new Int32Array(cx * cy * cz).fill(-1);
  const P = [], C = [], I = [], tmp = [0, 0, 0];
  const ins = new Uint8Array(V.N); for (let i = 0; i < V.N; i++) ins[i] = inside(i) ? 1 : 0;
  const corner = [0, 1, sy, sy + 1, sz, sz + 1, sz + sy, sz + sy + 1];
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const g = i + j * sy + k * sz;
    let m = 0;
    for (let c = 0; c < 8; c++) m |= ins[g + corner[c]] << c;
    if (m === 0 || m === 255) continue;
    let cnt = 0, px = 0, py = 0, pz = 0;
    for (let c = 0; c < 8; c++) for (const b of [1, 2, 4]) { // the 12 cube edges, each once
      if (c & b) continue;
      if (((m >> c) & 1) === ((m >> (c | b)) & 1)) continue;
      px += (c & 1) + (b === 1 ? 0.5 : 0); py += ((c >> 1) & 1) + (b === 2 ? 0.5 : 0); pz += ((c >> 2) & 1) + (b === 4 ? 0.5 : 0); cnt++;
    }
    cell[i + j * cx + k * cx * cy] = P.length / 3;
    P.push(lo[0] + (i + px / cnt + 0.5) * d, lo[1] + (j + py / cnt + 0.5) * d, lo[2] + (k + pz / cnt + 0.5) * d);
    if (colorBy) { rampLinear(colorBy.ramp, colorBy.q[g] / 255, tmp); C.push(tmp[0], tmp[1], tmp[2]); }
  }
  const cid = (i, j, k) => cell[i + j * cx + k * cx * cy];
  const quad = (a, q) => { if (a) I.push(q[0], q[1], q[2], q[0], q[2], q[3]); else I.push(q[0], q[2], q[1], q[0], q[3], q[2]); };
  for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 0; i < cx; i++) { const g = i + j * sy + k * sz; if (ins[g] !== ins[g + 1]) quad(ins[g], [cid(i, j - 1, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i, j - 1, k)]); }
  for (let k = 1; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 1; i < cx; i++) { const g = i + j * sy + k * sz; if (ins[g] !== ins[g + sy]) quad(ins[g], [cid(i - 1, j, k - 1), cid(i - 1, j, k), cid(i, j, k), cid(i, j, k - 1)]); }
  for (let k = 0; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) { const g = i + j * sy + k * sz; if (ins[g] !== ins[g + sz]) quad(ins[g], [cid(i - 1, j - 1, k), cid(i, j - 1, k), cid(i, j, k), cid(i - 1, j, k)]); }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(P, 3));
  if (colorBy) geo.setAttribute('color', new T.Float32BufferAttribute(C, 3));
  geo.setIndex(I);
  // two passes of Laplacian smoothing take the voxel steps out
  const nv = P.length / 3, nb = Array.from({ length: nv }, () => []);
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) nb[I[t + e]].push(I[t + (e + 1) % 3]);
  const p = geo.attributes.position.array;
  for (let pass = 0; pass < 2; pass++) {
    const q = Float32Array.from(p);
    for (let v = 0; v < nv; v++) {
      const L = nb[v]; if (!L.length) continue;
      let x = 0, y = 0, z = 0; for (const w of L) { x += q[w * 3]; y += q[w * 3 + 1]; z += q[w * 3 + 2]; }
      p[v * 3] = 0.5 * q[v * 3] + 0.5 * x / L.length; p[v * 3 + 1] = 0.5 * q[v * 3 + 1] + 0.5 * y / L.length; p[v * 3 + 2] = 0.5 * q[v * 3 + 2] + 0.5 * z / L.length;
    }
  }
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  return geo;
}

/** Display range of surface Cp: the 5th-95th percentile of the bike's skin is -0.35 to +0.30; stagnation saturates */
export const SURFACE_CP = [-0.5, 0.5];
/** Average a vertex field with its mesh neighbours (the probe one cell off the wall is noisy at 8 mm). */
function smoothOnMesh(v, idx, passes) {
  const n = v.length, deg = new Float32Array(n), acc = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    acc.fill(0); deg.fill(0);
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; acc[a] += v[b]; acc[b] += v[a]; deg[a]++; deg[b]++; }
    const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = deg[i] ? 0.5 * v[i] + 0.5 * acc[i] / deg[i] : v[i];
    v = out;
  }
  return v;
}

export async function aeroScene(caseName, theme) {
  // each case carries the CAD pack it was run on (a variant build has its own rims and tyres)
  const [cfd, buf] = await loadPack('data/cfd/' + caseName);
  const [cad, cbuf] = await loadPack(cfd.cad || 'data/cad/parts');
  const group = new T.Group(), R = new T.Matrix4();
  const r = cfd.yaw_R; // rows of the yaw rotation (bike -> tunnel); the scene shows the bike frame, so flows are rotated back
  R.set(r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, 0, 0, 0, 1);
  const flow = new T.Group(); flow.matrixAutoUpdate = false; flow.matrix.copy(R); group.add(flow);
  const [sLo, sHi] = cfd.ranges.speed, U = 11111; // mm/s at 40 km/h

  // bike surface coloured by Cp: smoothed over the mesh, on a CFD rainbow, over the range the surface actually spans
  const cpOf = new Map(cfd.surface.map((s) => [s.name, s]));
  const surfaceMeshes = [];
  // Rolling: wheels, cassette and crankset turn about their axles as if the bike rode at 40 km/h on the
  // same slowed clock as the particles; pedals orbit the BB and stay level. The tunnel itself ran with
  // static wheels, so this motion is illustrative and the surface colours ride along with the parts.
  const rollers = (() => {
    const front = /^(rim|tyre|hub|spokes|qr)_front/, rear = /^(rim|tyre|hub|spokes|qr)_rear|^cassette$/, crank = /^(crankset|chainring_)/, pedal = /^pedal_/;
    const sets = { front: [], rear: [], crank: [], pedal: [] }, R = cad.wheel_radius_mm || 334;
    const r = { angle: 0, ratio: 50 / 17, on: true, groups: {} };
    r.add = (name, m) => {
      const k = front.test(name) ? 'front' : rear.test(name) ? 'rear' : crank.test(name) ? 'crank' : pedal.test(name) ? 'pedal' : null;
      if (k) sets[k].push(m); else group.add(m);
    };
    const centre = (list, name) => { const b = new T.Box3(); for (const m of list) if (!name || m.userData.pick.name.startsWith(name)) b.union(m.geometry.boundingBox); return b.getCenter(new T.Vector3()); };
    const pivot = (list, at) => { const g = new T.Group(); g.position.set(at.x, at.y, 0); for (const m of list) { m.position.set(-at.x, -at.y, 0); g.add(m); } group.add(g); return g; };
    r.finish = () => {
      const fa = centre(sets.front, 'hub_front'), ra = centre(sets.rear, 'hub_rear');
      r.groups.front = pivot(sets.front, fa); r.groups.rear = pivot(sets.rear, ra); r.groups.crank = pivot(sets.crank, new T.Vector3());
      // each pedal: an orbit about the BB carrying a counter-rotating holder about its own spindle
      r.groups.pedals = sets.pedal.map((m) => {
        const c = m.geometry.boundingBox.getCenter(new T.Vector3()), orbit = new T.Group(), hold = new T.Group();
        hold.position.set(c.x, c.y, 0); m.position.set(-c.x, -c.y, 0); hold.add(m); orbit.add(hold); group.add(orbit);
        return { orbit, hold };
      });
      r.wheelRate = U / R; // rad/s of real time at 40 km/h
      // The pressure on a rim or tyre belongs to a place in the tunnel, not to the rubber: index each
      // vertex by its ring (radius, z) and azimuth, so a turning wheel can look its colour up where it is now.
      const NB = 240;
      r.spun = [];
      for (const [k, at] of [['front', fa], ['rear', ra]]) for (const m of sets[k]) {
        const cp = m.userData.cp; if (!cp || !/^(rim|tyre)_/.test(m.userData.pick.name)) continue;
        const pos = m.geometry.attributes.position.array, n = cp.length, ring = new Int32Array(n), bin = new Float32Array(n), rings = new Map();
        for (let i = 0; i < n; i++) {
          const x = pos[i * 3] - at.x, y = pos[i * 3 + 1] - at.y, z = pos[i * 3 + 2];
          const key = Math.round(Math.hypot(x, y) / 3) * 4096 + Math.round(z / 3) + 2048;
          let id = rings.get(key); if (id === undefined) { id = rings.size; rings.set(key, id); }
          ring[i] = id; bin[i] = ((Math.atan2(y, x) / (2 * Math.PI) + 1) % 1) * NB;
        }
        const tab = new Float32Array(rings.size * NB).fill(NaN);
        for (let i = 0; i < n; i++) tab[ring[i] * NB + (Math.floor(bin[i]) % NB)] = cp[i];
        for (let q = 0; q < rings.size; q++) { // fill empty bins from the nearest filled one round the ring
          const o = q * NB; let last = NaN;
          for (let pass = 0; pass < 2; pass++) for (let b = 0; b < NB; b++) { if (!Number.isNaN(tab[o + b])) last = tab[o + b]; else if (!Number.isNaN(last) && pass === 1) tab[o + b] = last; else if (!Number.isNaN(last)) tab[o + b] = last; }
        }
        r.spun.push({ m, ring, bin, tab, NB, col: m.geometry.attributes.color });
      }
    };
    const tmpC = [0, 0, 0];
    r.paint = (w) => { // w: wheel angle, radians (pivot rotation.z)
      for (const it of r.spun) {
        if (!it.m.material.vertexColors) continue;
        const shift = (w / (2 * Math.PI)) * it.NB, a = it.col.array;
        for (let i = 0; i < it.ring.length; i++) {
          const b = Math.floor(((it.bin[i] + shift) % it.NB + it.NB) % it.NB);
          rampLinear('cfd', (it.tab[it.ring[i] * it.NB + b] - SURFACE_CP[0]) / (SURFACE_CP[1] - SURFACE_CP[0]), tmpC);
          a[i * 3] = tmpC[0]; a[i * 3 + 1] = tmpC[1]; a[i * 3 + 2] = tmpC[2];
        }
        it.col.needsUpdate = true;
      }
    };
    r.set = (a) => {
      r.angle = a; const wheel = -a, crankA = -a / r.ratio;
      r.groups.front.rotation.z = wheel; r.groups.rear.rotation.z = wheel; r.groups.crank.rotation.z = crankA; r.paint(wheel);
      for (const { orbit, hold } of r.groups.pedals) { orbit.rotation.z = crankA; hold.rotation.z = -crankA; }
    };
    r.step = (dt) => { if (r.on) r.set(r.angle + dt * SLOW * r.wheelRate); };
    return r;
  })();
  const [cpLo, cpHi] = cfd.ranges.cp, [dLo, dHi] = SURFACE_CP;
  const glow = (m, k) => { m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += vColor.rgb * ${k.toFixed(2)};\n#endif`); }; m.customProgramCacheKey = () => 'glow' + k; };
  for (const p of cad.parts) {
    const pos = deq(cbuf, p.pos[0], p.pos[1], cad.offset, cad.scale);
    const idx = new Uint32Array(cbuf, p.idx[0], p.idx[1]);
    const g = geometryFrom(pos, idx);
    const s = cpOf.get(p.name);
    const col = new Float32Array(p.pos[1] * 3), tmp = [0, 0, 0];
    let cpv = null;
    if (s) {
      const q = new Uint8Array(buf, s.cp, s.n);
      cpv = new Float32Array(s.n); for (let i = 0; i < s.n; i++) cpv[i] = cpLo + (q[i] / 255) * (cpHi - cpLo);
      cpv = smoothOnMesh(cpv, idx, 2);
      for (let i = 0; i < s.n; i++) { rampLinear('cfd', (cpv[i] - dLo) / (dHi - dLo), tmp); col.set(tmp, i * 3); }
    } else col.fill(0.42);
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.35 });
    glow(mat, 0.22);
    const m = new T.Mesh(g, mat);
    m.castShadow = true; m.userData.pick = { name: p.name, slot: p.slot, aero: !!s };
    m.userData.plain = new T.Color(...p.color); m.userData.cp = cpv;
    surfaceMeshes.push(m); rollers.add(p.name, m);
  }
  rollers.finish();
  const mm = 1000;

  // streamlines, and particles that ride them at the local speed of the mean flow
  const lines = cfd.streamlines.map((l) => {
    const pts = half(buf, l.pts, l.n * 3), sp = new Uint8Array(buf, l.speed, l.n);
    const P = new Float32Array(l.n * 3); for (let i = 0; i < l.n * 3; i++) P[i] = pts[i] * mm;
    // time of flight along the line, in seconds at 40 km/h: dt = ds / |u|
    const tof = new Float32Array(l.n);
    for (let i = 1; i < l.n; i++) {
      const ds = Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2], P[i * 3 + 2] - P[i * 3 - 1]);
      const u = Math.max(0.06, (sLo + ((sp[i] + sp[i - 1]) / 510) * (sHi - sLo))) * U;
      tof[i] = tof[i - 1] + ds / u;
    }
    return { P, sp, tof, n: l.n, T: tof[l.n - 1] };
  }).filter((l) => l.T > 0);
  const segPos = [], segCol = [], tmp = [0, 0, 0];
  for (const l of lines) for (let i = 0; i < l.n - 1; i++) {
    segPos.push(l.P[i * 3], l.P[i * 3 + 1], l.P[i * 3 + 2], l.P[i * 3 + 3], l.P[i * 3 + 4], l.P[i * 3 + 5]);
    for (const k of [i, i + 1]) { rampColor('flow', l.sp[k] / 255, tmp); segCol.push(...tmp); }
  }
  const lg = new T.BufferGeometry();
  lg.setAttribute('position', new T.Float32BufferAttribute(segPos, 3)); lg.setAttribute('color', new T.Float32BufferAttribute(segCol, 3));
  const streamLines = new T.LineSegments(lg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.09, depthWrite: false, blending: T.AdditiveBlending }));
  flow.add(streamLines);
  // each particle is a comet: a bright head and a TRAIL of fading line segments behind it, spaced in time, so slow air
  // draws a short streak and fast air a long one
  const PER = 5, TRAIL = 14, np_ = lines.length * PER, NV = np_ * TRAIL;
  const ppos = new Float32Array(NV * 3), prgba = new Float32Array(NV * 4), phase = new Float32Array(np_);
  for (let i = 0; i < np_; i++) phase[i] = Math.random();
  const tidx = []; for (let p = 0; p < np_; p++) for (let j = 0; j < TRAIL - 1; j++) tidx.push(p * TRAIL + j, p * TRAIL + j + 1);
  const hidx = []; for (let p = 0; p < np_; p++) hidx.push(p * TRAIL);
  const pg = new T.BufferGeometry();
  const posA = new T.BufferAttribute(ppos, 3), colA = new T.BufferAttribute(prgba, 4);
  pg.setAttribute('position', posA); pg.setAttribute('rgba', colA); pg.setIndex(tidx);
  const hg = new T.BufferGeometry(); hg.setAttribute('position', posA); hg.setAttribute('rgba', colA); hg.setIndex(hidx);
  const vsh = `attribute vec4 rgba; uniform float scale; varying vec4 vC;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(2.0, 7.0 * scale / -mv.z); vC = rgba; }`;
  const tmat = new T.ShaderMaterial({ uniforms: { scale: { value: 600 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, vertexShader: vsh,
    fragmentShader: 'varying vec4 vC; void main() { gl_FragColor = vec4(vC.rgb * vC.a, 1.0); }' });
  const pmat = new T.ShaderMaterial({ uniforms: tmat.uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending, vertexShader: vsh,
    fragmentShader: 'varying vec4 vC; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vC.rgb * a * a * vC.a * 1.6, 1.0); }' });
  const particles = new T.Group();
  const trails = new T.LineSegments(pg, tmat), heads = new T.Points(hg, pmat);
  trails.frustumCulled = heads.frustumCulled = false; particles.add(trails, heads); flow.add(particles);
  heads.onBeforeRender = (renderer, _s, camera) => { const v = renderer.getDrawingBufferSize(new T.Vector2()); tmat.uniforms.scale.value = v.y * 0.5 * camera.projectionMatrix.elements[5]; };
  const SLOW = 0.055; // playback runs at 5.5 % of real time so a particle can be followed
  const GAP = 0.0012; // s of real flow between trail samples (13 mm at free stream, 170 mm of tail)
  let clock = 0;
  const at = (l, t, hint, out) => { // position and speed at time of flight t; returns segment index
    let lo = hint;
    if (l.tof[lo] > t) { let a = 0, b = lo; while (b - a > 1) { const m = (a + b) >> 1; if (l.tof[m] < t) a = m; else b = m; } lo = a; }
    else while (lo < l.n - 2 && l.tof[lo + 1] < t) lo++;
    const hi = lo + 1, f = Math.min(1, Math.max(0, (t - l.tof[lo]) / Math.max(l.tof[hi] - l.tof[lo], 1e-9)));
    for (let a = 0; a < 3; a++) out[a] = l.P[lo * 3 + a] + (l.P[hi * 3 + a] - l.P[lo * 3 + a]) * f;
    out[3] = (l.sp[lo] + (l.sp[hi] - l.sp[lo]) * f) / 255;
    return lo;
  };
  const o4 = [0, 0, 0, 0];
  const step = (dt) => {
    clock += dt * SLOW;
    let k = 0, v = 0;
    for (const l of lines) {
      for (let j = 0; j < PER; j++, k++) {
        const head = (phase[k] * l.T + clock) % l.T;
        let seg = 0;
        for (let s = 0; s < TRAIL; s++, v++) {
          const t = head - s * GAP;
          if (t < 0) { prgba[v * 4 + 3] = 0; ppos.fill(0, v * 3, v * 3 + 3); continue; }
          seg = at(l, t, s === 0 ? l.n - 2 : seg, o4);
          ppos[v * 3] = o4[0]; ppos[v * 3 + 1] = o4[1]; ppos[v * 3 + 2] = o4[2];
          rampColor('flow', o4[3], tmp);
          // fade in at the inlet and out at the far end of the line, and along the tail
          const edge = Math.min(1, t / 0.02, (l.T - t) / 0.03), a = (1 - s / TRAIL) ** 1.3 * edge * (s === 0 ? 1 : 0.75);
          prgba[v * 4] = tmp[0]; prgba[v * 4 + 1] = tmp[1]; prgba[v * 4 + 2] = tmp[2]; prgba[v * 4 + 3] = a;
        }
      }
    }
    posA.needsUpdate = true; colA.needsUpdate = true;
  };
  step(0);

  // slices
  const slices = {};
  for (const s of cfd.slices) {
    const solid = new Uint8Array(buf, s.solid, s.w * s.h);
    const tex = { speed: sliceTexture(new Uint8Array(buf, s.speed, s.w * s.h), s.w, s.h, 'speed', solid), cp: sliceTexture(new Uint8Array(buf, s.cp, s.w * s.h), s.w, s.h, 'cp', solid) };
    const [a0, b0, a1, b1] = s.box.map((v) => v * mm);
    const geo = new T.PlaneGeometry(a1 - a0, b1 - b0);
    const mat = new T.MeshBasicMaterial({ map: tex.speed, transparent: true, side: T.DoubleSide, depthWrite: false, opacity: 0.92 });
    const m = new T.Mesh(geo, mat);
    if (s.axis === 'z') m.position.set((a0 + a1) / 2, (b0 + b1) / 2, s.at_m * mm);
    else if (s.axis === 'y') { m.rotation.x = -Math.PI / 2; m.position.set((a0 + a1) / 2, s.at_m * mm, (b0 + b1) / 2); m.scale.y = -1; }
    else { m.rotation.y = Math.PI / 2; m.position.set(s.at_m * mm, (b0 + b1) / 2, (a0 + a1) / 2); m.scale.x = -1; }
    m.visible = false; m.renderOrder = -1;
    slices[s.name] = { mesh: m, tex };
    flow.add(m);
  }
  // the scrubbable cut plane through the volume, and isosurfaces: the wake (slow air) and vortex cores (Q)
  const V = volumeOf(cfd, buf);
  const plane = V ? volumePlane(V) : null;
  if (plane) { plane.mesh.visible = false; flow.add(plane.mesh); }
  // Both isosurfaces carry bands that travel downstream at the particles' playback speed, so the mean wake reads as moving air.
  const flowClock = { value: 0 };
  const flowing = (mat, { band, glass }) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = flowClock;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTun;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTun = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTun; uniform float uT;')
        .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
          float ph = (vTun.x + uT * ${(U * SLOW).toFixed(1)}) / ${band.toFixed(1)};
          float wave = 0.5 + 0.5 * sin(6.2832 * ph + 0.9 * sin(vTun.y * 0.012 + vTun.z * 0.015));
          ${glass ? `float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 1.6);
          diffuseColor.a *= (0.25 + 1.9 * rim) * (0.55 + 0.75 * wave);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.9, 1.0), 0.35 * wave * rim);` : 'diffuseColor.rgb *= 0.72 + 0.5 * wave;'}`);
    };
    mat.customProgramCacheKey = () => 'flow' + band + glass;
    return mat;
  };
  const iso = {
    wakeIso: { mesh: null, on: false, level: 0.7, mat: flowing(new T.MeshStandardMaterial({ color: 0x4b8fe0, transparent: true, opacity: 0.32, roughness: 0.3, side: T.DoubleSide, depthWrite: false }), { band: 170, glass: true }) },
    vortex: { mesh: null, on: false, level: 0.06, mat: flowing(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.05, side: T.DoubleSide, emissive: 0x0a1a20 }), { band: 120, glass: false }) },
  };
  const buildIso = (k) => {
    const it = iso[k]; if (!V) return;
    if (it.mesh) { flow.remove(it.mesh); it.mesh.geometry.dispose(); }
    let g;
    if (k === 'wakeIso') { const F = V.F.speed, thr = ((it.level - F.range[0]) / (F.range[1] - F.range[0])) * 255; g = isoSurface(V, (i) => !V.solid[i] && F.q[i] < thr, null); }
    else { // vortex cores away from the walls (the boundary layers carry Q too), coloured by how hard they spin
      if (!V.near) { // solid dilated by two cells
        V.near = Uint8Array.from(V.solid); const st = [1, V.nx, V.nx * V.ny];
        for (let pass = 0; pass < 2; pass++) { const src = Uint8Array.from(V.near); for (let i = 0; i < V.N; i++) if (src[i]) for (const o of st) { if (i + o < V.N) V.near[i + o] = 1; if (i - o >= 0) V.near[i - o] = 1; } }
      }
      const thr = it.level * 255; g = isoSurface(V, (i) => !V.near[i] && V.F.q.q[i] > thr, { q: V.F.vort.q, ramp: 'vort' });
    }
    it.mesh = new T.Mesh(g, it.mat); it.mesh.renderOrder = k === 'wakeIso' ? 2 : 0; it.mesh.visible = it.on; flow.add(it.mesh);
  };
  // Unsteady wake: instantaneous snapshots from the end of a tunnel run (cad/wind_tunnel.py --snaps), played back in
  // order. Vortex cores (Q) as a surface per frame, and the spanwise vorticity on the centre plane.
  const unsteady = (() => {
    const u = { on: false, ready: false, loading: null, frame: 0, t: 0, level: 0.3, showCores: true, showSheet: true, meshes: [], built: 0 };
    let D = null, sheet = null, sheetTex = null, cores = null, dense = null;
    const coreMat = flowing(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05, side: T.DoubleSide, emissive: 0x0c1c22 }), { band: 1e6, glass: false });
    const decodeQ = (f) => { // varint-delta indices then values -> dense uint8 over the volume grid
      const b = new Uint8Array(D.buf, f.off, f.bytes); dense.fill(0);
      let p = 0, idx = -1; const vals = f.off + f.bytes - f.count;
      const vq = new Uint8Array(D.buf, vals, f.count);
      for (let k = 0; k < f.count; k++) { let d = 0, sh = 0, c; do { c = b[p++]; d += (c & 127) * 2 ** sh; sh += 7; } while (c & 128); idx += d; dense[idx] = vq[k]; }
      return dense;
    };
    const build = (i) => {
      const q = decodeQ(D.json.volume.frames[i]), thr = u.level * 255;
      if (!V.near) { V.near = Uint8Array.from(V.solid); const st = [1, V.nx, V.nx * V.ny]; for (let pass = 0; pass < 2; pass++) { const src = Uint8Array.from(V.near); for (let k = 0; k < V.N; k++) if (src[k]) for (const o of st) { if (k + o < V.N) V.near[k + o] = 1; if (k - o >= 0) V.near[k - o] = 1; } } }
      return isoSurface(V, (k) => !V.near[k] && q[k] > thr, { q, ramp: 'vort' });
    };
    const paintSheet = (i) => {
      const P = D.json.plane, src = new Uint8Array(D.buf, P.frames[i], P.w * P.h), data = sheetTex.image.data, col = [0, 0, 0];
      for (let k = 0; k < P.w * P.h; k++) {
        const v = src[k], m = Math.abs(v - 127.5) / 127.5;
        rampColor('swirl', v / 255, col);
        data[k * 4] = col[0] * 255; data[k * 4 + 1] = col[1] * 255; data[k * 4 + 2] = col[2] * 255; data[k * 4 + 3] = v === 0 || m < 0.04 ? 0 : Math.min(235, 40 + 520 * m);
      }
      sheetTex.needsUpdate = true;
    };
    const show = (i) => {
      if (cores) cores.visible = false;
      const m = u.meshes[i];
      if (m) { m.visible = u.showCores; cores = m; }
      if (sheet) { sheet.visible = u.showSheet; if (u.showSheet) paintSheet(i); }
    };
    u.load = async () => {
      if (u.loading) return u.loading;
      u.loading = loadPack('data/cfd/' + cfd.unsteady).then(([json, buf]) => {
        D = { json, buf }; dense = new Uint8Array(V.N);
        const P = json.plane, mm = 1000;
        sheetTex = new T.DataTexture(new Uint8Array(P.w * P.h * 4), P.w, P.h, T.RGBAFormat);
        sheetTex.colorSpace = T.SRGBColorSpace; sheetTex.magFilter = sheetTex.minFilter = T.LinearFilter;
        const [a0, b0, a1, b1] = P.box.map((v) => v * mm);
        sheet = new T.Mesh(new T.PlaneGeometry(a1 - a0, b1 - b0), new T.MeshBasicMaterial({ map: sheetTex, transparent: true, side: T.DoubleSide, depthWrite: false }));
        sheet.position.set((a0 + a1) / 2, (b0 + b1) / 2, P.at_m * mm); sheet.renderOrder = -1; sheet.visible = false; flow.add(sheet);
        u.ready = true; u.meshes = new Array(json.frames).fill(null); u.built = 0;
        u.meshes[0] = new T.Mesh(build(0), coreMat); u.meshes[0].visible = false; flow.add(u.meshes[0]); u.built = 1;
        show(0);
      });
      return u.loading;
    };
    u.setOn = async (on) => { u.on = on; if (on) { await u.load(); show(u.frame); } else { if (cores) cores.visible = false; if (sheet) sheet.visible = false; } };
    u.setLevel = (lv) => { u.level = lv; if (!u.ready) return; for (const m of u.meshes) if (m) { flow.remove(m); m.geometry.dispose(); } u.meshes = new Array(D.json.frames).fill(null); u.built = 0; cores = null; u.meshes[u.frame] = new T.Mesh(build(u.frame), coreMat); flow.add(u.meshes[u.frame]); show(u.frame); };
    u.setParts = (c, sh) => { u.showCores = c; u.showSheet = sh; if (u.on && u.ready) show(u.frame); };
    u.tick = (dt) => {
      if (!u.ready) return false;
      // fill the cache one frame per tick, ahead of the playhead
      if (u.showCores) for (let k = 1; k < 3; k++) { const j = (u.frame + k) % u.meshes.length; if (!u.meshes[j]) { const m = new T.Mesh(build(j), coreMat); m.visible = false; flow.add(m); u.meshes[j] = m; break; } }
      u.t += dt * SLOW;
      const n = Math.floor(u.t / D.json.dt_s);
      if (n > 0) {
        u.t -= n * D.json.dt_s;
        let next = (u.frame + n) % u.meshes.length;
        if (u.showCores && !u.meshes[next]) next = u.frame; // wait for the build
        if (next !== u.frame) { u.frame = next; show(next); }
      }
      return true;
    };
    u.info = () => (D ? { frames: D.json.frames, dt_s: D.json.dt_s, span_s: D.json.frames * D.json.dt_s, frame: u.frame } : null);
    u.dispose = () => { u.meshes.forEach((m) => m?.geometry.dispose()); coreMat.dispose(); sheetTex?.dispose(); };
    return u;
  })();
  // the camera fits the bike, not the tunnel
  const bb = new T.Box3(); surfaceMeshes.forEach((m) => bb.union(m.geometry.boundingBox));
  const bounds = new T.Mesh(new T.BoxGeometry(...bb.getSize(new T.Vector3()).toArray()), new T.MeshBasicMaterial());
  bounds.position.copy(bb.getCenter(new T.Vector3())); bounds.visible = false; group.add(bounds);
  let field = 'speed', running = true, scan = false, scanDir = 1, onScan = null;
  const cut = { axis: 'x', t: 0.45, on: false };
  const applyCut = () => { if (!plane) return null; plane.mesh.visible = cut.on; return cut.on ? plane.set(cut.axis, cut.t, field) : null; };
  // drag and side force per x-slab and group (newer packs)
  const pr = cfd.profile, G = cfd.groups.length;
  const profile = pr ? { ...pr, drag: new Float32Array(buf, pr.drag, G * pr.n), side: new Float32Array(buf, pr.side, G * pr.n) } : null;
  const history = cfd.history;
  return {
    group, cfd, slices, surfaceMeshes, bounds, volume: V, profile, history,
    animate(dt) {
      let busy = false;
      if (running && particles.visible) { step(dt); busy = true; }
      if (running && rollers.on) { rollers.step(dt); busy = true; }
      if (running && ((iso.wakeIso.on && iso.wakeIso.mesh) || (iso.vortex.on && iso.vortex.mesh))) { flowClock.value += dt; busy = true; }
      if (unsteady.on && unsteady.tick(running ? dt : 0)) busy = true;
      if (scan && cut.on && plane) {
        cut.t += scanDir * dt * 0.08;
        if (cut.t > 1) { cut.t = 1; scanDir = -1; } else if (cut.t < 0) { cut.t = 0; scanDir = 1; }
        applyCut(); onScan?.(cut.t); busy = true;
      }
      return busy;
    },
    setRunning(v) { running = v; },
    /** Bike rolling on the playback clock; ratio is chainring / sprocket of the selected gear. */
    setRolling(on, ratio) { rollers.on = on; if (ratio > 0) rollers.ratio = ratio; },
    get hasUnsteady() { return !!cfd.unsteady && !!V; },
    unsteady,
    show(what, on) {
      if (what === 'particles') particles.visible = on;
      else if (what === 'lines') streamLines.visible = on;
      else if (what === 'surface') surfaceMeshes.forEach((m) => { m.material.vertexColors = on; m.material.color.copy(on ? new T.Color(1, 1, 1) : m.userData.plain); m.material.needsUpdate = true; });
      else if (iso[what]) { iso[what].on = on; if (on && !iso[what].mesh) buildIso(what); if (iso[what].mesh) iso[what].mesh.visible = on; }
      else if (slices[what]) slices[what].mesh.visible = on;
    },
    setIso(what, level) { iso[what].level = level; if (iso[what].on) buildIso(what); else if (iso[what].mesh) { flow.remove(iso[what].mesh); iso[what].mesh.geometry.dispose(); iso[what].mesh = null; } },
    /** Cut plane through the volume: axis 'x' (across the flow), 'y' (plan), 'z' (side); t from 0 to 1. Returns its position in mm. */
    setCut(c) { Object.assign(cut, c); return applyCut(); },
    get cut() { return { ...cut }; },
    setScan(v, cb) { scan = v; onScan = cb || null; },
    setField(f) { field = f; for (const s of Object.values(slices)) if (s.tex[f]) { s.mesh.material.map = s.tex[f]; s.mesh.material.needsUpdate = true; } applyCut(); },
    highlight(groupNames) { // dim everything except the parts of a drag group
      for (const m of surfaceMeshes) { const on = !groupNames || groupNames.some((k) => m.userData.pick.name === k || (k.endsWith('_') && m.userData.pick.name.startsWith(k)) || m.userData.pick.name.startsWith(k + '_')); m.material.transparent = !on; m.material.opacity = on ? 1 : 0.18; m.material.depthWrite = on; }
    },
    dispose: () => { dispose(group); unsteady.dispose(); plane?.dispose(); Object.values(iso).forEach((it) => { it.mesh?.geometry.dispose(); it.mat.dispose(); }); },
  };
}

// ---- Abaqus shell model --------------------------------------------------------------------------
export async function feScene(theme) {
  const [doc, buf] = await loadPack('data/fe/frame');
  const n = doc.n_nodes;
  const P0 = deq(buf, doc.positions, n, doc.offset, doc.scale);
  const idx = new Uint32Array(buf, doc.triangles, doc.n_tris * 3);
  const g = geometryFrom(P0.slice(), idx);
  const col = new Float32Array(n * 3); g.setAttribute('color', new T.BufferAttribute(col, 3));
  const mesh = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: T.DoubleSide, flatShading: false }));
  mesh.castShadow = true;
  const wire = new T.LineSegments(new T.WireframeGeometry(g), new T.LineBasicMaterial({ color: theme === 'dark' ? 0x000000 : 0x1b1f24, transparent: true, opacity: 0.07 }));
  const ghost = new T.Mesh(geometryFrom(P0.slice(), idx), new T.MeshBasicMaterial({ color: 0x8b95a1, wireframe: true, transparent: true, opacity: 0.06 }));
  const group = new T.Group(); group.add(mesh, wire, ghost);
  const arrows = new T.Group(); group.add(arrows);
  const cases = doc.cases.map((c) => ({ ...c, U: half(buf, c.U, n * 3), S: half(buf, c.mises, n) }));
  const modes = doc.modes.map((m) => ({ hz: m.hz, U: half(buf, m.U, n * 3) }));
  let cur = cases[0], mode = null, scale = 20, t = 0, playing = true, vmax = cur.p99_mises, smooth = true;
  const pos = g.attributes.position.array, wpos = wire.geometry.attributes.position.array;
  const tmp = [0, 0, 0];
  // the wireframe follows the mesh: map each wire vertex back to its mesh vertex once
  const wmap = new Int32Array(wpos.length / 3);
  { const key = new Map(); for (let i = 0; i < n; i++) key.set(`${P0[i * 3].toFixed(2)},${P0[i * 3 + 1].toFixed(2)},${P0[i * 3 + 2].toFixed(2)}`, i);
    for (let i = 0; i < wmap.length; i++) wmap[i] = key.get(`${wpos[i * 3].toFixed(2)},${wpos[i * 3 + 1].toFixed(2)},${wpos[i * 3 + 2].toFixed(2)}`) ?? 0; }
  function colour() {
    if (mode) { for (let i = 0; i < n; i++) { const u = mode.U, m = Math.hypot(u[i * 3], u[i * 3 + 1], u[i * 3 + 2]); rampColor('stress', m, tmp); col.set(tmp, i * 3); } }
    else for (let i = 0; i < n; i++) { rampColor('stress', cur.S[i] / vmax, tmp); col.set(tmp, i * 3); }
    g.attributes.color.needsUpdate = true;
  }
  function shape(f) {
    const U = mode ? mode.U : cur.U, s = mode ? scale * 1.6 : scale;
    for (let i = 0; i < n * 3; i++) pos[i] = P0[i] + U[i] * s * f;
    for (let i = 0; i < wmap.length; i++) { const j = wmap[i]; wpos[i * 3] = pos[j * 3]; wpos[i * 3 + 1] = pos[j * 3 + 1]; wpos[i * 3 + 2] = pos[j * 3 + 2]; }
    g.attributes.position.needsUpdate = true; wire.geometry.attributes.position.needsUpdate = true;
    if (smooth) g.computeVertexNormals();
  }
  function drawArrows(rp) {
    arrows.clear();
    if (mode || !rp) return;
    const fmax = Math.max(...cur.loads.map(([, v]) => Math.hypot(v[0], v[1], v[2])), 1);
    for (const [key, v] of cur.loads) {
      const F = new T.Vector3(v[0], v[1], v[2]); const len = F.length();
      const at = new T.Vector3(...rp[key]);
      if (len > 1e-6) {
        const L = 90 + 160 * len / fmax;
        arrows.add(new T.ArrowHelper(F.clone().normalize(), at.clone().addScaledVector(F.clone().normalize(), -L - 12), L, theme === 'dark' ? 0xffffff : 0x111418, 30, 16));
      }
      const M = new T.Vector3(v[3], v[4], v[5]);
      if (M.length() > 1e-3 && len < 1e-6) { // pure moment: a ring
        const ring = new T.Mesh(new T.TorusGeometry(70, 3, 8, 48, Math.PI * 1.6), new T.MeshBasicMaterial({ color: theme === 'dark' ? 0xffffff : 0x111418 }));
        ring.position.copy(at); ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), M.clone().normalize()); arrows.add(ring);
      }
    }
    for (const [key] of cur.bcs) {
      const c = new T.Mesh(new T.ConeGeometry(18, 34, 4), new T.MeshStandardMaterial({ color: 0x18a9a8, roughness: 0.5 }));
      c.position.set(...rp[key]).add(new T.Vector3(0, -40, 0)); arrows.add(c);
    }
  }
  colour(); shape(0.5); drawArrows(doc.rp);
  return {
    group, doc, cases, modes,
    get current() { return mode ? { mode } : cur; },
    animate(dt) {
      if (!playing) return false;
      t += dt;
      const f = mode ? Math.sin(2 * Math.PI * 0.8 * t) : 0.5 - 0.5 * Math.cos(2 * Math.PI * 0.5 * t);
      smooth = false; shape(f); smooth = true;
      return true;
    },
    setCase(name) { mode = null; cur = cases.find((c) => c.name === name) || cases[0]; vmax = cur.p99_mises; colour(); shape(playing ? 0 : 1); g.computeVertexNormals(); drawArrows(doc.rp); },
    setMode(i) { mode = modes[i]; colour(); shape(0); drawArrows(null); },
    setScale(s) { scale = s; if (!playing) { shape(mode ? 1 : 1); g.computeVertexNormals(); } },
    setPlaying(v) { playing = v; if (!v) { shape(1); g.computeVertexNormals(); } },
    setWire(v) { wire.visible = v; },
    dispose: () => dispose(group),
  };
}
