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
| `V` then `1`–`5` | 3D / Plan / Side / Front / Quad |
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

Nose gear dual spacing and tandem spacing are **not** constrained by any
consulted source. Each unit declares them in `assumedFields`, validation fails
if that declaration is missing, and the app shows an amber notice naming them
whenever an aircraft is loaded. Changing a dual spacing re-derives the track,
so the authoritative outer width survives whatever you enter. Full breakdown in
`src/data/SOURCES.md` §5.

## Status

**v1.0** shipped M0–M6 plus M7. **v1.1** added the rendering work above and the
glTF asset-slot loader. **v1.2** adds the aircraft library (M8), ghost
rendering, and the E-Labs preview image.

**v1.4** adds chassis silhouettes, a drafting-title-block header, draggable
callouts, material controls and the quad view.

**v1.5** adds per-tire measured contact-patch overrides and glTF/OBJ geometry
export. **v1.6** adds the three wing-plus-body aircraft, closing the build spec.

## Quad view

`Quad` renders plan, 3D, side and front in one frame — the layout for
*checking* a configuration rather than composing a single figure, and it
exports as a complete check sheet.

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
