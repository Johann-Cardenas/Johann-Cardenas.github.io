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
analyzer is one contained island — is satisfied trivially: the analyzer is a
separate page and nothing else on the site loads any of it.

**What was kept.** The architectural point the framework choice was serving:
`src/engine/` imports nothing from the DOM, no browser API and no UI code. It
takes typed arrays in and returns results, which is what makes it testable
against synthetic signals, which is the only way to know the math is right.

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
a mean joint-angle curve with a ±1 SD band across strides, normalized to the
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
fails too, and less obviously: on a treadmill the planted foot travels backward
at belt speed for two thirds of the cycle while the swing lasts about a tenth of
a second, so once the trajectories are low-pass filtered the sustained backward
stance velocity is LARGER in magnitude than the brief forward swing peak, and
"whichever way the foot moves fastest" points backward. That produced a
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
neighborhood, not on the heaviest candidate.

**Why.** Seeding on "the heaviest, earliest" meant that when noise scattered
several candidates of one method across the window, the earliest of them
anchored the cluster and dragged the event early. The bias therefore grew with
noise, which is backward for something meant to be robust: measured contact
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
magnitude". On a treadmill the planted foot travels backward at belt speed for
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
black-box model emitting a "running form score". No labeled ground truth for
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
agreeing with an artifact. What actually happens: the body is in free fall
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
software rasterizer and Node's zlib.

**Why.** A picture whose claim is "this is what the app computes" should break
when the app breaks. It also avoids adding an image dependency for one asset.
The card's hover animation in `assets/js/e-labs-canvas.js` is a self-contained
closed-form model rather than a port of the engine, because that file is shared
by six other cards and stays dependency-free.

---

## D25. The tracked skeleton went from 17 landmarks to 25

**Decision.** Ears, eyes, a hand centroid per side and a lateral forefoot per
side were added to the canonical vocabulary, plus four derived points (pelvis,
neck, head center, mid-trunk).

**Why.** Everything except the lateral forefoot was already in the pose model's
output and was being discarded. BlazePose returns 33 landmarks; the engine was
using 17. The ears in particular are not decoration: Winter places the
head-and-neck center of mass at the ear canal, so they are the structural
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

## D26. A fourteen-segment center-of-mass model was added

**Decision.** Winter's segment inertial parameters, mass-weighted over fourteen
segments, giving a whole-body center of mass per frame. Its vertical oscillation
is reported alongside — not instead of — the pelvis measurement.

**Why.** This was prompted by reading Van Hooren et al. (2024), which pooled the
observational literature on running biomechanics and running economy. Vertical
oscillation of the center of mass is the single strongest association it found
(r = 0.35, moderate). Most video tools, including this one until now, report the
vertical movement of a hip landmark and call it vertical oscillation. It is not
the same quantity: the swinging limbs move opposite to the trunk and partly
cancel its rise and fall. On the synthetic runner the center of mass moves
7.4 cm against the pelvis's 8.5 cm, and a test now asserts that ordering — if it
ever inverts, the model is wrong.

Since the best-evidenced variable in the app is this one, it was worth measuring
the thing rather than a proxy for it. Both are reported and the pelvis one says
which it is.

A lost hand does not delete 0.6% of body mass and drag the center of mass
toward the feet: segment masses are renormalized over what is available, and a
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
real source; center-of-mass oscillation and both stiffness terms are the only
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

## D30. The track-header matrix was read four bytes early

**Decision.** Fixed, and pinned by a hand-built MP4 fixture in the test suite.

**Why it matters more than an off-by-four usually does.** The display matrix in
`tkhd` begins at byte 40 for a version-0 track header and 52 for version 1. The
parser used 36 and 48. It therefore read the tail of a reserved field instead of
the matrix, got `a = 256, b = 0`, and concluded every video on earth was
unrotated.

The consequence was silent and total. A phone recording in portrait stores
landscape pixels plus a quarter turn in that matrix. WebCodecs decodes the
CODED frame and knows nothing about the matrix, so the pose model was handed a
runner lying on their side. BlazePose is trained on upright people: given a
sideways one it does not fail loudly, it produces a confident and entirely
wrong skeleton, and every angle, every event and every measurement downstream
was computed from it. Nothing threw. The report looked normal.

Found because a user uploaded a 9:16 clip and said it was being treated as
landscape. The fixture now asserts all four quarter turns, both track-header
versions, and the display-dimension swap.

---

## D31. Rotation is applied to the pixels, not to the landmarks

**Decision.** Frames are rotated to display orientation before inference, in the
same pass as the downscale.

**Why not rotate the landmarks afterward**, which moves no pixels: because the
model has to see an upright person to produce landmarks worth rotating. The
whole problem is upstream of the coordinates.

**Why it also fixes a disagreement between the two decode paths.** A `<video>`
element applies the display matrix itself, so the fallback decoder was already
producing upright frames while WebCodecs was not. The same clip analyzed in two
browsers would have given two different answers. The fallback now reports zero
rotation and the WebCodecs path reports the real one, so both arrive upright.

**Mirroring is handled too.** A negative matrix determinant means the frame is
flipped, which front-camera recordings carry. A flipped frame swaps the
runner's left and right, so every per-side measurement and every asymmetry
index would be confidently reported for the wrong leg — the same class of
silent, plausible error, and it is detected, corrected and announced.

---

## D32. A limb that changes length is disbelieved

**Decision.** `pose/plausible.js` measures each rigid segment against its own
median across the clip and marks the distal landmark missing on any frame where
it departs by more than 40%.

**Why visibility was not enough.** A pose estimator asked for a landmark it
cannot see does not decline; it guesses, and often reports a comfortable
confidence while doing so. On the real test clip — a runner on a treadmill
filmed from behind and to one side — the far leg was hallucinated below the
treadmill deck for much of the cycle and passed the visibility gate. Six left
strides and two right ones were being reported from it.

Bones do not change length. That is checkable without any reference to how sure
the model claims to be, and it uses the runner's own proportions rather than a
population's. After the gate: three left and one right, which is fewer strides
and a truthful number of them.

---

## D33. Displacement is only measured when the frame is fixed to the world

**Decision.** If the runner travels less than two leg lengths across the whole
clip, step length, stride length and speed are not reported for an overground
capture, and the warning says to select Treadmill and enter the belt speed.

**Why.** On the real test clip, marked "road" but actually a treadmill, the app
reported a speed of **0.10 m/s — a pace of 166 minutes per kilometer**. The
displacement between foot strikes was near zero because the runner was not
going anywhere relative to the camera.

A treadmill and a hand-held camera that follows the runner are indistinguishable
in the data, and both make displacement-based measurement meaningless rather
than merely noisy. The damage does not stop at the one number: speed feeds the
vertical ratio, the spring-mass stiffness model, and the choice of
speed-conditional reference band, so a single undetected capture condition
quietly corrupts a whole column of the report.

---

## D34. An oblique camera caps every plane-sensitive measurement

**Decision.** When the view classifies as oblique, the 24 measurements marked
`planeSensitive` in the catalog are capped at low confidence — which puts them
below the threshold for scoring and for firing any rule. They are still
displayed, with the reason attached.

**Why capping rather than widening an interval.** An oblique camera does not
make a planar angle noisy, it makes it wrong: the angle is measured in a plane
the movement did not happen in. Averaging more strides cannot help, so a wider
confidence interval would misrepresent the problem as imprecision. The
measurements that do not depend on the camera azimuth — cadence, the timing
metrics, the vertical oscillations — keep their normal confidence.

This is the difference between a tool that produces a report from any clip and
one that says which clips it can read. The real test clip is 30 fps, oblique,
and on a treadmill labeled as road; after these fixes it yields cadence and
center-of-mass oscillation, three warnings each naming what to change, and
nothing else. That is the correct output for that recording.

---

## D35. The overlay shows the measurement, not just the number

**Decision.** The annotated player was rebuilt around one idea: an analytical
overlay draws the thing it measured. Nine layers, three density presets, and a
heads-up readout of the values AT THE CURRENT FRAME rather than the stride
aggregates the dashboard shows.

**Why per-frame values.** This is the difference between a video with a skeleton
on it and an analysis tool. Stepping frame by frame through a contact and
watching knee flexion rise is how a gait cycle is actually read, and for that
the numbers have to be on the frame. The arc and the number come from the same
per-frame series, keyed by name, so the drawing and the reading cannot describe
different joints or disagree about a sign convention.

**Why dimension lines.** "Overstride 11% of standing height" is an abstraction.
The same thing drawn between the plumb line through the hips and the ankle, on
the frame where it is taken, is a fact about the picture. Same for the
center-of-mass excursion, which is otherwise the least visible of the
well-evidenced variables. The construction lines — ground, plumb, hip horizon,
scale bar — exist so the reader can see what each measurement is taken FROM.

**Why the phase lanes.** Stance and swing for both feet across the whole clip
makes the event detection inspectable: if the two feet do not alternate, the
detection is wrong, and that is visible without reading a number.

**Three things the drawing refuses to do.**

An angle with no readable value is not annotated at all. An arc without a number
is an annotation that cannot say what it found, so if the conditioned series
gated that joint out, nothing is drawn.

A dimension line is not drawn for a measurement below medium confidence. Drawing
one would let the overlay contradict the report it belongs to — the engine
already declines to score or advise on those, and a confident-looking annotation
on the frame would undo that. On an oblique capture the frame says so, next to
the timecode.

A landmark the pose model was unsure of is drawn hollow and dimmed, and the bones
resting on it are drawn faint. A skeleton standing on a guess should look like
one.

**One sizing note worth keeping.** The design unit comes from the geometric mean
of the frame, not its short side. A 9:16 phone clip has a short side barely a
third of its long one, so sizing from the minimum shrinks every label and lane to
illegibility on exactly the videos people actually record.

---

## D36. There are two demos, and the filmed one is deliberately imperfect

**Decision.** The Demo button became a dropdown with two entries. The synthetic
runner stays; a real phone clip of somebody on a treadmill was added beside it,
shipped in `demo/` and analyzed through the ordinary path — fetch, pre-flight,
decode, pose over every frame, the same refusals as anyone's own video.

**Why two.** They answer different questions and neither can answer the other's.
The synthetic runner is the only clip in existence for which this app knows the
true cadence, contact time, trunk lean and strike angle, because they were
inputs to the model that generated it — so it is the only one that can show the
engine's *error*. A filmed runner has no ground truth, only a second
measurement. But the synthetic clip is 240 fps, square on, and perfectly
tracked, which is not what anybody has on their phone, so on its own it
demonstrates the app under conditions the app will rarely meet.

**Why this clip, which measures badly.** It is 30 fps, portrait, and shot from
behind and to one side of a treadmill. The app answers it with cadence, the
oscillation metrics and one finding, and withholds the twenty-four
plane-sensitive angles, the three timing metrics and both stiffnesses, naming a
reason for each. That *is* the demonstration. An app whose demo only ever shows
the capture it was designed for teaches a visitor nothing about the capture they
have, and the refusals are the part of this engine most worth seeing.

**Why it runs the real pipeline rather than replaying a stored result.** Faster,
and it would demonstrate nothing. The rotation is really detected, the tracker
really runs, the limb-length gate really throws away two thirds of the detected
strides. A recorded answer would be a screenshot with extra steps.

**Twelve seconds, not the six the app proposes.** Eight candidate windows were
measured. Six seconds gives three or four usable strides and three measurements
at medium confidence and fires no rule; twelve gives nine, eight, and one
finding with advice attached, for about four more seconds of compute. The
six-second default for a clip you bring is a latency choice, and this is the
evidence for what it costs. The window is committed rather than proposed so the
demo answers the same thing twice.

**What is quoted rather than measured.** Standing height 1.68 m, mass 75 kg and
belt speed 3.33 m/s were supplied by the person filmed. Height sets the
pixels-to-meters scale; belt speed cannot be measured at all here, because a
runner on a treadmill does not move through the frame. All three live in
`stated` in `src/ui/demos.js` and the report says so on its face, so what the
app was told stays separable from what the app worked out.

**Two guards in the test suite.** The declared container metadata is read back
out of the shipped bytes with the app's own demuxer, so swapping the file for a
different recording fails the build rather than turning the demo's note into a
confident lie. And the stated belt speed is cross-checked against the measured
cadence: 3.33 m/s at the 182 steps/min this clip returns is a step of 65% of
standing height, which is ordinary. The 5 m/s that was briefly on the table
would have implied 98%, which is not a thing a body does, so the arbitration is
recorded as an assertion rather than as a memory.

**The camera was checked, not assumed.** The clip reports about 16 cm of
vertical oscillation, high enough to suspect the handheld camera rather than the
runner. Matching the left and right 22% of the frame — wall and machine, static
in the world — across 58 sample pairs returns zero displacement, on a
sum-of-absolute-differences surface that is sharply peaked at zero (7.1 at no
shift, 11.9 at one pixel, 20.8 at four) and that recovers an artificially
shifted control exactly. The camera does not move. The number is the runner's.

---

## D37. A score of zero must mean out of range, and used not to

**Decision.** `scoreValue` now divides by the distance from the optimal center
to the acceptable edge **on the side the value falls**, not by half the total
acceptable width.

**Why.** Twenty-one of the twenty-four bands here are asymmetric about their own
optimal center — being a little under is rarely as bad as being a lot over. One
half-width for both sides puts the zero closer in on the wider side, inside the
acceptable range. Head oscillation, optimal 4–9 cm and acceptable 3–12, scored a
flat zero from 11 cm upward while `bandStatus` went on calling 11.7 cm
acceptable, so the app showed a half-filled glyph reading "Near the typical
range" next to a score of 0 out of 100 for the same measurement, and meant both.
Every one of the twenty-one had a dead zone like it.

This was a bug against the function's own documented contract, which already
said "a value at the edge of the acceptable band scores 0" — true only for a
symmetric band, and none of the interesting ones are. `scoreValue > 0` is now
exactly `bandStatus !== 'outside'` by construction, and symmetric bands are
unaffected. The suite sweeps all 24 bands at 39 points each and asserts the
equivalence; reverting the formula fails those checks, which is the negative
control.

**Found by the filmed demo**, which put "Posture and alignment 0 / 100" on
screen underneath a measurement labeled near-typical. It now reads 5 / 100.

---

## D38. The window proposal is a separate, pure module

**Decision.** The arithmetic that picks the analysis window moved out of the DOM
controller into `src/ui/propose.js`; app.js keeps only the measuring, which
needs a canvas, and the applying, which needs the sliders.

**Why.** The heuristic's important behavior is that it *declines* — a clip of
somebody running the whole way through has no quiet part to skip, every window
scores the same, and moving the selection then looks like a decision and is a
coin toss. That guard cannot be exercised against the shipped demo, because the
shipped demo is exactly the uniform case: it correctly proposes nothing, which
looks identical to a proposal that never worked. Splitting the decision out
makes both paths testable, and the positive path — a 30 s clip with the running
in the middle ten — is now a check rather than a hope.

The threshold is a multiple of the median rather than the mean, so a single
bright thumbnail (a passing shadow, an autoexposure step) cannot both create the
winning window and raise the bar that window has to clear.

---

## D39. Three defects the demo work surfaced, fixed on the way

**A missing IndexedDB key returned the request object, not the default.** `tx()`
resolved with `out.result !== undefined ? out.result : out`, so a `get` that
found nothing resolved with the IDBRequest itself, which is truthy.
`getSetting('units', 'metric')` then read `.value` off a request, got
`undefined`, and returned that instead of the caller's fallback — so on a first
visit the units selector was set to `undefined`, `selectedIndex` went to −1, and
the control rendered blank. `activeProfile()` had it worse: it was handed a
request object as a primary key and threw into a `catch` that swallowed it. A
miss now resolves as `undefined`.

**Every select clipped its own descenders.** `.sl-select` set `height: 2.1em`
while inheriting the app's 1.75 line-height; under border-box that leaves 15.7px
of content box for a 23.8px line. Invisible on "Metric", obvious the moment
"Demo — synthetic runner" went in one. Now `min-height` plus a stated
`line-height: 1.25`.

**The Analyze run button was unreachable on a phone.** `.sl-topbar` wraps, but
`.sl-topbar-group` is a flex *item* and did not, so the group holding the device
chip, the demo control and the two buttons stayed one row wide however narrow
the viewport got. `.sl-workspace` uses `overflow: clip` below 1080 (so its
sticky bar works), which meant the overflow was not scrollable — it simply was
not there. At 380px the primary action sat at x=506 and could not be tapped.
The group wraps now, and below 720px the demo control takes a row of its own.

Worth noting that the third one was latent before this change and would have
bitten at a slightly narrower width; adding 232px of dropdown to that row is
what made it certain, and therefore visible.

---

## D40. The playback decoder has to stop the clock

**Decision.** `decodeWithVideoElement` pauses the video around the awaited
`onFrame`, and registers the next `requestVideoFrameCallback` before resuming.

**Why.** It did not, and the consequence was severe and silent. `onFrame` is
pose inference — a hundred milliseconds and up per frame — and a playing video
does not wait for it. Re-registering the callback only after the await meant
every frame presented while the model was busy was gone: the decoder sampled at
the speed of inference rather than at the frame rate of the clip.

Measured on a real 30 fps recording: a free consumer got 24 fps, a 40 ms
consumer 11.5 fps with 51 of 117 frames dropped, and real inference about 5.
The pipeline then read 5 fps off the timestamps of the frames that survived,
refused the clip, and told the user to **re-record at 60 fps or higher** — about
a recording that was already 30, and whose frames the app had thrown away
itself. After the fix the same clip yields 119 frames at 29.8 fps and analyzes.

This is not an exotic path. The demuxer here is ISO-BMFF only, so **every WebM
file falls back to it on every browser**, including files the app's own camera
recorder produces whenever `MediaRecorder` cannot give it MP4 — Firefox always,
and Chrome depending on the build. Record a clip in the app, and the app could
refuse it.

The cost is honest: decode now takes as long as inference does, which is what
the WebCodecs path costs too. There is no way to get every frame out of a
`<video>` except to stop time, and a sampling decoder that quietly discards
four fifths of a clip is worse than a slow one.

**And the refusal now names the right culprit.** `runPipeline` is told how many
frames the decoder lost and what the source rate was, and when the two disagree
it says the browser could not keep up rather than blaming the camera. Advice
that cannot help is worse than no advice.

---

## D41. One skipped frame is not a variable frame rate

**Decision.** Frame-interval spread is the 10th-to-90th-percentile range over
the median, not max minus min. A few isolated long gaps are reported separately,
as skips.

**Why.** A range is the least robust statistic available, and it was the one
gating this warning. One skipped frame makes one interval twice the others and
reports "Frame intervals vary by 100%" — which is what a genuinely
variable-frame-rate phone recording looks like too, and the two call for
different things. On the two-runner test clip it read 121% for a clip that was
steady 30 fps apart from two skips in 119 frames.

Every other gate in this engine rests on a robust statistic — D10 uses the
standard error rather than the spread, D12 a weighted median before a mean.
This was the exception, and it fired on healthy clips.

---

## D42. Four more defects, found by exercising what the demo could not

The filmed demo has one runner in it and is an MP4, so it exercises neither the
person-picker nor the fallback decoder. Both were reached with a clip built for
the purpose: the demo composited beside a time-shifted copy of itself, recorded
to WebM through `MediaRecorder`. Everything in D40 and D41 came out of that, and
so did these.

**The picker was unreachable by keyboard.** The choice is a gate — the analysis
stops until it is answered — and the only way to answer was clicking a canvas.
There is now a real `<button>` per candidate beside the prompt, carrying the
same number its box is labeled with, focused on open, and highlighting its box
on focus so the two readings of one choice stay tied together.

**The picker was drawn into a letterbox.** The live canvas is pinned to 360px
for the progress display, which left each candidate about 80px wide to hit on a
desktop viewport and far less on a phone. It grows to `min(64vh, 620px)` while
choosing and is put back afterward.

**The share link was built and never shown.** `shareLink` awaited
`navigator.clipboard.writeText` and only then wrote any text. Without transient
user activation Chrome does not reject that promise, it leaves it pending
forever — so the panel opened, stayed empty, and the link the user had asked
for was never displayed. A `catch` cannot catch a promise that never settles.
The link now goes on screen first, in a selectable field, and the clipboard
attempt is bounded and merely upgrades the status line. This is the same lesson
Cross-Section Studio already learned: never let the clipboard be the only path.

**A note on method.** Two of the four were invisible to the test suite and
always would have been — they live in the DOM half, which is deliberately not
unit-tested (D-series preamble). They were found by driving the real interface
with a fixture built to reach the branches the shipped demo cannot. That is the
argument for keeping a fixture generator around rather than only golden files.

---

## D43. A shared summary has to carry its own context

**Decision.** `renderSharedSummary` now shows units, confidence intervals, the
side each reading belongs to, confidence spelled out, and the capture context
that travels in the link. Low-confidence rows are marked and counted.

**Why.** It showed a bare number, a "Left"/"Right" pair that non-sided metrics
half-filled, and a single letter — `l`, `m` — in a column headed Confidence,
because `makeShareCode` stores `confidence[0]` to save bytes and the renderer
printed the stored value. So "Step time 305" reached the recipient with no unit
(milliseconds? seconds?), no interval, and a one-character quality flag.

The link already carried `summary.c` — frame rate, view, surface, speed — and
the renderer ignored it. That is the worst of the set: a cadence measured on a
30 fps oblique treadmill clip is a different claim from one measured square-on
at 240 fps, and the difference is this app's entire argument. A shared summary
that drops it is the one view of these numbers with none of the apparatus that
qualifies them.

Also fixed while there: a sided metric whose LEFT slot was empty was skipped
entirely, taking its measured right side with it. Row count on the demo went
from 24 to 28.

**And the link is now read when it arrives, not only at startup.** The hash was
parsed once in `init`. Pasting a share link into a tab already showing this page
changes only the fragment, so the browser fires `hashchange` and does not
reload — and that link silently did nothing.

---

## D44. The overlay video is recorded in real time because it is played, not seeked

**Decision.** `exportOverlayVideo` plays the source clip and draws on
`requestVideoFrameCallback`, instead of seeking to each frame in turn.

**Why.** `MediaRecorder` timestamps by wall clock, so whatever the render loop
does slowly is what the exported video plays slowly. Seeking once per frame and
awaiting each `seeked` made a 2.05 s window come out at 2.52 s — 23% slow.
Somebody counting steps in the exported video would get a cadence 23% below the
one in the report it came from, which for this app is the exact failure it
exists to avoid.

Playing the clip makes media time and wall clock advance together by
construction, and `indexAtTime` picks the matching series frame for each
presented one. Measured after: a 4.11 s window exports as 4.00 s, −2.7%, and
rendering costs 1.3x real time rather than 2x. The seek loop is kept for the
synthetic demo, which has no source video, and there it now paces against the
clip's own timeline so a slow paint steals from the next frame's wait rather
than stretching the whole export. Recording starts once there is something to
record, rather than capturing the blank canvas as lead-in.

**What was checked and was fine:** `series.t` holds absolute media time, not
time relative to the trim window, so the per-frame seek was pointing at the
right part of the clip. That was verified rather than assumed — had it been
relative, the overlay would have been drawn over unrelated video.

---

## D45. The printed report is forced light, because paper is

**Decision.** `@media print` redefines the palette tokens to the light set, and
a `beforeprint` handler re-renders the charts in the light theme.

**Why.** This app is dark-first and browsers do not print background colors.
`--sl-ink` is `#e8eef9`, so a reader in dark mode — the default — pressed
"Printable report" and got near-white text on white paper. The feature produced
a blank sheet for most of its users. Charts are canvases and print the bitmap
they hold rather than taking any CSS, hence the re-render; `renderResult` was
already re-entrant because changing units calls it. The player canvas is left
alone deliberately, being a video frame.

**The re-render is synchronous, and that is the load-bearing part.** Chart
canvases are normally drawn on the next animation frame, which is a batching
choice rather than a requirement — `setup()` in charts.js reads
`getBoundingClientRect()`, which flushes layout on its own, so a canvas can be
drawn the moment it is in the document; the frame buys doing that once for
forty cards instead of forty times. Printing cannot afford the deferral.
`beforeprint` runs synchronously and the browser lays the page out for paper as
soon as the handler returns, so a repaint parked on an animation frame is a
race — one that happened to be won in Chrome and Firefox with no promise of
being won anywhere else. `scheduleChart` draws inline while printing, and the
outcome no longer depends on scheduling: dispatching `beforeprint` and reading
a chart pixel with no await in between now returns the light value, where
before it needed most of a second.

Also hidden in print: the History and Compare panes, which
`.sl-pane { display: block !important }` had been printing along with
everything else. Compare with nothing selected printed the sentence "Pick two
analyses in the History tab", which on paper is an instruction nobody can
follow.

---

## D46. A stored analysis can be opened, which is what makes keeping the video mean anything

**Decision.** History rows gained an **Open** action that restores a stored
analysis into the player, with the kept video when there is one.

**Why.** `store.getVideo` was called from nowhere in the app. The checkbox
"Keep the video with this analysis" wrote the clip into IndexedDB — tens of
megabytes, five retained — and nothing ever read it back: it was write-only
storage, spending the user's quota in an app that warns them about quota, and
buying nothing at all. Stored analyses could only be compared or deleted.

What comes back says what it is not: the record keeps measurements, scores,
findings, warnings, events and keypoints, but not the engine's internal
per-frame series, so the gait-cycle curves and the richer overlay layers are
unavailable and a warning says so rather than quietly drawing less.

`scores.perMetric` is recomputed on open rather than stored twice —
`stripMetrics` keeps only the dimension scores, and the metric grid reads
`perMetric` for every card's status. Scoring is a pure function of the
measurements and the speed band, so what comes back is what was stored.

---

## D47. The overlay follows presented frames, not `timeupdate`

**Decision.** The player's overlay is driven by `requestVideoFrameCallback`,
with an animation-frame loop as fallback and `timeupdate` demoted to a backstop
for a paused element being scrubbed.

**Why.** Reported as: the overlay tracks perfectly at 0.15x and 0.25x and falls
apart at 0.5x and 1x. It was hanging off `timeupdate`, which browsers throttle
to roughly four events a second — measured here at a **266 ms** median
interval. That is a fixed budget in WALL time, so what it buys in MEDIA time
scales with the playback rate: at 0.15x, 266 ms is about one frame of a 30 fps
clip and the overlay looks exact; at 1x it is eight frames, and the skeleton
sits on a pose the runner left a quarter of a second ago, jumping eight frames
at a time to catch up. At 180 steps per minute that lag is more than a whole
step, which is why it looked like the detection had failed rather than like a
sync problem. The detection was never wrong; the overlay was drawing the wrong
frame.

Measured, overlay-to-picture lag in frames, median (max):

| rate | before | after |
|---|---|---|
| 0.15x | 1 (2) | 0 (1) |
| 1x | 4 (8) | 0 (1) |

`requestVideoFrameCallback` fires once per presented frame and hands over that
frame's exact `mediaTime`, so the pose drawn is the pose of the picture
underneath it at any rate, by construction. The callback chain is canceled
when the player is re-armed, or two chains would draw over each other.

---

## D48. The wait shows the detection, and one mapping table does it

**Decision.** The processing stage draws a detection HUD — acquisition
brackets around the landmarks found, joints sized by the confidence the model
reported, a sweep line, and chips reading the frame index, the number of
landmarks locked and whether more than one person is in shot — over a stepper
that marks each stage done or running, a percentage, a throughput in frames per
second and an estimated time left.

**Why.** Forty seconds is a long time to look at a stick figure on an empty
rectangle with no idea how long is left. Everything drawn is real: the box is
the landmark extent, the joint sizes are reported visibilities, the rate and
the estimate come from frames actually completed. None of it is decoration
imitating telemetry, which in this app would be the wrong kind of joke.

**And it found a duplicate mapping.** The preview had its own hand-written copy
of the backend-to-canonical landmark table, and it was already out of step with
the engine's: it knew 17 of the 25 canonical landmarks and produced nothing for
the ears, eyes, hands and outer feet, which `adaptFrame` builds as centroids of
several raw points. So the live preview drew a poorer skeleton than the report
of the same frame, and the HUD's "landmarks locked" count ran against a
denominator eight of which could never be filled. The preview now calls
`adaptFrame`, and the second table is gone. Two copies of a mapping is two
things that can disagree, and these already had.

---

## D49. What the camera path is, and what could not be tested without a camera

**Found.** `MediaRecorder` writes a FRAGMENTED container — samples live in
`moof`/`trun` boxes rather than in the `moov` sample table — and it cannot write
anything else, because it is describing a stream whose final length it does not
yet know. The demuxer here reads sample tables; it recognizes the fragmented
layout and reports `reason: 'fragmented'`, so `probe` correctly falls back.
Verified by recording through `MediaRecorder` and parsing the result: the file
carries `moof`, `traf`, `trun` and `mvex`, and `parseMp4` returns
`ok: false, reason: 'fragmented'` rather than a track with an empty sample list.

**So every clip recorded inside this app takes the `<video>` playback decoder,
always.** Nothing recorded here will ever reach the WebCodecs fast path. That is
correct behavior and it is surfaced to the user as reduced timing precision —
and it is why the playback decoder silently dropping four fifths of its frames
(D40) mattered as much as it did: it was not an edge case, it was the path this
feature uses every time. Preferring `video/mp4` over WebM in the recorder's
format list therefore buys no speed; it is kept only because an mp4 is the more
portable thing for somebody to keep.

**Hardened while there:** the produced file takes the recorder's own negotiated
`mimeType` rather than the first chunk's, which can be empty and does not exist
at all if nothing was captured; a recording that produced no chunks now says so
instead of handing an empty file to the pre-flight; a clip under two seconds is
called out at the point of recording rather than only in the checks; and the
record button refuses politely when no stream is open.

**What was verified without a device.** Stubbing `getUserMedia` with a canvas
stream drives the whole path for real: the camera stage opens, the hint reads
the actual stream settings back, Record becomes Stop, stopping produces
`recording.mp4` of the negotiated type, and it lands in the pre-flight and trim
stage with the fragmented-container fallback correctly flagged.

**What could not be.** A synthetic camera cannot produce a realistic frame rate
in an automated browser: the page is not being painted, so
`requestAnimationFrame` and `requestVideoFrameCallback` are both throttled to
about 1 Hz, and the recording comes out at 1 fps — which the app then refuses,
correctly and for the right reason. That refusal is the app being right about a
genuinely 1 fps file, not a defect; a plain `<video>` reading the same file
sees the same four frames a second apart. The remaining gap is therefore narrow
and specific: a real camera recording at a real frame rate, end to end. The
decode half of that join is separately verified — the same fragmented/WebM
fallback path recovers 29.8 fps out of a 30 fps clip (D40) — so what is
untested is the hardware, not the code it feeds.

---

## Open questions the specification left for the human

These were answered with the conservative default and are easy to change.

1. **Design source** (§2.1) — resolved by instruction: the design follows this
   site's other E-Labs apps. Same palette, same workbench structure, same
   responsive ladder, same button-override convention.
2. **Single headline score** (§5.12) — not shipped. See D16.
3. **Validation data** (§13.4) — none available. `/science` states this plainly
   and publishes only what was actually measured, against synthetic ground truth,
   labeled as such.
4. **Pronation** (§5.10 #30) — shipped as an explicitly labeled low-confidence
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
