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

/** Draw text for both sides of a swept tube. Drive side sits at v = 0.25, non-drive at v = 0.75. */
function bothSides(c, w, h, draw) {
  c.save(); c.translate(0, h * 0.25); draw(c); c.restore();
  c.save(); c.translate(w, h * 0.75); c.rotate(Math.PI); draw(c); c.restore();
}

/** Painted tube material with a per-tube texture. `kind` selects the artwork. */
export function tubePaint(M, P, kind) {
  const S = M.scheme, decals = P.decals !== false;
  const W = 2048, H = 512;
  const tex = canvasTexture(W, H, (c) => {
    c.fillStyle = S.c1; c.fillRect(0, 0, W, H);
    const red = (x, y, w, h) => { c.fillStyle = S.c2; c.fillRect(x * W, y * H, w * W, h * H); };
    const line = (x, y, w, h) => { c.fillStyle = S.c3; c.fillRect(x * W, y * H, w * W, Math.max(h * H, 4)); };
    // Layout from the owner's photos. v = 0 is the sweep's N axis, 0.25 the drive side, 0.5 the opposite face.
    if (kind === 'down') {          // red belly (v 0.5), black pinstripes, white top, cannondale on both flanks
      red(0, 0.34, 1, 0.32); line(0, 0.335, 1, 0.012); line(0, 0.655, 1, 0.012);
      red(0, 0, 0.13, 1);           // red where it meets the bottom bracket
      red(0.86, 0.12, 0.14, 0.76);  // and the head-tube hood wrapping round the front
      if (decals) bothSides(c, W, H, (k) => {
        k.font = font(138); k.textBaseline = 'middle'; k.textAlign = 'center';
        k.lineWidth = 7; k.strokeStyle = '#8b9096'; k.strokeText('cannondale', W * 0.50, 4);
        k.fillStyle = M.inkOnPaint; k.fillText('cannondale', W * 0.50, 4);
      });
    } else if (kind === 'top') {    // front third red (the hood), black pinstripe under the full length
      red(0.64, 0, 0.36, 1); line(0.64, 0, 0.006, 1);
      red(0.30, 0.40, 0.70, 0.20); line(0, 0.47, 1, 0.06);
      if (decals) bothSides(c, W, H, (k) => {
        k.fillStyle = S.c2; k.font = font(70); k.textBaseline = 'middle'; k.textAlign = 'left';
        k.fillText('SYNAPSE', W * 0.12, 2);
      });
    } else if (kind === 'seat') {   // red at the bottom bracket, SYNAPSE along the tube, black at the front top
      red(0, 0, 0.16, 1); line(0.16, 0, 0.006, 1);
      line(0.55, 0.47, 0.45, 0.06);
      if (decals) bothSides(c, W, H, (k) => {
        k.font = font(96); k.textBaseline = 'middle'; k.textAlign = 'center';
        k.lineWidth = 5; k.strokeStyle = '#6f757c'; k.strokeText('SYNAPSE', W * 0.60, 2);
        k.fillStyle = S.c1; k.fillText('SYNAPSE', W * 0.60, 2);
      });
    } else if (kind === 'fork_drive' || kind === 'fork_left') { // inner face red, crown and tips red
      const inner = kind === 'fork_drive' ? 0 : 0.5;
      red(0, inner - 0.12, 1, 0.24); if (inner === 0) red(0, 0.88, 1, 0.12);
      red(0.84, 0, 0.16, 1); red(0, 0, 0.08, 1);
    } else if (kind === 'stay') {   // outer edge red, red toward the dropout
      red(0, 0.40, 1, 0.20); red(0.74, 0, 0.26, 1); line(0, 0.395, 1, 0.008);
    } else if (kind === 'chainstay') { // red with SAVE on the flanks
      red(0, 0, 1, 1); line(0, 0.47, 1, 0.06);
      if (decals) bothSides(c, W, H, (k) => {
        k.fillStyle = '#ffffff'; k.font = font(80, '800 {s}px Arial, sans-serif'); k.textBaseline = 'middle'; k.textAlign = 'center';
        k.fillText('SAVE', W * 0.45, 2);
      });
    } else if (kind === 'head') {   // the red hood: everything but the rear face
      red(0, 0.16, 1, 0.68);
    }
  });
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
