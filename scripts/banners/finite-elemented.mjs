/* ============================================================
   Finite-Elemented — E-Labs card banner generator.
   ------------------------------------------------------------
   Run with:  node scripts/banners/finite-elemented.mjs
   Writes     images/e-labs/E-Labs_Finite-Elemented.png (1310x790)

   The picture is the app's own answer, not an illustration of it.
   FE.lab in e-labs/finite-elemented/index.html meshes a structure,
   builds Q4 or T3 element matrices with Gauss integration, assembles
   a banded global K, applies boundary conditions, factors it with
   Cholesky and recovers stresses. That pipeline is transcribed below
   and run here, and its results are CHECKED against the numbers the
   app puts on screen before anything is drawn — the tip deflections
   of its own five-point convergence study, to full double precision.
   If the app's solver changes and this one does not, the assertions
   fail and no banner is written.

   Why the cantilever and not the L-bracket: the beam-theory
   comparison is the platform's central lesson, the deflection curve
   below the hero is the same problem refined five times, and a beam
   spans the whole viridis range where the bracket sits mostly at the
   dark end. One problem, told twice.
   ============================================================ */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { surface, rgb, viridis } from './kit.mjs';
import { validateFonts } from './fonts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', '..', 'images', 'e-labs', 'E-Labs_Finite-Elemented.png');

/* ============================================================
   1. The solver, transcribed from FE.lab
   ============================================================ */

const E = 1000, NU = 0.3, TH = 1, P0 = 10;

function buildMesh({ preset, elemType, density, loadFac }) {
    let ux, uy, keep;
    if (preset === 'lbrk') {
        ux = 8; uy = 8;
        keep = (cx, cy) => cx < 2 || cy < 2;
    } else {
        ux = 8; uy = 2;
        keep = () => true;
    }
    const d = density, ncx = ux * d, ncy = uy * d, h = 1 / d;
    const nodeId = {}, coords = [];
    let id = 0;

    const nodeNeeded = (ix, iy) => {
        for (let cx = ix - 1; cx <= ix; cx++) for (let cy = iy - 1; cy <= iy; cy++) {
            if (cx >= 0 && cy >= 0 && cx < ncx && cy < ncy && keep(cx * h, cy * h)) return true;
        }
        return false;
    };

    for (let ix = 0; ix <= ncx; ix++) {
        for (let iy = 0; iy <= ncy; iy++) {
            if (nodeNeeded(ix, iy)) { nodeId[ix + '_' + iy] = id++; coords.push([ix * h, iy * h]); }
        }
    }

    const quads = [];
    for (let cx = 0; cx < ncx; cx++) {
        for (let cy = 0; cy < ncy; cy++) {
            if (!keep(cx * h, cy * h)) continue;
            quads.push([
                nodeId[cx + '_' + cy], nodeId[(cx + 1) + '_' + cy],
                nodeId[(cx + 1) + '_' + (cy + 1)], nodeId[cx + '_' + (cy + 1)]
            ]);
        }
    }

    let elems = [];
    if (elemType === 'q4') {
        elems = quads.map(q => ({ type: 'q4', n: q }));
    } else {
        quads.forEach((q, qi) => {
            if (qi % 2 === 0) {
                elems.push({ type: 't3', n: [q[0], q[1], q[2]] });
                elems.push({ type: 't3', n: [q[0], q[2], q[3]] });
            } else {
                elems.push({ type: 't3', n: [q[0], q[1], q[3]] });
                elems.push({ type: 't3', n: [q[1], q[2], q[3]] });
            }
        });
    }

    const fixed = [], loads = [], eps = 1e-9, P = P0 * loadFac;
    if (preset === 'cant') {
        const rightNodes = [];
        coords.forEach((c, i) => {
            if (Math.abs(c[0]) < eps) fixed.push(2 * i, 2 * i + 1);
            if (Math.abs(c[0] - ux) < eps) rightNodes.push(i);
        });
        rightNodes.forEach((i, k) => {
            const w = (k === 0 || k === rightNodes.length - 1) ? 0.5 : 1;
            loads.push([2 * i + 1, -P * w / (rightNodes.length - 1)]);
        });
    } else {
        const tipNodes = [];
        coords.forEach((c, i) => {
            if (Math.abs(c[1] - uy) < eps) fixed.push(2 * i, 2 * i + 1);
            if (Math.abs(c[0] - ux) < eps) tipNodes.push(i);
        });
        tipNodes.forEach((i, k) => {
            const w = (k === 0 || k === tipNodes.length - 1) ? 0.5 : 1;
            loads.push([2 * i + 1, -P * w / Math.max(tipNodes.length - 1, 1)]);
        });
    }
    return { coords, elems, fixed, loads, ux, uy };
}

function Dmatrix(form) {
    if (form === 'pstress') {
        const c = E / (1 - NU * NU);
        return [[c, c * NU, 0], [c * NU, c, 0], [0, 0, c * (1 - NU) / 2]];
    }
    const c = E / ((1 + NU) * (1 - 2 * NU));
    return [[c * (1 - NU), c * NU, 0], [c * NU, c * (1 - NU), 0], [0, 0, c * (1 - 2 * NU) / 2]];
}

const GP2 = [-0.5773502692, 0.5773502692];

function keQ4(xy, D) {
    const ke = Array.from({ length: 8 }, () => new Array(8).fill(0));
    for (let gi = 0; gi < 2; gi++) for (let gj = 0; gj < 2; gj++) {
        const xi = GP2[gi], eta = GP2[gj];
        const dNxi = [-0.25 * (1 - eta), 0.25 * (1 - eta), 0.25 * (1 + eta), -0.25 * (1 + eta)];
        const dNeta = [-0.25 * (1 - xi), -0.25 * (1 + xi), 0.25 * (1 + xi), 0.25 * (1 - xi)];
        let j11 = 0, j12 = 0, j21 = 0, j22 = 0;
        for (let a = 0; a < 4; a++) {
            j11 += dNxi[a] * xy[a][0]; j12 += dNxi[a] * xy[a][1];
            j21 += dNeta[a] * xy[a][0]; j22 += dNeta[a] * xy[a][1];
        }
        const det = j11 * j22 - j12 * j21;
        const i11 = j22 / det, i12 = -j12 / det, i21 = -j21 / det, i22 = j11 / det;
        const B = [];
        for (let a = 0; a < 4; a++) {
            B.push([i11 * dNxi[a] + i12 * dNeta[a], i21 * dNxi[a] + i22 * dNeta[a]]);
        }
        const w = det * TH;
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
            const ax = B[a][0], ay = B[a][1], bx = B[b][0], by = B[b][1];
            ke[2 * a][2 * b] += (ax * D[0][0] * bx + ay * D[2][2] * by) * w;
            ke[2 * a][2 * b + 1] += (ax * D[0][1] * by + ay * D[2][2] * bx) * w;
            ke[2 * a + 1][2 * b] += (ay * D[1][0] * bx + ax * D[2][2] * by) * w;
            ke[2 * a + 1][2 * b + 1] += (ay * D[1][1] * by + ax * D[2][2] * bx) * w;
        }
    }
    return ke;
}

function keT3(xy, D) {
    const [x1, y1] = xy[0], [x2, y2] = xy[1], [x3, y3] = xy[2];
    const A2 = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    const b = [y2 - y3, y3 - y1, y1 - y2], c = [x3 - x2, x1 - x3, x2 - x1];
    const ke = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const w = TH / (2 * Math.abs(A2));
    for (let a = 0; a < 3; a++) for (let d = 0; d < 3; d++) {
        const ax = b[a], ay = c[a], bx = b[d], by = c[d];
        ke[2 * a][2 * d] += (ax * D[0][0] * bx + ay * D[2][2] * by) * w;
        ke[2 * a][2 * d + 1] += (ax * D[0][1] * by + ay * D[2][2] * bx) * w;
        ke[2 * a + 1][2 * d] += (ay * D[1][0] * bx + ax * D[2][2] * by) * w;
        ke[2 * a + 1][2 * d + 1] += (ay * D[1][1] * by + ax * D[2][2] * bx) * w;
    }
    return ke;
}

function solveBanded(N, hb, band, Fv) {
    const s = hb + 1;
    for (let j = 0; j < N; j++) {
        let diag = band[j * s];
        for (let k = Math.max(0, j - hb); k < j; k++) {
            const l = band[j * s + (j - k)];
            diag -= l * l;
        }
        if (diag <= 0) return null;
        const dj = Math.sqrt(diag);
        band[j * s] = dj;
        const imax = Math.min(N - 1, j + hb);
        for (let i = j + 1; i <= imax; i++) {
            let sum = band[i * s + (i - j)];
            for (let k = Math.max(0, i - hb, j - hb); k < j; k++) {
                sum -= band[i * s + (i - k)] * band[j * s + (j - k)];
            }
            band[i * s + (i - j)] = sum / dj;
        }
    }
    const y = Fv;
    for (let i = 0; i < N; i++) {
        let sum = y[i];
        for (let k = Math.max(0, i - hb); k < i; k++) sum -= band[i * s + (i - k)] * y[k];
        y[i] = sum / band[i * s];
    }
    for (let i = N - 1; i >= 0; i--) {
        let sum = y[i];
        const imax = Math.min(N - 1, i + hb);
        for (let k = i + 1; k <= imax; k++) sum -= band[k * s + (k - i)] * y[k];
        y[i] = sum / band[i * s];
    }
    return y;
}

const mult3 = (D, e) => [
    D[0][0] * e[0] + D[0][1] * e[1],
    D[1][0] * e[0] + D[1][1] * e[1],
    D[2][2] * e[2]
];

function q4StressAt(xy, ue, D, xi, eta) {
    const dNxi = [-0.25 * (1 - eta), 0.25 * (1 - eta), 0.25 * (1 + eta), -0.25 * (1 + eta)];
    const dNeta = [-0.25 * (1 - xi), -0.25 * (1 + xi), 0.25 * (1 + xi), 0.25 * (1 - xi)];
    let j11 = 0, j12 = 0, j21 = 0, j22 = 0;
    for (let a = 0; a < 4; a++) {
        j11 += dNxi[a] * xy[a][0]; j12 += dNxi[a] * xy[a][1];
        j21 += dNeta[a] * xy[a][0]; j22 += dNeta[a] * xy[a][1];
    }
    const det = j11 * j22 - j12 * j21;
    const i11 = j22 / det, i12 = -j12 / det, i21 = -j21 / det, i22 = j11 / det;
    let ex = 0, ey = 0, gxy = 0;
    for (let a = 0; a < 4; a++) {
        const dNx = i11 * dNxi[a] + i12 * dNeta[a];
        const dNy = i21 * dNxi[a] + i22 * dNeta[a];
        ex += dNx * ue[2 * a]; ey += dNy * ue[2 * a + 1];
        gxy += dNy * ue[2 * a] + dNx * ue[2 * a + 1];
    }
    return mult3(D, [ex, ey, gxy]);
}

function solve(cfg) {
    const form = cfg.form || 'pstress';
    const mesh = buildMesh(cfg);
    const nN = mesh.coords.length, N = 2 * nN;
    const D = Dmatrix(form);

    let hb = 0;
    mesh.elems.forEach(el => {
        let mn = Infinity, mx = -Infinity;
        el.n.forEach(nd => { mn = Math.min(mn, nd); mx = Math.max(mx, nd); });
        hb = Math.max(hb, 2 * (mx - mn) + 1);
    });
    const s = hb + 1;
    const band = new Float64Array(N * s), Fv = new Float64Array(N);

    mesh.elems.forEach(el => {
        const xy = el.n.map(nd => mesh.coords[nd]);
        const ke = el.type === 'q4' ? keQ4(xy, D) : keT3(xy, D);
        const dofs = [];
        el.n.forEach(nd => dofs.push(2 * nd, 2 * nd + 1));
        for (let i = 0; i < dofs.length; i++) for (let j = 0; j < dofs.length; j++) {
            if (dofs[j] > dofs[i]) continue;
            band[dofs[i] * s + (dofs[i] - dofs[j])] += ke[i][j];
        }
    });
    mesh.loads.forEach(l => { Fv[l[0]] += l[1]; });

    const isFixed = new Uint8Array(N);
    mesh.fixed.forEach(d => { isFixed[d] = 1; });
    for (let i = 0; i < N; i++) {
        for (let d = 0; d <= hb; d++) {
            const j = i - d;
            if (j < 0) break;
            if (isFixed[i] || isFixed[j]) band[i * s + d] = 0;
        }
    }
    for (let i = 0; i < N; i++) if (isFixed[i]) { band[i * s] = 1; Fv[i] = 0; }

    const u = solveBanded(N, hb, band, Fv);
    if (!u) return null;

    const nodalS = Array.from({ length: nN }, () => [0, 0, 0]);
    const cnt = new Float64Array(nN);
    mesh.elems.forEach(el => {
        const xy = el.n.map(nd => mesh.coords[nd]);
        const ue = [];
        el.n.forEach(nd => ue.push(u[2 * nd], u[2 * nd + 1]));
        if (el.type === 't3') {
            const [x1, y1] = xy[0], [x2, y2] = xy[1], [x3, y3] = xy[2];
            const A2 = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
            const b = [y2 - y3, y3 - y1, y1 - y2], c = [x3 - x2, x1 - x3, x2 - x1];
            let ex = 0, ey = 0, gxy = 0;
            for (let a = 0; a < 3; a++) {
                ex += b[a] / A2 * ue[2 * a];
                ey += c[a] / A2 * ue[2 * a + 1];
                gxy += c[a] / A2 * ue[2 * a] + b[a] / A2 * ue[2 * a + 1];
            }
            const sg = mult3(D, [ex, ey, gxy]);
            el.n.forEach(nd => { nodalS[nd][0] += sg[0]; nodalS[nd][1] += sg[1]; nodalS[nd][2] += sg[2]; cnt[nd]++; });
        } else {
            const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
            for (let a = 0; a < 4; a++) {
                const sg = q4StressAt(xy, ue, D, corners[a][0], corners[a][1]);
                const nd = el.n[a];
                nodalS[nd][0] += sg[0]; nodalS[nd][1] += sg[1]; nodalS[nd][2] += sg[2]; cnt[nd]++;
            }
        }
    });
    for (let i = 0; i < nN; i++) if (cnt[i] > 0) {
        nodalS[i][0] /= cnt[i]; nodalS[i][1] /= cnt[i]; nodalS[i][2] /= cnt[i];
    }

    const vm = new Float64Array(nN);
    let maxVM = 0;
    for (let i = 0; i < nN; i++) {
        const [sx, sy, txy] = nodalS[i];
        const sz = form === 'pstrain' ? NU * (sx + sy) : 0;
        vm[i] = Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * txy * txy);
        maxVM = Math.max(maxVM, vm[i]);
    }
    return { mesh, u, vm, maxVM, N };
}

/** Tip deflection, measured the way the app measures it. */
function femDeflection(sol) {
    const { mesh, u } = sol;
    let best = 0;
    mesh.coords.forEach((c, i) => {
        if (Math.abs(c[0] - mesh.ux) < 1e-9) best = Math.max(best, Math.abs(u[2 * i + 1]));
    });
    return best;
}

/** Timoshenko cantilever, bending plus shear, as the app writes it. */
function beamTheory(loadFac = 1) {
    const P = P0 * loadFac, L = 8, Hh = 2;
    const I = TH * Hh ** 3 / 12, G = E / (2 * (1 + NU)), A = TH * Hh, k = 1.2;
    return P * L ** 3 / (3 * E * I) + k * P * L / (G * A);
}

/* ============================================================
   2. Check this solver against the app's own published numbers
   ============================================================ */

/* The five-point h-refinement study FE.lab.runStudy() plots, read
   straight out of its Plotly trace. Densities 1..5, cantilever,
   plane stress, load x1. If these stop matching, the transcription
   above has drifted from e-labs/finite-elemented/index.html. */
const APP_STUDY = {
    dofs: [54, 170, 350, 594, 902],
    q4: [2.361768106479132, 2.5836231616139758, 2.632031271171963, 2.6500461263031903, 2.658724380161413],
    t3: [1.4853862594325418, 2.2085103073887176, 2.4409578928979063, 2.536360748658713, 2.5837317971856573],
    timoshenko: 2.6848
};

function runStudy() {
    const out = { dofs: [], q4: [], t3: [] };
    for (const elemType of ['q4', 't3']) {
        for (let d = 1; d <= 5; d++) {
            const sol = solve({ preset: 'cant', elemType, density: d, loadFac: 1, form: 'pstress' });
            if (elemType === 'q4') out.dofs.push(sol.N);
            out[elemType].push(femDeflection(sol));
        }
    }
    return out;
}

function check() {
    const study = runStudy();
    const fail = [];
    const near = (a, b, tol) => Math.abs(a - b) <= tol;

    APP_STUDY.dofs.forEach((n, i) => {
        if (study.dofs[i] !== n) fail.push(`DOF count at density ${i + 1}: ${study.dofs[i]} != ${n}`);
    });
    for (const et of ['q4', 't3']) {
        APP_STUDY[et].forEach((v, i) => {
            if (!near(study[et][i], v, 1e-9)) {
                fail.push(`${et} tip deflection at density ${i + 1}: ${study[et][i]} != ${v}`);
            }
        });
    }
    if (!near(beamTheory(), APP_STUDY.timoshenko, 5e-5)) {
        fail.push(`Timoshenko reference: ${beamTheory()} != ${APP_STUDY.timoshenko}`);
    }

    /* And the default state the app shows on load: 64 elements, 170
       DOF, peak von Mises 118, tip 2.58 against beam theory 2.68. */
    const d2 = solve({ preset: 'cant', elemType: 'q4', density: 2, loadFac: 1, form: 'pstress' });
    const shown = {
        elems: d2.mesh.elems.length,
        dofs: d2.N,
        maxvm: d2.maxVM.toPrecision(3),
        tip: femDeflection(d2).toPrecision(3),
        beam: beamTheory().toPrecision(3),
        diff: (100 * (femDeflection(d2) - beamTheory()) / beamTheory()).toFixed(1) + '%'
    };
    const want = { elems: 64, dofs: 170, maxvm: '118', tip: '2.58', beam: '2.68', diff: '-3.8%' };
    for (const k of Object.keys(want)) {
        if (String(shown[k]) !== String(want[k])) fail.push(`default view ${k}: ${shown[k]} != ${want[k]}`);
    }

    if (fail.length) {
        console.error('Solver no longer agrees with the app:\n  ' + fail.join('\n  '));
        process.exit(1);
    }
    return study;
}

const study = check();

/* ============================================================
   3. The composition — a drawing sheet
   ------------------------------------------------------------
   Not a card with a headline and four figures on it. Finite-
   Elemented teaches the analysis a drawing office runs, so the
   banner is laid out as a sheet from one: a ruled border, the
   part dimensioned in the clear, a strip of the same part at
   five mesh densities, numbered notes, and a title block in the
   bottom right corner where a title block goes.
   ============================================================ */

validateFonts();

const W = 1310, H = 790;
const s = surface(W, H, 2);

/* Drafting: wide and tall, square bowls, stencil digits. The widest
   of the three faces, which is why the copy here is the tersest. */
s.useFont('drafting');

/* The app's own dark-theme variables, from its :root block. */
const C = {
    bg0: rgb('#0b1220'), bg1: rgb('#111827'), panel: rgb('#1e293b'),
    ink: rgb('#f1f5f9'), ink2: rgb('#cbd5e1'), ink3: rgb('#94a3b8'),
    line: rgb('#334155'), edge: rgb('#475569'),
    teal: rgb('#0d9488'), tealHi: rgb('#2dd4bf'),
    indigo: rgb('#6366f1'), amber: rgb('#f59e0b')
};

s.vgradient(0, 0, W, H, C.bg1, C.bg0);
for (let x = 0; x < W; x += 46) s.rect(x, 0, 1, H, C.line, 0.14);
for (let y = 0; y < H; y += 46) s.rect(0, y, W, 1, C.line, 0.14);

/* ---- the sheet ------------------------------------------------- */

const SH = { x0: 56, y0: 56, x1: 1254, y1: 734 };
function frame(x0, y0, x1, y1, wgt, c, a) {
    s.rect(x0, y0, x1 - x0, wgt, c, a);
    s.rect(x0, y1 - wgt, x1 - x0, wgt, c, a);
    s.rect(x0, y0, wgt, y1 - y0, c, a);
    s.rect(x1 - wgt, y0, wgt, y1 - y0, c, a);
}
frame(SH.x0, SH.y0, SH.x1, SH.y1, 2, C.edge, 0.55);
frame(SH.x0 + 10, SH.y0 + 10, SH.x1 - 10, SH.y1 - 10, 1, C.edge, 0.25);
/* register marks, one per corner */
[[SH.x0, SH.y0, 1, 1], [SH.x1, SH.y0, -1, 1], [SH.x0, SH.y1, 1, -1], [SH.x1, SH.y1, -1, -1]]
    .forEach(([cx, cy, sx, sy]) => {
        s.rect(sx > 0 ? cx : cx - 26, sy > 0 ? cy : cy - 3, 26, 3, C.tealHi, 0.8);
        s.rect(sx > 0 ? cx : cx - 3, sy > 0 ? cy : cy - 26, 3, 26, C.tealHi, 0.8);
    });

const PAD = 92;

/* ---- sheet title ----------------------------------------------- */

s.text('FINITE-', PAD, 92, 5, C.ink, 1);
s.text('ELEMENTED', PAD, 148, 5, C.tealHi, 1);
s.rect(PAD, 202, 150, 3, C.tealHi, 0.9);
s.text('AN FEA PLATFORM', PAD, 224, 3, C.ink2, 0.95);
s.text('TWELVE MODULES, ENDING', PAD, 268, 2, C.ink3, 0.9);
s.text('IN A LIVE PLANE-STRESS', PAD, 290, 2, C.ink3, 0.9);
s.text('SOLVER YOU CAN DRAG', PAD, 312, 2, C.ink3, 0.9);

/* ---- the part, dimensioned in the clear ------------------------- */

const HERO = { x: 496, y: 92, w: 660, h: 190 };
const hero = solve({ preset: 'cant', elemType: 'q4', density: 3, loadFac: 1, form: 'pstress' });
const { mesh, u, vm } = hero;

let fmin = Infinity, fmax = -Infinity;
for (const v of vm) { fmin = Math.min(fmin, v); fmax = Math.max(fmax, v); }

let umax = 0;
for (let i = 0; i < mesh.coords.length; i++) umax = Math.max(umax, Math.hypot(u[2 * i], u[2 * i + 1]));
const dscale = 0.07 * Math.hypot(mesh.ux, mesh.uy) / umax;

let mx0 = Infinity, mx1 = -Infinity, my0 = Infinity, my1 = -Infinity;
for (let i = 0; i < mesh.coords.length; i++) {
    const c = mesh.coords[i];
    for (const dx of [0, dscale * u[2 * i]]) { mx0 = Math.min(mx0, c[0] + dx); mx1 = Math.max(mx1, c[0] + dx); }
    for (const dy of [0, dscale * u[2 * i + 1]]) { my0 = Math.min(my0, c[1] + dy); my1 = Math.max(my1, c[1] + dy); }
}
const ARROW = 30;
const sc = Math.min(HERO.w / (mx1 - mx0), (HERO.h - ARROW) / (my1 - my0));
const ox = HERO.x + (HERO.w - (mx1 - mx0) * sc) / 2 - mx0 * sc;
const oy = HERO.y + ARROW + (HERO.h - ARROW - (my1 - my0) * sc) / 2 + my1 * sc;
const X = (i, def) => {
    const c = mesh.coords[i];
    return [ox + (c[0] + (def ? dscale * u[2 * i] : 0)) * sc,
            oy - (c[1] + (def ? dscale * u[2 * i + 1] : 0)) * sc];
};

const SUB = 8;
const bilin = (P, fx, fy) => {
    const a = [P[0][0] + (P[1][0] - P[0][0]) * fx, P[0][1] + (P[1][1] - P[0][1]) * fx];
    const b = [P[3][0] + (P[2][0] - P[3][0]) * fx, P[3][1] + (P[2][1] - P[3][1]) * fx];
    return [a[0] + (b[0] - a[0]) * fy, a[1] + (b[1] - a[1]) * fy];
};
const bval = (V, fx, fy) => {
    const a = V[0] + (V[1] - V[0]) * fx, b = V[3] + (V[2] - V[3]) * fx;
    return a + (b - a) * fy;
};

function drawMesh(m, uu, vv, X2, opts) {
    let lo = Infinity, hi = -Infinity;
    for (const v of vv) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (opts.ghost) {
        m.elems.forEach(el => {
            const p = el.n.map(nd => X2(nd, false));
            for (let k = 0; k < p.length; k++) {
                const q = p[(k + 1) % p.length];
                s.line(p[k][0], p[k][1], q[0], q[1], 1, C.edge, 0.28);
            }
        });
    }
    m.elems.forEach(el => {
        const P = el.n.map(nd => X2(nd, true));
        const V = el.n.map(nd => vv[nd]);
        const n = opts.sub || SUB;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const f0 = i / n, f1 = (i + 1) / n, g0 = j / n, g1 = (j + 1) / n;
            s.polygon([bilin(P, f0, g0), bilin(P, f1, g0), bilin(P, f1, g1), bilin(P, f0, g1)],
                viridis((bval(V, (f0 + f1) / 2, (g0 + g1) / 2) - lo) / (hi - lo)), 1);
        }
    });
    if (opts.edges) {
        m.elems.forEach(el => {
            const p = el.n.map(nd => X2(nd, true));
            for (let k = 0; k < p.length; k++) {
                const q = p[(k + 1) % p.length];
                s.line(p[k][0], p[k][1], q[0], q[1], 0.9, [0, 0, 0], 0.3);
            }
        });
    }
}

s.glow(HERO.x + HERO.w / 2, HERO.y + HERO.h / 2, HERO.w * 0.58, C.teal, 0.09, 2.4);
drawMesh(mesh, u, vm, X, { ghost: true, edges: true });

/* the built-in end, hatched as a fixture is on a drawing */
const clampTop = X(mesh.coords.findIndex(c => c[0] === 0 && c[1] === mesh.uy), false);
const clampBot = X(0, false);
s.rect(clampBot[0] - 12, clampTop[1], 6, clampBot[1] - clampTop[1], C.tealHi, 0.85);
for (let hy = clampTop[1]; hy < clampBot[1]; hy += 9) {
    s.line(clampBot[0] - 12, hy + 9, clampBot[0] - 24, hy, 1.4, C.tealHi, 0.6);
}
mesh.loads.forEach(l => {
    const p = X(l[0] >> 1, true);
    s.line(p[0], p[1] - ARROW, p[0], p[1] - 9, 2.4, C.amber, 1);
    s.polygon([[p[0], p[1] - 1], [p[0] - 6, p[1] - 12], [p[0] + 6, p[1] - 12]], C.amber, 1);
});

/* dimension line, extension lines and arrowheads, as drawn */
(function dimension() {
    const a = X(0, false), b = X(mesh.coords.findIndex(c => c[0] === mesh.ux && c[1] === 0), false);
    const dy = HERO.y + HERO.h + 22;
    s.line(a[0], a[1] + 6, a[0], dy + 8, 1, C.edge, 0.7);
    s.line(b[0], b[1] + 6, b[0], dy + 8, 1, C.edge, 0.7);
    s.line(a[0], dy, b[0], dy, 1.4, C.ink3, 0.85);
    s.polygon([[a[0], dy], [a[0] + 11, dy - 4], [a[0] + 11, dy + 4]], C.ink3, 0.85);
    s.polygon([[b[0], dy], [b[0] - 11, dy - 4], [b[0] - 11, dy + 4]], C.ink3, 0.85);
    const label = 'L = 8';
    const lw = s.textWidth(label, 2);
    s.rect((a[0] + b[0]) / 2 - lw / 2 - 8, dy - 9, lw + 16, 18, C.bg0, 0.92);
    s.textCenter(label, (a[0] + b[0]) / 2, dy - 7, 2, C.ink2, 0.95);
})();

/* the scale, laid flat under the part rather than stood beside it */
(function scaleBar() {
    const bx = HERO.x, by = HERO.y + HERO.h + 52, bw = 210, bh = 13;
    s.field(bx, by, bw, bh, (u2) => viridis(u2));
    frame(bx - 1, by - 1, bx + bw + 1, by + bh + 1, 1, C.edge, 0.6);
    s.textRight(fmin.toPrecision(3), bx - 10, by, 2, C.ink3, 0.9);
    s.text(fmax.toPrecision(3), bx + bw + 10, by, 2, C.ink3, 0.9);
    s.text('VON MISES · DEFORMED ×' + (dscale >= 10 ? Math.round(dscale) : dscale.toFixed(1)),
        bx + bw + 84, by, 2, C.ink3, 0.75);
})();

/* ---- the same part, refined five times ------------------------- */

s.rect(PAD, 372, SH.x1 - 20 - PAD, 1, C.edge, 0.45);
s.text('H-REFINEMENT · Q4 QUADS · TIP DEFLECTION APPROACHING ' + beamTheory().toFixed(2),
    PAD, 380, 2, C.ink3, 0.85);

const beam = beamTheory();
const STRIP = { y: 428, h: 74, pitch: 226, w: 200 };
for (let d = 1; d <= 5; d++) {
    const fx = PAD + (d - 1) * STRIP.pitch;
    const sol = solve({ preset: 'cant', elemType: 'q4', density: d, loadFac: 1, form: 'pstress' });
    const tip = femDeflection(sol);

    let fu = 0;
    for (let i = 0; i < sol.mesh.coords.length; i++) fu = Math.max(fu, Math.hypot(sol.u[2 * i], sol.u[2 * i + 1]));
    const ds = 0.07 * Math.hypot(sol.mesh.ux, sol.mesh.uy) / fu;
    const fsc = Math.min(STRIP.w / 8.6, STRIP.h / 3.1);
    const fox = fx + (STRIP.w - 8 * fsc) / 2;
    const foy = STRIP.y + STRIP.h / 2 + mesh.uy * fsc / 2;
    const FX = (i, def) => {
        const c = sol.mesh.coords[i];
        return [fox + (c[0] + (def ? ds * sol.u[2 * i] : 0)) * fsc,
                foy - (c[1] + (def ? ds * sol.u[2 * i + 1] : 0)) * fsc];
    };
    drawMesh(sol.mesh, sol.u, sol.vm, FX, { sub: 3, edges: d <= 3 });

    s.text(String(sol.N) + ' DOF', fx, STRIP.y - 22, 2, d === 3 ? C.tealHi : C.ink3, 0.95);
    s.text(tip.toFixed(2), fx, STRIP.y + STRIP.h + 12, 3, C.ink, 1);
    /* how much of the gap to beam theory this mesh has closed */
    const closed = tip / beam;
    s.rect(fx, STRIP.y + STRIP.h + 44, STRIP.w - 26, 3, C.line, 0.9);
    s.rect(fx, STRIP.y + STRIP.h + 44, (STRIP.w - 26) * closed, 3, C.tealHi, 0.95);
}

/* ---- notes, and the title block --------------------------------- */

s.rect(PAD, 572, 660 - PAD, 1, C.edge, 0.45);

const NOTES = [
    ['1', 'PLANE STRESS, Q4, 2×2 GAUSS'],
    ['2', 'E = 1000, NU = 0.30, T = 1'],
    ['3', 'P = 10 AT THE FREE END'],
    ['4', 'BANDED CHOLESKY, IN BROWSER']
];
s.text('NOTES', PAD, 590, 2, C.tealHi, 0.95);
NOTES.forEach(([n, txt], i) => {
    s.text(n, PAD, 622 + i * 24, 2, C.ink3, 0.7);
    s.text(txt, PAD + 30, 622 + i * 24, 2, C.ink3, 0.9);
});

(function titleBlock() {
    /* Two columns of ruled rows, label left and figure right, the way a
       drawing office writes a title block — not four cards in a grid. */
    const x0 = 700, y0 = 562, x1 = SH.x1 - 20, y1 = 716;
    const head = 40, rowH = (y1 - y0 - head) / 3, colW = (x1 - x0) / 2;
    s.rect(x0, y0, x1 - x0, y1 - y0, C.panel, 0.55);
    frame(x0, y0, x1, y1, 1.6, C.edge, 0.8);
    s.rect(x0, y0 + head, x1 - x0, 1.2, C.edge, 0.8);
    for (let r = 1; r < 3; r++) s.rect(x0, y0 + head + r * rowH, x1 - x0, 1, C.edge, 0.4);
    s.rect(x0 + colW, y0 + head, 1, y1 - y0 - head, C.edge, 0.4);
    s.text('FINITE-ELEMENTED', x0 + 14, y0 + 9, 3, C.ink, 1);

    const d3Tip = femDeflection(hero);
    const cells = [
        ['ELEMENTS', String(mesh.elems.length)], ['TIP DEFL', d3Tip.toFixed(2)],
        ['DOF', String(hero.N)], ['BEAM', beam.toFixed(2)],
        ['PEAK σVM', fmax.toPrecision(3)], ['VS BEAM', (100 * (d3Tip - beam) / beam).toFixed(1) + '%']
    ];
    cells.forEach(([label, value], i) => {
        const cx = x0 + (i % 2) * colW, cy = y0 + head + ((i / 2) | 0) * rowH;
        s.text(label, cx + 14, cy + 11, 2, C.ink3, 0.9);
        s.textRight(value, cx + colW - 14, cy + 6, 3, i === 5 ? C.tealHi : C.ink, 1);
    });
})();

console.log(`wrote ${s.write(OUT)} (${W}x${H})`);
