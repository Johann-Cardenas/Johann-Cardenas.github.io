# Stride Lab — Decisions

Every deliberate deviation from the build specification, plus the decisions the
spec left open, plus the bugs whose fixes changed a design. Each entry states
what was decided and why, so a later maintainer can overturn it on the merits
rather than guessing.

---

## D1. The stack is the site's stack, not Astro + React + Tailwind

**Decision.** Vanilla ES modules, no bundler, no framework, no build step —
matching Gear3D, LEAPS, QR Studio and Cross-Section Studio.

**Why.** The spec asks for Astro 5, React 19 and Tailwind v4. This app lives
inside a Jekyll site that GitHub Pages builds itself; there is no Node step in
the deploy, and introducing one would mean restructuring the deployment of the
whole site for one app. Every other E-Labs app is a standalone SPA of plain
modules, and consistency across them is worth more here than any framework
would be. The spec's real requirement — marketing pages ship no JavaScript, the
analyser is one contained island — is satisfied trivially: the analyser is a
separate page and nothing else on the site loads any of it.

**What was kept.** The architectural point the framework choice was serving:
`src/engine/` imports nothing from the DOM, no browser API and no UI code. It
takes typed arrays in and returns results, which is what makes it testable
against synthetic signals, which is the only way to know the maths is right.

---

## D2. The multi-page IA became one workbench with views

**Decision.** The spec's routes (`/analyze`, `/history`, `/compare`,
`/exercises`, `/runners`, `/professionals`, `/retailers`, `/about`, `/blog`)
collapse into one app page plus a `science.html`, with history, comparison and
the exercise library as dock panes and metric sheets.

**Why.** The marketing routes describe a company. This is one tool in a personal
academic site that already has its own home page, blog and about page; adding
`/retailers` would be describing a business that does not exist. The functional
routes are real and are all present — they are panes rather than pages because
the app is a single workbench in the same shape as LEAPS, and because a runner
comparing two analyses wants them beside the player, not on another page.

**What was dropped outright, and why it is honest to drop it.** Team dashboards
and cloud sync: the spec itself marks these as not viable on a static host. They
are not faked. Export and import of a signed bundle is offered instead, and the
history pane says plainly that history lives in one browser on one device.

---

## D3. Charts are purpose-built Canvas, not uPlot, visx or Plotly

**Decision.** About 300 lines of Canvas 2D in `src/ui/charts.js`.

**Why.** Three reasons, all binding. The app must work with the network off
after one visit, and a plotting library from a CDN does not. Every chart must be
readable at 360 px and must have a table alternative, which is easier to
guarantee when the rendering is ours. And the figure this app actually needs —
a mean joint-angle curve with a ±1 SD band across strides, normalised to the
gait cycle, with the stance fraction shaded — is thirty lines of canvas and an
awkward fit for a general-purpose library. LEAPS uses Plotly from a CDN; that
was considered for consistency and rejected on the offline requirement.

---

## D4. The MP4 demuxer is ours

**Decision.** `src/engine/decode/mp4.js` parses ISO-BMFF directly rather than
depending on mp4box.js.

**Why.** Every timing measurement in this app is a difference between two
presentation timestamps, so the timestamps are not a detail to delegate. It is
also one fewer cross-origin script, which matters when the headline claim is
that nothing leaves the device. The subset needed is small; the parts that are
NOT small are detected and refused rather than guessed at — fragmented MP4,
non-trivial edit lists and anything that is not ISO-BMFF fall through to the
`requestVideoFrameCallback` path, which is marked `timingConfidence: 'reduced'`
in the analysis metadata.

`ctts` is parsed. With B-frames the decode order is not the display order, and
using decode time as presentation time silently reorders the video.

---

## D5. Trunk lean is reported positive-forward, contradicting the spec's formula

**Decision.** `trunkLean = -signedAngle(vertical, hipMid → shoulderMid)`.

**Why.** The spec's metric table gives `signedAngle(vertical, hipMid →
shoulderMid)`, and its own regression test (§13.2) requires a forward lean to
produce a POSITIVE value. In a frame where +x is the direction of travel those
two requirements are opposite: a forward lean rotates the trunk vector
clockwise, so the expression is negative. The report follows the regression
test, because "positive means leaning forward" is what a reader assumes. The
negation is applied once, in `metrics/angles.js`, and the test asserts it in
both directions of travel.

---

## D6. The strike-pattern-independent detector M0 was added

**Decision.** A sixth foot-strike detector, weight 1.3, keyed on the lower of
heel and toe reaching the ground.

**Why.** This is the most consequential change made to the specified design, and
it was made because the specified design demonstrably failed. The spec lists
five detectors of which two (M1, M2) are heel-based — and those two are not
independent of each other, they are the same landmark seen through position and
through its derivative. Together they outweigh everything else. On a forefoot
striker the heel does not reach the ground until roughly 70 ms after the foot
does, so a vote dominated by heel evidence places every forefoot contact 70 ms
late and shortens every measured contact time by the same amount.

Measured on the synthetic forefoot runner before M0 existed: **72 ms** mean
absolute error, against 6 ms for the rearfoot runner. After: 4 ms and 0.1 ms.
That is a bias applied to one population and not the other, falling exactly on
the distinction the product exists to measure — which is the failure mode the
spec's own §5.8 warns about, arrived at through the detector set it specifies.

Contact is the moment any part of the foot arrives. Tracking the lower of heel
and toe makes that literal, and which of the two it turns out to be is the
strike pattern itself.

---

## D7. Plateau onset, not the minimum

**Decision.** The position-based detectors (M0, M1, M3, M4) take the ONSET of
the flat region, not the extremum `localMinima` reports.

**Why.** A foot on the ground does not trace a sharp minimum in heel height. It
descends, arrives, and then dwells for most of stance. A naive "minimum of
heel_y" fires at the far end of that plateau — tens of milliseconds after
contact, which at 240 fps is many frame periods and is a systematic bias, not
noise, so averaging more strides does not remove it. Measured before the fix:
every strike 71 ms late on the synthetic runner.

The same argument in reverse gives `plateauEnd` for toe-off.

---

## D8. Toe-off is searched inside the stance window, not detected independently

**Decision.** Foot strikes are detected first; each toe-off is then voted for
only within `[strike + 100 ms, strike + 400 ms]`.

**Why.** The knee reaches full extension twice per stride — once approaching
toe-off and again in terminal swing — and on a real trajectory the two peaks are
the same height. No amount of prominence ranking separates them, and the
detector was picking the terminal-swing peak roughly half the time. Restricting
the search to the plausible stance duration removes the wrong peak by
construction. This is not circular: toe-off is *defined* relative to a strike,
and the window is the sanity constraint the spec already states.

---

## D9. Direction of travel comes from foot orientation, not body velocity

**Decision.** The toe is in front of the heel; the median of `toe.x - heel.x`
gives the direction. Hip velocity is computed as a cross-check only.

**Why.** Hip velocity is zero on a treadmill by construction. Foot velocity
fails too, and less obviously: on a treadmill the planted foot travels backwards
at belt speed for two thirds of the cycle while the swing lasts about a tenth of
a second, so once the trajectories are low-pass filtered the sustained backward
stance velocity is LARGER in magnitude than the brief forward swing peak, and
"whichever way the foot moves fastest" points backwards. That produced a
mirrored analysis frame in which every angle was reflected and still looked
plausible. Foot orientation is an anatomical invariant, available on every
frame, and independent of the surface.

---

## D10. The confidence gate is on the standard error, not the spread

**Decision.** Each event carries three numbers — `rangeMs` (max − min),
`spreadMs` (weighted SD about the voted time) and `sigmaMs` (the standard error
of the weighted mean, via Kish's effective sample size). The low-confidence gate
and the error budget use `sigmaMs`.

**Why.** The spec says to record the inter-method spread and to mark a stride
low-confidence when it exceeds 25 ms, using the range. The range grows with the
number of methods that voted: on noiseless synthetic gait at 240 fps, three
methods agreeing to within a frame or two already produce a ~29 ms range, and
**every stride in a perfect clip was being discarded**.

Switching to a weighted SD fixed that and left a subtler version of the same
perverse incentive. A midfoot strike is seen by five detectors instead of three,
because heel and toe arrive together; they disagree by slightly more, the SD
crossed the limit, and 16 of 17 strides were thrown away — better evidence
producing a worse answer. The standard error is the quantity the gate actually
wants: how well the consensus is determined, which correctly falls as more
independent estimates agree. All three numbers are retained because they answer
different questions and the diagnostics show the spread.

---

## D11. Cluster seeding is mode-seeking

**Decision.** A cluster is seeded on the candidate with the heaviest
neighbourhood, not on the heaviest candidate.

**Why.** Seeding on "the heaviest, earliest" meant that when noise scattered
several candidates of one method across the window, the earliest of them
anchored the cluster and dragged the event early. The bias therefore grew with
noise, which is backwards for something meant to be robust: measured contact
time fell from 216 ms to 191 ms as landmark noise rose from zero to 0.8% of leg
length, against a truth of 215 ms. Asking which candidate has the most agreement
around it does not depend on ordering at all.

---

## D12. The event time is a weighted median THEN a weighted mean

**Decision.** The weighted median locates the cluster; the weighted mean of the
members within a window around it gives the reported time.

**Why.** The spec asks for a weighted circular median. The median's breakdown
point is what makes a detector firing in the wrong place harmless, and that is
worth keeping. But once the outliers are gone the median throws away most of the
information — with three methods it reports one of them and ignores the other
two. Taking the mean of the survivors reduced foot-strike error from about 15 ms
to about 8 ms on the synthetic runner at 240 fps. ("Circular" is dropped: these
are linear times, not phases.)

---

## D13. M4 measures the foot settling to its STANCE velocity, not to zero

**Decision.** M4 looks for the plateau in `|foot.vx − stanceVx|`, where
`stanceVx` is estimated from the data.

**Why.** The spec describes M4 as "local minimum of foot horizontal velocity
magnitude". On a treadmill the planted foot travels backwards at belt speed for
the whole of stance, so a detector looking for a stationary foot finds nothing
at all. What is invariant across surfaces is that stance velocity is CONSTANT,
whatever its value. `stanceVx` is the median of the slower half of the foot's
own velocity distribution, which stance dominates — zero overground, minus the
belt speed on a treadmill, without being told which.

---

## D14. N2 is the toe starting to rise, not peak swing height

**Decision.** N2 is the upward zero crossing of toe vertical velocity inside the
stance window, or the end of the toe's ground plateau.

**Why.** The spec words N2 as "local maximum of toe_y after the stance minimum".
Read literally that is peak SWING height, roughly 150 ms after the foot has left
the ground, and it would drag every toe-off late and corrupt the vote.
`TODO(spec)` marks this in the source.

---

## D15. No learned gait-phase model ships

**Decision.** The geometric detector ships alone. The complete stage-2 inference
and fusion path is implemented and exercised by the test suite with a synthetic
"perfect model", but no `.onnx` file is included, and results record
`stage2: 'not-shipped'`.

**Why.** Training Model A honestly needs running video with force-plate or
instrumented-treadmill ground truth, split by subject rather than by clip. None
was available. The spec's own instruction covers this case: "If they are not
better than the geometric baseline, ship the geometric baseline and say so."
Shipping a model trained on nothing, or quoting FootNet's published accuracy as
though it were ours, were the dishonest alternatives.

What was rejected outright, per the spec and independently on the merits: a
black-box model emitting a "running form score". No labelled ground truth for
good form exists, the output would be unauditable, and explainability is the
entire product.

---

## D16. Four dimension scores, no single number

**Decision.** No overall score out of 100 exists anywhere in the result object,
and a test asserts its absence.

**Why.** The spec argues for this and it is right. Compressing independent,
non-commensurable dimensions into one figure invites comparison between people
that the measurement cannot support, and it cannot be explained when somebody
asks why it moved. Open question 2 in the spec offers the human an override; if
one is wanted, add it beside the dimension breakdown rather than instead of it.

---

## D17. Most normative bands cite "no primary source traced", and say so

**Decision.** `references.js` carries an explicit `indicative-unsourced` entry.
Bands taken from the spec's Appendix B cite it, are forced to
`strength: 'consensus-only'`, and are weighted lowest in scoring. A test asserts
that no unsourced band claims a higher strength.

**Why.** Appendix B supplies a table of literature-typical ranges and then says,
in the same breath, that they must not ship without citations. Attaching a
plausible-looking paper to a number that did not come from it would have been
worse than shipping nothing. This is uncomfortable to display and it is the
honest thing to display. Replacing these with sourced, speed- and
sex-conditional bands is the single highest-value improvement available.

---

## D18. Model weights load from a CDN; nothing is uploaded

**Decision.** MediaPipe Tasks Vision and the `.task` weights are fetched from
jsDelivr and Google's model storage on first analysis, then cached by the
service worker forever.

**Why.** The spec asks for self-hosting. The two model files are roughly 9 MB
and 29 MB; this is a personal academic site's repository and GitHub Pages does
not serve Git LFS, so they would be committed as ordinary blobs. The claim that
matters — no video, no frame and no landmark ever leaves the device — is
unaffected and remains literally true: these are downloads TO the device.
Self-hosting is still the better end state and the `modelBase` option exists to
switch to it in one line.

**Consequence accepted.** The very first analysis needs a network connection.
Every subsequent one does not, including with the network off.

---

## D19. Cross-origin isolation is not forced

**Decision.** No COOP/COEP service-worker shim. The single-threaded WASM build
with the GPU delegate is used.

**Why.** `coi-serviceworker` works by registering a worker that reloads the page
once on first visit. On a personal site where this app is one page among many,
an unexplained reload is a poor trade for a ~2x inference speedup on a six-second
clip that is already backgrounded with a progress bar and a live skeleton. The
GPU delegate does not need `SharedArrayBuffer`. `crossOriginIsolated` is recorded
in the analysis metadata either way, so a user report can be interpreted.

---

## D20. The service worker bypasses the HTTP cache on install

**Decision.** `install` fetches every shell file with `cache: 'reload'`.

**Why.** Found the hard way. `cache.add()` and a plain `fetch` both consult the
HTTP cache first, so a worker installing right after a deploy bakes in the
PREVIOUS build's file and then serves it as current — and because the worker is
now the thing answering, the stale copy survives every subsequent reload. It
cost an hour of debugging a stylesheet that was correct on disk, correct over
the wire, and wrong in the browser. Registration is additionally skipped on
localhost, because a worker that serves the shell from cache is exactly right in
production and exactly wrong while editing the files it cached.

---

## D21. `.sl-app [hidden] { display: none !important }`

**Decision.** One global rule inside the app's scope.

**Why.** The `hidden` attribute is only a `display: none` in the UA stylesheet,
so any later display rule silently defeats it — and most of the elements this app
toggles are flex or grid containers. Without the rule every wizard stage, the
metric sheet and the toast all render on top of each other. Stating it once beats
remembering it at a dozen call sites.

---

## D22. Exercises ship without media

**Decision.** Text, cues, dosage and contraindications; no video or photography.

**Why.** Appendix C specifies media files. Demonstration media has to be shot or
licensed, and taking somebody else's is not an option. The cues are what actually
determine whether a movement is done well, and the app says plainly that media is
not included rather than shipping broken `<video>` tags.

---

## D23. The synthetic runner's pelvis follows physics, not a sinusoid

**Decision.** A half-sine dip through contact and an exact free-fall parabola
through flight, matched for velocity continuity, then rescaled to the prescribed
amplitude.

**Why.** A cosine at step frequency puts its lowest point at foot strike and its
most negative velocity a quarter period earlier. Both are wrong, and wrong in a
way that would have quietly rewarded the pelvis-based contact detector (M5) for
agreeing with an artefact. What actually happens: the body is in free fall
through flight, so the pelvis arrives at contact with its most negative vertical
velocity, and the ground reaction force then reverses it, so the lowest point is
at mid-stance. A test oracle that gets its own physics wrong validates nothing.

Likewise `STANCE_ALIGN_FRACTION = 0.30`: the hip passes over the planted foot
about a third of the way through stance, not half way. At half way the foot lands
0.41 m ahead at 3 m/s, a quarter of standing height, which no runner does — and
every overstride and shank-angle assertion would have been calibrated against a
runner nobody resembles.

---

## D24. The banner and the card animation are drawn from the engine

**Decision.** `tools/make-banner.mjs` renders the E-Labs card image from real
frames of the synthetic runner and real detected events, through a small
software rasteriser and Node's zlib.

**Why.** A picture whose claim is "this is what the app computes" should break
when the app breaks. It also avoids adding an image dependency for one asset.
The card's hover animation in `assets/js/e-labs-canvas.js` is a self-contained
closed-form model rather than a port of the engine, because that file is shared
by six other cards and stays dependency-free.

---

## D25. The tracked skeleton went from 17 landmarks to 25

**Decision.** Ears, eyes, a hand centroid per side and a lateral forefoot per
side were added to the canonical vocabulary, plus four derived points (pelvis,
neck, head centre, mid-trunk).

**Why.** Everything except the lateral forefoot was already in the pose model's
output and was being discarded. BlazePose returns 33 landmarks; the engine was
using 17. The ears in particular are not decoration: Winter places the
head-and-neck centre of mass at the ear canal, so they are the structural
landmark for the head segment, and they survive a profile view — which is the
view most of this app runs in — far better than the eyes or the nose. The hand
centroid is the mean of the three finger landmarks, which distinguishes a hand
crossing the midline from a forearm that has merely rotated.

The lateral forefoot is the exception: BlazePose does not have one. It is in the
vocabulary anyway, because it turns each foot from a LINE into a PLANE, which is
what a foot progression angle needs. With the default backend the metric that
needs it reports itself unavailable and names the missing landmark. That is the
honest way for a backend difference to surface, and it is why the adapter exists.

---

## D26. A fourteen-segment centre-of-mass model was added

**Decision.** Winter's segment inertial parameters, mass-weighted over fourteen
segments, giving a whole-body centre of mass per frame. Its vertical oscillation
is reported alongside — not instead of — the pelvis measurement.

**Why.** This was prompted by reading Van Hooren et al. (2024), which pooled the
observational literature on running biomechanics and running economy. Vertical
oscillation of the centre of mass is the single strongest association it found
(r = 0.35, moderate). Most video tools, including this one until now, report the
vertical movement of a hip landmark and call it vertical oscillation. It is not
the same quantity: the swinging limbs move opposite to the trunk and partly
cancel its rise and fall. On the synthetic runner the centre of mass moves
7.4 cm against the pelvis's 8.5 cm, and a test now asserts that ordering — if it
ever inverts, the model is wrong.

Since the best-evidenced variable in the app is this one, it was worth measuring
the thing rather than a proxy for it. Both are reported and the pelvis one says
which it is.

A lost hand does not delete 0.6% of body mass and drag the centre of mass
towards the feet: segment masses are renormalised over what is available, and a
missing distal landmark falls back to the next joint up.

---

## D27. Vertical and leg stiffness, from a spring-mass model

**Decision.** Morin et al. (2005), which estimates both from contact time,
flight time, body mass, running speed and leg length.

**Why.** The second and third strongest associations in the same meta-analysis
(r = −0.31 and −0.28, both moderate), and every input was already being
measured. It converts timings the app was already producing into the variables
the evidence actually cares about.

**Two constraints that come with it.** The model's peak-force term is an output
of a sine-wave approximation to the force trace, not a measurement, and it is
never reported as one — the specification is explicit that force cannot come
from video, and this is exactly the place where a careless implementation would
imply otherwise. And stiffness is withheld entirely unless body mass is entered:
substituting a population average for somebody's own mass would be inventing the
answer, so the measurement says what it needs instead of appearing.

---

## D28. Bands were corrected against the evidence, including one that was wrong

**Decision.** Duty factor's band no longer describes it as well evidenced;
ground contact time carries the same correction; cadence's direction now cites a
real source; centre-of-mass oscillation and both stiffness terms are the only
bands in the app rated `moderate`.

**Why.** This app shipped a band comment reading "Duty factor is one of the
better-evidenced technique correlates of running economy", rated `moderate`,
citing Moore 2016. The 2024 meta-analysis pools the literature and finds duty
factor's association with running economy TRIVIAL and non-significant
(r = −0.06), and ground contact time likewise (r = −0.02). So does it find for
foot-strike pattern, knee flexion, trunk lean, shank angle at contact, stride
length and braking — a large share of what this app displays.

That was an overclaim of exactly the kind the specification forbids, made in
good faith from a narrower source, and it was live. It is corrected, a test now
asserts the correction, and the reasoning is on the science page rather than
buried here.

**The number that should be hardest to ignore**, and which is now on the science
page in a callout: taken in isolation, these technique variables explain 4–12%
of the differences in running economy between people. Nearly everything that
makes one runner more economical than another is not visible in a video of their
technique. A tool of this kind that leaves the opposite impression has misled its
user, and a dashboard is very good at leaving that impression.

---

## D29. The RTMPose Halpe-26 backend is prepared but not shipped

**Decision.** The keypoint map, the adapter, the coverage reporting and the one
metric that needs it are all in place. No ONNX model is bundled and no second
backend runs.

**Why, having looked into it.** RTMPose-s on Halpe-26 is about 23 MB and
RTMPose-m about 56 MB, and both are top-down models: they need a person detector
in front of them, so a second model and a two-stage pipeline as well. The public
ONNX exports live in third-party accounts on model-hosting sites rather than on
a CDN with any stability guarantee. Against that, what it actually buys over
BlazePose is the lateral forefoot — one landmark, enabling one metric.

The alternative, done instead, was to stop discarding the landmarks the model
already loaded was producing and to build the segment model on top of them. That
took the tracked set from 17 to 25 and added the three best-evidenced variables
in the app, for no download, no compatibility risk and no second inference pass.
Given a fixed amount of effort that was the better trade, and it is the one the
evidence pointed at.

The door is deliberately left open: `PoseBackend`, the Halpe-26 map and
`backendCoverage()` all exist and are tested, so adding the backend is an
implementation of one interface rather than a redesign.

---

## Open questions the specification left for the human

These were answered with the conservative default and are easy to change.

1. **Design source** (§2.1) — resolved by instruction: the design follows this
   site's other E-Labs apps. Same palette, same workbench structure, same
   responsive ladder, same button-override convention.
2. **Single headline score** (§5.12) — not shipped. See D16.
3. **Validation data** (§13.4) — none available. `/science` states this plainly
   and publishes only what was actually measured, against synthetic ground truth,
   labelled as such.
4. **Pronation** (§5.10 #30) — shipped as an explicitly labelled low-confidence
   proxy called "Rearfoot alignment (proxy)", never "pronation", with the reason
   it cannot be measured stated on the metric and again on `/science`. Retained
   rather than dropped so a reader looking for pronation finds the explanation
   rather than nothing. If it misleads more than it informs, drop it.
5. **Custom domain** — the site already uses one; all links are relative, so
   nothing here depends on it.
6. **Contact form** — not included. The site has its own contact route.
7. **Analytics** — none in this app.

---

## Golden values

`test/run.mjs` pins a fixed synthetic clip twice: against the engine's committed
output (tight tolerance) and against physical truth (loose). Any change that
moves a golden number must be recorded here with its reason — a golden file
alone will happily preserve a bug forever, because it only ever asks whether
today matches yesterday.

Current baseline, seed 20260831: cadence 171.949, GCT 217.830 / 228.976 ms, duty
0.3120, step length 1.1163 m, vertical oscillation 8.596 cm, trunk lean 6.000°,
foot-strike angle 10.851°, overstride 11.197% of height.
