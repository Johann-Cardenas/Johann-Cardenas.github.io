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
npm test          # 74 checks, no dependencies
```

---

## Architecture

Scene units are **metres**; everything else is **millimetres**. The single
1/1000 scale lives on the assembly root and nowhere else.

```
index.html · styles.css · main.js        shell and UI controller
src/
  core/       coords · units · prng · tires · schema · store · bridge · layout
  data/       tires.json · trucks/*.json · SOURCES.md
  geometry/   tire · rim · hub · axle · assembly
  scene/      renderer · cameras · lighting · materials
  annotate/   projection · dimensions
  contact/    models · patch · export
  views/      isolation
  io/         project · exportRaster · exportVector
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
| `.gear3d` | Unit + customizations + camera (all four modes) + lighting + annotations + seed. |
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
| `V` then `1`–`4` | 3D / Plan / Side / Front |
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

## Aircraft (v1.2)

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

**v1.4** adds chassis silhouettes.

**v1.4** adds chassis silhouettes, a drafting-title-block header, draggable
callouts and material controls.

Deferred, with reasons in `DECISIONS.md`:

- **747 and A380** — wing-plus-body gear layouts need body-gear offsets that no
  consulted source provides (`SOURCES.md` §5.5).
- The 2×2 quad view, per-tire contact patch overrides, and glTF/OBJ scene
  export.

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
