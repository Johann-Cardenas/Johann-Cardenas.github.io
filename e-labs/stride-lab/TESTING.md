# StrideLab release protocol

Do not release with failing checks. A passing synthetic suite alone is not a
browser or real-video validation. The real-video checks must execute inference;
they must not substitute prerecorded keypoints for the treadmill analysis.

## Setup

Use Node 22+, an installed Google Chrome, and the Playwright Firefox build:

```sh
npm ci
npx playwright install firefox
```

Chrome and Firefox run by default, one worker at a time. Real inference fetches
the pinned MediaPipe runtime and heavy pose model from their published URLs.
Video, frames and landmarks stay local. The test server binds to 127.0.0.1,
serves the repository and supports byte-range video requests.

## Release gate

```sh
npm run test:release
npm run benchmark:model
git diff --check
```

`test:release` stops if the engine suite fails, then runs both browser projects.
Retries are disabled. Assertions, application errors and retained failure traces
must be reviewed; a failed check must not be converted to a skip to obtain a
green result. Fix a demonstrated defect and repeat the affected checks, followed
by the complete release gate for changes to shared paths.

The engine suite covers synthetic ground truth, clean golden values, noise,
mirroring, confidence suppression, missing data, temporal reconstruction,
malformed timestamps and buffers, parser corruption and bounded random inputs.
The paired model benchmark covers 60 synthetic clips across frame rates,
cadences, seeds and noise levels. It is not real-world biomechanical validation.
It fails on missing/non-finite trajectory support, changed clean results or
aggregate knee-error regression beyond its stated 1% plus 0.01° tolerance.

## Browser matrix

Each browser executes six scenarios:

1. Synthetic runner through the normal UI: scored values, initial unavailable
   state, deterministic backward seeking, six theme/viewport combinations and
   storage of the per-cycle measurements.
2. The complete shipped treadmill analysis on the default GPU preference,
   including the supported CPU fallback. Check true model provenance, portrait
   orientation, approximately 30 fps, cadence plausibility, confidence gates,
   playback, all analysis panels, CSV export and reopening the saved video.
3. The same treadmill window with CPU inference explicitly selected in the UI.
4. Playback decoder on the real clip with an intentionally slow 45 ms consumer:
   frame retention, timestamp monotonicity, portrait orientation, cancellation
   and propagation of a thrown consumer error. Compare a 16×16 first-frame
   pixel fingerprint with the independently rotated WebCodecs output to catch
   a sideways or stretched image even when dimensions look correct.
5. Inject a worker failure, verify it terminates and reports the error, then run
   a successful synthetic analysis in the same page.
6. On the real video, stop presented-frame callbacks and throw from one draw.
   Verify that the independent animation clock continues updating and stops at
   the analyzed boundary without an uncaught page error.

The real-inference cases exercise both 0.5× and 1× playback before and after
repeated history reopening. Sample the displayed overlay timestamp on animation
frames: require more than ten distinct poses over 1.8 seconds, less than 200 ms
media-time mismatch and no pose held for 350 ms. Check the visible scores against
direct engine evaluation at the displayed frame, including unavailable values.
Stable-size playback must reuse its canvas backing buffer, with at most one
resize/reset during each sampled interval. Paused-clock unit cases verify exact
presentation retention and retry of failed draws at the original seek target.
Verify stopping at the analyzed endpoint and restarting from the beginning.
Inject a one-time failure in the real overlay canvas's stroke operation; verify
that the canvas state resets and later poses render without an uncaught error.
These are explicit test budgets, not a guarantee against a browser or operating
system suspending execution.

The treadmill clip is `demo/treadmill-30fps.mp4`, analyzed over 0.5–12.5 seconds
with the catalog's supplied height, mass and belt speed. Cadence is checked
against a broad empirical 170–200 spm envelope, not treated as ground truth.
Ground contact time must remain unavailable at this frame rate. Low-confidence
scores must remain unavailable; never force a score to make a demo look better.

Screenshots cover dark and light themes at 1440×1000, 768×1024 and 390×844.
Review the video/overlay alignment, score cards, controls and chart rendering.
Automated checks reject page overflow, missing score cards, canvas/video
geometry mismatches, uncaught page errors and unexpected write requests,
but do not replace visual inspection. Browser artifacts include the
actual analysis record for reviewing warnings, confidence and measurements.

## Reports and focused checks

```sh
npm run test:browser -- --project=chrome
npm run test:browser -- --project=firefox
npm run test:smoke
npx playwright show-report
```

Reports and screenshots live under ignored `playwright-report/` and
`test-results/` directories. Failure traces record the failed action, page state
and requests. Use `npx playwright show-trace <trace.zip>` to inspect one.
`STRIDE_BROWSER_CHANNEL=msedge` substitutes Edge for the Chrome project.

The CI workflow runs the engine suite and browser smoke scenarios on Chrome and
Firefox. It deliberately does not claim real-inference performance on a shared
software-rendered runner; the full real-video release gate must also be run on
a graphics-capable development machine before release.

## Rendering caveats and unresolved validation

The occluded treadmill fixture yields different accepted-cycle counts across
heavy/full and CPU/GPU (observed: 1–9). A fixed three-cycle quota was therefore
an invalid quality assertion. The release test requires valid cycle evidence,
cadence within 170–200 spm, low confidence, and withheld movement scores across
the entire clip; synthetic truth tests separately require numerical scores.

Software WebGL must not be mistaken for a hardware neural accelerator. A forced
SwiftShader experiment processed roughly 0.3 fps and hit the test timeout. The
engine now detects known software renderers and selects CPU inference, retaining
WebGL for image conversion. A browser with WebGL entirely disabled cannot run
the pinned pose runtime's image conversion and reports that requirement clearly.
`STRIDE_SOFTWARE_GL=1` is available for this diagnostic, not a way to accelerate
the release suite. Native GPU timing and software-rendered timing are separate
observations.

Responsive desktop tests are not tests on a physical phone. Safari/iOS and
independent motion-capture or force-plate validation remain outside this matrix.
Passing these checks does not prove the absence of every defect or establish
clinical accuracy.
