// Space-frame finite-element model of the frameset: 3D Euler-Bernoulli beams, 6 DOF per node.
// Pure functions, no DOM. Units: mm, N, MPa (so E in MPa, moments in N.mm, density in t/mm^3).
//
// This is a beam idealisation with ASSUMED thin-wall sections and an equivalent isotropic laminate.
// It ranks load paths and gives order-of-magnitude stiffness. It is not a strength assessment.
import { hardpoints, steerAxes } from './derived.js';

// ---- section properties -------------------------------------------------------------------------
/** Hollow ellipse: outer semi-axes a (local y) and b (local z), wall t. */
export function tubeSection(a, b, t) {
  t = Math.min(t, a * 0.98, b * 0.98);
  const ai = a - t, bi = b - t;
  const A = Math.PI * (a * b - ai * bi);
  const Iz = (Math.PI / 4) * (b * a ** 3 - bi * ai ** 3); // bending in the local x-y plane, fibres at +-a
  const Iy = (Math.PI / 4) * (a * b ** 3 - ai * bi ** 3); // bending in the local x-z plane, fibres at +-b
  const am = a - t / 2, bm = b - t / 2, Am = Math.PI * am * bm;
  const h = ((am - bm) / (am + bm)) ** 2;
  const perim = Math.PI * (am + bm) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))); // Ramanujan
  const J = (4 * Am * Am * t) / perim; // Bredt, closed thin wall
  return { A, Iy, Iz, J, cy: a, cz: b, Am, t };
}
export const solidRound = (r) => ({ A: Math.PI * r * r, Iy: Math.PI * r ** 4 / 4, Iz: Math.PI * r ** 4 / 4, J: Math.PI * r ** 4 / 2, cy: r, cz: r, Am: Math.PI * r * r / 2, t: r });

// ---- element stiffness --------------------------------------------------------------------------
function localK(E, Gm, s, L) {
  const k = Array.from({ length: 12 }, () => new Float64Array(12));
  const set = (i, j, v) => { k[i][j] = v; k[j][i] = v; };
  const EA = E * s.A / L, GJ = Gm * s.J / L;
  set(0, 0, EA); set(0, 6, -EA); set(6, 6, EA);
  set(3, 3, GJ); set(3, 9, -GJ); set(9, 9, GJ);
  const z = E * s.Iz, y = E * s.Iy, L2 = L * L, L3 = L2 * L;
  // bending in x-y (v, rz)
  set(1, 1, 12 * z / L3); set(1, 5, 6 * z / L2); set(1, 7, -12 * z / L3); set(1, 11, 6 * z / L2);
  set(5, 5, 4 * z / L); set(5, 7, -6 * z / L2); set(5, 11, 2 * z / L);
  set(7, 7, 12 * z / L3); set(7, 11, -6 * z / L2); set(11, 11, 4 * z / L);
  // bending in x-z (w, ry)
  set(2, 2, 12 * y / L3); set(2, 4, -6 * y / L2); set(2, 8, -12 * y / L3); set(2, 10, -6 * y / L2);
  set(4, 4, 4 * y / L); set(4, 8, 6 * y / L2); set(4, 10, 2 * y / L);
  set(8, 8, 12 * y / L3); set(8, 10, 6 * y / L2); set(10, 10, 4 * y / L);
  return k;
}

/** Rows are the local x, y, z axes. Local y is the in-plane normal (global Z cross x). */
function triad(p, q) {
  const x = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(...x);
  x[0] /= L; x[1] /= L; x[2] /= L;
  let y = [-x[1], x[0], 0]; // Z cross x
  let n = Math.hypot(...y);
  if (n < 1e-6) { y = [0, 1, 0]; n = 1; }
  y = y.map((v) => v / n);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return { R: [x, y, z], L };
}

// ---- dense solver -------------------------------------------------------------------------------
export function solveDense(A, b) {
  const n = b.length, M = A.map((r) => Float64Array.from(r)), x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c, mx = Math.abs(M[c][c]);
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > mx) { mx = Math.abs(M[r][c]); p = r; }
    if (mx < 1e-9) throw new Error('Singular stiffness matrix: the model is a mechanism under these supports.');
    if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; [x[p], x[c]] = [x[c], x[p]]; }
    const piv = M[c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv[c];
      if (!f) continue;
      const row = M[r];
      for (let k = c; k < n; k++) row[k] -= f * piv[k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Generic solve.
 *  nodes     [[x,y,z], ...]
 *  elements  [{n1, n2, E, G, sec, member}]
 *  fixed     [[node, dof], ...]   dof 0..5 = ux, uy, uz, rx, ry, rz
 *  loads     [[node, dof, value], ...]
 */
export function solveFrame({ nodes, elements, fixed, loads }) {
  const nd = nodes.length * 6;
  const K = Array.from({ length: nd }, () => new Float64Array(nd)), f = new Float64Array(nd);
  const cache = elements.map((e) => {
    const { R, L } = triad(nodes[e.n1], nodes[e.n2]);
    const kl = localK(e.E, e.G, e.sec, L);
    const map = [];
    for (const n of [e.n1, e.n2]) for (let d = 0; d < 6; d++) map.push(n * 6 + d);
    // T = diag(R, R, R, R);  Kg = T^T kl T
    const Tm = Array.from({ length: 12 }, () => new Float64Array(12));
    for (let b = 0; b < 4; b++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Tm[b * 3 + i][b * 3 + j] = R[i][j];
    const klT = kl.map((row) => { const o = new Float64Array(12); for (let j = 0; j < 12; j++) { let s = 0; for (let k = 0; k < 12; k++) s += row[k] * Tm[k][j]; o[j] = s; } return o; });
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { let s = 0; for (let k = 0; k < 12; k++) s += Tm[k][i] * klT[k][j]; K[map[i]][map[j]] += s; }
    return { klT, map, L };
  });
  for (const [n, d, v] of loads) f[n * 6 + d] += v;
  const isFixed = new Uint8Array(nd);
  for (const [n, d] of fixed) isFixed[n * 6 + d] = 1;
  const free = []; for (let i = 0; i < nd; i++) if (!isFixed[i]) free.push(i);
  const u = new Float64Array(nd);
  const sol = solveDense(free.map((i) => free.map((j) => K[i][j])), free.map((i) => f[i]));
  free.forEach((i, k) => { u[i] = sol[k]; });
  // reactions
  const reactions = [];
  for (const [n, d] of fixed) { const i = n * 6 + d; let s = -f[i]; for (let j = 0; j < nd; j++) s += K[i][j] * u[j]; reactions.push({ node: n, dof: d, value: s }); }
  // element end forces (local) and stresses
  const results = elements.map((e, ei) => {
    const { klT, map } = cache[ei];
    const fl = new Float64Array(12);
    for (let i = 0; i < 12; i++) { let s = 0; for (let j = 0; j < 12; j++) s += klT[i][j] * u[map[j]]; fl[i] = s; }
    const ends = [0, 6].map((o) => {
      const N = Math.abs(fl[o]), Tq = Math.abs(fl[o + 3]), My = Math.abs(fl[o + 4]), Mz = Math.abs(fl[o + 5]);
      const s = e.sec;
      const bend = Math.hypot(My * s.cz / s.Iy, Mz * s.cy / s.Iz);
      const sigma = N / s.A + bend, tau = Tq / (2 * s.Am * s.t);
      return { N: o ? fl[o] : -fl[o], T: Tq, My, Mz, sigma, tau, vm: Math.hypot(sigma, Math.sqrt(3) * tau) };
    });
    return { member: e.member, ends, vm: Math.max(ends[0].vm, ends[1].vm), axial: ends[0].N };
  });
  return { u, reactions, results };
}

// ---- the bicycle --------------------------------------------------------------------------------
export const DEFAULT_LAMINATE = { E: 65000, nu: 0.3, rho: 1.55e-9, allowable: 500, wallScale: 1 };
const ALU = { E: 69000, G: 26000, rho: 2.7e-9 }, STEEL = { E: 200000, G: 77000, rho: 7.85e-9 };

/**
 * Build the beam model from the frame geometry.
 * geometry.tubes gives start/end outer semi-axes and wall per member (illustrative until M09).
 */
export function buildModel(geom, { laminate = DEFAULT_LAMINATE, fitPts = null, div = 6 } = {}) {
  const hp = hardpoints(geom), tb = geom.tubes, ax = steerAxes(geom);
  const lam = { ...DEFAULT_LAMINATE, ...laminate };
  const cf = { E: lam.E, G: lam.E / (2 * (1 + lam.nu)), rho: lam.rho };
  const nodes = [], elements = [], named = {}, memberNodes = {};
  const node = (p, name) => { nodes.push([...p]); if (name) named[name] = nodes.length - 1; return nodes.length - 1; };
  const secAt = (spec, u) => {
    const pick = (k) => {
      if (spec.mid && u <= 0.5) return spec.start[k] + (spec.mid[k] - spec.start[k]) * (u / 0.5);
      if (spec.mid) return spec.mid[k] + (spec.end[k] - spec.mid[k]) * ((u - 0.5) / 0.5);
      return spec.start[k] + (spec.end[k] - spec.start[k]) * u;
    };
    return tubeSection(pick('a'), pick('b'), spec.wall_mm * lam.wallScale);
  };
  function member(name, i1, i2, spec, mat = cf, n = div) {
    const p = nodes[i1], q = nodes[i2];
    let prev = i1; const list = [i1];
    for (let k = 1; k <= n; k++) {
      const t = k / n, cur = k === n ? i2 : node([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
      const sec = typeof spec.A === 'number' ? spec : secAt(spec, (k - 0.5) / n);
      elements.push({ n1: prev, n2: cur, E: mat.E, G: mat.G, rho: mat.rho, sec, member: name });
      prev = cur; list.push(cur);
    }
    (memberNodes[name] ||= []).push(list);
  }
  const rigid = tubeSection(18, 18, 6); // stiff connector (axles, crown, shell)
  const BB = node(hp.BB_CENTER, 'BB'), ST = node(hp.ST_TOP, 'ST'), HT = node(hp.HT_TOP, 'HT_TOP'), HB = node(hp.HT_BOTTOM, 'HT_BOTTOM');
  member('seat_tube', BB, ST, tb.seat_tube);
  member('top_tube', HT, ST, tb.top_tube);
  member('down_tube', HB, BB, tb.down_tube);
  member('head_tube', HB, HT, tb.head_tube, cf, 3);
  const RA = node(hp.REAR_AXLE, 'REAR_AXLE'), FA = node(hp.FRONT_AXLE, 'FRONT_AXLE');
  for (const s of [-1, 1]) {
    const side = s > 0 ? 'R' : 'L';
    const rd = node([hp.REAR_AXLE[0], hp.REAR_AXLE[1], s * 65], 'RD_' + side);
    const bbs = node([0, 0, s * 24]);
    member('bb_shell', BB, bbs, rigid, ALU, 1);
    member('chainstay', bbs, rd, tb.chainstay);
    member('seat_stay', ST, rd, tb.seat_stay);
    member('rear_axle', RA, rd, solidRound(5), STEEL, 1);
    // fork: crown offset, then the blade down to the dropout
    const crown = node([hp.HT_BOTTOM[0] - ax.up[0] * 22, hp.HT_BOTTOM[1] - ax.up[1] * 22, s * 46]);
    const fd = node([hp.FRONT_AXLE[0], hp.FRONT_AXLE[1], s * 50], 'FD_' + side);
    member('fork_crown', HB, crown, rigid, cf, 1);
    member('fork_blade', crown, fd, tb.fork_blade);
    member('front_axle', FA, fd, solidRound(4.5), STEEL, 1);
  }
  // seatpost and cockpit carry the rider loads into the frame
  if (fitPts) {
    const SAD = node(fitPts.saddle, 'SADDLE');
    member('seatpost', ST, SAD, tubeSection(13.6, 13.6, 2.2), ALU, 3);
    const SB = node(fitPts.stemBase, 'STEM_BASE'), BAR = node(fitPts.bar, 'BAR');
    member('steerer', HT, SB, tubeSection(14.3, 14.3, 2.5), cf, 2);
    member('stem', SB, BAR, tubeSection(16, 16, 3), ALU, 2);
  }
  const mass_t = elements.reduce((s, e) => {
    const p = nodes[e.n1], q = nodes[e.n2];
    return s + (['rear_axle', 'front_axle', 'seatpost', 'stem', 'steerer', 'fork_crown', 'bb_shell'].includes(e.member) ? 0 : e.rho * e.sec.A * Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
  }, 0);
  return { nodes, elements, named, memberNodes, laminate: lam, tubeMass_g: mass_t * 1e6 };
}

/** Load cases. Forces in N, lengths in mm. `rider` = {mass_kg, crank_mm, ring, cog}. */
export function loadCases(model, rider = {}) {
  const n = model.named, m = rider.mass_kg ?? 75, W = m * 9.80665;
  const Lc = rider.crank_mm ?? 170, ringT = rider.ring ?? 50;
  const Rr = 12.7 / (2 * Math.sin(Math.PI / ringT)), zc = 43.5, zp = 150;
  const road = [[n.REAR_AXLE, 0], [n.REAR_AXLE, 1], [n.REAR_AXLE, 2], [n.REAR_AXLE, 3], [n.FRONT_AXLE, 1], [n.FRONT_AXLE, 2]];
  const F = 1100, Tc = F * Lc / Rr;
  const cases = {
    seated: {
      label: 'Seated, 1 g', note: `Rider weight ${W.toFixed(0)} N split 55 % saddle, 30 % pedals, 15 % bars. Wheels on the ground.`,
      fixed: road, loads: [[n.SADDLE, 1, -0.55 * W], [n.BB, 1, -0.30 * W], [n.BAR, 1, -0.15 * W]], ref: W,
    },
    pedalling: {
      label: 'Out-of-saddle pedalling', note: `${F} N on the drive-side pedal, crank forward and level, ${zp} mm from the centre plane (ISO 4210-6 pedalling-force magnitudes). Chain tension ${Tc.toFixed(0)} N between the ${ringT}T ring and the rear axle.`,
      fixed: road, ref: F,
      loads: [[n.BB, 1, -F], [n.BB, 3, zp * F], [n.BB, 0, -Tc], [n.BB, 4, -zc * Tc], [n.REAR_AXLE, 0, Tc], [n.REAR_AXLE, 4, zc * Tc]],
    },
    fork: {
      label: 'Rearward fork load', note: '600 N rearward at the front axle (ISO 4210-6 horizontal-force magnitude). Rear axle held.',
      fixed: road, loads: [[n.FRONT_AXLE, 0, -600]], ref: 600,
    },
    saddle: {
      label: 'Vertical saddle load', note: '1200 N down on the saddle (ISO 4210-6 vertical-force magnitude). Wheels on the ground.',
      fixed: road, loads: [[n.SADDLE, 1, -1200]], ref: 1200,
    },
    torsion: {
      label: 'Head-tube torsion', note: '100 N·m about the longitudinal axis at the head tube; rear dropouts clamped, bottom bracket propped vertically.',
      fixed: [...[0, 1, 2, 3, 4, 5].flatMap((d) => [[n.RD_L, d], [n.RD_R, d]]), [n.BB, 1]], loads: [[n.HT_BOTTOM, 3, 100000]], ref: 100,
    },
  };
  return cases;
}

/** Solve one case and summarise it. */
export function analyse(model, lc) {
  const sol = solveFrame({ nodes: model.nodes, elements: model.elements, fixed: lc.fixed, loads: lc.loads });
  const disp = (i) => [sol.u[i * 6], sol.u[i * 6 + 1], sol.u[i * 6 + 2]];
  const mag = (i) => Math.hypot(...disp(i));
  let umax = 0; for (let i = 0; i < model.nodes.length; i++) umax = Math.max(umax, mag(i));
  const byMember = {};
  sol.results.forEach((r) => {
    if (['rear_axle', 'front_axle', 'fork_crown', 'bb_shell'].includes(r.member)) return;
    const b = (byMember[r.member] ||= { vm: 0, axial: 0 });
    if (r.vm > b.vm) { b.vm = r.vm; b.axial = r.axial; }
  });
  const sumR = [0, 0, 0], sumF = [0, 0, 0];
  sol.reactions.forEach((r) => { if (r.dof < 3) sumR[r.dof] += r.value; });
  lc.loads.forEach(([, d, v]) => { if (d < 3) sumF[d] += v; });
  return { ...sol, disp, mag, umax, byMember, peak: Math.max(...Object.values(byMember).map((b) => b.vm)), equilibrium: sumR.map((r, i) => r + sumF[i]) };
}

/** Headline stiffness figures. */
export function stiffness(model, rider) {
  const lcs = loadCases(model, rider), n = model.named;
  const ped = analyse(model, lcs.pedalling), tor = analyse(model, lcs.torsion), sad = analyse(model, lcs.saddle);
  return {
    bb_N_per_mm: 1100 / ped.mag(n.BB),
    bb_lateral_mm: ped.disp(n.BB)[2],
    torsion_Nm_per_deg: 100 / Math.abs(tor.u[n.HT_BOTTOM * 6 + 3] * 180 / Math.PI),
    saddle_N_per_mm: 1200 / Math.abs(sad.disp(n.SADDLE)[1]),
  };
}
