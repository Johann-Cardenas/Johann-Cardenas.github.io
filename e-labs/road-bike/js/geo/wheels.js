// Wheels and tyres: rim section, laced spokes, hubs, quick releases, valve, labelled tyre.
// Each wheel is built about its own axle (local origin) so it can spin.
//
// Installed pair (owner photos): Fulcrum Racing, black anodised 622x15C alloy rim with a machined
// brake track, big white RACING lettering with red accents and the small "ETRTO 622x15C /
// Aluminium Alloy" print; black bladed straight-pull spokes, silver nipples, Presta valve with a
// knurled lock ring and black cap. Tyre: Vittoria Rubino Pro 23-622, black, file-tread diamonds on
// the shoulders, white sidewall print. Both wheels are quick release, lever on the non-drive side.
import * as T from 'three';
import { V, AX, lathe, rod, sweep, spline, merge, plate, polarShape, rad, lerp, smooth, canvasTexture } from './kit.js';

export const BSD_R = 311;          // ETRTO 622 bead seat radius
export const RIM_OUTER_R = 316.5;  // top of the hook
export const TRACK_H = 10.5;       // machined brake track height

// Lacing the photos show but the catalog entry does not (yet) carry. The 622x15C Racing is the
// generation before the C17 rims, whose rear wheel was 2:1 ("2-Way Power"): drive-side spokes in
// crossed pairs, the non-drive side radial at half the count (16 + 8). A `lacing` field in the
// part's visual overrides this table.
const PHOTO_LACING = {}; // per-wheel overrides; the catalog visual is the source (Racing 15C: 18 radial, 24 rear 2:1)

// Dropout thickness outboard of the locknut (frame.js: rear plate 6 mm at OLN/2+3, fork 5.5 mm).
const DROP_T = { front: 5.5, rear: 6 };

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

// Tyre section. Point 0 is the non-drive bead, the arc runs over the crown to the drive bead, so
// the lathe's v coordinate is 0 at the non-drive bead, 0.5 on the crown and 1 at the drive bead.
const TIRE_ARC = 138, TIRE_N = 26;
function tireProfile(R, w, rimW) {
  const rc = R - w / 2, p = [], h = rimW / 2 - 1.2;
  p.push([RIM_OUTER_R - 2.5, -h]);
  for (let i = 0; i <= TIRE_N; i++) {
    const a = rad(-TIRE_ARC + (2 * TIRE_ARC * i) / TIRE_N);
    p.push([rc + (w / 2) * Math.cos(a), (w / 2) * Math.sin(a) * 1.02]);
  }
  p.push([RIM_OUTER_R - 2.5, h]);
  return p;
}
/** v of the tyre texture at section angle `deg` (0 = crown, -90 = non-drive wall, +90 = drive wall). */
const tireV = (deg) => (1 + ((deg + TIRE_ARC) / (2 * TIRE_ARC)) * TIRE_N) / (TIRE_N + 2);

// ---- textures ----------------------------------------------------------------------------------

/**
 * Draw into a band of a lathe texture so the artwork reads correctly from outside the wheel.
 * The lathe's u runs counter-clockwise seen from the drive side; each face of the wheel therefore
 * sees the canvas mirrored one way or the other. `top` and `bottom` are the band edges in v; the
 * glyph tops go to `top`. `flipH` mirrors along u.
 */
function band(c, W, H, top, bottom, flipH, draw) {
  const hgt = Math.abs(bottom - top) * H, sy = bottom > top ? 1 : -1;
  c.save();
  c.translate(flipH ? W : 0, top * H); c.scale(flipH ? -1 : 1, sy);
  draw(c, hgt);
  c.restore();
}

// Sidewall print strip: section angles (deg, non-drive negative) and the arc it spans.
const LABEL_A = [100, 131], LABEL_PHI = 2.0, LABEL_W = 4096, LABEL_H = 192;

function tyreMaterials(M, tv) {
  const wall = tv.sidewall === 'tan' ? '#b48a55' : '#151515';
  // colour only varies across the section: wall, black tread, bead
  const tex = canvasTexture(4, 512, (c, w, H) => {
    c.fillStyle = wall; c.fillRect(0, 0, w, H);
    const t0 = tireV(-74) * H, t1 = tireV(74) * H;
    c.fillStyle = '#121212'; c.fillRect(0, t0, w, t1 - t0);
    c.fillStyle = '#0b0b0b'; c.fillRect(0, 0, w, H * 0.035); c.fillRect(0, H * 0.965, w, H * 0.035);
  }, {});
  // file tread: rows of small raised diamonds over the shoulders, a plain strip on the crown
  const bump = canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#5a5a5a'; c.fillRect(0, 0, w, h);
    const v0 = tireV(-80) * h, v1 = tireV(80) * h, c0 = tireV(-7) * h, c1 = tireV(7) * h;
    const dx = 32, dy = 13;
    for (let y = v0, row = 0; y < v1; y += dy, row++) {
      if (y > c0 - dy * 0.4 && y < c1 + dy * 0.4) continue;
      for (let x = (row % 2) * dx / 2; x < w + dx; x += dx) {
        const g = c.createLinearGradient(x - dx * 0.4, y, x + dx * 0.4, y);
        g.addColorStop(0, '#9a9a9a'); g.addColorStop(0.5, '#d0d0d0'); g.addColorStop(1, '#7a7a7a');
        c.fillStyle = g; c.beginPath();
        c.moveTo(x - dx * 0.42, y); c.lineTo(x, y - dy * 0.46); c.lineTo(x + dx * 0.42, y); c.lineTo(x, y + dy * 0.46); c.closePath(); c.fill();
      }
    }
    c.fillStyle = '#6c6c6c'; c.fillRect(0, (c0 + c1) / 2 - 1, w, 2);
  }, { srgb: false, aniso: 8 });
  bump.wrapS = T.RepeatWrapping; bump.wrapT = T.ClampToEdgeWrapping; bump.repeat.set(64, 1);
  M.textures.push(tex, bump);
  const m = new T.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.86, metalness: 0, bumpMap: bump, bumpScale: 1.6 });
  m.name = 'tire_tex';
  return m;
}

/**
 * Sidewall print, as on the Rubino Pro: italic brand (red slash through the V of Vittoria), a
 * hairline divider, the model in outline capitals, "23-622 / 700x23c" stacked, a rule beneath.
 * Drawn on its own strip so the lettering gets real resolution. One canvas pixel is ~0.155 mm
 * along the tyre and ~0.032 mm across it, so glyphs are drawn squeezed by K to come out upright.
 */
function tyreLabel(M, tv, tireW, flipH, top) {
  const parts = String(tv.label || '').split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const ink = tv.sidewall === 'tan' ? '#151515' : '#ecebe6';
  const sizeA = parts.find((s) => /\d{2}-622/.test(s)) || `${Math.round(tireW)}-622`;
  const words = parts.filter((s) => s !== sizeA), brand = words[0] || '', model = words.slice(1).join(' ');
  const W = LABEL_W, H = LABEL_H, K = 0.21;
  const tex = canvasTexture(W, H, (c) => {
    c.clearRect(0, 0, W, H);
    band(c, W, H, top, 1 - top, flipH, (k, h) => {
      k.textBaseline = 'middle'; k.fillStyle = ink; k.strokeStyle = ink; k.textAlign = 'left';
      let x = 260;
      k.font = `italic 700 ${Math.round(h * 0.5)}px "Trebuchet MS", Arial, sans-serif`;
      k.save(); k.translate(x, h * 0.5); k.scale(K * 1.1, 1); k.fillText(brand, 0, 0);
      const bw = k.measureText(brand).width * K * 1.1;
      if (/^vittoria$/i.test(brand)) { // red slash through the V
        k.fillStyle = '#c8202a'; k.beginPath(); k.moveTo(h * 0.30, -h * 0.26); k.lineTo(h * 0.42, -h * 0.26); k.lineTo(h * 0.20, h * 0.24); k.lineTo(h * 0.08, h * 0.24); k.fill();
      }
      k.restore();
      x += bw + 70;
      k.fillRect(x, h * 0.16, 4, h * 0.66);                       // hairline divider
      x += 60;
      k.font = `italic 400 ${Math.round(h * 0.7)}px "Arial Narrow", Arial, sans-serif`;
      k.save(); k.translate(x, h * 0.46); k.scale(K * 1.3, 1); k.lineWidth = 8; k.strokeText(model, 0, 0);
      const mw = k.measureText(model).width * K * 1.3; k.restore();
      x += mw + 160;
      k.font = `400 ${Math.round(h * 0.3)}px Arial, sans-serif`;
      k.save(); k.translate(x, 0); k.scale(K * 1.1, 1); k.fillText(sizeA, 0, h * 0.30); k.fillText(`700x${Math.round(tireW)}c`, 0, h * 0.66); k.restore();
      k.fillRect(200, h * 0.9, x + 200, 7);                        // the rule under the print
    });
  }, {});
  M.textures.push(tex);
  return new T.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: 'tire_print' });
}

/** Lathe strip lying on the tyre wall between section angles a0 -> a1 (deg), over `phi` radians. */
function tyreStrip(R, w, a0, a1, phiStart, phi) {
  const rc = R - w / 2, pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = rad(lerp(a0, a1, i / 8));
    pts.push(new T.Vector2(rc + (w / 2 + 0.12) * Math.cos(a), (w / 2 + 0.12) * Math.sin(a) * 1.02));
  }
  const g = new T.LatheGeometry(pts, 96, phiStart, phi); g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Rim lettering, Fulcrum style: the word set huge so the letters fill the band, red slanted
 * accents after it and the small ETRTO print before it. Transparent elsewhere (the rim shows).
 * `flipH`/`flipV` orient it for one face; it reads upright at the bottom of the wheel.
 */
function rimDecal(M, vis, depth, { flipH, flipV }) {
  const W = 4096, H = 160, text = vis.decal, color = vis.decalColor || '#ffffff', accent = vis.decalAccent;
  const rep = depth > 35 ? 3 : 2;
  const tex = canvasTexture(W, H, (c) => {
    c.clearRect(0, 0, W, H);
    band(c, W, H, flipV ? 1 : 0, flipV ? 0 : 1, flipH, (k, h) => {
      for (let i = 0; i < rep; i++) {
        const x0 = (i / rep) * W + 120;
        k.save(); k.translate(x0, h * 0.5);
        // small print
        k.fillStyle = color; k.textBaseline = 'middle'; k.textAlign = 'left';
        // One canvas px is ~0.46 mm along the rim and ~0.08 mm across it: glyphs drawn at their
        // natural aspect come out ~6x extended, which is about what the Fulcrum lettering is.
        k.font = `500 ${Math.round(h * 0.22)}px Arial, sans-serif`;
        k.save(); k.scale(0.24, 1); k.fillText('ETRTO 622x15C', 0, -h * 0.13); k.fillText('Aluminium Alloy', 0, h * 0.15); k.restore();
        const wx = 90, sx = 0.95;
        k.font = `italic 900 ${Math.round(h * 0.98)}px "Arial Black", Arial, sans-serif`;
        k.save(); k.translate(wx, h * 0.04); k.scale(sx, 1); k.transform(1, 0, -0.14, 1, 0, 0);
        k.fillText(text, 0, 0);
        const tw = k.measureText(text).width * sx; k.restore();
        if (accent) { // red slanted blades after the word, and a thin red underline
          const ax = wx + tw + 24;
          k.fillStyle = accent;
          for (let j = 0; j < 3; j++) {
            const x = ax + j * 34, wj = 22 - j * 5;
            k.beginPath(); k.moveTo(x + 10, -h * 0.42); k.lineTo(x + 10 + wj, -h * 0.42); k.lineTo(x + wj - 10, h * 0.42); k.lineTo(x - 10, h * 0.42); k.closePath(); k.fill();
          }
          k.fillRect(wx, h * 0.45, tw * 0.5, h * 0.045);
        }
        k.restore();
      }
    });
  }, {});
  M.textures.push(tex);
  return new T.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.45, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: 'rim_decal' });
}

/** Machined brake track: concentric lathe marks as a roughness/bump map. */
function trackMaterial(M) {
  const tex = canvasTexture(4, 256, (c, w, h) => {
    for (let y = 0; y < h; y++) { const g = 120 + Math.round(60 * Math.sin(y * 1.7) * Math.sin(y * 0.23) + (y * 37 % 11) * 4); c.fillStyle = `rgb(${g},${g},${g})`; c.fillRect(0, y, w, 1); }
  }, { srgb: false, aniso: 4 });
  M.textures.push(tex);
  const m = M.aluMachined.clone();
  m.roughnessMap = tex; m.bumpMap = tex; m.bumpScale = 0.15; m.roughness = 0.55; m.name = 'brake_track';
  return m;
}

// ---- spokes ------------------------------------------------------------------------------------

/** Spoke end points for one wheel. Returns [{hub: V, rim: V}], local to the axle. */
function lacing(n, cross, fl, rimR) {
  const out = [];
  if (cross === 'g3') { // Campagnolo/Fulcrum G3 triplets: two drive-side tangential, one non-drive radial
    const groups = n / 3, d = rad(4.4);
    for (let g = 0; g < groups; g++) {
      const a = (g / groups) * Math.PI * 2;
      out.push({ hub: pol(fl.L, a, fl.zL), rim: pol(rimR, a, 0), side: -1 });
      for (const s of [-1, 1]) out.push({ hub: pol(fl.R, a + s * (d + rad(38)), fl.zR), rim: pol(rimR, a + s * d, 0), side: 1 });
    }
    return out;
  }
  if (cross === '2:1') { // Fulcrum 2-Way Power: drive-side crossed pairs, one radial non-drive between
    const groups = Math.round(n / 3), d = rad(4.6), sweepA = rad(34);
    for (let g = 0; g < groups; g++) {
      const a = (g / groups) * Math.PI * 2;
      out.push({ hub: pol(fl.L, a + Math.PI / groups, fl.zL), rim: pol(rimR, a + Math.PI / groups, 0), side: -1 });
      for (const s of [-1, 1]) out.push({ hub: pol(fl.R, a + s * d - s * sweepA, fl.zR), rim: pol(rimR, a + s * d, 0), side: 1 });
    }
    return out;
  }
  const m = n / 2;
  for (let side = 0; side < 2; side++) for (let i = 0; i < m; i++) {
    const a = ((2 * i + side) / n) * Math.PI * 2;
    const k = cross * (i % 2 ? -1 : 1);
    out.push({ hub: pol(side ? fl.R : fl.L, a + (k * Math.PI * 2) / m, side ? fl.zR : fl.zL), rim: pol(rimR, a, 0), side: side ? 1 : -1 });
  }
  return out;
}
const pol = (r, a, z) => V(r * Math.cos(a), r * Math.sin(a), z);

/** Basis for an instance laid along a spoke: Y along it, Z as close to the axle as possible. */
function spokeBasis(s) {
  const d = s.rim.clone().sub(s.hub), len = d.length(), y = d.clone().normalize();
  let z = AX.z.clone().addScaledVector(y, -y.z).normalize();
  const x = y.clone().cross(z).normalize(); z = x.clone().cross(y);
  return { q: new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z)), len, y };
}

function spokeMesh(list, mat, bladed) {
  // bladed: 2.3 x 0.9 mm flat, round for the last few mm at each end (as drawn spokes are)
  const blade = new T.CylinderGeometry(1, 1, 1, 10, 1), round = new T.CylinderGeometry(1, 1, 1, 8, 1);
  const inst = new T.InstancedMesh(blade, mat, list.length), ends = new T.InstancedMesh(round, mat, list.length * 2);
  const m = new T.Matrix4(), sc = new T.Vector3();
  list.forEach((s, i) => {
    const { q, len, y } = spokeBasis(s), e = 9;
    sc.set(bladed ? 1.15 : 0.95, len - 2 * e, bladed ? 0.45 : 0.95);
    inst.setMatrixAt(i, m.compose(s.hub.clone().add(s.rim).multiplyScalar(0.5), q, sc));
    sc.set(0.95, e + 0.5, 0.95);
    ends.setMatrixAt(2 * i, m.compose(s.hub.clone().addScaledVector(y, e / 2), q, sc));
    ends.setMatrixAt(2 * i + 1, m.compose(s.rim.clone().addScaledVector(y, -e / 2), q, sc));
  });
  inst.castShadow = ends.castShadow = true;
  return [inst, ends];
}

/** Straight-pull heads seated in the flange, a short cylinder along each spoke at the hub end. */
function spokeHeads(list, mat) {
  const geo = new T.CylinderGeometry(2.1, 2.1, 5, 10);
  const inst = new T.InstancedMesh(geo, mat, list.length), m = new T.Matrix4(), one = V(1, 1, 1);
  list.forEach((s, i) => { const { q, y } = spokeBasis(s); inst.setMatrixAt(i, m.compose(s.hub.clone().addScaledVector(y, 1), q, one)); });
  return inst;
}

// ---- hubs --------------------------------------------------------------------------------------

function hubGeometry(front, half) {
  if (front) {
    // slim alloy barrel, two straight-pull flanges with radial lobes
    const zL = -33, zR = 33;
    const body = [[0.01, -half], [5.6, -half], [5.6, -half + 1.5], [9.6, -half + 1.5], [9.6, -half + 6.5], [8.6, -half + 7.5], [10.5, -half + 9.5],
      [11.5, zL - 4], [16, zL - 3], [16.5, zL + 2.5], [12.5, zL + 6], [11.2, -10], [11, 0], [11.2, 10], [12.5, zR - 6], [16.5, zR - 2.5], [16, zR + 3], [11.5, zR + 4],
      [10.5, half - 9.5], [8.6, half - 7.5], [9.6, half - 6.5], [9.6, half - 1.5], [5.6, half - 1.5], [5.6, half], [0.01, half]];
    return { body, fl: { L: 19.5, R: 19.5, zL, zR }, lobes: [[zL, 19.5], [zR, 19.5]] };
  }
  // rear: small non-drive flange, big drive flange for twice the spokes, then the freehub
  const zL = -37, zR = 19;
  const body = [[0.01, -half], [5.6, -half], [5.6, -half + 1.5], [10.4, -half + 1.5], [10.4, -half + 7.5], [9.4, -half + 8.5], [11.6, -half + 11],
    [12.5, zL - 4], [16, zL - 3], [16.5, zL + 2.5], [13.5, zL + 7], [13.2, -12], [15, 6], [18, zR - 4.5], [26, zR - 2.6], [26.5, zR + 2.4], [20.5, zR + 3.5], [20.5, zR + 5], [0.01, zR + 5]];
  return { body, fl: { L: 19, R: 24, zL, zR }, lobes: [[zL, 19], [zR, 24]] };
}

/** HG freehub body: 9 splines (one wide), visible between the drive flange and the cassette. */
function freehub(z0, z1) {
  const spl = polarShape((a) => { const k = ((a / (Math.PI * 2)) * 9) % 1; return k < 0.62 ? 17.3 : 16.2; }, 216);
  const g = plate(spl, z1 - z0); g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

// ---- quick release -----------------------------------------------------------------------------

/** Conical spring, small end toward the hub, as a helix of round wire. */
function spring(zIn, zOut, r0, r1, turns = 3.5) {
  const pts = [], n = Math.round(turns * 18);
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * Math.PI * 2, r = lerp(r0, r1, t); pts.push(V(r * Math.cos(a), r * Math.sin(a), lerp(zIn, zOut, t))); }
  return sweep(pts, 0.55, { seg: 6, side: AX.z });
}

/**
 * Fulcrum-type QR skewer about the axle (local origin, +Z drive side). `dir` is the in-plane
 * direction the closed lever lies along. The cam housing and lever sit on the non-drive side, the
 * knurled adjusting nut on the drive side, a conical spring under each.
 */
function quickRelease(B, origin, half, dropT, dir, steer, label) {
  const { M } = B, zo = half + dropT;            // outer face of the dropout
  const grp = B.pivot('wheels', origin, { steer, key: 'static' });
  // skewer rod and springs (mostly hidden in the hub axle and the nut/cam recesses)
  B.addTo(grp, merge([rod(V(0, 0, -zo - 8), V(0, 0, zo + 9), 2.5, 2.5, 12), spring(zo + 0.2, zo + 3.2, 3.4, 5.6), spring(-zo - 0.2, -zo - 3.2, 3.4, 5.6)]), M.steel, `${label} QR skewer and springs`);
  // drive side: knurled adjusting nut, chamfered toward the dropout, domed outer face
  const knurl = plate(polarShape((a) => 8.7 + 0.32 * Math.cos(a * 28), 168), 8.5); knurl.translate(0, 0, zo + 4.75 + 1.8);
  const nut = merge([knurl, lathe([[3.5, zo + 0.9], [6.8, zo + 0.9], [8.3, zo + 2.55], [8.3, zo + 2.6]], 32), lathe([[8.3, zo + 10.8], [7.2, zo + 12.2], [4.5, zo + 12.9], [0.01, zo + 13.1]], 32)]);
  B.addTo(grp, nut, M.aluDark, `${label} QR adjusting nut`);
  // non-drive side: cam housing (cup against the dropout, barrel out to the cam)
  const zc = -zo - 13.5;                          // cam pivot
  B.addTo(grp, lathe([[0.01, -zo - 0.9], [7.8, -zo - 0.9], [9.2, -zo - 2.2], [9.6, -zo - 4.5], [8.4, -zo - 9.5], [7.6, zc + 2.5], [7.6, zc], [0.01, zc]], 36), M.aluDark, `${label} QR cam housing`);
  // lever: forked cam head round the pivot pin, then a curved blade lying back toward the frame
  const d = dir.clone().setZ(0).normalize(), pinAx = V(-d.y, d.x, 0);
  // cam head: one rounded body across the pin, enclosing the end of the housing
  const head = sweep([V(0, 0, zc - 1.5).addScaledVector(pinAx, -10), V(0, 0, zc - 1.5).addScaledVector(pinAx, 10)], { a: 8.6, b: 9.4, n: 2.6 }, { seg: 28, side: d, capRound: true });
  const at = (s, off) => V(d.x * s, d.y * s, -zo - off);
  const path = spline([at(2, 18.6), at(12, 18.8), at(26, 17.6), at(42, 15.2), at(56, 13), at(64, 12.4)], 30);
  const blade = sweep(path, (u) => ({ a: lerp(8.4, 5.6, smooth(u * 1.6)) + 1.4 * smooth((u - 0.72) / 0.28), b: lerp(2.6, 1.9, u), n: 3 }), { seg: 18, side: AX.z, capRound: true });
  B.addTo(grp, merge([head, blade]), M.plasticGloss, `${label} QR lever`);
  B.addTo(grp, rod(pinAx.clone().multiplyScalar(-14.9).setZ(zc - 1.5), pinAx.clone().multiplyScalar(14.9).setZ(zc - 1.5), 2.2, 2.2, 14), M.chrome, `${label} QR cam pin`);
}

// ---- wheels ------------------------------------------------------------------------------------

export function buildWheels(B) {
  const { M, hp } = B, wp = B.part('wheels'), vis = wp?.visual ?? {}, tv = B.part('tires')?.visual ?? {};
  const tireW = B.tireW, R = B.R, width = vis.width ?? 20.8;
  const carbon = vis.rim === 'carbon', track = vis.track ?? 'alloy';
  const rimMat = carbon ? M.carbon : M.aluBlack.clone();
  if (!carbon) { rimMat.roughness = 0.38; rimMat.metalness = 0.55; rimMat.color.set(0x161719); rimMat.name = 'rim_anodised'; }
  const hubMat = vis.hub === 'silver' ? M.aluSilver : M.aluBlack;
  const spokeMat = vis.hub === 'silver' ? M.steel : M.plasticGloss.clone();
  if (spokeMat !== M.steel) { spokeMat.color.set(0x121315); spokeMat.roughness = 0.35; spokeMat.metalness = 0.4; spokeMat.name = 'spoke_black'; }
  const tireMat = tyreMaterials(M, tv), trackMat = track === 'alloy' ? trackMaterial(M) : null;
  const photo = PHOTO_LACING[wp?.id] || {};
  // non-drive strip runs bead -> crown (glyph tops at v = 1), drive strip crown -> bead, mirrored
  const labelMats = [tyreLabel(M, tv, tireW, false, 1), tyreLabel(M, tv, tireW, true, 0)];
  B.rimWidth = width;

  // QR levers lie closed along the fork blade (front) and between the stays (rear)
  const forkDir = hp.hb.clone().sub(hp.fa).setZ(0).normalize();
  const stayDir = hp.bb.clone().sub(hp.ra).setZ(0).normalize().add(hp.st.clone().sub(hp.ra).setZ(0).normalize()).normalize();

  for (const front of [true, false]) {
    const axle = front ? hp.fa : hp.ra, steer = front, key = front ? 'front' : 'rear', label = front ? 'Front' : 'Rear';
    const depth = (!front && vis.depthRear) || vis.depth || 24;
    const lace = vis.lacing?.[key] || photo[key] || {};
    const n = lace.n ?? (vis.spokes ?? [16, 20])[front ? 0 : 1], cross = lace.cross ?? (vis.cross ?? [0, 2])[front ? 0 : 1];
    const half = (front ? B.geom.interfaces.front_oln_mm : B.geom.interfaces.rear_oln_mm) / 2;
    const W = B.pivot('wheels', axle, { steer, key }), Tg = B.pivot('tires', axle, { steer, key });
    const { p, rt, rn } = rimProfile(depth, width);

    // rim body, machined brake tracks, decals
    B.addTo(W, lathe(p, 180), rimMat, `${label} rim`);
    if (trackMat) {
      const h = width / 2 + 0.06;
      B.addTo(W, merge([lathe([[rt + 0.4, -h], [RIM_OUTER_R - 0.5, -h]], 180), lathe([[RIM_OUTER_R - 0.5, h], [rt + 0.4, h]], 180)]), trackMat, `${label} brake track`);
    }
    if (vis.decal && B.P.decals !== false && depth >= 22) {
      const r1 = rt - 1.2, r0 = Math.max(rn + 2.5, rt - (depth > 35 ? 26 : 14));
      const zAt = (r) => { const t = (r - rn - 0.6) / (rt - rn - 0.6); return lerp(2.6, width / 2, Math.pow(Math.max(t, 0), depth > 35 ? 0.42 : 0.6)) + 0.08; };
      const prof = (a, b) => { const q = []; for (let i = 0; i <= 6; i++) { const r = lerp(a, b, i / 6); q.push(r); } return q; };
      // drive face: v = 0 at the outer edge; non-drive face: v = 0 at the inner edge
      B.addTo(W, lathe(prof(r1, r0).map((r) => [r, zAt(r)]), 180), rimDecal(M, vis, depth, { flipH: false, flipV: true }), `${label} rim decal`, false);
      B.addTo(W, lathe(prof(r0, r1).map((r) => [r, -zAt(r)]), 180), rimDecal(M, vis, depth, { flipH: true, flipV: false }), `${label} rim decal`, false);
    }

    // hub
    const hub = hubGeometry(front, half);
    B.addTo(W, lathe(hub.body, 56), hubMat, `${label} hub`);
    if (!front) {
      B.addTo(W, freehub(hub.fl.zR + 5, Math.min(half - 2, 62)), M.aluDark, 'Freehub body');
      B.addTo(W, lathe([[0.01, half - 3], [8.8, half - 3], [8.8, half], [0.01, half]], 32), M.aluDark, 'Rear axle end cap');
    }

    // spokes, straight-pull heads, nipples
    const spokes = lacing(n, cross, hub.fl, rn + 1.5);
    const [blades, ends] = spokeMesh(spokes, spokeMat, vis.bladed);
    W.add(tag(blades, 'wheels', `${label} spokes`), tag(ends, 'wheels', `${label} spokes`));
    W.add(tag(spokeHeads(spokes, hubMat), 'wheels', `${label} spoke heads`));
    const nip = new T.InstancedMesh(merge([new T.CylinderGeometry(1.85, 1.85, 9, 8), new T.CylinderGeometry(2.4, 2.4, 1.2, 12).translate(0, 4.2, 0)]), M.aluSilver, spokes.length), mt = new T.Matrix4(), q = new T.Quaternion();
    spokes.forEach((s, i) => {
      const dd = s.rim.clone().sub(s.hub).normalize();
      q.setFromUnitVectors(AX.y, dd);
      nip.setMatrixAt(i, mt.compose(s.rim.clone().addScaledVector(dd, -3), q, new T.Vector3(1, 1, 1)));
    });
    W.add(tag(nip, 'wheels', `${label} spoke nipples`));

    // Presta valve between two spokes: knurled lock ring, threaded body, black cap
    const va = rad(front ? 252 : 236) + Math.PI / n, vd = V(Math.cos(va), Math.sin(va), 0), at = (r) => vd.clone().multiplyScalar(r);
    const ring = plate(polarShape((a) => 4.4 + 0.25 * Math.cos(a * 18), 108), 4);
    ring.applyQuaternion(new T.Quaternion().setFromUnitVectors(AX.z, vd)); ring.translate(...at(rn - 2.4).toArray());
    B.addTo(W, merge([rod(at(rn + 2), at(rn - 26), 2.9, 2.9, 14), ring]), M.aluSilver, `${label} valve`);
    B.addTo(W, merge([rod(at(rn - 25), at(rn - 41), 3.7, 3.4, 16), rod(at(rn - 41), at(rn - 42.2), 3.4, 2.6, 16)]), M.plasticGloss, `${label} valve cap`);

    // tyre
    B.addTo(Tg, lathe(tireProfile(R, tireW, width), 240), tireMat, `${label} tyre`);
    if (labelMats[0]) B.addTo(Tg, tyreStrip(R, tireW, -LABEL_A[1], -LABEL_A[0], front ? 2.2 : 0.4, LABEL_PHI), labelMats[0], `${label} tyre sidewall print`, false);
    if (labelMats[1]) B.addTo(Tg, tyreStrip(R, tireW, LABEL_A[0], LABEL_A[1], front ? 3.9 : 4.6, LABEL_PHI), labelMats[1], `${label} tyre sidewall print`, false);
    quickRelease(B, axle, half, front ? DROP_T.front : DROP_T.rear, front ? forkDir : stayDir, steer, label);
  }
}

function tag(mesh, slot, name) { mesh.userData.slot = slot; mesh.userData.part = name; mesh.receiveShadow = true; mesh.castShadow = true; return mesh; }
