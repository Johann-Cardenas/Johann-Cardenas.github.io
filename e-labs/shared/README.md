# Interactive engineering labs

Finite-Elemented and Frontier share a Three.js viewport and accessible laboratory shell. Numerical models are independent of rendering and can be exercised with Node.

## Run locally

Serve the repository root with a static HTTP server and open `/e-labs/finite-elemented/` or `/e-labs/frontier/`. There is no application build step or network dependency. Opening HTML directly with `file://` is not the supported workflow for Web Workers.

- `models.js`: independently implemented T3/Q4 plane-stress assembly, Jacobi-preconditioned CG, stress recovery, reactions, interpolation, scaling, and roofline models.
- `solver-worker.js`: numerical solves and six-mesh convergence studies outside the UI thread.
- `scene.js`: shared Three.js geometry, result fields, inspection, orbit/zoom, camera transitions, lifecycle, and reduced motion.
- `curriculum.js`: 14 finite-element lessons and 9 computing lessons, each with an experiment, assumptions, prediction, and explanatory feedback.
- `app.js` / `lab.css`: responsive laboratory interface, charts, accessible controls, exports, and local progress.
- `../../assets/js/e-labs-lab-previews.js`: visibility-gated miniatures using these same models and scene builders.

The repository's existing local Three.js build is reused. No React migration, CDN dependency, or asset from Model X Studio is required.

## Verification

```text
node e-labs/shared/models.test.cjs
node e-labs/shared/browser.test.cjs <path-to-playwright-module> [artifact-directory]
```

Browser checks currently launch the installed Windows Chrome executable. Adjust `executablePath` for another environment. Playwright is test tooling only; the applications do not require it. Tests cover all lessons, structural edge cases, mesh convergence, feedback, export, job timeout, mobile overflow, reduced motion, WebGL unavailability, and both catalog miniatures. Screenshots are written outside the repository by default.

To regenerate the two static entry pages and catalog script references:

```text
node scripts/build-learning-labs.mjs
```

To refresh both poster fallbacks from the actual Three.js scenes, append `--posters` to the browser test command (after an explicit artifact-directory argument). This writes `images/e-labs/E-Labs_Finite-Elemented.png` and `E-Labs_Frontier.png` at 1310 × 790. The older software-rendered Finite-Elemented banner script predates this rebuild.

## Numerical scope

The structural solver uses N, mm, and MPa; thickness 6 mm; Poisson ratio 0.3; fully fixed left edge; consistent right-edge traction loads; constant-strain T3 or fully integrated Q4 elements. Display extrusion adds no physical degrees of freedom. Element-center stresses are unsmoothed. The static solver, analytical modal shapes, exact steady conduction profile, and interpolation experiment are explicitly distinguished in the UI.

HPC results are transparent teaching predictions. They are not benchmarks of the ORNL Frontier system. Scaling, GPU overhead, memory latency, communication, scheduling, and power assumptions are stated beside their results.

See [the visualization framework review](../../docs/e-labs-visualization-review.md) for Model X Studio findings and priorities for the rest of E-Labs.
