# Gear3D

Deterministic, true-to-scale 3D visualizer of **truck axle configurations** and
**aircraft landing gear**, for pavement engineers, researchers and instructors.

Gear3D is a renderer and a dimension engine — not a CAD tool and not a physics
simulator. It does three things:

1. Shows what a gear configuration actually looks like in 3D, from any angle.
2. Shows the numbers that matter — axle spacings, track widths, dual spacings,
   tire sizes — as measurable, annotated, exportable dimensions.
3. Exports **machine-readable footprint coordinates** that drop straight into a
   finite-element pre-processor.

Point 3 is the differentiator.

**Live:** `/e-labs/gear3d/`

---

## Quick start

It is a static app. No build step.

```bash
# from the repository root
bundle exec jekyll serve      # → http://localhost:4000/e-labs/gear3d/
# or, without Jekyll:
python -m http.server 8899    # → http://localhost:8899/e-labs/gear3d/
```

Tests need only Node ≥ 18:

```bash
cd e-labs/gear3d
npm test          # 141 checks, no dependencies
```

---

## Architecture

Scene units are **metres**; everything else is **millimetres**. The single
1/1000 scale lives on the assembly root and nowhere else.

```
index.html · styles.css · main.js        shell and UI controller
src/
  core/       coords · units · prng · tires · schema · store · bridge ·
              layout · version
  data/       tires.json · trucks/*.json · aircraft/*.json · SOURCES.md
  geometry/   tire · rim · hub · axle · chassis · assembly · assets
  scene/      renderer · cameras · lighting · materials · environment ·
              textures · grid
  annotate/   projection · dimensions · snapping
  contact/    models · patch · export
  views/      isolation · quadview
  io/         project · exportRaster · exportVector
assets/       textures/ (CC0, see CREDITS.md)
test/         harness.mjs · run.mjs
```

**The load-bearing rule:** `src/core`, `src/contact` and `src/annotate/projection.js`
import **no three.js and touch no DOM**. That is what makes coordinates, unit
conversion, tire parsing, layout resolution, bridge-formula compliance, contact
models and label decluttering testable under plain Node — and it is why the
renderer, the dimension engine and the FEM export cannot disagree about where a
tire is: all three consume the same `resolveLayout()` output.

### Coordinate system

Defined once in `src/core/coords.js` and never deviated from:

- `x` longitudinal, **positive rearward**, origin at the front-most axle centreline
- `y` transverse, **positive right** of the direction of travel, origin on the centreline
- `z` vertical, **positive up**, `z = 0` at the pavement surface

Right-handed, millimetres. three.js is Y-up, so `(x,y,z)_eng → (y,z,x)_three`
at the scene boundary only — a cyclic permutation, so handedness is preserved.
Render coordinates never appear in data or exports.

---

## How to add a vehicle

1. Pick the right file in `src/data/trucks/` — `light.json` (classes 1–3),
   `single-unit.json` (4–7), `single-trailer.json` (8–10), `multi-trailer.json`
   (11–13).
2. Add a unit to its `units[]` array. Required: `schemaVersion`, `id`,
   `domain`, `classification`, `axles[]`, `axleGroups[]`, `sources[]`.
3. **Every axle needs a `source` string. Every load needs a `basis` string.**
   The test suite fails the build otherwise — that is deliberate.
4. The first axle must be at `x: 0`; axles must be ordered front to rear.
5. If the vehicle claims federal legality, leave `federalBridgeFormula` unset
   (classes ≥ 5 default to `"compliant"`) and the suite will check it over
   every consecutive-axle subset. If it does not comply, say so with
   `"permit"` or `"exempt"` rather than quietly excluding it.
6. `npm test`.

## How to add a tire

- **Metric** (`315/80R22.5`), **passenger** (`LT245/75R16`) and **aircraft**
  (`H44.5x16.5-21`, `1400x530R23`) sizes need nothing — the designation encodes
  the dimensions and `src/core/tires.js` computes them.
- **Inch-nominal** sizes (`11R22.5`) do not encode overall diameter, so they
  need an entry in `src/data/tires.json` under `nominal`, with `sectionWidth`,
  `overallDiameter`, a `source` and a `confidence`. A size that is absent is
  reported as unknown; it is never guessed.
- Add it to `presets` too if it should appear in the UI pickers.

---

## Determinism

`Math.random()` is not used anywhere. Every procedural detail draws from a
seeded generator (`src/core/prng.js`) keyed on the project seed, which is shown
in the UI and stored in the project file. Same seed and settings → identical
render.

---

## Export

| Output | Notes |
|---|---|
| PNG / PNG-transparent / JPEG | Re-rendered at full resolution. Above the GPU's `MAX_RENDERBUFFER_SIZE` / `MAX_TEXTURE_SIZE` the render is **tiled** and composited, so 600 dpi works on integrated graphics. A blank result raises an error instead of silently saving a black rectangle. |
| **SVG** | Hybrid: shaded render embedded as a raster, all dimensions and labels kept **vector**. This is the format that survives journal production. |
| **PDF** | Same hybrid composition. Self-contained writer — no external library, works offline. |
| `footprint.csv` / `.json` | Contact patches with load, pressure, area and equivalent radius. |
| Abaqus parameter table | Patch rectangles and pressures, with the assumptions stated in the header. Not a runnable deck — see `DECISIONS.md` §D11. |
| `unit.json` | The full parametric definition, citations included. |
| `.gear3d` | Unit + customizations + camera (all four modes) + lighting + annotations + materials + seed. Quad view exports as a single check sheet. |
| **`.glb`** (glTF) | The visible geometry, in the **engineering frame** and in **millimetres** — the same coordinates as `footprint.csv`, not the render frame and not glTF's metre convention. Instances share geometry, so 34 tyres reference one mesh. Frame and unit are written into the file's `extras`. |
| **`.obj`** | Same geometry for pre-processors that will not read glTF. OBJ has no instancing, so a full unit is large — the app says so at export time and suggests isolating an axle or using `.glb`. |
| Gear matrix | N×M comparison sheet with shared camera, lighting and **shared scale**, so cells are genuinely comparable. |

---

## Chassis silhouettes

The **Full unit** isolation level draws the vehicle envelope around the
running gear. It is a *schematic*, and deliberately looks like one —
translucent panels with picked-out edges, never a modelled body.

That is not a shortcut. Gear3D has no sourced body dimensions, so the
envelope is built only from bounds that are citable: the unit's own overall
length, the 102 in federal width limit, the 13 ft 6 in height limit, and the
real axle positions. The internal subdivision is representative and the app
names it on screen. The silhouette carries no snap targets and cannot be
picked, so no measurement can ever be taken off it.

Aircraft show no fuselage: nothing in the sourced data constrains one.

## Measuring

Press **`M`** (or the Measure button) and click two features. Endpoints snap
only to real geometry — tire centres and edges, contact patch centres, axle
centrelines — because a free-hand endpoint produces a number that looks
authoritative and is quietly wrong. Snap targets follow visibility, so a
dimension can never be anchored to something the reader cannot see.

Measurements land in `customDimensions`, are undoable, list in the Dimensions
panel with a delete control, and save into the `.gear3d` file. A measurement
that is essentially axis-aligned is labelled with that axis and behaves like an
automatic one; a diagonal is marked `free` and its dimension line is offset
perpendicular to the measurement itself rather than to a coordinate axis.

## Keyboard

| Key | Action |
|---|---|
| `V` then `1`–`5` | Quad / 3D / Plan / Side / Front |
| `C` | Gear configuration catalogue |
| `M` | Measure mode |
| `A` | Annotations on/off |
| `G` | Ground grid on/off |
| `Esc` | Cancel a pending measurement, then measure mode, then step out one isolation level |
| `F` | Fit |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` | Save project |

Click an axle in the viewport to isolate it; `Esc` steps back up.

**Annotations start sparse on purpose.** A full class 9 with every dimension
set enabled puts around twenty dimension lines over the model and the geometry
stops being readable. Longitudinal spacings and the scale bar are on by
default; the rest are one checkbox away, and `A` clears everything at once.

---

## Provenance

The app's central claim is that its dimensions are real engineering values.
Every axle carries a citation and every load a stated basis, both visible in
the properties panel. **`src/data/SOURCES.md` records the verification status
of every number, including what could *not* be verified** — read it before
using any output in a publication.

`window.gear3d` exposes the live state so the resolved layout and patch table
can be read straight from the console, without trusting the UI.

---

## Rendering (v1.1)

- **Image-based lighting.** A studio environment is generated at runtime
  (`src/scene/environment.js`) and PMREM-filtered. Machined aluminium is
  defined by what it reflects; without IBL no roughness value makes a rim read
  as metal. Built procedurally rather than loaded from an HDRI so there is no
  asset dependency, no third-party licence in the repo, and the environment
  stays a pure function of the lighting parameters. The softbox positions
  follow the key light's azimuth, so reflections agree with cast shadows.
- **Tread is geometry, not texture.** The tire is a custom revolve whose outer
  radius is modulated by the tread pattern, so grooves and lug blocks break the
  silhouette, catch the key light and self-shadow. A perfect circular outline is
  the loudest "this is CG" tell in a tire render. Textures now carry only the
  fine detail geometry cannot afford.
- **Sidewall and tread are separate materials**, via geometry groups — they are
  genuinely different surfaces.
- **Wheel handedness is modelled.** Dual wheels bolt together back-to-back, so
  the two wheels of a dual pair are mirror images, and each disc sits near its
  outboard face rather than at the tire's centre plane.
- **Adaptive detail.** `pickQuality()` steps segment counts down as tire count
  rises, so an isolated axle gets the full treatment and a 34-tire turnpike
  double stays interactive.
- **Supersampled export.** Renders at 2× and box-filters down, which resolves
  the specular shimmer on polished lips and the sub-pixel detail in tread
  grooves that MSAA alone leaves aliased at 600 dpi. Composes with the tiled
  fallback automatically.

## Gear nomenclature — FAA Order 5300.7 (v1.9)

Order 5300.7, effective 6 October 2005, replaced three mutually untranslatable
naming systems — the FAA's own, the Air Force's and the Navy's — with one
grammar. Gear3D implements it **as a grammar**, in `src/core/gearcode.js`,
rather than as a lookup table:

```
    # X #  /  # X #  ( P )
    │ │ │     │ │ │    └── optional ICAO tire pressure code, Table 1
    │ │ │     │ │ └────── TOTAL number of body/belly gears
    │ │ │     │ └──────── gear type, S D T or Q
    │ │ │     └────────── gear types in tandem
    │ │ └──────────────── number of main gears in line, ONE SIDE
    │ └────────────────── gear type, S D T or Q
    └──────────────────── gear types in tandem
```

The module parses, re-emits, describes and counts wheels. Table 3 is
transcribed in full — all eighteen rows, with the historic FAA, U.S. Air Force
and U.S. Navy names, because the Order is the only published concordance
between the four systems, and an engineer holding a drawing marked `T-TA` or
`DDT` has nowhere else to look.

Three rules are easy to get wrong and each has a test pinned to it:

- **The main multiple is doubled; the body multiple is not.** §6e's count is
  gears in line *on one side* of a symmetric gear. §6f's is the *total* across
  the aircraft. Swap them and `2D/D1` comes out at 12 wheels instead of 10.
- **The body count is never omitted** (§6f), "because body gear arrangement
  may not be symmetrical". `2D/D` is refused, not silently read as `2D/D1`.
- **`T` means triple, not tandem** (§6d). The letter changed meaning when this
  Order took effect, so a pre-2005 drawing marked `T` may well mean something
  else, and `2T` is twelve wheels rather than eight.

**The convention is open-ended and the app treats it that way.** Figure 2's
caption — *increase numeric value for additional tandem axles* — means `9Q` is
a legal name whether or not anyone has built one. Validation is by parsing, not
by membership of a table.

Press `C` for the **catalogue**: all 21 configurations as Figure 2-style wheel
plans, each with its wheel count, its reference figure, the aircraft the Order
names against it, and whether this library answers it with a measured aircraft
or a schematic. Click one to load it. The thumbnails come from the same
`wheelPlan()` the app uses elsewhere, so a diagram cannot disagree with the
model it loads.

### Configurations (v1.9)

Sixteen loadable configurations cover every code in the Order:
**S, T, Q, 2S, 2T, 2Q, 3S, 3T, 3Q, 2D/D1, 2D/2D1, 5D, 7D, C5, D2, Q2.**
The five codes that already have measured aircraft — D, 2D, 3D, 2D/2D2,
2D/3D2 — point at those instead of being duplicated, because a measured
aircraft is strictly better than a drawing of one.

**Every one of them is flagged `Schematic`**, in the title block and in an
amber panel notice, and the distinction is worth keeping sharp:

- **Real, and cited per gear:** the wheel geometry — track, dual spacing,
  tandem spacing, body-gear offset — of the ten configurations whose
  representative aircraft appears in the **FAARFIELD 2.1.1 aircraft library**
  (C-130, C-17, DC-10-30, A340-600, An-124, An-225, C-5, B-52, IL-76, F-15).
  That library publishes per-wheel coordinates in millimetres and is already
  what this project uses to corroborate the 747 and A380.
- **Nominal, and declared:** the tire and the wheelbase, on all sixteen.
  FAARFIELD carries a contact patch and an inflation pressure, not a Tire and
  Rim Association designation, and it models the main gear only because the
  nose gear carries too little load to matter to thickness design. The nose
  gear's *type* is real — Table 3 tabulates it — but its distance forward
  is not.
- **The six pure patterns** (`T`, `Q`, `2Q`, `3S`, `3T`, `3Q`) have no aircraft
  behind them and are drawn to one nominal scale so Figure 2's cells stay
  comparable. Not one of those numbers describes an aircraft.

**None of them states a `mainGearOuterWidth`, and that is deliberate.** On a
real aircraft the FAA's published outer width is the datum and the track is
derived from it; here the relationship runs the other way — the track is
measured and the outer width would depend on the nominal tire — so stating one
would dress a placeholder up as a datum.

### Uneven bogies

`wheelOffsets` on a gear carries explicit lateral wheel positions where the
published spacing is not even, instead of averaging it into a single pitch. The
C-5's quadruple axle sits in two pairs with a wider gap up the middle
(34 in, 53 in, 34 in), the IL-76's is 620/820/620 mm and the C-17's triple is
1079.5 and 1028.7 mm. Absent the array a bogie is spread evenly at
`dualSpacing`, which is every other gear in the library.

The C-5 is modelled as **eight axles rather than four bogies**, because each of
its bogies carries a quadruple axle *and* a dual axle — which is exactly why
§6h declines to name it by the convention at all, and the only honest way to
express a mixed bogie in a schema built on wheels-across times rows.

## Aircraft (v1.2, extended v1.6)

Four Boeing aircraft spanning gear codes **D, 2D and 3D**: 737-800, 757-200,
767-400ER, 777-300ER.

The important detail: the FAA publishes main gear **outer** width — its data
dictionary says *"distance between outer tires"* — not the centreline tread.
Gear3D therefore **derives** the track from it rather than assuming they are
the same, which on a 777 would misplace every main wheel by nearly a metre per
side. With the recorded dual spacings, that derivation reproduces each
manufacturer's separately published tread to within 10–26 mm on all four
aircraft; the test suite asserts it.

Nose gear dual spacing is **not** constrained by any consulted source. Each
unit declares it in `assumedFields`, validation fails if that declaration is
missing, and the app shows an amber notice naming it whenever an aircraft is
loaded. Changing a dual spacing re-derives the track, so the authoritative
outer width survives whatever you enter. Full breakdown in
`src/data/SOURCES.md` §5.

**v1.9 retires the tandem-spacing assumptions.** The 757-200, 767-400ER and
777-300ER declared `MLG.tandemSpacing` as assumed; the FAARFIELD 2.1.1 library
constrains all three. Two were wrong — the 767-400ER by 50.4 mm and the
777-300ER by 15.0 mm — and the 757-200's assumed 45 in was exactly right. A
tandem spread is symmetric about the bogie centre, so a wrong one moves both
axle lines and leaves the wheelbase, the track and the outer width untouched;
that is precisely why it could sit undetected for seven releases while every
other check on those aircraft passed.

## Status

**v1.0** shipped M0–M6 plus M7. **v1.1** added the rendering work above and the
glTF asset-slot loader. **v1.2** adds the aircraft library (M8), ghost
rendering, and the E-Labs preview image.

**v1.4** adds chassis silhouettes, a drafting-title-block header, draggable
callouts, material controls and the quad view.

**v1.5** adds per-tire measured contact-patch overrides and glTF/OBJ geometry
export. **v1.6** adds the three wing-plus-body aircraft, closing the build spec.
**v1.8** raises text contrast to WCAG AA across both themes and gives the
structure tree a proper keyboard model. **v1.7** is a visual pass: chrome drawn on the figure now follows the figure
rather than the app theme, the viewport is composed as a sheet, and dimension
labels are decluttered by their true rotated footprint. **v1.6.1** corrects the
767-400ER main gear dual spacing to the FAARFIELD value
(1143 → 1163 mm), dropping its tread cross-check residual from 26 mm to 6 mm.
The outer tire edge is unmoved — the authoritative outer width is held, so the
correction is absorbed inside it — while the inboard tire shifts 20 mm and the
strut 10 mm. The cross-check tolerance that let a 26 mm error pass for four
releases is tightened from 40 mm to 15 mm.

**v1.9** implements the FAA Order 5300.7 naming convention as a grammar, adds
sixteen gear configurations covering every code in the Order (library 22 → 38),
makes quad the default view, and corrects three tandem spacings that were
assumed and are not. 175 checks, up from 160.

**v1.10** raises the live viewport to a UHD drawing buffer with adaptive
supersampling, fixes a renderer that had been redrawing at 60 fps while idle
since v1.0, and completes the Gear configuration picker: it listed only the
sixteen schematics, so the five conventions answered by a measured aircraft —
D, 2D, 3D, 2D/2D2, 2D/3D2 — were missing from the one list in the app that
exists to enumerate the convention. It now lists all twenty-one, and a test
asserts the coverage at library level. 176 checks.

## Render resolution (v1.10)

The viewport used to render at `min(devicePixelRatio, 2)`, which on an ordinary
1x desktop monitor is a pixel ratio of **one**. A viewport around 1000 x 660 CSS
pixels was therefore rasterised at 0.7 megapixels, and it showed — faceted tyre
silhouettes, stair-stepped shadow edges, specular shimmer on the rim lips that
MSAA cannot touch because it only antialiases geometry edges. The figure export
has always supersampled; the live view had not.

**Rendering → Quality** now offers three tiers, and each moves the pixel count
and the geometry together, because raising either alone is wasted: more pixels
on a faceted silhouette merely resolve the facets, and more segments behind a
1x buffer are never seen.

| Tier | Drawing buffer | Tyre floor | Shadow map |
|---|---|---|---|
| Balanced | 1920 px wide | adaptive | 2048 |
| High | 2560 px | 240 segments | 3072 |
| **Ultra — UHD** (default) | **3840 px** | 352 segments | 4096 |

On a 1017 x 693 viewport that is **3840 x 2617, 10.0 MP, a 3.78x buffer**. The
panel and the status strip both print what is actually being rasterised, because
the ratio depends on the viewport's CSS width, the display's own pixel ratio and
what the GL context will allocate — "Ultra" is not the same number of pixels on
two machines, and a reader who asked for UHD is entitled to check.

**Interaction drops to a 1.25x buffer and the full frame is drawn 220 ms after
the view settles.** A 10 MP frame is entirely affordable for an image that is
going to sit on screen and not at all affordable at 60 fps during an orbit, so
the cost lands on the still image rather than on the drag.

Two things had to be fixed to make this work, and both were long-standing:

- **The renderer was never actually on demand.** `OrbitControls.update()`
  returns `true` on every frame even when the camera has not moved — its settle
  test compares quaternions against a 1e-6 epsilon and the jitter from calling
  `lookAt()` each update sits on that threshold. The loop trusted that return
  value, so an idle Gear3D redrew at 60 fps for the whole life of the app. It
  now compares position, orientation, target and zoom itself. **Idle is now
  zero renders per second.**
- **A grid line is one DEVICE pixel wide** whatever the ratio, so at 3.78x it is
  a quarter of a CSS pixel and the grid does not look sharper, it looks like it
  faded out. Its alpha is scaled by the ratio to hold the integrated weight
  constant, which is the quantity the eye actually reads.

`Tyre detail` is separate for when you want to override: `auto` scales segment
count by tyre count, which is what the README has always claimed and what — see
below — the app never actually did.

**Bug fixed in passing.** `view.quality` defaulted to `'standard'`, which is a
valid `QUALITY` key and therefore an *override*, so `pickQuality`'s adaptive
step-down never ran once. A 34-tyre turnpike double got the same segment count
as a single isolated axle. The default is now `'auto'`.

## Quad view — the default since v1.9

`Quad` renders plan, 3D, side and front in one frame — the layout for
*checking* a configuration rather than composing a single figure, and it
exports as a complete check sheet.

**It is what the app opens on.** A gear configuration is a plan first: the
thing a reader needs from it is where the wheels are, and a single pictorial
3D view is the one arrangement that answers that worst, because it foreshortens
both axes at once and no spacing can be read off it. Opening on all four shows
the layout, the elevation, the track and the pictorial together, which is what
a gear drawing has looked like for as long as there have been gear drawings.
Clicking any pane still opens it full size, and the `V`-then-digit shortcuts
follow the toolbar order, so `V1` is Quad.

Plan sits above Side so the two share a longitudinal axis and a dimension can
be carried straight down between them; Side and Front share a row and the
vertical axis. **The three orthographic panes share one scale.** Fitted
independently the front elevation of a 22 m truck comes out roughly seven
times larger than its side elevation — each pane correctly framed and the
sheet useless. Drafting practice puts all three at one scale and so does
this; 3D is a pictorial reference, so it keeps its own fit.

Annotations are drawn per pane and clipped to it. Click any pane to open it
full size.

Nothing from the original build spec is outstanding. The 747 and A380, deferred
since the first build for want of published body-gear offsets, ship in v1.6 —
see **Wing-plus-body gear** below.

## Wing-plus-body gear (v1.6)

The **747-400**, **747-8** (2D/2D2) and **A380-800** (2D/3D2) have four main
struts rather than two: a wing gear and, inboard and further aft, a body gear.
They were deferred through v1.5 for a specific reason — a single main-gear
outer width closes a two-strut layout, but it cannot close a four-bogie one.
The body gear's offset from the wing gear is a free parameter, and no summary
table carries it.

It turned out to be a **data** problem, not a modelling one. The manufacturers'
own footprint figures — Boeing ACAP §7.2, Airbus AC §7-2-0 — state the track,
both gear positions and every spacing outright. So for these three the sourcing
is **inverted**: the geometry is read off the figure and the outer width becomes
a cross-check, closing to 0.2, 5 and 5 mm respectively. Nothing is assumed on
the 747-8 or the A380 at all.

Every dimension is corroborated independently by the FAA's FAARFIELD 2.1.1
aircraft library, which stores explicit per-wheel coordinates and agrees with
the manufacturer figures **to the millimetre** — including the A380 body
bogie's 20 mm wider middle axle (1530 / 1550 / 1530 mm), which is carried in
`dualSpacingByRow` rather than averaged away.

Two things this exposed, both of which were latent bugs that only a mixed-bogie
aircraft could reveal:

- **The outer-width check reached for the first main gear.** On the A380 the
  body bogie is *wider* than the wing bogie (1530 against 1350 mm), so the
  quantity that closes the outer width is the outermost strut's, not the first
  one listed. Every previous aircraft made those the same thing.
- **The wheelbase averaged struts, not tires.** The A380's body gear carries
  twelve of the twenty main tires, which pulls the load centroid 328 mm aft of
  the midpoint between wing and body gear. A plain mean is right on every other
  aircraft in the library — which is exactly what would have kept it hidden.

`SOURCES.md` §5.5 records both, plus two places where the FAA database
disagrees with the manufacturers and the manufacturers are followed.

## Accessibility (v1.8)

**Text contrast.** `--g3-muted` had shipped since v1.0 at 2.72:1 on the light
theme's panel, below the WCAG AA minimum on every background in that theme,
across 55 elements. Both themes' muted tokens are raised, and graphite is
darkened with them so the two tiers stay a visible step apart rather than
collapsing together. Measured across the whole interface: **55 failures to 0,
in both themes.**

It is a test, not a note: `test/run.mjs` parses `styles.css` and asserts every
text token against every surface it is drawn on. A token is one edit from
regressing, and 2.72:1 does not look broken — it looks slightly soft, which is
why it lasted seven releases.

**The structure tree is one tab stop.** It was nineteen — every node was
tabbable, which a keyboard user had to walk through to reach anything past the
panel. It now behaves as `role="tree"` implies: a single tab stop with
Up/Down/Home/End moving within it, and `aria-selected` so the current row is
announced rather than being conveyed by colour alone.

## Interface (v1.7)

The design system did not change — no new colours, no new controls. What
changed is craft.

**Chrome on the figure follows the figure.** The viewport shows publication
white in both themes, because it is a preview of the exported figure and the
annotation halo depends on that. The HUD and axis badge were nonetheless
themed, so dark mode put near-black pills on white paper. They now take their
colours from `--g3-fig-*`, declared on the viewport itself. The rule: on the
figure, follow the figure; on the interface, follow the theme.

**The viewport is a sheet.** Given an edge, a mat and a lift, the white plate
reads as drafting film on a desk rather than a hole in the interface. The mat
is a shadow ring, not padding — see `DECISIONS.md` §D25 for why padding would
silently misalign every dimension line.

**Labels stop colliding.** Dimension values are rotated along their dimension
lines, but the declutter pass was testing their *unrotated* boxes and so let
steeply angled labels overlap. Measured before and after: a five-dimension
truck went from overlapping labels at the default camera to zero overlapping
pairs at four orbits.

**Chrome recedes until asked for.** The structure tree's isolate buttons appear
on hover and keyboard focus instead of stacking twenty identical icons down one
edge, and nested rows get depth guides so a wheel's parent axle is readable at
a glance.

Plus: selects carry a chevron and ellipsis instead of clipping mid-word,
section headers stay put while their contents scroll, the idle coordinate
readout collapses instead of showing a lone dash, and the floating HUD stands
down in quad view where it was covering the PLAN pane's own label.

## Materials

Five controls per surface — tint, brightness, roughness, relief — matching
Cross-Section Studio, so a figure pair from the two apps can be matched by
eye. Overrides are strictly **appearance**: nothing there can move a
dimension, resize a contact patch or alter an export, which is why they live
in the view state rather than the undoable document. They are saved in the
project file and re-applied when the material library is rebuilt.

## Documents

- `DECISIONS.md` — every `[DECISION]`, and every deliberate deviation from the spec
- `DESIGN.md` — token system, signature element, self-critique, accessibility
- `ASSETS.md` — the contract for contributing higher-fidelity glTF meshes
- `src/data/SOURCES.md` — citations and verification status
