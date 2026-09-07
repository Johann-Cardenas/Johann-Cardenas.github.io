# Interactive engineering labs

Finite-Elemented and Frontier share a Three.js viewport and accessible laboratory shell. Numerical models are independent of rendering and can be exercised with Node.

## Run locally

Serve the repository root with a static HTTP server and open `/e-labs/finite-elemented/` or `/e-labs/frontier/`. There is no application build step or network dependency. Opening HTML directly with `file://` is not the supported workflow for Web Workers.

- `models.js`: independently implemented T3/Q4 plane-stress assembly, Jacobi-preconditioned CG, stress recovery, reactions, interpolation, scaling, and roofline models.
- `solver-worker.js`: numerical solves and six-mesh convergence studies outside the UI thread.
- `scene.js`: shared Three.js geometry, result fields, inspection, orbit/zoom, camera transitions, lifecycle, and reduced motion.
- `curriculum.js` / `courses.js`: 22 finite-element and 19 computing lessons in four courses per app, with concise introductions, lesson-specific vocabulary, experiments, and knowledge checks.
- `guide.js` / `course.css`: Understand → Experiment → Explain → Check progression, a searchable starting dashboard, persistent desktop module navigation, mobile overview access, optional advanced controls, and saved lesson resume. Completed predictions from the previous version remain available.
- `course-models.js` / `scene-concepts.js`: one-dimensional bar assembly, quadrature, resource matching, job accounting, hardware layouts, serial/parallel task queues, and CPU/GPU image and frame-sequence models.
- `app.js` / `lab.css`: numerical integration, charts, accessible controls, exports, and local progress.
- `site-palette.css`: generated from the website’s light and dark CSS tokens. The labs use the same `theme-preference` setting and theme button as the site; scene backgrounds and labels follow it too.
- `../../assets/js/e-labs-lab-previews.js`: visibility-gated miniatures using these same models and scene builders.

The repository's existing local Three.js build is reused. No React migration, CDN dependency, or asset from Model X Studio is required.

## Verification

```text
node e-labs/shared/models.test.cjs
node e-labs/shared/course-models.test.cjs
node e-labs/shared/course.test.cjs <path-to-playwright-module>
node e-labs/shared/progress.test.cjs <path-to-playwright-module>
```

Browser checks currently launch the installed Windows Chrome executable. Adjust `executablePath` for another environment. Playwright is test tooling only; the applications do not require it. Tests cover all 41 lessons, step visibility, course navigation, quizzes, theme persistence, resume, mesh convergence, exports, job completion/timeout/insufficient memory/cancellation, rendering races, mobile layout, reduced motion, blocked storage, WebGL fallback, and both catalog miniatures. Screenshots are written to the system temporary directory. `browser.test.cjs` delegates to this suite by default and retains the `--shape-only` and `--posters` artifact modes.

To regenerate the two static entry pages and catalog script references:

```text
node scripts/build-learning-labs.mjs
```

To refresh both poster fallbacks from the actual Three.js scenes, run `node e-labs/shared/browser.test.cjs <path-to-playwright-module> <artifact-directory> --posters`. This writes `images/e-labs/E-Labs_Finite-Elemented.png` and `E-Labs_Frontier.png` at 1310 × 790. The older software-rendered Finite-Elemented banner script predates this rebuild.

## Numerical scope

The structural solver uses N, mm, and MPa; thickness 6 mm; Poisson ratio 0.3; fully fixed left edge; consistent right-edge traction loads; constant-strain T3 or fully integrated Q4 elements. Display extrusion adds no physical degrees of freedom. Element-center stresses are unsmoothed. The static solver, analytical modal shapes, exact steady conduction profile, and interpolation experiment are explicitly distinguished in the UI.

HPC results are transparent teaching predictions. They are not benchmarks of the ORNL Frontier system. Scaling, GPU overhead, memory latency, communication, scheduling, and power assumptions are stated beside their results.

The restored rightsizing deck contains 12 explicit workload configurations. Laptop, workstation, and cluster are illustrative capacities; tasks assigned to a cluster explicitly assume distributed software or independent ensembles. The five-stage workflow models one CPU-node request, memory fit, runtime limits, and allocated core-hours. Image races use equal pixel workloads and disclosed synthetic rates, with accelerated playback for long frame sequences. Geometry examples for beams, shells, and solids do not claim additional solver implementations; locking and hourglassing remain conceptual lessons.

See [the restoration map](../../docs/e-labs-course-restoration.md) for the original concepts and their current course locations.

See [the visualization framework review](../../docs/e-labs-visualization-review.md) for Model X Studio findings and priorities for the rest of E-Labs.

The course overview opens on an unfragmented URL or `#overview`; lesson fragments remain directly shareable. Module cards expose outcomes, suggested preparation, lesson previews, experiments, and completion counts. Each module also includes a worked example and reflection in the Explain step. Typography uses the same self-hosted Inter Variable font as the website, with 17 px explanatory text and a 14 px minimum for secondary course labels.

## Reading and progress

Both apps open on the overview when launched without a lesson fragment; unknown fragments also return to the overview. Valid lesson links remain shareable. The overview does not mark a lesson started. Opening a lesson records its visited steps and last step; only a correct knowledge-check answer marks it completed. Overview filters, module counts, the lesson progress strip, and sidebar status labels reflect these separate states.

`elabs-activity-fea` / `elabs-activity-hpc` store per-lesson activity. Existing `elabs-v2-*` completion records and `elabs-course-*` resume records are retained. Storage failures keep the app usable and show a session-only notice. Progress is local to the browser, not synchronized between devices.

The type scale uses relative units, 17 px body text, 16 px primary controls, and at least 14 px secondary text at standard size. The Larger text button increases relative text by 12.5% and persists across both apps. Charts retain readable labels with keyboard-accessible horizontal scrolling in narrow panels. Large-text and mobile layouts give content additional width instead of shrinking text.
