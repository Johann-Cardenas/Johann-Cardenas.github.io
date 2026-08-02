# Gear3D — Decisions

Every point the build spec marked **[DECISION]**, plus the deviations from the
spec that this build made deliberately. Each entry states what was decided and
why, so a later maintainer can overturn it on the merits rather than guessing.

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
