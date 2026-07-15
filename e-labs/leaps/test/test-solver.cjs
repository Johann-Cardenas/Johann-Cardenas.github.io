/* LEAPS engine validation suite (Node) */
'use strict';
const LEAPS = require(require('path').join(__dirname, '..', 'solver.js'));

let nPass = 0, nFail = 0;
function approx(name, got, want, rtol, atol) {
    atol = atol || 0;
    const err = Math.abs(got - want);
    const ok = err <= Math.max(rtol * Math.abs(want), atol);
    if (ok) { nPass++; console.log(`  PASS ${name}: ${got.toPrecision(8)} (want ${want.toPrecision(8)})`); }
    else { nFail++; console.log(`  FAIL ${name}: got ${got}, want ${want}, relerr ${(err/Math.max(Math.abs(want),1e-300)).toExponential(2)}`); }
}

const p = 0.7, a = 150, E = 100, nu = 0.35, G = E / (2 * (1 + nu));

/* ---------- Boussinesq closed forms ---------- */
function bous_sz(z) { const R = Math.hypot(a, z); return -p * (1 - (z ** 3) / (R ** 3)); }
function bous_sr(z) { const R = Math.hypot(a, z); return -p / 2 * ((1 + 2 * nu) - 2 * (1 + nu) * z / R + (z ** 3) / (R ** 3)); }
function bous_w(z) { const R = Math.hypot(a, z); return p * (1 + nu) * a / E * (a / R + (1 - 2 * nu) * (R - z) / a); }

console.log('== 1. Halfspace (Boussinesq) on-axis ==');
{
    const pts = [];
    const zs = [0, 10, 75, 150, 300, 900, 3000];
    zs.forEach(z => pts.push({ x: 0, y: 0, z }));
    pts.push({ x: 300, y: 0, z: 0 }); // exterior surface
    pts.push({ x: 75, y: 0, z: 0 });  // interior surface
    const out = LEAPS.solve({ layers: [{ h: 0, E, nu }], interfaces: [], loads: [{ x: 0, y: 0, p, a }], points: pts });
    zs.forEach((z, i) => {
        approx(`sz(z=${z})`, out.points[i].sig.zz, bous_sz(z), 5e-5, 1e-7);
        approx(`sr(z=${z})`, out.points[i].sig.xx, bous_sr(z), 3e-4, 2e-6);
        approx(`w(z=${z})`, out.points[i].disp.uz, bous_w(z), 1e-4, 1e-7);
    });
    // exterior surface deflection via elliptic
    const ke = LEAPS.ellipKE(a / 300);
    const wr = p * a * (1 - nu) / G * (2 / Math.PI) * (300 / a) * (ke.E - (1 - (a / 300) ** 2) * ke.K);
    approx('w(r=2a,0)', out.points[zs.length].disp.uz, wr, 1e-6);
    approx('sz(r=2a,0)', out.points[zs.length].sig.zz, 0, 0, 1e-9);
    // interior surface
    const kei = LEAPS.ellipKE(75 / a);
    const wi = p * a * (1 - nu) / G * (2 / Math.PI) * kei.E;
    approx('w(r=a/2,0)', out.points[zs.length + 1].disp.uz, wi, 1e-6);
    approx('sz(r=a/2,0)', out.points[zs.length + 1].sig.zz, -p, 1e-9);
}

console.log('== 2. Three equal layers reduce to halfspace (bonded) ==');
{
    const layers = [{ h: 100, E, nu }, { h: 200, E, nu }, { h: 0, E, nu }];
    const pts = [
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 50 }, { x: 0, y: 0, z: 100 },
        { x: 0, y: 0, z: 150 }, { x: 0, y: 0, z: 299.5 }, { x: 0, y: 0, z: 600 },
        { x: 200, y: 0, z: 0 }, { x: 400, y: 0, z: 120 }
    ];
    const out = LEAPS.solve({ layers, interfaces: [{ bond: 'bonded' }, { bond: 'bonded' }], loads: [{ x: 0, y: 0, p, a }], points: pts });
    [0, 50, 100, 150, 299.5, 600].forEach((z, i) => {
        approx(`sz(z=${z})`, out.points[i].sig.zz, bous_sz(z), 3e-4, 3e-6);
        approx(`w(z=${z})`, out.points[i].disp.uz, bous_w(z), 3e-4, 1e-6);
        approx(`sr(z=${z})`, out.points[i].sig.xx, bous_sr(z), 1e-3, 5e-6);
    });
    // off-axis
    const ke = LEAPS.ellipKE(a / 200);
    const wr = p * a * (1 - nu) / G * (2 / Math.PI) * (200 / a) * (ke.E - (1 - (a / 200) ** 2) * ke.K);
    approx('w(r=200,0)', out.points[6].disp.uz, wr, 3e-4);
}

console.log('== 3. Spring interface limits (2-layer) ==');
{
    const layers = [{ h: 150, E: 3000, nu: 0.35 }, { h: 0, E: 80, nu: 0.40 }];
    const pts = [{ x: 0, y: 0, z: 149.99 }, { x: 0, y: 0, z: 0 }, { x: 120, y: 0, z: 75 }];
    const loads = [{ x: 0, y: 0, p, a }];
    const bond = LEAPS.solve({ layers, interfaces: [{ bond: 'bonded' }], loads, points: pts });
    const kBig = LEAPS.solve({ layers, interfaces: [{ bond: 'spring', k: 1e6 }], loads, points: pts });
    const free = LEAPS.solve({ layers, interfaces: [{ bond: 'unbonded' }], loads, points: pts });
    const kTiny = LEAPS.solve({ layers, interfaces: [{ bond: 'spring', k: 1e-8 }], loads, points: pts });
    for (let i = 0; i < pts.length; i++) {
        approx(`spring(k→∞)≈bonded sx pt${i}`, kBig.points[i].sig.xx, bond.points[i].sig.xx, 2e-3, 1e-5);
        approx(`spring(k→∞)≈bonded uz pt${i}`, kBig.points[i].disp.uz, bond.points[i].disp.uz, 2e-3, 1e-6);
        approx(`spring(k→0)≈unbonded sx pt${i}`, kTiny.points[i].sig.xx, free.points[i].sig.xx, 2e-3, 1e-5);
        approx(`spring(k→0)≈unbonded uz pt${i}`, kTiny.points[i].disp.uz, free.points[i].disp.uz, 2e-3, 1e-6);
    }
    // sanity: unbonded should deflect more than bonded
    if (free.points[1].disp.uz > bond.points[1].disp.uz) { nPass++; console.log('  PASS unbonded deflects more than bonded'); }
    else { nFail++; console.log(`  FAIL unbonded w=${free.points[1].disp.uz} !> bonded w=${bond.points[1].disp.uz}`); }
}

console.log('== 4. Vertical equilibrium at depth (3-layer flexible) ==');
{
    const layers = [{ h: 100, E: 3000, nu: 0.35 }, { h: 200, E: 300, nu: 0.35 }, { h: 0, E: 60, nu: 0.40 }];
    const zeq = 250;
    const rs = []; const NR = 80, RMAX = 4000;
    for (let i = 0; i < NR; i++) rs.push(RMAX * (i / (NR - 1)) ** 1.5);
    const pts = rs.map(r => ({ x: r, y: 0, z: zeq }));
    const out = LEAPS.solve({ layers, interfaces: [{}, {}], loads: [{ x: 0, y: 0, p, a }], points: pts });
    let F = 0;
    for (let i = 0; i < NR - 1; i++) {
        const r0 = rs[i], r1 = rs[i + 1];
        const s0 = out.points[i].sig.zz, s1 = out.points[i + 1].sig.zz;
        F += Math.PI * (r1 - r0) * (s0 * r0 + s1 * r1 + 0.5 * (s0 * r1 + s1 * r0)) * (2 / 3) * 1.0;
    }
    // simpler trapezoid on 2πr·σz
    let F2 = 0;
    for (let i = 0; i < NR - 1; i++) {
        F2 += 0.5 * (2 * Math.PI * rs[i] * out.points[i].sig.zz + 2 * Math.PI * rs[i + 1] * out.points[i + 1].sig.zz) * (rs[i + 1] - rs[i]);
    }
    approx('∫σz dA = -P', F2, -p * Math.PI * a * a, 2e-2);
}

console.log('== 5. Dual-wheel superposition symmetry ==');
{
    const layers = [{ h: 100, E: 3000, nu: 0.35 }, { h: 0, E: 60, nu: 0.40 }];
    const loads = [{ x: -175, y: 0, p, a: 100 }, { x: 175, y: 0, p, a: 100 }];
    const out = LEAPS.solve({
        layers, interfaces: [{}], loads,
        points: [{ x: 0, y: 0, z: 99.9 }, { x: -175, y: 0, z: 99.9 }, { x: 175, y: 0, z: 99.9 }, { x: 0, y: 0, z: 0 }]
    });
    approx('sym sx under wheels', out.points[1].sig.xx, out.points[2].sig.xx, 1e-6);
    approx('sym w under wheels', out.points[1].disp.uz, out.points[2].disp.uz, 1e-6);
    // midpoint: tau_xz must vanish by symmetry
    approx('midpoint τxz=0', out.points[0].sig.xz, 0, 0, 1e-8);
    approx('midpoint uy=0', out.points[0].disp.uy, 0, 0, 1e-10);
    // single wheel at r computed two ways (x offset vs y offset)
    const o2 = LEAPS.solve({
        layers, interfaces: [{}], loads: [{ x: 0, y: 0, p, a: 100 }],
        points: [{ x: 130, y: 0, z: 50 }, { x: 0, y: 130, z: 50 }]
    });
    approx('rotation sx↔sy', o2.points[0].sig.xx, o2.points[1].sig.yy, 1e-8);
    approx('rotation τxz↔τyz', o2.points[0].sig.xz, o2.points[1].sig.yz, 1e-8);
}

console.log('== 6. Two-layer Burmister deflection factor (E1/E2=10, h=a, ν=0.5) ==');
{
    const E2 = 50, layers = [{ h: 150, E: 500, nu: 0.5 }, { h: 0, E: E2, nu: 0.5 }];
    const out = LEAPS.solve({ layers, interfaces: [{}], loads: [{ x: 0, y: 0, p, a }], points: [{ x: 0, y: 0, z: 0 }] });
    const F2 = out.points[0].disp.uz * E2 / (1.5 * p * a);
    console.log(`  F2 = ${F2.toFixed(4)} (Burmister chart ≈ 0.5)`);
    if (F2 > 0.40 && F2 < 0.60) { nPass++; console.log('  PASS Burmister F2 in range'); }
    else { nFail++; console.log('  FAIL Burmister F2 out of range'); }
}

console.log('== 7. High modulus contrast + thin layer robustness ==');
{
    const layers = [
        { h: 40, E: 40000, nu: 0.15 },   // very stiff thin PCC overlay
        { h: 3, E: 30, nu: 0.45 },       // very thin soft interlayer
        { h: 250, E: 20000, nu: 0.15 },  // PCC
        { h: 0, E: 40, nu: 0.45 }
    ];
    const out = LEAPS.solve({
        layers, interfaces: [{}, {}, {}], loads: [{ x: 0, y: 0, p: 1.4, a: 120 }],
        points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 41.5 }, { x: 0, y: 0, z: 292 }, { x: 0, y: 0, z: 600 }]
    });
    let finiteOK = true;
    out.points.forEach(pt => {
        ['xx', 'yy', 'zz', 'xz'].forEach(k => { if (!isFinite(pt.sig[k])) finiteOK = false; });
        if (!isFinite(pt.disp.uz)) finiteOK = false;
    });
    if (finiteOK) { nPass++; console.log('  PASS all responses finite'); } else { nFail++; console.log('  FAIL non-finite response'); }
    // physical: σz must decay monotonically-ish and deflection positive
    if (out.points[0].disp.uz > 0 && out.points[3].disp.uz > 0 && out.points[0].disp.uz >= out.points[3].disp.uz * 0.999) {
        nPass++; console.log('  PASS deflections positive & decreasing');
    } else { nFail++; console.log(`  FAIL w0=${out.points[0].disp.uz} w600=${out.points[3].disp.uz}`); }
    console.log(`  stats: ${JSON.stringify(out.stats)}`);
}

console.log('== 8. selfTest() ==');
{
    const st = LEAPS.selfTest();
    if (st.pass) { nPass++; console.log('  PASS engine selfTest'); }
    else { nFail++; console.log('  FAIL: ' + st.errors.join(' | ')); }
}

console.log('== 9. Performance: 61x41 grid, 2 loads, 4 layers ==');
{
    const layers = [{ h: 100, E: 3000, nu: 0.35 }, { h: 150, E: 400, nu: 0.35 }, { h: 300, E: 150, nu: 0.35 }, { h: 0, E: 60, nu: 0.4 }];
    const pts = [];
    for (let i = 0; i < 61; i++) for (let j = 0; j < 41; j++) {
        pts.push({ x: -600 + 1200 * i / 60, y: 0, z: 0.5 + 800 * j / 40 });
    }
    const t0 = Date.now();
    const out = LEAPS.solve({ layers, interfaces: [{}, {}, {}], loads: [{ x: -175, y: 0, p, a: 100 }, { x: 175, y: 0, p, a: 100 }], points: pts });
    console.log(`  ${pts.length} pts x 2 loads in ${Date.now() - t0} ms; stats=${JSON.stringify(out.stats)}`);
    nPass++;
}

console.log(`\n===== ${nPass} passed, ${nFail} failed =====`);
process.exit(nFail ? 1 : 0);
