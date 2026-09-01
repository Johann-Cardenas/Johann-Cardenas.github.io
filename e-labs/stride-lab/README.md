# Stride Lab

Client-side running-form and gait analysis. A short clip is decoded, pose-tracked
and measured entirely in the browser: 25 landmarks, a 14-segment whole-body
centre-of-mass model, and 40 biomechanical measurements, each with the confidence
interval that goes with it, plus a rule-based corrective plan. Nothing is
uploaded, because there is no server to upload to.

Live: `/e-labs/stride-lab/` · Method and limits: `/e-labs/stride-lab/science.html`

---

## Run it

Static files. Any web server will do:

```bash
python -m http.server 8000        # from the repository root
# then open http://localhost:8000/e-labs/stride-lab/
```

`file://` will not work — the app uses ES modules and a worker.

## Test it

```bash
npm test          # node test/run.mjs — 104 checks, no dependencies
npm run banner    # regenerate the E-Labs card image from the engine
```

The suite runs on the engine alone and needs nothing but Node 18+.

---

## Layout

```
index.html          the app
science.html        method, error budget, validation status, limitations
app.js              DOM controller — the only impure part
styles.css          workspace; science.css for the method page
sw.js               offline shell + model cache, scoped to this directory

src/engine/         PURE. No DOM, no fetch, no framework. This is the product.
  types.js            constants, anthropometry, statistics, sign conventions
  analyze.js          the pipeline, stages D-L, one pure function
  decode/mp4.js       ISO-BMFF sample table, for exact presentation timestamps
  decode/frames.js    WebCodecs, with a requestVideoFrameCallback fallback
  pose/skeleton.js    the canonical 17-landmark vocabulary + backend adapters
  pose/mediapipe.js   BlazePose backend, person selection, tracking
  pose/plausible.js   anatomical gating; is the frame fixed to the world?
  signal/filter.js    zero-phase Butterworth, Hampel, gap fill, derivatives
  signal/peaks.js     extrema, plateau onset/end, zero crossings, FFT
  signal/condition.js stage E, in the order that matters
  calib/scale.js      view, direction of travel, per-frame pixels-to-metres
  events/detect.js    six strike detectors, three toe-off detectors, a vote
  events/stage2.js    the learned model's inference path (no model ships)
  metrics/            angle series, the catalogue, per-stride computation
  metrics/com.js      14-segment centre of mass, Morin spring-mass stiffness
  scoring/            normative bands, references, dimension scores
  recommend/          rules and exercises, as reviewable data

src/ui/             browser glue: pipeline, overlay, charts, IndexedDB, format
src/synth/gait.js   the synthetic runner — test oracle and demo mode
workers/            pose inference
test/               validation suite
tools/              banner generator
```

**`src/engine/` imports nothing from the DOM or the network.** That is the load-
bearing constraint: it is what lets the whole thing be tested against signals
whose answers are known, which is the only way to know the maths is right.

---

## What it does, in one pass

Ingest and validate → frame extraction with exact timestamps → pose estimation →
person selection → signal conditioning → view and direction → per-frame scaling →
gait events → stride segmentation → measurements → scoring → recommendations.

Stages D–L are `runPipeline()` in `analyze.js`, and it is a pure function.

## Things worth knowing before changing anything

- **Sign conventions live in `metrics/angles.js` and nowhere else.** A mirrored
  coordinate frame produces angles that are all wrong and all plausible. Two
  regression tests guard it: forward lean must be positive, and a right-to-left
  clip must produce the same numbers as a left-to-right one.
- **The filter is zero-phase, and the dual-pass cutoff correction is applied.**
  `designFc = effectiveFc / (√2 − 1)^(1/4)`. Skipping it is the commonest error
  in biomechanics filtering code, and the suite checks both the correction and
  that a single causal pass really does lag.
- **Events are voted on, and the vote's statistics matter.** Read D10, D11 and
  D12 in `DECISIONS.md` before touching `events/detect.js`; three separate
  attempts at the dispersion statistic were wrong in ways that only showed up as
  "every stride discarded" or "error grows with noise".
- **Orientation is not metadata, it is pixels.** WebCodecs ignores the
  container's display matrix, so portrait clips arrive on their side and the
  pose model produces a confident, wrong skeleton. Frames are rotated before
  inference. `tkhd`'s matrix starts at byte 40 (52 for version 1) — reading it
  four bytes early makes every video look unrotated, which is D30.
- **Refuse rather than approximate.** Three capture conditions produce numbers
  that are meaningless rather than imprecise, and each is detected: a camera
  that is not square to the plane of motion, a runner who does not travel
  across the frame, and a limb the model hallucinated. See D32-D34.
- **Confidence is not decoration.** A metric below medium confidence is never
  scored and no rule may fire on it. Timing metrics are suppressed outright below
  60 fps rather than shown with a ±14% interval.
- **Normative bands are data.** `scoring/norms.js` is meant to be read and
  argued with by somebody who does not read JavaScript.
- **The evidence is thinner than the dashboard looks.** Van Hooren et al. (2024)
  found only four of these variables significantly associated with running
  economy — centre-of-mass oscillation, vertical and leg stiffness, and cadence —
  and technique in total explains 4-12% of the differences between people. Bands
  that overclaimed were corrected against it; do not reintroduce one.

## Claims

It is not a medical device, it does not predict injury, it is not lab-grade, it
measures no forces, and it has not been validated against force plates or motion
capture. `science.html` says all of that at length, publishes the only accuracy
figures that were actually measured (against synthetic ground truth, labelled as
such), and carries a limitations section written to be one a biomechanist would
not object to.

## Origin

Built to a detailed external specification. `DECISIONS.md` records every
deliberate deviation from it and why — including the places where following it
literally produced measurably wrong results.
