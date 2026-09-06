/* ============================================================
   Asphera — E-Labs card banner generator.
   ------------------------------------------------------------
   Run with:  node scripts/banners/asphera.mjs
   Writes     images/e-labs/E-Labs_Asphera.png (1310x790)

   Asphera does not compute anything at run time: it reads
   finite element results that were produced once, in Abaqus,
   for the ICT/IDOT R27-252 study, and shipped as JSON. So this
   banner does not model anything either. It opens the very
   files the app fetches —

       e-labs/asphera/data/TK_P1/structure.json
       e-labs/asphera/data/TK_P1/contours.json
       e-labs/asphera/data/TK_P1/profiles.json

   — and draws the same field, on the same grid, with the same
   diverging scale and the same layer interfaces. The contour is
   longitudinal strain on an 80 x 79 grid, pixel for pixel the
   array behind the app's own Plotly trace; the strip below is
   the critical depth profile, discontinuities at the material
   interfaces included, because that is what the numbers do.

   The peak values in the chips are selected exactly as
   renderStats() in e-labs/asphera/index.html selects them:
   by component and layer group, off the same profiles.
   ============================================================ */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { surface, rgb, mix, rdBuAt, chips, badge, colorbar } from './kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const OUT = join(ROOT, 'images', 'e-labs', 'E-Labs_Asphera.png');
const APP = join(ROOT, 'e-labs', 'asphera', 'index.html');
const DATA = join(ROOT, 'e-labs', 'asphera', 'data', 'TK_P1');

const read = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const structure = read('structure.json');
const contours = read('contours.json');
const profiles = read('profiles.json').profiles;

/* The node count is the app's, not the data's: it lives in the
   structure catalog at the top of index.html. Pull it from there
   rather than restating it. */
const catalog = readFileSync(APP, 'utf8');
const nodeMatch = new RegExp(
    "id:\\s*'" + structure.id + "'[^}]*?nodeCount:\\s*(\\d+)"
).exec(catalog);
if (!nodeMatch) throw new Error(`no nodeCount for ${structure.id} in the app's structure catalog`);
const nodeCount = parseInt(nodeMatch[1], 10);

/* ============================================================
   1. The same selections the app makes
   ============================================================ */

const FIELD = 'E11';                       /* the app's default contour field */
const PLANE = 'longitudinal';              /* and its default plane           */

const plane = contours[PLANE];
const grid = plane.fields[FIELD];
const xs = plane.axis1, depths = plane.depths, Z = grid.values;

let zmin = Infinity, zmax = -Infinity;
for (const row of Z) for (const v of row) { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); }

/* renderStats(): peak longitudinal strain in the asphalt, peak
   vertical strain in the base or slab, peak shear in the asphalt. */
const pick = (component, groups, category) => profiles.find(p =>
    p.component === component && groups.includes(p.layerGroup) &&
    (category === undefined || p.category === category));
const e11 = pick('E11', ['HMA']);
const e22 = pick('E22', ['B1', 'SB1', 'PCC']);
const e23 = pick('E23', ['HMA'], 'HMA Layer');
if (!e11 || !e22 || !e23) throw new Error('the app-critical profiles are no longer in profiles.json');

const totalThick = structure.layers.reduce((a, l) => a + l.thickness, 0);

/* ============================================================
   2. Check against what the app puts on screen
   ============================================================ */

const SHOWN = {
    name: 'Arterial Section',
    totalThickness: '5000 mm', layers: 4, timesteps: 13, timestepRange: 'Steps 4–16',
    peakE11: '98.9 µε', peakE11At: '@ 155.0 mm depth, ts=5',
    peakE22: '-276.5 µε', peakE22At: '@ 460.0 mm depth, ts=16',
    peakE23: '-118.5 µε', peakE23At: '@ 52.4 mm depth, ts=16',
    contourGrid: [79, 80], contourRange: [-51.976, 118.45],
    interfaces: [0, 40, 155, 460],
    nodeCount: 144452
};

function check() {
    const fail = [];
    const eq = (got, want, what) => { if (String(got) !== String(want)) fail.push(`${what}: ${got} != ${want}`); };
    eq(structure.name, SHOWN.name, 'structure name');
    eq(`${totalThick.toFixed(0)} mm`, SHOWN.totalThickness, 'total thickness');
    eq(structure.layers.length, SHOWN.layers, 'layer count');
    eq(structure.timesteps.total, SHOWN.timesteps, 'timestep total');
    eq(`Steps ${structure.timesteps.start}–${structure.timesteps.end}`, SHOWN.timestepRange, 'timestep range');
    eq(`${e11.criticalValue.toFixed(1)} µε`, SHOWN.peakE11, 'peak E11');
    eq(`@ ${e11.criticalDepth.toFixed(1)} mm depth, ts=${e11.timestep}`, SHOWN.peakE11At, 'peak E11 location');
    eq(`${e22.criticalValue.toFixed(1)} µε`, SHOWN.peakE22, 'peak E22');
    eq(`@ ${e22.criticalDepth.toFixed(1)} mm depth, ts=${e22.timestep}`, SHOWN.peakE22At, 'peak E22 location');
    eq(`${e23.criticalValue.toFixed(1)} µε`, SHOWN.peakE23, 'peak E23');
    eq(`@ ${e23.criticalDepth.toFixed(1)} mm depth, ts=${e23.timestep}`, SHOWN.peakE23At, 'peak E23 location');
    eq([Z.length, Z[0].length].join('x'), SHOWN.contourGrid.join('x'), 'contour grid');
    eq([+zmin.toFixed(3), +zmax.toFixed(3)].join(','), SHOWN.contourRange.join(','), 'contour range');
    eq(structure.layers.map(l => l.depthTop).join(','), SHOWN.interfaces.join(','), 'layer interfaces');
    eq(nodeCount, SHOWN.nodeCount, 'node count');
    if (fail.length) {
        console.error('Data no longer agrees with the app:\n  ' + fail.join('\n  '));
        process.exit(1);
    }
}
check();

/* ============================================================
   3. The composition
   ============================================================ */

const W = 1310, H = 790;
const s = surface(W, H, 2);

/* The app's own dark-theme variables, from its :root block. */
const C = {
    bg0: rgb('#0c1425'), bg1: rgb('#12203a'), panel: rgb('#1e293b'),
    ink: rgb('#f1f5f9'), ink2: rgb('#cbd5e1'), ink3: rgb('#94a3b8'),
    line: rgb('#3b4f6b'), edge: rgb('#546a84'),
    teal: rgb('#18a9a8'), tealHi: rgb('#2dd4d3'), amber: rgb('#f59e0b'),
    ok: rgb('#10b981')
};

/* Plotly's RdBu, reversed, which is how the app asks for it: high
   tension blue, compression red. */
const cmap = (t) => rdBuAt(1 - t);

s.vgradient(0, 0, W, H, C.bg1, C.bg0);
for (let x = 0; x < W; x += 46) s.rect(x, 0, 1, H, C.line, 0.14);
for (let y = 0; y < H; y += 46) s.rect(0, y, W, 1, C.line, 0.14);

const PAD = 64;

/* ---- hero: the cross-section contour ---------------------------- */

const DEPTH_MAX = 710;                     /* the app's own y-axis range */
const CT = { x: 578, y: 92, w: 632, h: 340 };

/* Bilinear sample of the shipped grid, at output resolution. */
function sampleAt(xmm, dmm) {
    const fx = (xmm - xs[0]) / (xs[xs.length - 1] - xs[0]) * (xs.length - 1);
    let fy = 0;
    for (let i = 0; i < depths.length - 1; i++) {
        if (dmm <= depths[i + 1]) { fy = i + (dmm - depths[i]) / (depths[i + 1] - depths[i]); break; }
        fy = i + 1;
    }
    const i0 = Math.max(0, Math.min(depths.length - 2, Math.floor(fy)));
    const j0 = Math.max(0, Math.min(xs.length - 2, Math.floor(fx)));
    const ty = Math.max(0, Math.min(1, fy - i0)), tx = Math.max(0, Math.min(1, fx - j0));
    const a = Z[i0][j0] + (Z[i0][j0 + 1] - Z[i0][j0]) * tx;
    const b = Z[i0 + 1][j0] + (Z[i0 + 1][j0 + 1] - Z[i0 + 1][j0]) * tx;
    return a + (b - a) * ty;
}

s.field(CT.x, CT.y, CT.w, CT.h, (u, v) =>
    cmap((sampleAt(xs[0] + u * (xs[xs.length - 1] - xs[0]), v * DEPTH_MAX) - zmin) / (zmax - zmin)));

/* layer interfaces and their names, as the app annotates them */
const dy = (d) => CT.y + (d / DEPTH_MAX) * CT.h;
structure.layers.forEach((l, i) => {
    if (i > 0) s.dashedLine(CT.x, dy(l.depthTop), CT.x + CT.w, dy(l.depthTop), 1.4, [15, 23, 42], 0.72, 9, 7);
    const label = l.label.replace(/[₀-₉]/g, (m) => String(m.charCodeAt(0) - 0x2080));
    if (dy(l.depthTop) + 24 < CT.y + CT.h) s.text(label, CT.x + 10, dy(l.depthTop) + 8, 2, [15, 23, 42], 0.85);
});
s.rect(CT.x - 1, CT.y - 1, CT.w + 2, 1, C.edge, 0.7);
s.rect(CT.x - 1, CT.y + CT.h, CT.w + 2, 1, C.edge, 0.7);
s.rect(CT.x - 1, CT.y - 1, 1, CT.h + 2, C.edge, 0.7);
s.rect(CT.x + CT.w, CT.y - 1, 1, CT.h + 2, C.edge, 0.7);

for (let d = 0; d <= 700; d += 100) {
    s.rect(CT.x - 7, dy(d), 6, 1, C.edge, 0.8);
    s.textRight(String(d), CT.x - 12, dy(d) - 7, 2, C.ink3, 0.85);
}
[-660, -330, 0, 330, 660].forEach(xv => {
    const px = CT.x + (xv - xs[0]) / (xs[xs.length - 1] - xs[0]) * CT.w;
    s.rect(px, CT.y + CT.h + 1, 1, 6, C.edge, 0.8);
    s.textCenter(String(xv), px, CT.y + CT.h + 12, 2, C.ink3, 0.85);
});
s.textRight('DEPTH MM', CT.x - 12, CT.y - 26, 2, C.ink3, 0.8);
s.text('X TRAFFIC DIRECTION, MM', CT.x, CT.y + CT.h + 34, 2, C.ink3, 0.8);

colorbar(s, 1230, 200, 18, CT.y + CT.h - 214, cmap, {
    frame: C.edge, ink: C.ink2, ink2: C.ink3, titleBelow: true,
    title: 'µε', max: zmax.toFixed(0), min: zmin.toFixed(0)
});

s.textRight(structure.name.toUpperCase() + ' · ' + structure.description.split(',')[1].trim().toUpperCase(),
    CT.x + CT.w, CT.y + CT.h + 34, 2, C.ink2, 0.95);

/* ---- strip: the critical depth profile --------------------------- */

const PR = { x: 578, y: 544, w: 660, h: 108 };
s.roundRect(506, 494, 1268 - 506, 202, 14, C.panel, 0.45);

let vMin = Infinity, vMax = -Infinity;
for (const v of e11.values) { vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); }
const vPad = (vMax - vMin) * 0.12;
const pdx = (d) => PR.x + (Math.min(d, DEPTH_MAX) / DEPTH_MAX) * PR.w;
const pdy = (v) => PR.y + PR.h - (v - (vMin - vPad)) / ((vMax + vPad) - (vMin - vPad)) * PR.h;

/* the same layer bands, in the app's own material colors */
s.rect(PR.x, PR.y, PR.w, PR.h, C.bg0, 0.45);
structure.layers.forEach((l) => {
    if (l.depthTop >= DEPTH_MAX) return;
    const x0 = pdx(l.depthTop), x1 = pdx(Math.min(l.depthBottom, DEPTH_MAX));
    s.rect(x0, PR.y, x1 - x0, PR.h, rgb(l.color), 0.3);
    if (x1 - x0 > 60) {
        const label = l.label.replace(/[₀-₉]/g, (m) => String(m.charCodeAt(0) - 0x2080));
        s.text(label.toUpperCase(), x0 + 8, PR.y + PR.h - 20, 2, C.ink3, 0.9);
    }
});
s.dashedLine(PR.x, pdy(0), PR.x + PR.w, pdy(0), 1.3, C.edge, 0.7, 8, 7);

/* the profile itself, broken where the material changes: the strain
   really is discontinuous across an interface, and smoothing that
   away would be the one thing this picture must not do */
let seg = [];
for (let i = 0; i < e11.depths.length; i++) {
    if (i > 0 && e11.depths[i] === e11.depths[i - 1]) {
        if (seg.length > 1) s.polyline(seg, 2.6, C.tealHi, 1);
        seg = [];
    }
    seg.push([pdx(e11.depths[i]), pdy(e11.values[i])]);
}
if (seg.length > 1) s.polyline(seg, 2.6, C.tealHi, 1);

/* the critical point the app reports */
const cx = pdx(e11.criticalDepth), cy = pdy(e11.criticalValue);
s.line(cx, cy - 9, cx, PR.y - 12, 1.4, C.amber, 0.7);
s.ring(cx, cy, 9, 2, C.amber, 0.9);
s.disc(cx, cy, 4.2, C.amber, 1);

s.textRight(vMax.toFixed(0), PR.x - 10, PR.y - 7, 2, C.ink3, 0.85);
s.textRight(vMin.toFixed(0), PR.x - 10, PR.y + PR.h - 7, 2, C.ink3, 0.85);
[0, 155, 460, 710].forEach(d => s.textCenter(String(d), pdx(d), PR.y + PR.h + 12, 2, C.ink3, 0.8));
s.text('ε11 µε', PR.x, PR.y - 34, 2, C.ink2, 0.9);
s.textRight('PEAK ' + e11.criticalValue.toFixed(1) + ' µε AT ' + e11.criticalDepth.toFixed(0) + ' MM, TIMESTEP ' + e11.timestep + ' OF ' + structure.timesteps.total, PR.x + PR.w, PR.y - 34, 2, C.amber, 0.9);
s.text('DEPTH FROM SURFACE, MM · JUMPS ARE MATERIAL INTERFACES', PR.x, PR.y + PR.h + 30, 2, C.ink3, 0.75);

/* ---- left column ------------------------------------------------ */

let wx = PAD;
wx += s.text('A', wx, 104, 8, C.ink, 1);
wx += s.text('SPHER', wx, 104, 8, C.tealHi, 1);
s.text('A', wx, 104, 8, C.ink, 1);
s.rect(PAD, 186, 150, 3, C.tealHi, 0.9);
s.text('3D RESPONSE VISUALIZER', PAD, 212, 3, C.ink2, 0.95);
s.text('DYNAMIC FINITE ELEMENT RESULTS FOR', PAD, 248, 2, C.ink3, 0.95);
s.text('FOUR FLEXIBLE PAVEMENT SECTIONS,', PAD, 272, 2, C.ink3, 0.95);
s.text('READ, NOT RE-SOLVED, IN THE BROWSER', PAD, 296, 2, C.ink3, 0.95);

badge(s, 'ICT R27-252', PAD, 336, { bg: [10, 40, 40], dot: C.ok, ink: C.ok });

chips(s, [
    ['FE NODES', (nodeCount / 1000).toFixed(0) + 'K', ''],
    ['TIMESTEPS ' + structure.timesteps.start + '-' + structure.timesteps.end, String(structure.timesteps.total), ''],
    ['PEAK ε11 µε', e11.criticalValue.toFixed(1), ''],
    ['PEAK ε22 µε', e22.criticalValue.toFixed(1), '']
], PAD, 406, { bg: C.panel, rule: C.tealHi, label: C.ink3, value: C.ink, w: 206, gap: 14 });

s.text('LAYER THICKNESSES, INTERFACES AND STRAINS READ STRAIGHT FROM THE FILES THE APP ITSELF LOADS',
    PAD, 706, 2, C.ink3, 0.8);

console.log(`wrote ${s.write(OUT)} (${W}x${H}) — ${structure.name}, ${FIELD} ${PLANE}, ts ${contours.timestep}`);
