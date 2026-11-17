// Material library and paint textures. One instance per build; the viewer disposes it on rebuild.
import * as T from 'three';
import { canvasTexture } from './kit.js';

export const PAINT_SCHEMES = {
  stock: { c1: '#f3f3f0', c2: '#c41230', c3: '#111214', label: 'White / race red' },
  stealth: { c1: '#17181a', c2: '#3a3d42', c3: '#b8bcc2', label: 'Stealth black' },
  team: { c1: '#0d7a3e', c2: '#f3f3f0', c3: '#111214', label: 'Team green' },
};
export const schemeColors = (P) => (P.paint === 'custom' ? { c1: P.c1, c2: P.c2, c3: P.c3 } : PAINT_SCHEMES[P.paint] || PAINT_SCHEMES.stock);

const lum = (hex) => { const c = new T.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };

/** Fine twill for bare carbon; used as a roughness/bump map so it only shows in reflections. */
function carbonWeave() {
  return canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#7a7a7a'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      c.fillStyle = (x + y) % 4 < 2 ? '#8c8c8c' : '#666';
      c.fillRect(x * 16, y * 16, 16, 16);
      c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x * 16, y * 16, 16, 1); c.fillRect(x * 16, y * 16, 1, 16);
    }
  }, { repeat: [24, 6], srgb: false, flipY: true });
}
function tapeWrap() {
  return canvasTexture(64, 64, (c, w, h) => {
    c.fillStyle = '#808080'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#3c3c3c'; c.lineWidth = 5;
    for (let i = -2; i < 4; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32 + 22, h); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,.10)';
    for (let i = 0; i < 90; i++) c.fillRect((i * 37) % w, (i * 53) % h, 2, 2);
  }, { repeat: [26, 1], srgb: false, flipY: true });
}
function treadTex() {
  return canvasTexture(256, 64, (c, w, h) => {
    c.fillStyle = '#808080'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,.25)';
    for (let i = 0; i < 700; i++) c.fillRect((i * 71) % w, (i * 29) % h, 1, 1);
  }, { repeat: [90, 4], srgb: false, flipY: true });
}

export function makeMaterials(P) {
  const S = schemeColors(P);
  const weave = carbonWeave(), wrap = tapeWrap(), tread = treadTex();
  const phys = (o) => new T.MeshPhysicalMaterial(o), std = (o) => new T.MeshStandardMaterial(o);
  const M = {
    scheme: S, textures: [weave, wrap, tread],
    paint: phys({ color: S.c1, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 }),
    paintAccent: phys({ color: S.c2, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 }),
    paintDark: phys({ color: S.c3, roughness: 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 }),
    carbon: phys({ color: 0x141517, roughness: 0.42, metalness: 0.1, clearcoat: 0.9, clearcoatRoughness: 0.18, roughnessMap: weave, bumpMap: weave, bumpScale: 0.25 }),
    carbonMatte: std({ color: 0x18191b, roughness: 0.62, metalness: 0.05, bumpMap: weave, bumpScale: 0.2 }),
    aluBlack: std({ color: 0x1b1c1f, roughness: 0.42, metalness: 0.75 }),
    aluDark: std({ color: 0x2a2c30, roughness: 0.4, metalness: 0.8 }),
    aluSilver: std({ color: 0xc9ccd0, roughness: 0.24, metalness: 1 }),
    aluMachined: std({ color: 0x9da2a8, roughness: 0.4, metalness: 1, envMapIntensity: 0.75 }),
    steel: std({ color: 0x8f9399, roughness: 0.36, metalness: 1, envMapIntensity: 0.8 }),
    chrome: std({ color: 0xb9bdc2, roughness: 0.16, metalness: 1, envMapIntensity: 0.85 }),
    bolt: std({ color: 0x8d9197, roughness: 0.36, metalness: 1 }),
    brass: std({ color: 0xb79a55, roughness: 0.38, metalness: 1 }),
    plastic: std({ color: 0x161719, roughness: 0.58, metalness: 0 }),
    plasticGloss: std({ color: 0x101113, roughness: 0.28, metalness: 0 }),
    rubber: std({ color: 0x141414, roughness: 0.88, metalness: 0 }),
    hood: std({ color: 0x1a1a1c, roughness: 0.78, metalness: 0 }),
    tire: std({ color: 0xffffff, roughness: 0.9, metalness: 0, bumpMap: tread, bumpScale: 0.3 }),
    saddle: std({ color: 0x131314, roughness: 0.62, metalness: 0 }),
    tape: std({ color: P.tape || '#161618', roughness: 0.82, metalness: 0, bumpMap: wrap, bumpScale: 0.9 }),
    housing: std({ color: 0x131315, roughness: 0.55, metalness: 0 }),
    lens: phys({ color: 0xffffff, roughness: 0.08, metalness: 0, transmission: 0.6, thickness: 4, emissive: 0xfff4d6, emissiveIntensity: 0.25 }),
    lensRed: phys({ color: 0xd01818, roughness: 0.12, metalness: 0, emissive: 0xb00000, emissiveIntensity: 0.6 }),
    screen: std({ color: 0x0c1014, roughness: 0.12, metalness: 0.2, emissive: 0x16323a, emissiveIntensity: 0.6 }),
    bottle: phys({ color: 0xf2f4f6, roughness: 0.42, metalness: 0, transmission: 0.25, thickness: 2 }),
    hole: new T.MeshBasicMaterial({ color: 0x050506 }),
  };
  // text colour that reads on the primary paint
  M.inkOnPaint = lum(S.c1) > 0.4 ? S.c3 : (lum(S.c3) > 0.4 ? S.c3 : '#e9eaec');
  for (const [k, m] of Object.entries(M)) if (m && m.isMaterial) m.name = k;
  return M;
}

const FONT = 'italic 900 {s}px "Arial Black", "Helvetica Neue", Arial, sans-serif';
const font = (s, f = FONT) => f.replace('{s}', s);

/**
 * Painted tube material with a per-tube texture. `kind` selects the artwork.
 *
 * Layout read off the owner's photos (2026-11-16): gloss white base; Cannondale red on the down-tube
 * belly, the head-tube hood (which runs onto the front of the top tube and the top of the down tube),
 * the lower half of the chainstays, the wheel-side edge of the seat stays and the bottom-bracket
 * underside, each edged with a thin black pinstripe; a black band under the rear of the top tube that
 * carries on down the front of the seat tube; lower-case "cannondale" in black with a grey shadow on
 * both flanks of the down tube; "SYNAPSE" in thin black outline letters running along the seat tube,
 * letter tops facing forward on both sides; a red flash and a black trailing edge on the fork.
 *
 * Texture space: u (x) runs along the tube, v (y) round the section. Where v = 0 sits differs per
 * tube (it is the sweep's N axis), so each layout below notes it.
 */
export function tubePaint(M, P, kind) {
  const S = M.scheme, decals = P.decals !== false;
  const W = 2048, H = 512;
  const tex = canvasTexture(W, H, (c) => {
    c.fillStyle = S.c1; c.fillRect(0, 0, W, H);
    /** Filled polygon in (u, v), drawn three times so shapes that cross the v seam wrap. */
    const poly = (pts, col) => {
      c.fillStyle = col;
      for (const off of [-1, 0, 1]) {
        c.beginPath();
        pts.forEach(([u, v], i) => (i ? c.lineTo(u * W, (v + off) * H) : c.moveTo(u * W, (v + off) * H)));
        c.closePath(); c.fill();
      }
    };
    /** Region between two curves v0(u) < v1(u) for u in [u0, u1]; `pin` edges it with a pinstripe. */
    const band = (u0, u1, v0, v1, col, pin = 0) => {
      const n = 48, top = [], bot = [];
      for (let i = 0; i <= n; i++) { const u = u0 + (u1 - u0) * i / n; top.push([u, v0(u)]); bot.push([u, v1(u)]); }
      if (pin) poly([...top.map(([u, v]) => [u, v - pin]), ...bot.slice().reverse().map(([u, v]) => [u, v + pin])], S.c3);
      poly([...top, ...bot.reverse()], col);
    };
    const k = (x) => () => x;
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    /** Text on one flank: centred at (u, v), `flip` turns it 180 degrees, stretched to `len` in u. */
    const text = (str, u, v, flip, len, draw) => {
      c.save(); c.translate(u * W, v * H); if (flip) c.rotate(Math.PI);
      const wNat = c.measureText(str).width || 1;
      c.scale((len * W) / wNat, 1); draw(c, str); c.restore();
    };
    const red = S.c2, ink = S.c3, pin = 0.007;

    if (kind === 'down') {
      // v: 0 top face, 0.25 drive flank, 0.5 belly, 0.75 non-drive. u: 0 at the BB.
      // Belly red, rising over the flanks into the hood near the head tube (only the top stays white).
      const lift = (u) => 0.2 * ss(0.80, 0.95, u);
      band(-0.02, 1.02, (u) => 0.305 - lift(u), (u) => 0.695 + lift(u), red, pin);
      if (decals) for (const [v, flip] of [[0.185, false], [0.815, true]]) {
        c.font = font(118, '800 {s}px "Arial Rounded MT Bold", "Arial Black", Arial, sans-serif'); c.textBaseline = 'middle'; c.textAlign = 'center';
        text('cannondale', 0.52, v, flip, 0.56, (k2, s2) => {
          k2.fillStyle = '#9ba1a8'; k2.fillText(s2, 3, 9);
          k2.fillStyle = M.inkOnPaint; k2.fillText(s2, 0, 0);
        });
      }
    } else if (kind === 'top') {
      // v: 0 top, 0.25 drive, 0.5 underside, 0.75 non-drive. u: 0 at the seat cluster, 1 at the head tube.
      // Red hood over the front; its edge sweeps back along the top. Black band under the rear half.
      const edge = (v) => 0.80 + 0.07 * (1 - Math.cos(2 * Math.PI * v)) / 2;
      const pts = []; for (let i = 0; i <= 64; i++) { const v = i / 64; pts.push([edge(v), v]); }
      poly([[1.02, 0], ...pts.map(([u, v]) => [u - 0.004, v]), [1.02, 1]], ink);
      poly([[1.02, 0], ...pts, [1.02, 1]], red);
      band(-0.02, 0.6, (u) => 0.5 - 0.15 * (1 - ss(0, 0.6, u)), (u) => 0.5 + 0.15 * (1 - ss(0, 0.6, u)), ink);
    } else if (kind === 'seat') {
      // v: 0 rear face, 0.25 drive, 0.5 front, 0.75 non-drive. u: 0 at the BB.
      // The top tube's black band carries on down the front of the seat tube as a tapering wedge.
      const wedge = (u) => 0.16 * ss(0.62, 0.86, u) * (1 - ss(0.885, 0.9, u));
      band(0.62, 0.9, (u) => 0.5 - wedge(u), (u) => 0.5 + wedge(u), ink);
      if (decals) for (const [v, flip] of [[0.25, true], [0.75, false]]) {
        c.font = font(104, '300 {s}px "Bahnschrift", "Arial Narrow", Arial, sans-serif'); c.textBaseline = 'middle'; c.textAlign = 'center';
        text('SYNAPSE', 0.63, v, flip, 0.40, (k2, s2) => {
          k2.lineJoin = 'miter'; k2.lineWidth = 6.5; k2.strokeStyle = ink; k2.strokeText(s2, 0, 0);
        });
      }
    } else if (kind === 'head') {
      // v: 0 rear (toward the frame), 0.5 front. u: 0 at the bottom. Red over all but the lower third,
      // and a white strip down the rear face joining the white under the top tube to the down tube.
      const lowEdge = (v) => { const d = Math.min(v, 1 - v); return 0.02 + 0.34 * ss(0.17, 0.36, d); };
      const pts = []; for (let i = 0; i <= 64; i++) { const v = i / 64; pts.push([lowEdge(v), v]); }
      poly([[1.02, 0], ...pts.map(([u, v]) => [u - 0.012, v]), [1.02, 1]], ink);
      poly([[1.02, 0], ...pts, [1.02, 1]], red);
      band(-0.02, 0.72, k(-0.085), k(0.085), ink);
      band(-0.02, 0.70, k(-0.08), k(0.08), S.c1);
    } else if (kind === 'chainstay') {
      // v: 0 bottom, 0.25 +Z, 0.5 top, 0.75 -Z. u: 0 at the BB. Lower half red, top white.
      const rr = (u) => 0.30 - 0.30 * ss(0.80, 0.96, u);
      band(-0.02, 1.02, (u) => -rr(u), rr, red, pin);
      if (decals) for (const [v, flip] of [[0.20, true], [0.80, false]]) {
        c.font = font(46, '800 {s}px Arial, sans-serif'); c.textBaseline = 'middle'; c.textAlign = 'center';
        text('SAVE', 0.50, v, flip, 0.07, (k2, s2) => { k2.fillStyle = S.c1; k2.fillText(s2, 0, 0); });
      }
    } else if (kind === 'stay') {
      // v: 0 the wheel-side edge, 0.5 the upper edge. u: 0 at the seat cluster. Red along the wheel side.
      const rr = (u) => 0.24 * ss(0.13, 0.21, u) * (1 - ss(0.70, 0.84, u));
      band(-0.02, 1.02, (u) => -rr(u), rr, red, pin * 0.8);
    } else if (kind === 'fork_drive' || kind === 'fork_left') {
      // v: 0 the -Z face, 0.25 front, 0.5 +Z, 0.75 rear. u: 0 at the crown. Red flash on the outer
      // face below the crown, black down the trailing edge of the lower blade.
      const outer = kind === 'fork_drive' ? 0.5 : 0, fr = kind === 'fork_drive' ? 1 : -1; // which way "front" runs in v
      const q = (u, d) => [u, outer + fr * d];
      poly([q(0.10, 0.20), q(0.19, 0.20), q(0.36, -0.22), q(0.25, -0.22)], ink);
      poly([q(0.115, 0.20), q(0.18, 0.20), q(0.345, -0.22), q(0.265, -0.22)], red);
      band(0.42, 0.96, (u) => 0.75 - 0.06 * ss(0.42, 0.6, u), (u) => 0.75 + 0.06 * ss(0.42, 0.6, u), ink);
    } else if (kind === 'bb') {
      // v: 0 front, 0.25 up, 0.5 rear, 0.75 down. The underside is red, carrying the belly through.
      band(-0.02, 1.02, k(0.56), k(1.04), red, pin);
    }
    // 'crown': plain white
  });
  tex.wrapT = T.RepeatWrapping; // v runs round the section; the frame mesh unwraps the seam past 1
  M.textures.push(tex);
  const m = M.paint.clone(); m.color.set(0xffffff); m.map = tex; m.name = 'paint_' + kind;
  return m;
}

/** Text ring for a lathe band (rim decal). `mirror` flips it for the opposite face of the wheel. */
export function ringText(M, text, color, { repeat = 3, mirror = false, size = 0.62, font: f = '900 {s}px Arial, sans-serif', bg = null, accent = null } = {}) {
  const W = 4096, H = 128;
  const tex = canvasTexture(W, H, (c) => {
    c.clearRect(0, 0, W, H);
    if (bg) { c.fillStyle = bg; c.fillRect(0, 0, W, H); }
    if (mirror) { c.translate(W, 0); c.scale(-1, 1); }
    c.fillStyle = color; c.font = font(Math.round(H * size), f); c.textBaseline = 'middle'; c.textAlign = 'center';
    for (let i = 0; i < repeat; i++) {
      const x = (i + 0.5) * W / repeat;
      if (accent) { // the white band the lettering sits in, with a red block after it
        const tw = c.measureText(text).width;
        c.fillStyle = color; c.fillRect(x - tw * 0.62, H * 0.12, tw * 1.24, H * 0.76);
        c.fillStyle = accent; c.fillRect(x + tw * 0.66, H * 0.12, tw * 0.22, H * 0.76);
        c.fillStyle = '#111214'; c.fillText(text, x, H / 2 + 2); c.fillStyle = color;
      } else c.fillText(text, x, H / 2 + 2);
    }
  });
  M.textures.push(tex);
  return new T.MeshStandardMaterial({ map: tex, transparent: !bg, alphaTest: bg ? 0 : 0.35, roughness: 0.5, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/** Tyre texture: tread band, sidewalls (black or tan) and the maker's label on both walls. */
export function tireTexture(M, { label = '', sidewall = 'black' } = {}) {
  const W = 4096, H = 256, wall = sidewall === 'tan' ? '#b48a55' : '#161616';
  const tex = canvasTexture(W, H, (c) => {
    c.fillStyle = wall; c.fillRect(0, 0, W, H);
    c.fillStyle = '#121212'; c.fillRect(0, H * 0.30, W, H * 0.40);            // tread
    c.fillStyle = '#0c0c0c'; c.fillRect(0, 0, W, H * 0.045); c.fillRect(0, H * 0.955, W, H * 0.045); // bead
    c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(0, H * 0.295, W, 2); c.fillRect(0, H * 0.70, W, 2);
    if (!label) return;
    const ink = sidewall === 'tan' ? '#141414' : '#d9d9d9';
    c.font = font(Math.round(H * 0.105), '800 {s}px Arial, sans-serif'); c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillStyle = ink;
    for (let i = 0; i < 2; i++) {
      const x = (i + 0.5) * W / 2;
      c.save(); c.translate(x, H * 0.17); c.fillText(label, 0, 0); c.restore();
      c.save(); c.translate(x + W / 4, H * 0.83); c.rotate(Math.PI); c.fillText(label, 0, 0); c.restore();
    }
  });
  M.textures.push(tex);
  const m = M.tire.clone(); m.map = tex; m.name = 'tire_tex';
  return m;
}
