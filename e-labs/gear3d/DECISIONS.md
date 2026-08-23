# Gear3D — Decisions

Every point the build spec marked **[DECISION]**, plus the deviations from the
spec that this build made deliberately. Each entry states what was decided and
why, so a later maintainer can overturn it on the merits rather than guessing.

---

## D29. The gear naming convention is implemented as a grammar, not a table (v1.9)

**Decision.** `src/core/gearcode.js` parses FAA Order 5300.7 names from the
convention's own rules. `GEAR_CODES` in `schema.js` is generated from it, and a
designation is validated by **parsing** rather than by membership of a list.

**Why.** The convention is explicitly open-ended. Figure 2's caption says
*increase numeric value for additional tandem axles*, so `4S`, `9Q` and `2D/4D3`
are all legal names, and a table can only ever contain the ones someone thought
to type. The hand-maintained table this replaced held twelve codes and had
already drifted out of the Order's vocabulary — it described `2D` as "Dual
wheel, tandem", which is the phrasing §6d retired when it made `T` mean triple
instead of tandem. A third copy of the same list sat in
`src/data/aircraft/index.json`. Three copies of a table is three places for it
to be wrong; a parser is one place, and it answers questions no table can.

**What this buys, concretely.** Table 3 publishes a wheel count for eighteen
configurations. The parser derives all eighteen from the names alone, which is
a real test of whether the grammar was understood — and it caught the two rules
that are easiest to invert:

- The main-gear multiple counts gears in line **on one side** of a symmetric
  gear (§6e) and is doubled; the body-gear multiple is the **total across the
  aircraft** (§6f) and is not. Getting that backwards gives `2D/D1` twelve
  wheels instead of ten.
- The body count is **never** elided, even when it is 1, "because body gear
  arrangement may not be symmetrical". `2D/D` is therefore refused rather than
  read as a synonym for `2D/D1`, which it is not.

**The parser throws rather than returning a partial result.** A half-understood
gear name is worse than a refusal, because every wheel position downstream
would be derived from the half that was guessed.

**Where.** `src/core/gearcode.js`; `GEAR_CODES` and `isValidGearCode()` in
`src/core/schema.js`; group 12b of the test suite.

---

## D30. Gear configurations are schematics, and say so everywhere (v1.9)

**Decision.** The sixteen FAA Order 5300.7 configurations ship as normal
aircraft units — they validate, resolve and export as aircraft — but carry
`kind: "schematic"`, a separate Domain in the picker, an amber panel notice and
a `Schematic` flag in the title block that **outranks** both other flags.

**Why not a fourth domain.** `domain` is `truck | aircraft` throughout the
schema, the layout engine and the exporters. A third value would have meant a
third branch in every one of them to express something that is not true: these
*are* aircraft gear. The separation belongs in the picker, which is where the
confusion would otherwise happen, and nowhere else.

**Why the flag outranks the others.** Whether a drawing was edited away from
its reference, or how many of its values were assumed, is a second-order
question next to whether it is a drawing at all. A reader who takes one flag
off a figure should take that one.

**The sourcing runs opposite to the real aircraft, which is why no schematic
states an outer width.** On a 737 the FAA's published main gear outer width is
the datum and the track is derived from it (D14). Here the track is the
measured quantity — FAARFIELD publishes per-wheel coordinates — and the outer
width would fall out of a **nominal** tire, because no consulted source gives a
Tire and Rim Association designation for these aircraft. Publishing one would
dress a placeholder up as a datum, so `mainGearOuterWidth` is null on all
sixteen and the validator's closure check correctly skips them. A test asserts
that no schematic ever states one.

**Two honest nulls fell out of this, and both are corroborated rather than
tolerated.** The B-52 has no nose gear at all — Figure 18 ignores the wingtip
outriggers — so it has no wheelbase, the quantity being measured from a nose
gear that does not exist, and no `percentOnMainGear`, that figure existing to
split load between nose and main gear. The tests that used to demand both now
demand that a unit stating null genuinely *has* no nose gear, and that the null
propagates: no tire may carry a load derived from a split that was never
stated. That is strictly stronger than what they asserted before.

**Where.** `src/data/aircraft/faa-5300-7.json`; `renderTitleBlock()`,
`renderAssumptionNotice()` and `poolFor()` in `main.js`.

---

## D31. FAARFIELD's belly entries share a datum, and the 747 proves the sign (v1.9)

**Decision.** The wing-to-body gear longitudinal offset on the DC-10-30 and
A340-600 schematics is taken from the FAARFIELD 2.1.1 library, with the body
gear **aft** of the wing gear.

**Why this needed proving.** FAARFIELD stores an aircraft's belly gear as a
*separate library entry*, and it is not obvious that the two share a
longitudinal origin. They visibly do not always: the DC-10-30's wing bogie sits
at Y 762 mm while the KC-10's — essentially the same gear — sits at 0. This
build initially read the offset as putting the body gear **forward**, which is
the wrong side, and would have put a body bogie ahead of the wing gear on two
aircraft.

**What settles it.** The 747-400. Its FAARFIELD wing gear sits at Y 3073.4 mm,
and Boeing's own ACAP §7.2.1 footprint figure — read separately, for
`boeing.json`, from a wholly independent document — puts the 747 body gear
3073 mm **aft** of the wing gear. Agreement to 0.4 mm fixes both the datum
(shared, origin at the body gear) and the sign (positive Y forward) at once.
The direction then also agrees with the A380, with Figures 10–12 and 16, and
with the 747 entry already in this library.

**The general lesson.** A cross-check is only worth something when the two
sides are independent. This one is worth something precisely because the ACAP
figure was transcribed for a different aircraft, for a different file, before
this question was asked.

**Where.** `faa-5300-7.json`, the `WLG-L` and `BLG` source strings on
`faa-2d-d1` and `faa-2d-2d1`.

---

## D1. Drafting convention: ISO 129-1

**Decision.** Dimensions follow ISO 129-1, not ANSI Y14.5.

- Continuous dimension line, filled closed arrowhead at each end.
- Extension (witness) lines start with a small gap from the feature and
  overrun the dimension line slightly.
- The value sits **above** the dimension line and parallel to it, rather than
  breaking the line as ANSI does.
- Labels are kept upright: a label that would read upside-down is rotated
  180° so text never runs right-to-left.

**Why.** The audience is international pavement and airfield engineering,
where ISO is the prevailing drafting convention, and the "value above an
unbroken line" form survives rescaling better — an ANSI broken line with a
value in the gap degrades badly when a typesetter shrinks a figure.

**Where.** `src/annotate/dimensions.js`, `drawDimension()`.

---

## D2. No bundler; native ES modules and a pinned CDN import map

**Spec asked for** Vite, with three.js bundled so the app is reproducible
offline.

**Decision.** Ship as plain ES modules served directly, with three.js pinned at
`0.160.1` through an import map — matching Cross-Section Studio and LEAPS.

**Why.** The site is GitHub Pages + Jekyll with no build step. Introducing Vite
would mean either committing a `dist/` directory (so the repository stops being
the source of truth) or adding a CI build (so a one-file content fix stops
being a one-file content fix). Neither is worth it for an app whose entire
dependency list is one library. Native ESM works in every browser this app
targets, and the module graph is small enough that request count is not a real
cost.

**Cost, stated plainly.** Offline reproducibility is weaker: the app needs the
CDN on first load. Mitigations: the version is pinned exactly, so the bytes
cannot drift under us; and vendoring is a two-line change (drop
`three.module.js` into `vendor/` and repoint the import map) if the tradeoff
ever stops being acceptable.

---

## D3. No framework, and one UI controller instead of a `ui/` tree

**Spec asked for** vanilla ES modules — agreed, no argument needed — and a
`ui/` directory of `panels/`, `tree.js`, `inputs.js`, `shell.js`.

**Decision.** No framework. The UI lives in a single `main.js` controller.

**Why.** The state is one document tree plus a handful of view flags, which
`src/core/store.js` covers in about 150 lines. Splitting the controller across
six files would spread one flow of control over six places without making any
of them independently testable, because none of them can be tested without a
DOM anyway. The logic that genuinely benefits from isolation — coordinates,
units, tire parsing, layout resolution, the bridge formula, contact models,
projection and decluttering — already lives under `src/core`, `src/contact` and
`src/annotate`, none of which import three.js or touch the DOM. That is where
the test suite gets its purchase.

**Other consolidations, same reasoning:**

| Spec file | Where it lives now |
|---|---|
| `views/modes.js` | `scene/cameras.js` (view modes are camera state) |
| `annotate/declutter.js` | `annotate/projection.js` (pure, tested together) |
| `annotate/callouts.js`, `annotate/scalebar.js` | `annotate/dimensions.js` |
| `io/tiledRender.js` | `io/exportRaster.js` (the tiled path is the fallback branch of one function) |
| `geometry/chassis.js` | not built — see D9 |

---

## D4. Huang's coefficient is held exactly, not as the published rounding

**Decision.** `HUANG_K = 0.24 + 0.09π = 0.5227433…`, with the literature's
`0.5227` kept alongside as `HUANG_K_PUBLISHED` for captions.

**Why.** The shape is a 0.4L × 0.6L rectangle plus two semicircles of radius
0.3L. That integrates to exactly 0.24 + 0.09π. The universally quoted 0.5227 is
that number rounded to four decimals. Using the rounded constant makes the
*reported* area disagree with the *drawn* outline by about 1 part in 12 000 —
small, but exactly the kind of quiet inconsistency a figure caption should
never carry. The test suite asserts that the reported area equals the area of
the shape's own parts.

**Note on two sources that are wrong.** The build spec renders the formula as
`A = 0.5227 L² + 0.4227 L²`, which is not an equation. A widely-circulated web
summary renders it as `π(0.3L)² + (0.4L)(0.3L)`, which sums to 0.4027 L², not
0.5227 L². Neither reproduces the canonical coefficient; the form implemented
here does.

---

## D5. "Front" view places the observer behind the vehicle

**Decision.** Kept the spec's axes exactly: the Front view looks along **−x**,
with **+y to screen-right** and **+z up**.

**Consequence, stated so nobody thinks it is a bug.** Because +x is positive
*rearward*, looking along −x means looking in the direction of travel — that
is, standing behind the vehicle looking forward. That is what makes the
vehicle's right-hand side (+y) appear on the right of the screen. A true front
elevation would mirror the image left-to-right.

**Why keep it.** The transverse dimension set (track width, dual spacing,
overall width) is symmetric, so the choice does not affect any measurement, and
the spec's axes are what the rest of the pipeline was specified against.
Changing the handedness to get a "true" front elevation would put +y on the
left, which reads wrong in a plan/front pair.

**Related.** The Plan view's up-axis was corrected during the build. The spec
implied +y downward; a right-handed camera basis with +x to screen-right forces
**+y to screen-up**. The test `locked views form right-handed screen bases`
pins this.

---

## D6. Design direction: measurement instruments and technical documentation

Full rationale and the self-critique are in `DESIGN.md`. In summary: six
tokens, a system-font stack with tabular figures as a *functional* requirement,
and one signature element (the **datum tick** on panel headings, which reuses
the extension-line mark the dimension engine draws in the viewport). The
instrument-red signal colour is reserved exclusively for the live measurement
and the current selection.

---

## D7. Axle-group positions are derived from the Federal Bridge Formula

**Decision.** Where a truck's longitudinal layout was not fixed by a cited
document, the trailer group position is set to the smallest realistic spread
that satisfies 23 CFR 658.17 over **every** consecutive-axle subset at the
vehicle's stated legal loads — not just the outer bridge, which is rarely the
binding one.

**Why.** It replaces "a plausible-looking number" with a reproducible
derivation that a reader can check. `test/run.mjs` re-derives the check
independently and fails if any subset violates it, so the data and the stated
basis cannot drift apart.

**Margin.** Positions carry deliberate margin rather than sitting exactly on
the limit. The class 9 trailer tandem was moved from 16 062 mm to 16 200 mm for
this reason: at the original position the binding A2–A5 subset cleared the
formula by −0.4 lb, which is compliant in arithmetic and fragile in practice.

---

## D8. Units that do not comply say so instead of pretending

**Decision.** Units carry `federalBridgeFormula: "compliant" | "permit" |
"exempt"`. The class 13 turnpike double declares `permit`; the transit bus
declares `exempt`. The test suite checks compliance only for units claiming it,
and separately asserts that the turnpike double genuinely *fails* the federal
formula.

**Why.** A 129 000 lb turnpike double does not satisfy the bridge formula —
that is precisely why it runs under state turnpike permits. Silently labelling
it compliant, or quietly excluding it from the check, would have been the easy
lie. The negative assertion means that if someone later "fixes" its loads or
geometry to make it pass, the suite fails and asks why.

---

## D9. Deferred to v1.1: aircraft data library, chassis silhouettes, quad view

The spec's own build order says ship M0–M6 as v1.0 with aircraft (M8) to
follow. This build honours that, and the **data model, schema, layout
resolver, dimension sets and renderer all handle the aircraft domain today** —
dropping `src/data/aircraft/*.json` in is picked up with no code changes.

**Why the aircraft data specifically was not shipped.** The spec is explicit
that FAARFIELD-consistent values win because the audience will compare against
FAARFIELD, and any mismatch destroys trust. During this build the FAA Aircraft
Characteristics Database returned HTTP 403 and every manufacturer ACAP PDF
exceeded the fetch size limit, so **no aircraft gear geometry could be verified
against a primary source**. Shipping plausible-looking gear spacings with
confident citations would have been worse than shipping nothing: it would have
been the exact failure the spec warns about, wearing the costume of provenance.

Also not built: chassis silhouettes (the `unit` isolation level currently
renders the same as `running-gear`), the 2×2 quad view (the gear matrix export
covers the comparison use case), and glTF/OBJ scene export.

---

## D10. A debug handle is exposed on `window`

`window.gear3d` exposes the live app state.

**Why.** The app's whole claim is that its numbers are real. Being able to read
the resolved layout, the patch table and the camera state straight out of the
console is how a sceptical user checks that without having to trust the UI. It
carries no secrets and enables nothing that is not already in the project file.

---

## D21. The three orthographic quad panes share one scale (v1.4)

**Decision.** In quad view, plan, side and front are fitted to a single
shared scale — the largest any of them needs. 3D keeps its own.

**Why.** Fitted independently each pane is correctly framed and the sheet is
useless. A 22 m truck's front elevation comes out about seven times larger
than its side elevation, so nothing can be compared between panes by eye and
a dimension cannot be carried down from the plan to the side beneath it —
which is the entire reason those two views are placed in one column. Drafting
practice puts the orthographic views of a drawing at one scale; a check sheet
that does not is decoration.

3D is excluded because it is a pictorial reference rather than an elevation:
nothing is measured off it, so matching its scale to the others would only
waste pane area.

**Found on the way.** The half-height was a single value fitted for whichever
mode happened to be active when `fit()` last ran, so even in single view
switching Plan → Front framed the front elevation using the plan's extents.
It is now stored per mode and every mode is fitted at once.

---

## D22. Quad view refuses to tile rather than export a wrong sheet (v1.4)

Tiled export offsets ONE projection matrix. Quad view has four, each confined
to a scissor rect, and a frame-level offset does not map onto them. Asked for
a quad export above the GPU's single-pass limit the app therefore raises a
message naming the limit and the ways round it, rather than emitting a sheet
that is quietly wrong. Single-view tiling is untouched.

---

## D27. Text contrast is a token property, and it is tested (v1.8)

`--g3-muted` shipped from v1.0 to v1.7 at **2.72:1** against the light theme's
panel. WCAG AA wants 4.5:1 for text that size. It failed on *every* background
in that theme — 2.50:1 on a raised surface, 2.32:1 on an inset — and it colours
55 elements: the title-block labels, every definition term in the unit stats,
the tree's tags, the panel notes. The dark theme was marginal at 4.06:1 rather
than badly wrong, which is probably why it survived: the app is usually looked
at in dark mode.

Both are raised. Light muted goes to `#5a6774` (4.56:1 at worst, on `--g3-inset`,
which is the darkest surface it is drawn on — not the panel, which is the one
you would naively check). Dark goes to `#7d8f9d`. All 16 uses of the token are
`color:`, so nothing decorative moved.

**Raising muted alone would have flattened the hierarchy.** Light graphite sat
at 5.05:1 and muted would have landed at 5.34:1 — the "secondary" tier would
have out-weighted the primary one. Graphite is darkened to `#465564` (7.06:1)
to keep the two tiers a clear step apart, and a test asserts that gap stays.

### Two things this exposed about where colours are judged

- **The wordmark is measured against the wrong thing if you measure it against
  the panel.** `Gear3D`'s teal `3D` sits on `.g3-tb-mark`, the inset tile,
  which is darker than the panel behind it — 2.66:1 by the panel's reckoning,
  and the first correction computed against the panel still left it at 3.89:1.
  It is `#107271` now, 4.51:1 against the tile it is actually on. WCAG exempts
  logotypes, so this is legibility rather than compliance: at 2.27:1 the `3D`
  faded next to `Gear` and read as a rendering fault rather than as branding.
- **The axis badge was still using a theme token on the figure.** D25 set the
  rule — chrome on the figure follows the figure — and the badge's `<b>` was
  missed: `--g3-datum-hover` manages 3.88:1 on white in the light theme and
  2.88:1 in the dark one, because it is tuned for panels. There is now a
  `--g3-fig-datum` (`#138483`, 4.51:1) alongside the other figure tokens.

### Why this is a test and not a note

A token is one edit from regressing and the regression is invisible to every
other check in the suite — and to the eye, which is exactly the problem: 2.72:1
does not look broken, it looks slightly soft. `test/run.mjs` now parses
`styles.css`, extracts each theme's custom properties, and asserts every text
token against every surface it is drawn on, plus the figure tokens against the
figure. Verified by reverting the old value: the suite fails with
`--g3-muted (#8b98a5) on --g3-surface (#f4f6f8) is 2.72:1, needs 4.5`.

Measured across the whole interface afterwards: **55 failures to 0, in both
themes.**

---

## D28. The structure tree is one tab stop, not nineteen (v1.8)

The tree is correctly marked up — `role="tree"`, `role="treeitem"` — but every
node carried `tabIndex = 0`. A 5-axle truck put 19 tab stops in that panel and
an A380 puts 28, all of which a keyboard user had to walk through to reach
anything after the tree. The ARIA practice for a tree is the opposite: the
whole tree is a **single** tab stop and the arrow keys move within it.

So: roving tabindex. Exactly one node is tabbable — the selected row if there
is one, otherwise the first — and Up/Down/Home/End move focus and the tab stop
together. The handler is bound to the container, not to each node, because the
tree is rebuilt wholesale on every selection change and per-node handlers would
be re-attached each time.

Nodes also now carry `aria-selected`. Selection had been communicated by colour
alone, so a screen reader user could move through the tree without ever being
told which row was current.

---

## D25. Chrome drawn on the figure follows the figure, not the theme (v1.7)

The viewport shows publication white in both themes. That is deliberate and it
is not going to change: the annotation halo in `annotate/dimensions.js` is
drawn in the *figure's* background colour so that a figure exported on white
while the app runs dark does not get a dark halo eating its own text. The
viewport is a preview of the figure, so the figure's background is what it
shows.

The consequence had not been followed through. The HUD, the axis badge and the
progress overlay were styled from the *theme's* tokens, so in the dark theme
they became near-black pills sitting on white paper — blocks with more visual
weight than the drawing they annotate, which is precisely backwards.

So `.g3-viewport` now declares `--g3-fig-paper`, `--g3-fig-ink`, `--g3-fig-rule`
and `--g3-fig-muted`, and everything drawn over the plate takes its colour from
those. The rule is: **if it sits on the figure, it follows the figure; if it
sits on the interface, it follows the theme.** The halo already worked this
way; the rest of the chrome now does too.

The white plate in a dark interface is then handled as a composition rather
than apologised for. It gets an edge, a mat and a lift, so it reads as drafting
film lying on a desk instead of a hole punched through the UI.

### The one thing not to do to the viewport

**Never add padding to `.g3-viewport`.** The SVG annotation overlay is
`inset: 0`, which resolves against the element's PADDING box, while the canvas
fills its CONTENT box. Padding would leave the two boxes different sizes, and
every dimension line would be drawn a few pixels off the geometry it measures.
That failure looks exactly like a projection bug — it would be hunted for in
the maths, not in the stylesheet. The mat is therefore a `box-shadow` ring,
which does not affect layout. There is a comment saying so at the rule itself.

---

## D26. Dimension labels are decluttered by their rotated footprint (v1.7)

Labels are rotated to lie along their own dimension line, which is ISO 129-1
and correct. `declutter()` and `overlaps()` in `annotate/projection.js` are
axis-aligned box tests, and they were being handed the *unrotated* glyph box.

A 70 x 12 label at 45 degrees occupies a 58 x 58 square. Tested as 70 x 12 it
was treated as a thin horizontal sliver, so it could overlap almost anything it
was not parallel to — and a three-quarter view is nothing but non-parallel
dimension lines. Values sat on top of each other and on the tires, in the one
part of the app whose whole job is to be read.

`rotatedBox(w, h, angle)` now supplies the true axis-aligned footprint, and the
declutter pass is given that instead. Measured in the browser afterwards, a
five-dimension truck goes from labels overlapping at the default camera to zero
overlapping pairs at four different orbits, and the 22-tire A380 is clean too.

Two things worth noting about the fix:

- The declutter pass was not broken. It was being lied to about how much room
  each label needed. The bug was in what it was told, not in what it did — and
  a test asserting `declutter` separates two boxes would have passed throughout.
- `projection.js` is pure precisely so this is testable under Node, and it had
  no coverage at all. It does now, including the case that distinguishes the
  two behaviours: two labels 20 px apart that do *not* overlap as flat boxes
  and *do* overlap once rotated.

---

## D24. The wing-plus-body aircraft invert the sourcing method (v1.6)

The 747-400, 747-8 and A380-800 were deferred from v1.2 to v1.5 with a reason
that stayed accurate the whole time: a single main-gear outer width closes a
two-strut layout, but it cannot close a four-bogie one. The body gear's offset
from the wing gear is a free parameter, and putting a number on it without a
source would have been inventing geometry — the one thing this library exists
not to do.

What changed is not the modelling. It is that the number was found. It is
stated outright in the manufacturers' own airport planning figures (Boeing
ACAP §7.2, Airbus AC §7-2-0), which publish the track, both gear positions and
every spacing. Neither the FAA database nor FAARFIELD carries it: FAARFIELD
analyses one gear at a time and stores the wing gear and body gear as separate
entries, so it has the bogie geometry but not the distance between the two.
Three releases of "deferred" were three releases of not having looked in the
right document.

So these three are sourced **the other way round** from D-, 2D- and 3D-gear
aircraft. There, the outer width is authoritative and the track is derived from
it (the trap in SOURCES.md §5.2). Here, the track is published and the outer
width becomes an independent check — which closes to 0.2, 5 and 5 mm, the
residuals being the figures' own rounding to the nearest inch or 0.01 ft.

Two sourcing methods in one library is a cost, and it is worth paying. The
derivation exists because the track is unpublished for the original four; where
a manufacturer states the track directly, deriving it from a coarser number
instead would be throwing away the better datum to preserve a uniform method.
Both `index.json` and `boeing.json` say which method applies to which aircraft,
because a reader comparing two entries would otherwise have no way to tell.

**The corroboration is what makes this trustworthy.** FAARFIELD 2.1.1 stores
explicit per-wheel coordinates, derived from neither source used here, and it
reproduces every published spacing to the millimetre — including the A380 body
bogie's 20 mm wider middle axle (±764.54 and ±774.70 mm against the figure's
1530 and 1550). Its per-strut load percentages independently reproduce the
95 % on the main gear from a third direction.

### What this exposed

Adding an aircraft whose bogies are not all alike found two latent bugs. Both
had been correct on every aircraft in the library, which is what makes this
class of bug expensive:

- **The outer-width validator reached for `mains[0]`.** Outer width is measured
  at the outermost tires, so the dual spacing and tire that close the sum are
  the outermost strut's. On the A380 the *body* bogie is the wider one (1530
  against 1350 mm), so taking the first-listed main gear would have misjudged
  the width by 180 mm — while looking entirely reasonable.
- **The wheelbase averaged struts rather than tires.** The A380's body gear
  carries twelve of the twenty main tires, so the load centroid sits 328 mm aft
  of the midpoint between wing and body gear. Every previous aircraft had equal
  tire counts per strut, so the plain mean agreed and the bug could not surface.

A test now asserts the A380 case specifically, including that the tire-weighted
centroid differs from the plain mean — otherwise a regression to the simpler
formula would pass everything.

### The A380's middle axle

Its body bogie is a dual-tridem whose middle axle is 20 mm wider than the outer
two. That is 1.3 % on a 5.3 m track and invisible on screen, and it is
published and confirmed by two sources, so it is carried in `dualSpacingByRow`
rather than averaged. The app exports footprint coordinates for FEM
pre-processing; a dimension that is real, known and quietly rounded away is
precisely the kind of thing that has no business being silently wrong in a file
someone meshes.

### Where the FAA database is not followed

Two places, both recorded in the data files:

- **Its tabulated wheelbase is not consistently defined for these aircraft.**
  For the 747-8 it is the four-bogie centroid (agreeing to 2 mm); for the A380
  it is the nose-to-body-gear dimension exactly; for the 747-400 it is neither,
  nor their midpoint, giving 87.9 ft where Boeing's figure gives the commonly
  published 84.0 ft.
- **Its 747-400 MTOW is the -400ER figure** (910 000 lb), which exceeds the
  maximum *taxi* weight in Boeing's own table for the -400 — an internal
  contradiction that would have shipped unnoticed had the manufacturer table
  not been read.

The FAA database remains authoritative for the four two-strut aircraft, where
its outer width is the only published constraint on the track. It is used as a
cross-check, not an input, wherever the manufacturer figure is more specific.

---

## D23. The geometry export is millimetres in the engineering frame, against the glTF convention (v1.5)

glTF's stated convention is metres, Y-up. The export deliberately does not
follow it: it writes **millimetres** in the **engineering frame** — x
longitudinal positive rearward, y transverse positive right, z vertical
positive up.

Both departures are the same decision. This app already emits
`footprint.csv`, the Abaqus patch table and every printed dimension in
millimetres in that frame. If the `.glb` alone came out in metres in the
render frame, the two files describing the same truck would disagree with
each other by a factor of a thousand *and* by a rotation. Someone would open
them side by side in a pre-processor, and the failure mode is not a visible
error — it is a mesh that looks plausible and is wrong.

The trade is real and it is not close. Following the convention costs a
correctness trap that is expensive to notice; breaking it costs a viewer
showing a 22 000-unit truck, which is an inconvenience you see immediately
and fix with one scale factor. So the convention loses, and the file says so
about itself: the unit and the full axis definition are written into the
glTF `extras` and into the OBJ header, because a geometry export whose scale
can only be recovered from a README is a geometry export somebody will
import wrongly.

The transform itself lives in `core/coords.js`, next to `engToRender`, not
in the exporter. It is pure arithmetic and it is the inverse of the function
the whole scene is built through, so the two must never be allowed to drift
apart — and keeping it three-free is what lets the test suite check it,
including that its determinant is positive so no normal is inverted.

Two things this cost during implementation, both worth recording:

- Composing an instance's world matrix with two successive `applyMatrix4`
  calls **premultiplies**, giving `instance x world` rather than
  `world x instance`. That applies the assembly's 1/1000 scale before a
  translation already expressed in millimetres, and the export comes out a
  thousand times too large. It is now composed explicitly with
  `multiplyMatrices`, and verified by checking that every exported tyre node
  lands on its layout coordinate exactly, not approximately.
- OBJ has no instancing. A full unit is ~737k triangles and ~145 MB, because
  every tyre is written out in full. That is not a bug to fix — it is what
  the format is — so the app states it at export time and points at the
  `.glb`, which shares one mesh between all of them.

---

## D20. One whitelist, or none (v1.4)

**The bug.** `serializeProject` re-enumerated the view fields that the caller
had already assembled. Every view flag added after that point was written in
one place and dropped in the other, so `annotations`, `showGrid` and the
material overrides were all silently lost on save — switch the grid off, save,
reopen, and it is back on.

**Why it survived.** Nothing failed loudly. The project file was valid, it
just quietly held less than the app had put in it, and the defaults filled
the gaps on reopen so the result looked plausible.

**Fix.** `view: { ...state.view }`. The caller is the single authority on what
the view state is; two whitelists for one object is a bug generator. Backed
by a test that round-trips **every** view flag rather than a sampled few,
because the failure mode is specifically "the one nobody remembered".

---

## D18. The chassis is a regulatory envelope, not a vehicle body (v1.4)

**Decision.** The "Full unit" isolation level draws a translucent schematic
envelope with picked-out edges, not a modelled truck.

**Why.** Gear3D has no sourced body dimensions — it knows axle positions,
track widths and overall length, and nothing about cab shape, trailer height
or frame depth. Modelling a body would mean inventing dimensions, which is
the one thing this app exists not to do. So the silhouette is built from
bounds that are themselves citable:

| Bound | Source |
|---|---|
| Overall length | the unit's own cited `overallLength` |
| Overall width | min(actual outer width, **2591 mm**) — 23 CFR 658.15 |
| Overall height | **4115 mm** (13 ft 6 in) — the limit most US states apply |
| Axle positions | cited, straight from the unit |

Only the internal subdivision — where the cab ends, how deep the frame sits,
how the non-axle length splits between front and rear overhang — is
representative, and the app names those in an on-screen notice rather than
burying them here. The silhouette is excluded from picking and from
measurement snapping, so no number can ever be taken off it.

**Aircraft get nothing.** No sourced dimension constrains a fuselage, and the
notice says exactly that instead of quietly showing bare gear.

**Motorcycles get nothing** either: an envelope around a motorcycle conveys
nothing its two wheels do not already show.

---

## D19. A dropdown that filters must also load (v1.4)

**The bug.** Changing the Class or Domain dropdown repopulated the Model list
but never loaded anything, so the Model dropdown displayed one vehicle while
the viewport still held the previous one. The app looked frozen.

**Why my own testing missed it.** My verification fired `change` on the Model
select manually after changing the Class — so it exercised the code path I
had written rather than the interaction a user performs. Confirming a
mechanism is not the same as confirming a feature. The corrected check drives
only the control the user actually touches and asserts that the loaded unit
matches what the dropdown displays.

**Fix.** `syncUnits({ autoLoad })` loads the first matching unit whenever the
currently loaded one is filtered out. The flag defaults to false because
`syncUnitSelectors()` runs *after* a load and would otherwise re-enter
`loadUnitById`.

---

## D16. `[hidden]` needs an explicit rule, and the cost of not having one (v1.3)

**The bug.** The stylesheet had no `[hidden]` rule. The UA stylesheet declares
`[hidden] { display: none }` at the same specificity as a class selector, and
an author rule beats a UA rule outright — so every `.g3-thing { display: flex }`
silently un-hid its own element the moment the app set `.hidden = true`.

**Why it mattered so much.** `.g3-progress` is absolutely positioned over
`inset: 0` of the viewport with a translucent backdrop and `backdrop-filter:
blur(2px)`. Permanently displayed, it put a grey haze over every render and
**swallowed every pointer event** — no orbit, no click-to-select. The app
looked unfinished and behaved like a static image. The modified badge, the
aircraft assumption notice and the custom export fields were also all
permanently on screen.

**The lesson worth recording.** This was visible in screenshots from the very
first build and I explained it away as a headless-compositing artifact, because
exports looked perfect — `renderToCanvas` draws the WebGL scene directly and
never touches the DOM overlay, so the one output I was checking most carefully
was precisely the one that could not show the fault. When a rendering path and
an interactive path disagree, the disagreement is the finding; it should not be
attributed to the tooling until the tooling has been ruled out.

**Fix.** `.g3-app [hidden] { display: none !important; }`, stated once with the
reasoning attached, so no future `display:` rule can reintroduce it.

---

## D17. Annotations default to sparse, with a master switch (v1.3)

**Decision.** Only longitudinal dimensions and the scale bar are on at load.
A toolbar toggle (`A`) clears all annotation in one action, and a ground grid
(`G`) is on by default.

**Why.** With every set enabled a class 9 carries roughly twenty dimension
lines across an 18 m model, and the gear — the thing the app exists to show —
becomes unreadable behind its own measurements. The numbers are the product,
but they are a product the reader should be able to ask for rather than one
imposed on every view. The grid earns its place by being a readable scale in
its own right: its pitch is a round number in the display unit, so a viewer can
count squares, and it is part of the scene so it exports exactly as framed.

---

## D14. Aircraft track is derived from outer width, not assumed equal to it (v1.2)

**Decision.** Aircraft units store the FAA's `mainGearOuterWidth` as the
transverse datum and **derive** the centreline track from it:
`track = outerWidth − (wheelsAcross − 1)·dualSpacing − sectionWidth`.

**Why.** The FAA Aircraft Characteristics Database's own data dictionary
defines the field as *"Distance between outer tires in the main landing
gear."* It is an outside dimension. Treating it as the track — the obvious
mistake, because both are informally called "main gear width" — displaces every
main wheel outboard by half a dual spacing plus half a tire. On a 777 that is
close to a metre per side, and the resulting figure looks entirely plausible.

The derivation is validated twice: `validateUnit` fails if the stored gear
positions do not reproduce the stated outer width, and a separate test checks
the derived track against each manufacturer's independently published tread
(agreement is 10–26 mm across four aircraft, which is corroboration rather than
circularity because the tread figures play no part in the derivation).

---

## D15. Assumed values are declared in the data and shown in the app (v1.2)

**Decision.** Aircraft units carry a required `assumedFields[]` array. Schema
validation fails when it is absent — an empty array is valid and means "nothing
was assumed". The app renders an amber notice naming the assumed quantities
whenever such a unit is loaded.

**Why.** Two aircraft quantities — nose gear dual spacing, and tandem spacing
on 2D/3D gears — are not constrained by anything published. The alternatives
were to omit the aircraft entirely (a second deferral, with the code paths
already built and most of the data authoritative) or to record the values
silently and let them pass as sourced.

Neither is right. A modelling assumption that is *declared* is legitimate
engineering; the same number presented as a measurement is not. Putting the
declaration in the schema makes it unskippable, and putting it in the interface
means the person comparing output against FAARFIELD sees which two numbers to
check before concluding the app is wrong. The dual spacing is also the input
the user is most likely to know, and editing it re-derives the track, so
correcting it keeps the authoritative envelope intact.

---

## D12. The environment map is generated, not downloaded (v1.1)

**Decision.** Image-based lighting comes from a studio environment built at
runtime and PMREM-filtered, not from an HDRI file.

**Why.** An HDRI would be one more asset that can 404, one more third-party
licence living inside a public academic repository, and several megabytes on a
site whose other E-Labs apps ship as single files. A generated environment
keeps the app's existing promises — no asset dependency, deterministic output
— and has the added benefit that its softbox positions can follow the key
light, so reflections and cast shadows agree.

---

## D13. No third-party meshes were added (v1.1)

**Asked for:** download free 3D assets to build a mesh library.

**Decision.** The asset-slot **loader** was implemented; **no meshes were
committed**.

**Why.** Two independent reasons, either sufficient on its own.

1. **Licensing.** This repository is public, under a named academic's domain.
   Committing a mesh redistributes it, and most "free" marketplace licences
   permit use while prohibiting redistribution. The sourcing rules are written
   out in `ASSETS.md` §8.1: CC0 preferred, CC-BY acceptable with the
   attribution carried in the manifest, nothing whose licence cannot be
   stated. This is a judgement about the owner's exposure, not about
   convenience.
2. **Network access was rate-limited** for the remainder of the session in
   which this work was done, so no candidate asset could be fetched or, more
   importantly, have its licence verified at source.

**What this costs.** Nothing structural. The procedural path is the reference
implementation and is what the test suite exercises; meshes were always an
appearance enhancement. The loader, the manifest schema, the resolution chain
and the 1.6× distortion cap are all in place and tested by inspection, so
adding an asset later is a manifest entry and a file.

---

## D11. FEM export is a parameter table, not a runnable input deck

**Decision.** The Abaqus export emits commented patch rectangles, pressures and
an `area_ratio` column — not a generated `*DSLOAD` block.

**Why.** A generated load block has to assume a mesh, a surface naming scheme
and a step definition. A wrong assumption there is expensive to notice and
easy to miss, and the failure is silent. Handing the pre-processor exact
numbers and leaving the model author in control is the honest division of
responsibility. The header states the uniform-pressure idealisation in full,
including that it is *not* adequate for near-surface analysis.
