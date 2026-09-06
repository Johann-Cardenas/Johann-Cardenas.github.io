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
import { surface, rgb, rdBuAt, colorbar } from './kit.mjs';
import { validateFonts } from './fonts.mjs';

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
   3. The composition — a section, read by depth
   ------------------------------------------------------------
   Everything Asphera reports happens AT A DEPTH, so depth is
   the axis the whole banner is built on. A core of the real
   structure runs down the left at true scale, the section runs
   full width beside it, and the peak strains are not collected
   into a block of figures — each one is pinned to the depth it
   was found at, with a leader into the field that produced it.
   ============================================================ */

validateFonts();

const W = 1310, H = 790;
const s = surface(W, H, 2);

/* Strata: wide and short, the weight in the horizontals. Letters
   that lie down in layers, which is the only thing this app draws. */
s.useFont('strata');

/* The app's own dark-theme variables, from its :root block. */
const C = {
    bg0: rgb('#0c1425'), bg1: rgb('#12203a'), panel: rgb('#1e293b'),
    ink: rgb('#f1f5f9'), ink2: rgb('#cbd5e1'), ink3: rgb('#94a3b8'),
    line: rgb('#3b4f6b'), edge: rgb('#546a84'),
    teal: rgb('#18a9a8'), tealHi: rgb('#2dd4d3'), amber: rgb('#f59e0b'),
    ok: rgb('#10b981'), dark: rgb('#0f172a')
};

/* Plotly's RdBu, reversed, which is how the app asks for it: high
   tension blue, compression red. */
const cmap = (t) => rdBuAt(1 - t);

s.vgradient(0, 0, W, H, C.bg1, C.bg0);
for (let x = 0; x < W; x += 46) s.rect(x, 0, 1, H, C.line, 0.13);
for (let y = 0; y < H; y += 46) s.rect(0, y, W, 1, C.line, 0.13);

const PAD = 64;
const DEPTH_MAX = 710;                     /* the app's own y-axis range */
const TOP = 238, BOT = 636;
const dy = (d) => TOP + (Math.min(d, DEPTH_MAX) / DEPTH_MAX) * (BOT - TOP);

/* ---- the name, and what it is ---------------------------------- */

let wx = PAD;
wx += s.text('A', wx, 74, 7, C.ink, 1);
wx += s.text('SPHER', wx, 74, 7, C.tealHi, 1);
s.text('A', wx, 74, 7, C.ink, 1);
s.rect(PAD, 138, 150, 3, C.tealHi, 0.9);
s.text('DYNAMIC FINITE ELEMENT PAVEMENT RESPONSE', PAD, 152, 2, C.ink2, 0.95);
s.text('ICT R27-252 · ' + (nodeCount / 1000).toFixed(0) + 'K NODES · ' +
    structure.timesteps.total + ' TIMESTEPS', PAD, 174, 2, C.ink3, 0.85);

/* ---- a core of the structure, at true scale --------------------- */

const CORE = { x: PAD, w: 78 };
s.text('MM', CORE.x, TOP - 22, 2, C.ink3, 0.7);
structure.layers.forEach((l) => {
    const y0 = dy(l.depthTop), y1 = dy(l.depthBottom);
    const col = rgb(l.color);
    s.rect(CORE.x, y0, CORE.w, y1 - y0, col, 1);
    s.rect(CORE.x, y0, CORE.w, 1, C.bg0, 0.8);
    const lum = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
    const label = l.thickness.toFixed(0);
    if (y1 - y0 > 18) {
        s.textCenter(label, CORE.x + CORE.w / 2, (y0 + y1) / 2 - 7, 2, lum > 120 ? C.dark : C.ink2, 0.95);
    }
});
/* the subgrade runs on past the section, so the core is broken
   where the drawing stops, as a section mark would be */
for (let bx = 0; bx < CORE.w; bx += 12) {
    s.line(CORE.x + bx, BOT - 22, CORE.x + bx + 7, BOT - 30, 2, C.bg0, 0.85);
    s.line(CORE.x + bx, BOT - 12, CORE.x + bx + 7, BOT - 20, 2, C.bg0, 0.85);
}
s.rect(CORE.x - 1, TOP - 1, CORE.w + 2, 1, C.edge, 0.8);
s.rect(CORE.x - 1, BOT, CORE.w + 2, 1, C.edge, 0.8);
s.rect(CORE.x - 1, TOP - 1, 1, BOT - TOP + 2, C.edge, 0.8);
s.rect(CORE.x + CORE.w, TOP - 1, 1, BOT - TOP + 2, C.edge, 0.8);

/* ---- the section ------------------------------------------------ */

const CT = { x: 372, y: TOP, w: 740, h: BOT - TOP };

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

structure.layers.forEach((l, i) => {
    if (i > 0) s.dashedLine(CT.x, dy(l.depthTop), CT.x + CT.w, dy(l.depthTop), 1.4, C.dark, 0.72, 9, 7);
});
[['HMA', 0], ['BASE', 155], ['SUBGRADE', 460]].forEach(([name, d]) => {
    s.text(name, CT.x + 12, dy(d) + 9, 2, C.dark, 0.85);
});
s.rect(CT.x - 1, CT.y - 1, CT.w + 2, 1, C.edge, 0.75);
s.rect(CT.x - 1, CT.y + CT.h, CT.w + 2, 1, C.edge, 0.75);
s.rect(CT.x - 1, CT.y - 1, 1, CT.h + 2, C.edge, 0.75);
s.rect(CT.x + CT.w, CT.y - 1, 1, CT.h + 2, C.edge, 0.75);

[-660, -330, 0, 330, 660].forEach(xv => {
    const px = CT.x + (xv - xs[0]) / (xs[xs.length - 1] - xs[0]) * CT.w;
    s.rect(px, CT.y + CT.h + 1, 1, 6, C.edge, 0.8);
    s.textCenter(String(xv), px, CT.y + CT.h + 12, 2, C.ink3, 0.85);
});
s.textRight(structure.name.toUpperCase() + ' · ε11 LONGITUDINAL µε · X MM', CT.x + CT.w, CT.y - 24, 2, C.ink2, 0.95);

colorbar(s, 1146, 248, 20, 372, cmap, {
    frame: C.edge, ink: C.ink2, ink2: C.ink3,
    max: zmax.toFixed(0), min: zmin.toFixed(0)
});

/* ---- the peaks, pinned to the depths they were found at --------- */

function callout(prof, name) {
    const y = dy(prof.criticalDepth);
    const right = 356;
    s.line(right + 8, y, CT.x, y, 1.4, C.amber, 0.75);
    s.rect(right + 8, y - 5, 2, 10, C.amber, 0.9);
    s.textRight(name, right, y - 26, 2, C.amber, 0.95);
    s.textRight(prof.criticalValue.toFixed(1), right, y - 8, 4, C.ink, 1);
    /* the depth and the step are tagged AT the point, inside the field
       that produced them, rather than collected into a caption */
    s.disc(CT.x, y, 4.5, C.amber, 1);
    s.disc(CT.x, y, 2, C.bg0, 1);
    s.text(prof.criticalDepth.toFixed(0) + ' MM · STEP ' + prof.timestep, CT.x + 16, y - 24, 2, C.dark, 0.9);
}
callout(e11, 'PEAK ε11 µε');
callout(e22, 'PEAK ε22 µε');

/* ---- the foot: what was searched, and where it came from -------- */

s.rect(PAD, 664, 1260 - PAD, 1, C.edge, 0.45);

s.text('PEAK ε23 ' + e23.criticalValue.toFixed(1) + ' µε AT ' + e23.criticalDepth.toFixed(0) +
    ' MM · EVERY STEP SEARCHED', PAD, 682, 2, C.ink3, 0.85);
s.text('THICKNESSES, INTERFACES AND STRAINS READ FROM THE APP FILES',
    PAD, 712, 2, C.ink3, 0.8);

/* the analysis window, ticked out: thirteen steps, the drawn one lit */
(function steps() {
    const x0 = 1024, x1 = 1260, y = 684;
    const n = structure.timesteps.total;
    s.rect(x0, y, x1 - x0, 1, C.line, 0.9);
    for (let i = 0; i < n; i++) {
        const step = structure.timesteps.start + i;
        const px = x0 + (i / (n - 1)) * (x1 - x0);
        const on = step === contours.timestep;
        s.rect(px, y - (on ? 11 : 5), on ? 2.6 : 1.4, on ? 13 : 7, on ? C.tealHi : C.edge, on ? 1 : 0.8);
    }
    s.text('STEP ' + structure.timesteps.start, x0, y + 10, 2, C.ink3, 0.7);
    s.textRight(String(contours.timestep), x1, y + 10, 2, C.tealHi, 0.9);
})();

console.log(`wrote ${s.write(OUT)} (${W}x${H}) — ${structure.name}, ${FIELD} ${PLANE}, ts ${contours.timestep}`);
