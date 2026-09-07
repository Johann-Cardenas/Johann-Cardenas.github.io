const assert = require("node:assert/strict"),
  C = require("./course-models.js");
const coarse = C.axialBar({ segments: 2 }),
  fine = C.axialBar({ segments: 4 });
assert(coarse.converged && fine.converged);
assert(Math.abs(coarse.tip - fine.tip) < 1e-10);
assert(Math.abs(coarse.error / fine.error - 4) < 1e-8);
assert.equal(coarse.reaction, -2200);
for (let n = 1; n <= 4; n++)
  for (let degree = 0; degree <= 2 * n - 1; degree++)
    assert(C.quadrature({ points: n, degree }).error < 1e-12);
assert(C.quadrature({ points: 2, degree: 4 }).error > 0.1);
assert(!C.job({ memoryGB: 4 }).fits);
assert(C.job({ memoryGB: 64 }).fits);
assert(C.job({ processors: 8 }).time > C.job({ processors: 16 }).time);
assert.equal(C.job({ processors: 8, walltime: 2 }).serviceUnits, 16 / 60);
assert(C.renderCost({ resolution: 32, launch: 1 }).speedup < 1);
assert(C.renderCost({ resolution: 256 }).speedup > 1);
assert.equal(C.renderCost({ frames: 24 }).cpu, 24 * C.renderCost().cpu);
assert.equal(C.renderProgress(0.1, { launch: 0.2 }).gpu, 0);
assert(C.renderProgress(0.1, { launch: 0.2 }).cpu > 0);
assert.deepEqual(C.renderProgress(1000, { frames: 24 }), { cpu: 1, gpu: 1 });
for (let i = 0; i < C.tasks.length; i++) {
  const m = C.matchTask(i, C.tasks[i].fit);
  assert(m.fits && m.correct);
}
console.log(
  "PASS: bar interpolation/refinement, Gauss exactness, resource accounting, render workload scaling and 12 task matches.",
);
