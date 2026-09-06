const assert = require("node:assert/strict");
const {
  solveFE,
  cg,
  shape,
  quadB,
  scaling,
  roofline,
  interpolateError,
} = require("./models.js");
const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);
// Axial bar exact displacement (nu=0 removes clamp-induced Poisson effects).
for (const type of ["Q4", "T3"]) {
  const r = solveFE({ preset: "tension", type, density: 3, nu: 0 });
  assert.ok(r.converged);
  near(r.tip, r.reference, 1e-8);
  near(r.reactions[0], -1000, 1e-4);
  near(r.reactions[1], 0, 1e-4);
  for (const s of r.stresses) near(s.sx, 1000 / (24 * 6), 1e-5);
}
const base = solveFE({ density: 3 }),
  double = solveFE({ density: 3, load: 2000 }),
  stiff = solveFE({ density: 3, E: 140000 });
near(double.tip, 2 * base.tip, 1e-7);
near(stiff.tip, base.tip / 2, 1e-7);
near(double.maxStress, base.maxStress * 2, 1e-6);
near(base.reactions[1], 1000, 1e-4);
assert.ok(base.energy > 0);
assert.ok(base.converged);
for (const preset of ["beam", "bracket", "tension"])
  for (const type of ["Q4", "T3"]) {
    const r = solveFE({ preset, type, density: 5 });
    assert.ok(r.converged, `${preset} ${type} convergence`);
    assert.ok(r.u.every(Number.isFinite));
    near(
      r.reactions[preset === "tension" ? 0 : 1],
      preset === "tension" ? -1000 : 1000,
      0.001,
    );
  }
const coarse = solveFE({ density: 1 }),
  fine = solveFE({ density: 6 });
assert.ok(
  Math.abs(fine.tip) > Math.abs(coarse.tip),
  "bending improves with refinement",
);
for (const p of [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [0.3, -0.4],
])
  near(
    shape(...p).reduce((a, b) => a + b),
    1,
  );
near(
  quadB(
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
    0,
    0,
  ).det,
  1,
);
assert.ok(
  quadB(
    [
      [-1, -1],
      [1, -1],
      [-2, -2],
      [-1, 1],
    ],
    1,
    1,
  ).det < 0,
);
near(scaling({ processors: 1 }).speedup, 1);
near(scaling({ processors: 64, parallel: 0, overhead: 0 }).speedup, 1);
near(scaling({ processors: 8, parallel: 1, overhead: 0 }).speedup, 8);
assert.ok(scaling({ processors: 32, parallel: 0.9, overhead: 0 }).speedup < 10);
near(
  scaling({ processors: 8, parallel: 1, overhead: 0, weak: true }).speedup,
  8,
);
near(roofline({ intensity: 2, bandwidth: 200, peak: 4000 }).performance, 400);
assert.equal(
  roofline({ intensity: 30, bandwidth: 200, peak: 4000 }).bound,
  "Compute bound",
);
assert.ok(interpolateError(3, 2).error < interpolateError(3, 1).error);
assert.ok(interpolateError(6, 1).error < interpolateError(3, 1).error);
const zero = cg([new Map([[0, 1]])], new Float64Array(1));
assert.ok(zero.converged);
near(zero.x[0], 0);
console.log(
  "PASS: axial patch tests, load/modulus scaling, equilibrium, all geometries and element families, refinement, basis functions, mapping validity, CG, scaling, roofline.",
);
