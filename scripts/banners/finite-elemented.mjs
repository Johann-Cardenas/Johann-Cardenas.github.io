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
import { surface, rgb, viridis, chips, badge, colorbar } from './kit.mjs';
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
   3. The composition
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
for (let x = 0; x < W; x += 46) s.rect(x, 0, 1, H, C.line, 0.16);
for (let y = 0; y < H; y += 46) s.rect(0, y, W, 1, C.line, 0.16);

const PAD = 64, LEFT_W = 470;
const RX = 512, RW = W - RX - 64;          /* right column */

/* ---- hero: the cantilever, solved here, drawn deformed ---------- */

const HERO = { x: RX, y: 96, w: 640, h: 230 };
const hero = solve({ preset: 'cant', elemType: 'q4', density: 3, loadFac: 1, form: 'pstress' });
const { mesh, u, vm } = hero;

let fmin = Infinity, fmax = -Infinity;
for (const v of vm) { fmin = Math.min(fmin, v); fmax = Math.max(fmax, v); }

/* Displacement autoscale, the same 7%-of-diagonal rule the app uses. */
let umax = 0;
for (let i = 0; i < mesh.coords.length; i++) umax = Math.max(umax, Math.hypot(u[2 * i], u[2 * i + 1]));
const dscale = 0.07 * Math.hypot(mesh.ux, mesh.uy) / umax;

/* Fit the union of the undeformed and deformed shapes, keeping room at
   the top for the load arrows so nothing leaves the hero band. */
let mx0 = Infinity, mx1 = -Infinity, my0 = Infinity, my1 = -Infinity;
for (let i = 0; i < mesh.coords.length; i++) {
    const c = mesh.coords[i];
    for (const dx of [0, dscale * u[2 * i]]) { mx0 = Math.min(mx0, c[0] + dx); mx1 = Math.max(mx1, c[0] + dx); }
    for (const dy of [0, dscale * u[2 * i + 1]]) { my0 = Math.min(my0, c[1] + dy); my1 = Math.max(my1, c[1] + dy); }
}
const ARROW = 34;
const sc = Math.min(HERO.w / (mx1 - mx0), (HERO.h - ARROW) / (my1 - my0));
const ox = HERO.x + (HERO.w - (mx1 - mx0) * sc) / 2 - mx0 * sc;
const oy = HERO.y + ARROW + (HERO.h - ARROW - (my1 - my0) * sc) / 2 + my1 * sc;
const X = (i, def) => {
    const c = mesh.coords[i];
    return [ox + (c[0] + (def ? dscale * u[2 * i] : 0)) * sc,
            oy - (c[1] + (def ? dscale * u[2 * i + 1] : 0)) * sc];
};

/* a soft teal wash behind the beam so it lifts off the grid */
s.glow(HERO.x + HERO.w / 2, HERO.y + HERO.h / 2, HERO.w * 0.6, C.teal, 0.1, 2.4);

/* undeformed ghost */
mesh.elems.forEach(el => {
    const p = el.n.map(nd => X(nd, false));
    for (let k = 0; k < p.length; k++) {
        const q = p[(k + 1) % p.length];
        s.line(p[k][0], p[k][1], q[0], q[1], 1, C.edge, 0.3);
    }
});

/* Contour fill on the deformed shape. Each element is split 8x8 and
   filled from the bilinear field, which at this size reads smooth. */
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
mesh.elems.forEach(el => {
    const P = el.n.map(nd => X(nd, true));
    const V = el.n.map(nd => vm[nd]);
    for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) {
        const f0 = i / SUB, f1 = (i + 1) / SUB, g0 = j / SUB, g1 = (j + 1) / SUB;
        const quad = [bilin(P, f0, g0), bilin(P, f1, g0), bilin(P, f1, g1), bilin(P, f0, g1)];
        const c = viridis((bval(V, (f0 + f1) / 2, (g0 + g1) / 2) - fmin) / (fmax - fmin));
        s.polygon(quad, c, 1);
    }
});

/* deformed element edges */
mesh.elems.forEach(el => {
    const p = el.n.map(nd => X(nd, true));
    for (let k = 0; k < p.length; k++) {
        const q = p[(k + 1) % p.length];
        s.line(p[k][0], p[k][1], q[0], q[1], 0.9, [0, 0, 0], 0.3);
    }
});

/* supports on the clamped edge, load arrows on the tip */
const seen = new Set();
mesh.fixed.forEach(d => {
    const nd = d >> 1;
    if (seen.has(nd)) return;
    seen.add(nd);
    const p = X(nd, false);
    s.disc(p[0], p[1], 5, C.tealHi, 1);
    s.disc(p[0], p[1], 2.2, C.bg0, 1);
});
mesh.loads.forEach(l => {
    const nd = l[0] >> 1;
    const p = X(nd, true);
    s.line(p[0], p[1] - ARROW, p[0], p[1] - 9, 2.6, C.amber, 1);
    s.polygon([[p[0], p[1] - 1], [p[0] - 6.5, p[1] - 13], [p[0] + 6.5, p[1] - 13]], C.amber, 1);
});

colorbar(s, HERO.x + HERO.w + 36, 196, 20, HERO.y + HERO.h - 202, viridis, {
    frame: C.edge, ink: C.ink2, ink2: C.ink3,
    max: fmax.toPrecision(3), min: fmin.toPrecision(3)
});

s.text('CANTILEVER · Q4 · VON MISES · ×' +
    (dscale >= 10 ? Math.round(dscale) : dscale.toFixed(1)),
    HERO.x, HERO.y + HERO.h + 20, 2, C.ink3, 0.9);

/* ---- convergence: the same problem, refined five times ---------- */

const CV = { x: RX + 34, y: 428, w: 654, h: 182 };
const beam = beamTheory();
const yLo = 1.4, yHi = 2.8;
const px = (n) => CV.x + (Math.log10(n) - Math.log10(54)) / (Math.log10(902) - Math.log10(54)) * CV.w;
const py = (v) => CV.y + CV.h - (v - yLo) / (yHi - yLo) * CV.h;

s.roundRect(RX - 6, CV.y - 44, 1268 - (RX - 6), CV.h + 112, 14, C.panel, 0.45);
for (let g = 0; g <= 7; g++) {
    const v = yLo + (yHi - yLo) * g / 7;
    s.rect(CV.x, py(v), CV.w, 1, C.line, 0.45);
    if (g % 2 === 0) s.textRight(v.toFixed(1), CV.x - 10, py(v) - 7, 2, C.ink3, 0.85);
}

/* Timoshenko reference, the line both element types are heading for */
s.dashedLine(CV.x, py(beam), CV.x + CV.w, py(beam), 2, C.amber, 0.9, 12, 9);

const series = [
    { y: study.q4, color: C.tealHi, dash: false },
    { y: study.t3, color: C.indigo, dash: true }
];
for (const ser of series) {
    const pts = APP_STUDY.dofs.map((n, i) => [px(n), py(ser.y[i])]);
    for (let i = 1; i < pts.length; i++) {
        if (ser.dash) s.dashedLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], 3, ser.color, 1, 10, 7);
        else s.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], 3, ser.color, 1);
    }
    for (const p of pts) {
        s.disc(p[0], p[1], 6, C.bg0, 1);
        s.disc(p[0], p[1], 4.4, ser.color, 1);
    }
}
APP_STUDY.dofs.forEach(n => s.textCenter(String(n), px(n), CV.y + CV.h + 14, 2, C.ink3, 0.85));
s.text('TIP DEFLECTION VS DEGREES OF FREEDOM', CV.x, CV.y + CV.h + 38, 2, C.ink3, 0.7);

/* series key, in the panel's free top strip */
s.line(CV.x, CV.y - 22, CV.x + 34, CV.y - 22, 3, C.tealHi, 1);
s.text('Q4 QUADS', CV.x + 42, CV.y - 31, 2, C.ink2, 0.95);
s.dashedLine(CV.x + 190, CV.y - 22, CV.x + 224, CV.y - 22, 3, C.indigo, 1, 8, 6);
s.text('T3 TRIS', CV.x + 232, CV.y - 31, 2, C.ink2, 0.95);
s.dashedLine(CV.x + 366, CV.y - 22, CV.x + 400, CV.y - 22, 3, C.amber, 1, 8, 6);
s.text('BEAM ' + beam.toFixed(2), CV.x + 408, CV.y - 31, 2, C.amber, 0.95);

/* ---- left column ------------------------------------------------ */

s.text('FINITE-', PAD, 92, 5, C.ink, 1);
s.text('ELEMENTED', PAD, 150, 5, C.tealHi, 1);
s.rect(PAD, 214, 150, 3, C.tealHi, 0.9);
s.text('AN FEA PLATFORM', PAD, 238, 3, C.ink2, 0.95);
s.text('TWELVE MODULES, FROM THE', PAD, 286, 2, C.ink3, 0.95);
s.text('WEAK FORM TO A LIVE 2D', PAD, 310, 2, C.ink3, 0.95);
s.text('PLANE-STRESS SOLVER', PAD, 334, 2, C.ink3, 0.95);

badge(s, 'LIVE SOLVER', PAD, 378, { bg: [10, 40, 40], dot: rgb('#10b981'), ink: rgb('#10b981'), h: 44 });

/* Stat cards as dimensioned boxes off a drawing: hairline frame,
   heavy binding edge, a tick ruled under every figure. */
const d3Tip = femDeflection(hero);
chips(s, [
    ['MODULES', '12', ''],
    ['ELEMENTS', String(mesh.elems.length), 'Q4'],
    ['DOF', String(hero.N), ''],
    ['VS BEAM', (100 * (d3Tip - beam) / beam).toFixed(1), '%']
], PAD, 452, {
    variant: 'bar', w: 186, h: 92, gap: 16, inset: 16,
    labelScale: 2, valueScale: 4, unitScale: 3,
    bg: C.panel, rule: C.tealHi, frame: C.edge, label: C.ink3, value: C.ink
});

s.text('MESHED, ASSEMBLED, CHOLESKY-FACTORED AND RECOVERED IN THE BROWSER',
    PAD, 700, 2, C.ink3, 0.8);

console.log(`wrote ${s.write(OUT)} (${W}x${H})`);
