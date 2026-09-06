/* ============================================================
   AirCrafter — E-Labs card banner generator.
   ------------------------------------------------------------
   Run with:  node scripts/banners/aircrafter.mjs
   Writes     images/e-labs/E-Labs_Aircrafter.png (1310x790)

   Everything drawn here is the app's own answer for one real
   aeroplane. The tyre geometry is read out of the app's own
   library — e-labs/aircrafter/aircraft.xlsx, the sheet the app
   fetches at start-up — by a small ZIP + XML reader below, so
   the banner is wrong the moment that library changes. The
   stress model is computeStresses() from
   e-labs/aircrafter/index.html transcribed: a generalized
   parabola for the vertical component and a skewed rational
   parabola for the longitudinal one, per rib.

   Both are CHECKED against what the app renders — the full 7x10
   averaged matrices behind its own heatmap and surface plots,
   and its equilibrium residual — before anything is drawn.

   The hero is the vertical surface with the ribs and grooves
   left in rather than smoothed across, because that ridged
   shape is the thing itself: seven strips of rubber carrying
   the load and six grooves carrying none.
   ============================================================ */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { surface, rgb, mix, ylOrRd, rdBuAt, chips, badge, colorbar } from './kit.mjs';
import { validateFonts } from './fonts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const OUT = join(ROOT, 'images', 'e-labs', 'E-Labs_Aircrafter.png');
const XLSX = join(ROOT, 'e-labs', 'aircrafter', 'aircraft.xlsx');

const AIRCRAFT = 'B777-300 ER';

/* ============================================================
   1. Read the app's aircraft library
   ------------------------------------------------------------
   A workbook is a ZIP of XML. Walking the central directory is
   a few lines and gives exact sizes, which the local headers do
   not when a data descriptor is used. The sheet stores its
   strings inline, so no shared-string table has to be resolved.
   ============================================================ */

function unzip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const files = new Map();
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
        const method = buf.readUInt16LE(p + 10);
        const compSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const lho = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        const lNameLen = buf.readUInt16LE(lho + 26);
        const lExtraLen = buf.readUInt16LE(lho + 28);
        const start = lho + 30 + lNameLen + lExtraLen;
        const raw = buf.subarray(start, start + compSize);
        files.set(name, method === 0 ? raw : inflateRawSync(raw));
        p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

const XML_ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unesc = (s) => s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hd) => String.fromCharCode(parseInt(hd, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENT[m]);

function readSheet(path) {
    const files = unzip(readFileSync(path));
    const xml = files.get('xl/worksheets/sheet1.xml').toString('utf8');
    const rows = [];
    for (const m of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = {};
        for (const c of m[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
            const inline = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(c[3]);
            const value = /<v>([\s\S]*?)<\/v>/.exec(c[3]);
            cells[c[1]] = unesc(inline ? inline[1] : value ? value[1] : '');
        }
        rows.push(cells);
    }
    const head = rows[0];
    return rows.slice(1).map(r => {
        const o = {};
        for (const col of Object.keys(r)) if (head[col]) o[head[col]] = r[col];
        return o;
    });
}

const list = (s) => String(s).split(';').map(x => x.trim()).filter(Boolean).map(Number);

const row = readSheet(XLSX).find(r => r['Airplane Name'] === AIRCRAFT);
if (!row) throw new Error(`${AIRCRAFT} is no longer in aircraft.xlsx`);

/* The app's own reading of a row: the tyre pressure is rounded to
   three decimals on selection, and every groove starts at 10 mm. */
const bi = list(row['Ribs (mm)']);
const al = list(row['Load Factor']);
const sigmTip = list(row['Stress Factor']);
const gi = new Array(bi.length - 1).fill(10.0);
const P = parseFloat(row['Load (N)']);
const TiP = Math.round(parseFloat(row['Tire Pressure (MPa)']) * 1000) / 1000;
const L = parseFloat(row['Tire Contact Length (mm)']);
const numWheels = parseInt(row['Number Wheels'], 10);
const numGear = parseInt(row['Number Gear'], 10);
const wheelsPlotted = list(row['WheelCoord_X (in.)']).length;

/* ============================================================
   2. computeStresses(), transcribed
   ============================================================ */

const ADV = {
    ssy_factor: 0.40, xn: 10, nnz: 2,
    lsx_pospk: 0.20, lsx_negpk: 0.85,
    sx_posmag: 0.20, sx_negmag: -0.15, skpb: 0.60
};

/** Vertical contact stress on rib i, as a continuous function of the
 *  normalized station xn in [-1, 1]. Generalized parabola. */
function sszRib(i) {
    const a = al[i], b = bi[i], sig = sigmTip[i];
    const denom = (L * b * sig * TiP) / (a * P) - 1.0;
    const n = Math.abs(1.0 / (2.0 * denom));
    const coeff = (a * P) / (L * b);
    const factor = 1.0 + 1.0 / (2.0 * n);
    return (xnorm) => coeff * factor * (1 - Math.pow(xnorm * xnorm, n));
}

/** Longitudinal contact stress on rib i, as a function of distance
 *  along the patch in mm. Skewed rational parabola, two branches. */
function ssxRib(i) {
    const { lsx_pospk, lsx_negpk, sx_posmag, sx_negmag, skpb } = ADV;
    const x1 = [0, skpb * L], x2 = [lsx_pospk * L, lsx_negpk * L];
    const x3 = [skpb * L, L], y2 = [sx_posmag, sx_negmag];
    const a3 = [0, 1].map(k => (x1[k] + x3[k] - 2 * x2[k]) / (x1[k] * x3[k] - x2[k] * x2[k]));
    const a0 = [0, 1].map(k => (-x1[k] * x3[k] * (a3[k] * x2[k] - 1) * y2[k]) / ((x1[k] - x2[k]) * (x3[k] - x2[k])));
    const a1 = [0, 1].map(k => ((x1[k] + x3[k]) * (a3[k] * x2[k] - 1) * y2[k]) / ((x1[k] - x2[k]) * (x3[k] - x2[k])));
    const a2 = [0, 1].map(k => (y2[k] - a3[k] * x2[k] * y2[k]) / ((x1[k] - x2[k]) * (x3[k] - x2[k])));
    const xdist = [];
    for (let j = 0; j <= ADV.xn; j++) xdist.push((L / ADV.xn) * j);
    const cutIdx = Math.min(Math.round(skpb * xdist.length), xdist.length - 1);
    const cut = xdist[cutIdx];
    const sig = sigmTip[i];
    return (x) => {
        const k = (x >= 0 && x <= cut) ? 0 : 1;
        return TiP * sig * ((a2[k] * x * x + a1[k] * x + a0[k]) / (1 - a3[k] * x));
    };
}

/** The app's 10-column averaged matrices, and its equilibrium check. */
function averaged() {
    const lElem = L / ADV.xn;
    const xnorm = [], xdist = [];
    for (let j = 0; j <= ADV.xn; j++) {
        xdist.push(lElem * j);
        xnorm.push((lElem * j - L / 2) / (L / 2));
    }
    const ssz = [], ssx = [], axdist = [];
    for (let j = 0; j < ADV.xn; j++) axdist.push((xdist[j] + xdist[j + 1]) / 2);
    for (let i = 0; i < bi.length; i++) {
        const fz = sszRib(i), fx = ssxRib(i);
        const rz = [], rx = [];
        for (let j = 0; j < ADV.xn; j++) {
            rz.push((fz(xnorm[j]) + fz(xnorm[j + 1])) / 2);
            rx.push((fx(xdist[j]) + fx(xdist[j + 1])) / 2);
        }
        ssz.push(rz); ssx.push(rx);
    }
    let calcPz = 0;
    ssz.forEach((r, i) => { calcPz += r.reduce((s, v) => s + v, 0) * lElem * bi[i]; });
    return { ssz, ssx, axdist, calcPz, diff: 100 * (P - calcPz) / P };
}

/* ============================================================
   3. Check against what the app renders
   ------------------------------------------------------------
   The averaged 7x10 matrices behind the app's own heatmap and
   surface traces, read straight out of Plotly, plus the row of
   the aircraft library they came from.
   ============================================================ */

const APP = {
    P: 266305.367727, TiP: 1.524, L: 608.9791076660156,
    bi: [50, 35, 40, 90, 40, 35, 50],
    al: [0.24, 0.08, 0.08, 0.20, 0.08, 0.08, 0.24],
    sigmTip: [1.80, 1.10, 1.10, 1.10, 1.10, 1.10, 1.80],
    diff: 0.969,
    ssz: [
        [0.708704, 1.820688, 2.414315, 2.666693, 2.735962, 2.735962, 2.666693, 2.414315, 1.820688, 0.708704],
        [0.235310, 0.679290, 1.065560, 1.381947, 1.598567, 1.598567, 1.381947, 1.065560, 0.679290, 0.235310],
        [0.181088, 0.539158, 0.887753, 1.223031, 1.531549, 1.531549, 1.223031, 0.887753, 0.539158, 0.181088],
        [0.222037, 0.645866, 1.025146, 1.348446, 1.585330, 1.585330, 1.348446, 1.025146, 0.645866, 0.222037],
        [0.181088, 0.539158, 0.887753, 1.223031, 1.531549, 1.531549, 1.223031, 0.887753, 0.539158, 0.181088],
        [0.235310, 0.679290, 1.065560, 1.381947, 1.598567, 1.598567, 1.381947, 1.065560, 0.679290, 0.235310],
        [0.708704, 1.820688, 2.414315, 2.666693, 2.735962, 2.735962, 2.666693, 2.414315, 1.820688, 0.708704]
    ],
    ssxOuter: [0.228600, 0.502920, 0.521208, 0.429768, 0.280851, 0.097971, -0.106680, -0.300318, -0.383551, -0.189914],
    ssxInner: [0.139700, 0.307340, 0.318516, 0.262636, 0.171631, 0.059871, -0.065193, -0.183527, -0.234393, -0.116058]
};

const R = averaged();

function check() {
    const fail = [];
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const same = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail.push(`${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

    same(bi, APP.bi, 'rib widths');
    same(al, APP.al, 'load factors');
    same(sigmTip, APP.sigmTip, 'stress factors');
    if (!near(P, APP.P, 1e-6)) fail.push(`wheel load: ${P} != ${APP.P}`);
    if (!near(TiP, APP.TiP, 1e-9)) fail.push(`tyre pressure: ${TiP} != ${APP.TiP}`);
    if (!near(L, APP.L, 1e-9)) fail.push(`contact length: ${L} != ${APP.L}`);

    APP.ssz.forEach((r, i) => r.forEach((v, j) => {
        if (!near(R.ssz[i][j], v, 5e-7)) fail.push(`σz rib ${i + 1} station ${j + 1}: ${R.ssz[i][j]} != ${v}`);
    }));
    [0, 6].forEach(i => APP.ssxOuter.forEach((v, j) => {
        if (!near(R.ssx[i][j], v, 5e-7)) fail.push(`σx rib ${i + 1} station ${j + 1}: ${R.ssx[i][j]} != ${v}`);
    }));
    [1, 2, 3, 4, 5].forEach(i => APP.ssxInner.forEach((v, j) => {
        if (!near(R.ssx[i][j], v, 5e-7)) fail.push(`σx rib ${i + 1} station ${j + 1}: ${R.ssx[i][j]} != ${v}`);
    }));
    if (!near(R.diff, APP.diff, 5e-4)) fail.push(`equilibrium residual: ${R.diff} != ${APP.diff}`);

    if (fail.length) {
        console.error('Model no longer agrees with the app:\n  ' + fail.join('\n  '));
        process.exit(1);
    }
}
check();

/* ============================================================
   4. The composition
   ============================================================ */

validateFonts();

const W = 1310, H = 790;
const s = surface(W, H, 2);

/* Avionic: the narrowest and tallest of the three faces, crossbars
   sitting low — a flight-deck read-out rather than a terminal. */
s.useFont('avionic');

/* The app's own dark-theme variables, from its :root block. */
const C = {
    bg0: rgb('#0c1425'), bg1: rgb('#111f38'), panel: rgb('#1e293b'),
    ink: rgb('#f1f5f9'), ink2: rgb('#cbd5e1'), ink3: rgb('#94a3b8'),
    line: rgb('#3b4f6b'), edge: rgb('#546a84'),
    sky: rgb('#0ea5e9'), skyHi: rgb('#38bdf8'), orange: rgb('#f97316'),
    ok: rgb('#10b981')
};

/* The rib identity colors the app's contact-patch drawing uses. */
const RIB_COLORS = [
    [14, 165, 233], [249, 115, 22], [16, 185, 129], [139, 92, 246],
    [239, 68, 68], [6, 182, 212], [245, 158, 11], [236, 72, 153]
];

s.vgradient(0, 0, W, H, C.bg1, C.bg0);
for (let x = 0; x < W; x += 46) s.rect(x, 0, 1, H, C.line, 0.14);
for (let y = 0; y < H; y += 46) s.rect(0, y, W, 1, C.line, 0.14);

const PAD = 64, RX = 512;

/* ---- rib and groove geometry across the patch ------------------- */

const bands = [];             /* {kind, y0, y1, rib} in mm across the tyre */
let cursor = 0;
bi.forEach((w, i) => {
    bands.push({ kind: 'rib', rib: i, y0: cursor, y1: cursor + w });
    cursor += w;
    if (i < gi.length) { bands.push({ kind: 'groove', y0: cursor, y1: cursor + gi[i] }); cursor += gi[i]; }
});
const patchW = cursor;        /* 400 mm for this tyre */
const sszF = bi.map((_, i) => sszRib(i));
const ssxF = bi.map((_, i) => ssxRib(i));
let szMax = 0;
for (let i = 0; i < bi.length; i++) for (let k = 0; k <= 200; k++) szMax = Math.max(szMax, sszF[i](-1 + 2 * k / 200));

/* ---- hero: the vertical contact stress surface ------------------ */

const SURF = { x: RX, y: 74, w: 664, h: 322 };

/* An axonometric frame: the contact length runs down-left, the tyre
   width down-right, stress up. Chosen to read at the same angle as
   the app's own Plotly surface. The basis is fixed and the whole
   drawing is then scaled to fit its own bounding box, so a taller
   stress field shrinks the plan rather than escaping the band. */
const AXL = [-236, 150];      /* one unit of normalized contact length */
const AXW = [304, 118];       /* one unit of normalized tyre width     */
const ZH = 158;               /* pixels at szMax                       */

const raw = (u, v, z) => [
    u * AXL[0] + v * AXW[0],
    u * AXL[1] + v * AXW[1] - (z / szMax) * ZH
];

const NU = 72;
const bandV = (b) => [b.y0 / patchW, b.y1 / patchW];

let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
for (const b of bands) {
    for (const v of bandV(b)) {
        for (let k = 0; k <= NU; k++) {
            const u = k / NU;
            const z = b.kind === 'rib' ? sszF[b.rib](-1 + 2 * u) : 0;
            for (const zz of [0, z]) {
                const p = raw(u, v, zz);
                bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]);
                by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]);
            }
        }
    }
}
const k = Math.min(SURF.w / (bx1 - bx0), SURF.h / (by1 - by0));
const ox = SURF.x + (SURF.w - (bx1 - bx0) * k) / 2 - bx0 * k;
const oy = SURF.y + (SURF.h - (by1 - by0) * k) / 2 - by0 * k;
const proj = (u, v, z) => { const p = raw(u, v, z); return [ox + p[0] * k, oy + p[1] * k]; };

s.glow(SURF.x + SURF.w / 2, SURF.y + SURF.h * 0.6, SURF.w * 0.56, C.orange, 0.09, 2.6);

/* Base plane: the footprint the ribs stand on, tinted with the rib
   identity colors the app's own contact-patch drawing uses. */
s.polygon([proj(0, 0, 0), proj(1, 0, 0), proj(1, 1, 0), proj(0, 1, 0)], C.bg0, 0.85);
for (const b of bands) {
    const [v0, v1] = bandV(b);
    const c = b.kind === 'rib' ? RIB_COLORS[b.rib % RIB_COLORS.length] : [120, 130, 145];
    s.polygon([proj(0, v0, 0), proj(1, v0, 0), proj(1, v1, 0), proj(0, v1, 0)], c, b.kind === 'rib' ? 0.22 : 0.1);
}
s.line(...proj(0, 0, 0), ...proj(1, 0, 0), 1.3, C.edge, 0.5);
s.line(...proj(0, 0, 0), ...proj(0, 1, 0), 1.3, C.edge, 0.5);
s.line(...proj(1, 0, 0), ...proj(1, 1, 0), 1.6, C.edge, 0.9);
s.line(...proj(0, 1, 0), ...proj(1, 1, 0), 1.6, C.edge, 0.9);

/* The surface itself, painted back to front. Grooves stay on the
   floor: no rubber there, so no contact stress. */
const quads = [];
for (const b of bands) {
    const [v0, v1] = bandV(b);
    for (let i = 0; i < NU; i++) {
        const u0 = i / NU, u1 = (i + 1) / NU;
        quads.push({
            b, u0, u1, v0, v1,
            z0: b.kind === 'rib' ? sszF[b.rib](-1 + 2 * u0) : 0,
            z1: b.kind === 'rib' ? sszF[b.rib](-1 + 2 * u1) : 0,
            depth: u0 + v0
        });
    }
}
quads.sort((a, b) => a.depth - b.depth);

for (const q of quads) {
    const zm = (q.z0 + q.z1) / 2;
    const top = [proj(q.u0, q.v0, q.z0), proj(q.u1, q.v0, q.z1), proj(q.u1, q.v1, q.z1), proj(q.u0, q.v1, q.z0)];
    if (q.b.kind === 'groove') { s.polygon(top, C.bg0, 0.5); continue; }
    /* the two lit side walls, darker, so the ridges read as solid */
    s.polygon([proj(q.u0, q.v1, q.z0), proj(q.u1, q.v1, q.z1), proj(q.u1, q.v1, 0), proj(q.u0, q.v1, 0)],
        mix(ylOrRd(zm / szMax), C.bg0, 0.5), 1);
    s.polygon([proj(q.u1, q.v0, q.z1), proj(q.u1, q.v1, q.z1), proj(q.u1, q.v1, 0), proj(q.u1, q.v0, 0)],
        mix(ylOrRd(zm / szMax), C.bg0, 0.34), 1);
    s.polygon(top, ylOrRd(zm / szMax), 1);
}

/* one crest line per rib, so seven ridges read as seven */
bi.forEach((_, i) => {
    const b = bands.find(bb => bb.kind === 'rib' && bb.rib === i);
    const vm = (b.y0 + b.y1) / 2 / patchW;
    const pts = [];
    for (let j = 0; j <= NU; j++) pts.push(proj(j / NU, vm, sszF[i](-1 + 2 * j / NU)));
    s.polyline(pts, 1.2, [255, 255, 255], 0.22);
});

/* the two front edges get their dimension, outside the plan */
const lenAt = proj(0.5, 1, 0), widAt = proj(1, 0.5, 0);
s.textRight('CONTACT LENGTH ' + L.toFixed(0) + ' MM', Math.min(lenAt[0] + 200, 1176), lenAt[1] + 12, 2, C.ink3, 0.9);
s.textRight('TIRE WIDTH ' + patchW.toFixed(0) + ' MM', widAt[0] - 14, widAt[1] + 10, 2, C.ink3, 0.9);

colorbar(s, 1214, 196, 20, SURF.y + SURF.h - 214, ylOrRd, {
    frame: C.edge, ink: C.ink2, ink2: C.ink3,
    max: szMax.toFixed(2), min: '0'
});

s.text(AIRCRAFT.toUpperCase() + ' · ' + bi.length + ' RIBS · ' + wheelsPlotted + ' WHEELS ON ' + numGear + ' GEAR',
    SURF.x, SURF.y + SURF.h + 14, 2, C.ink2, 0.95);
s.text('σ Z · VERTICAL CONTACT STRESS, MPA, RIB BY RIB', SURF.x, SURF.y + SURF.h + 38, 2, C.ink3, 0.8);

/* ---- strip: the longitudinal component, which changes sign ------ */

const LG = { x: RX + 74, y: 512, w: 566, h: 120 };
s.roundRect(RX - 6, 466, 1268 - (RX - 6), 226, 14, C.panel, 0.45);

let sxMin = Infinity, sxMax = -Infinity;
for (let i = 0; i < bi.length; i++) for (let j = 0; j <= 120; j++) {
    const v = ssxF[i](L * j / 120);
    sxMin = Math.min(sxMin, v); sxMax = Math.max(sxMax, v);
}
const spad = (sxMax - sxMin) * 0.14;
const lx = (x) => LG.x + (x / L) * LG.w;
const ly = (v) => LG.y + LG.h - (v - (sxMin - spad)) / ((sxMax + spad) - (sxMin - spad)) * LG.h;

s.rect(LG.x, LG.y, LG.w, LG.h, C.bg0, 0.4);
s.dashedLine(LG.x, ly(0), LG.x + LG.w, ly(0), 1.6, C.edge, 0.85, 10, 8);
s.textRight('0', LG.x - 10, ly(0) - 7, 2, C.ink3, 0.85);
s.textRight(sxMax.toFixed(2), LG.x - 10, LG.y - 7, 2, C.ink3, 0.85);
s.textRight(sxMin.toFixed(2), LG.x - 10, LG.y + LG.h - 7, 2, C.ink3, 0.85);

/* Only two curves are distinct — the model gives ribs 2..6 the same
   stress factor — so the inner group is drawn once, thin, under the
   two shoulder ribs. */
for (const i of [1, 0]) {
    const pts = [];
    for (let j = 0; j <= 160; j++) {
        const x = L * j / 160;
        pts.push([lx(x), ly(ssxF[i](x))]);
    }
    s.polyline(pts, i === 0 ? 3.2 : 2.2, RIB_COLORS[i], i === 0 ? 1 : 0.8);
}
s.disc(LG.x + 12, LG.y + LG.h - 20, 5, RIB_COLORS[0], 1);
s.text('SHOULDER 1,7', LG.x + 24, LG.y + LG.h - 27, 2, C.ink3, 0.9);
s.disc(LG.x + 200, LG.y + LG.h - 20, 5, RIB_COLORS[1], 0.85);
s.text('INNER 2-6', LG.x + 212, LG.y + LG.h - 27, 2, C.ink3, 0.9);

[0, 0.25, 0.5, 0.75, 1].forEach(f => s.textCenter((L * f).toFixed(0), lx(L * f), LG.y + LG.h + 12, 2, C.ink3, 0.8));
s.text('σ X · LONGITUDINAL, SIGN REVERSING ALONG THE PATCH', LG.x, LG.y + LG.h + 38, 2, C.ink3, 0.75);
s.text('σ X MPA', LG.x, LG.y - 32, 2, C.ink2, 0.9);
s.textRight('EQUILIBRIUM RESIDUAL ' + R.diff.toFixed(2) + '%', LG.x + LG.w, LG.y - 32, 2, C.ok, 0.95);

/* a thin diverging key, the app's own RdBu, beside the strip label */
for (let j = 0; j < 130; j++) s.rect(LG.x + 116 + j, LG.y - 30, 1.1, 10, rdBuAt(1 - j / 129), 0.9);

/* ---- left column ------------------------------------------------ */

s.text('AIR', PAD, 88, 8, C.ink, 1);
s.text('CRAFTER', PAD, 174, 8, C.skyHi, 1);
s.rect(PAD, 264, 150, 3, C.orange, 0.9);
s.text('CONTACT STRESS ENGINE', PAD, 288, 3, C.ink2, 0.95);
s.text('THREE-DIMENSIONAL TIRE-PAVEMENT', PAD, 326, 2, C.ink3, 0.95);
s.text('CONTACT STRESS FOR THE WHOLE FAA', PAD, 348, 2, C.ink3, 0.95);
s.text('FAARFIELD AIRCRAFT LIBRARY', PAD, 370, 2, C.ink3, 0.95);

badge(s, 'EQUILIBRIUM PASSED', PAD, 402, { bg: [10, 40, 40], dot: C.ok, ink: C.ok, h: 44 });

/* Stat cards as instrument read-outs: no frame, only the four marks
   where a frame would be, and a bar under the figure. */
chips(s, [
    ['AIRCRAFT', '284', ''],
    ['CONTACT RIBS', String(bi.length), ''],
    ['WHEEL LOAD KN', (P / 1000).toFixed(1), ''],
    ['PEAK σ Z MPA', szMax.toFixed(2), '']
], PAD, 464, {
    variant: 'reticle', w: 186, h: 100, gap: 16, inset: 16, labelY: 14,
    labelScale: 2, valueScale: 5,
    bg: C.panel, rule: C.skyHi, label: C.ink3, value: C.ink
});

s.text('GEOMETRY READ FROM THE AIRCRAFT LIBRARY THE APP ITSELF LOADS · STRESSES SOLVED FROM IT, NOT SKETCHED',
    PAD, 706, 2, C.ink3, 0.8);

console.log(`wrote ${s.write(OUT)} (${W}x${H}) — ${AIRCRAFT}, ${bi.length} ribs, ${numWheels} wheels/gear`);
