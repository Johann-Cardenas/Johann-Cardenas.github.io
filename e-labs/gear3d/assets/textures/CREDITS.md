# Gear3D — third-party asset credits

Every file in this directory, its licence, and what was done to it.

---

## Rubber004 — tyre surface micro-detail

| | |
|---|---|
| **Files** | `rubber004_normal.jpg`, `rubber004_rough.jpg` |
| **Source** | <https://ambientcg.com/view?id=Rubber004> |
| **Provider** | ambientCG (Lennart Demes) |
| **Licence** | **CC0 1.0 Universal** (public domain dedication) |
| **Licence verified** | <https://ambientcg.com/license> — *"licensed under the Creative Commons CC0 1.0 Universal License"* |
| **Retrieved** | 2026-08-03 |
| **Tile size** | 75 × 75 mm (the provider's stated physical scale) |

CC0 requires no attribution. This record exists anyway, because an
engineering tool should be able to account for every pixel it ships.

### What was changed

Downloaded as the 1K-JPG set (8.4 MB). From it, **only the NormalGL and
Roughness maps** were kept, resized to 512 × 512 and re-encoded as
progressive JPEG at quality 88 — 114 KB total.

Deliberately **not** used:

- **Color** — Gear3D drives base colour from its own material spec so the
  tint and brightness controls stay meaningful, and so a scanned
  photograph's baked-in lighting can never contaminate a figure.
- **Displacement** — tread relief is real geometry (`src/geometry/tire.js`).
- **Metalness** — a per-material constant here, not a map.

512 px is not a compromise: these are seamless micro-detail maps tiled
dozens of times around a tyre's circumference, so resolution beyond the
tile's own physical scale buys nothing visible and costs weight on a
GitHub Pages site.

### How it is applied

Tiling is derived from **real physical dimensions**, not guessed. For an
11R22.5 the circumference is π × 1054 mm = 3311 mm, which is 3311 / 75 =
44.1 tiles; the tyre mesh's own UVs already repeat 11 times, so the texture
repeat is 44.1 / 11 = 4.01. Rubber grain is therefore the same physical size
on a motorcycle tyre as on an aircraft tyre, as it is in life.

---

## Evaluated and rejected

Recording these matters as much as recording what shipped: the next person
to ask "why isn't there a metal texture?" deserves the answer.

### Metal012 — rejected

<https://ambientcg.com/view?id=Metal012>, also CC0.

Two independent reasons:

1. Its normal map is almost perfectly flat (2 KB at 512 px after
   compression) — a smooth metal, contributing no visible machining detail.
2. Its roughness map dropped the rims and axle beams to a wet, plastic
   gloss that was plainly worse than the tuned values.

The underlying point is physical: **machined metal is characterised by what
it reflects**, and the studio environment map (`src/scene/environment.js`)
already supplies that. Rubber gains from measured micro-detail because
rubber genuinely *is* micro-detailed.

### Poly Haven CC0 meshes — rejected

<https://polyhaven.com/license> confirms CC0 with redistribution explicitly
permitted, so licensing was not the obstacle. Dimensions were checked
against the 1.6× distortion cap in `ASSETS.md` §4:

| Mesh | Actual size | Scaled to 11R22.5 | Verdict |
|---|---|---|---|
| `old_tyre` | 600 × 165 mm | **1.757×** | exceeds the cap |
| `rusted_wheel_rim_01` | 403 × 154 mm | **2.615×** | exceeds the cap |

Both are **car** parts, not truck parts, and both are tagged by their
authors as *trash / scrapyard / junkyard / rusted*. They do fit the light
FHWA classes within the cap (`old_tyre` → P225/60R16 is 1.364×), but a
rusted scrapyard car tyre is an appearance *downgrade* for a pavement
engineering figure, on precisely the vehicle classes that matter least for
pavement loading.

The procedural tyre is dimensionally exact for any designation in the
library, including sizes nobody has modelled. It remains the reference
implementation.

**No CC0 truck wheel, truck tyre or aircraft landing gear mesh was found.**
Poly Haven's 521-model library is props, tools and furniture; the search
covered every asset whose name, tags or categories matched wheel, tyre,
truck, vehicle, aircraft, axle or industrial.

---

## If you want to add an asset

Follow `ASSETS.md`. Record the source URL, the licence identifier and the
author in the manifest entry. If those three cannot be stated, the asset
does not go in.
