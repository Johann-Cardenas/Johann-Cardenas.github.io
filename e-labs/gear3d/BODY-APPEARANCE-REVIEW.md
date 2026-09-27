# Gear3D 1.14: additional 767 variants and body appearance

Added the 767-200ER and 767-300F using Boeing D6-58328 Rev K
(December 2024), available from the [Boeing airport planning manual](https://www.boeing.com/content/dam/boeing/v2/airports/acaps/767_REV_K.pdf).

| Variant | Takeoff / taxi weight (lb) | Main / nose pressure (psi) | PDF pages |
|---|---|---|---|
| 767-200ER | 395,000 / 396,000 | 190 / 185 | 23, 193 |
| 767-300F | 412,000 / 413,000 | 200 / 172 | 26, 194 |

Pressure comes from the corresponding taxi-weight column. Wheel loads continue
to use takeoff weight and the explicitly assumed 95% main-gear split.
The footprint drawings specify the same gear geometry as the existing
767-200 and 767-300ER respectively. Existing same-length passenger meshes,
attitudes and illustrative attachment heights are reused; cargo doors,
glazing and engine options are not variant-specific. This limitation is
recorded in each unit's notes, body-fit source and assumed fields.

The upstream generator is `e-labs/gear3d/scripts/build-boeing-variants.mjs`.
Its generated JSON and index are copied into this port's public data library.
No new third-party mesh or license is introduced.

Body customization now includes shaded/wireframe surface, matte/satin/metallic
finish and aircraft intake contrast. All three persist in project files and
autosave; old projects receive the default settings. Reset restores them.
Intake shading uses a smooth normal-dependent mask on the existing airframe,
without adding triangles or changing wheel coordinates. The body stays
excluded from engineering geometry and footprint exports.

Product changes live upstream in the controller, HTML shell and geometry
module. The course controller is regenerated with `port-main.mjs`; the React
shell carries the matching controls.

Validation passed in clean checkouts outside the Box workspace:

- All 196 upstream checks and all 52 Gear3D tests.
- Full Astro production build: 34 pages, including Pagefind indexing.
- Browser regression against the production-built page: both variants,
  unchanged wheel data and mesh identity, material changes, project round
  trips, old-project defaults, autosave reload, reset and a 390-pixel viewport.
- Controller regeneration and upstream/port body, data and version parity.
- American spelling and Git whitespace checks.
