# Gear3D — Asset contribution contract

Gear3D ships **entirely procedural geometry**. Every tire, rim, hub and axle
beam is generated from parameters, so the app has no asset dependency and
cannot break because a file is missing.

This document specifies how to drop in higher-fidelity meshes later **without
touching any layout code**. If you follow it exactly, an authored wheel
replaces a procedural one and every dimension, contact patch and export stays
identical — because none of those read the mesh. They read the parameters.

---

## 1. Format

| Requirement | Value |
|---|---|
| Container | **glTF 2.0 binary (`.glb`)** — single file, embedded textures |
| Compression | Draco optional; if used, state it in the manifest entry |
| Meshes per file | **One.** A slot is one mesh. Split a wheel into `tire` + `rim` + `hub` files. |
| Units | **Meters** (the glTF standard). Gear3D scales to its own frame. |
| Up axis | **+Y** (the glTF standard) |
| Materials | PBR metallic-roughness. No custom extensions beyond `KHR_materials_*`. |
| Triangle budget | ≤ 12 000 per tire, ≤ 8 000 per rim, ≤ 3 000 per hub |

The triangle budget is not arbitrary. A class 13 turnpike double carries **34
tires**, and the gear matrix renders four assemblies at once. At 12 000
triangles a tire that is 408 000 triangles for the tires alone, which is the
most an integrated GPU will hold at 60 fps alongside shadow mapping.

---

## 2. Origin and orientation — the part that matters most

> **Origin: the wheel center, exactly on the rotation axis.**
> **Rotation axis: the asset's local +X.**

Gear3D places a wheel by translating its origin to the wheel center and does
**no** rotation, because engineering +y (transverse) maps to render +x. If your
origin is off-axis, every tire in every figure is eccentric. If your axis is +Z
because that is what your DCC tool defaults to, every wheel lies on its side.

Check both before exporting. They are the two failures that are invisible in a
modeling viewport and obvious in a rendered figure.

For `axleBeam`, the origin is the **center of the axle**, on the vehicle
centerline, and the beam runs along local **+X**.

---

## 3. Slots

| Slot | What it is | Reference size to model at |
|---|---|---|
| `tire` | Tire carcass with molded tread | `11R22.5` — 1054 mm OD, 279 mm section |
| `rim` | Wheel barrel plus disc face | 22.5 in rim, 0.72 × section width |
| `hub` | Hub, cap and lug nuts | 10-stud, 22.5 in |
| `brakeDrum` | Brake drum | 22.5 in |
| `axleBeam` | Axle housing, spring pads, differential | 1829 mm track |
| `chassis:<bodyType>` | Chassis silhouette; `<bodyType>` matches the unit's `bodyType` | per body type |

---

## 4. Scaling and the distortion cap

An authored asset is **scaled non-uniformly** to match the parametric
dimensions of the tire it stands in for:

```
scale.x = targetSectionWidth    / referenceSectionWidth
scale.y = targetOverallDiameter / referenceOverallDiameter
scale.z = targetOverallDiameter / referenceOverallDiameter
```

Model at the reference size in the table above and these stay near 1.

Gear3D **logs every scale factor** and **rejects any asset whose scale exceeds
1.6× or falls below 1/1.6 on any axis**, falling back to procedural geometry
with a console warning. A 445/50R22.5 wide-base tire stretched from an 11R22.5
reference is 445/279 = 1.60 on width — right at the cap, and it looks it.
Author a separate asset for the wide-base family rather than stretching one.

---

## 5. Registry

`assets/manifest.json`:

```jsonc
{
  "schemaVersion": "1.0",
  "assets": [
    {
      "slot": "tire",
      "match": { "designation": "11R22.5" },
      "file": "tires/11R22.5.glb",
      "reference": { "overallDiameter": 1054, "sectionWidth": 279 },
      "draco": false,
      "credit": "Author name, license"
    },
    {
      "slot": "tire",
      "match": { "family": "metric", "rimDiameter": 571.5 },
      "file": "tires/metric-22-5.glb",
      "reference": { "overallDiameter": 1016, "sectionWidth": 295 }
    }
  ]
}
```

**Resolution order** — first match wins, and the chain always terminates:

1. exact `designation`
2. `family` + `rimDiameter`
3. `family`
4. **procedural** (always available, never fails)

An asset that fails to load, fails the distortion cap, or is missing entirely
falls through to procedural. The app must never show a hole where a wheel
should be.

---

## 6. What an asset must NOT do

- **Must not carry dimensions of its own.** Every measured value comes from
  the tire designation and the unit definition. A mesh that "knows" it is
  1054 mm across will be scaled anyway, and if the two disagree the figure will
  be dimensioned with one number and drawn with another. That is the single
  worst thing this app could do.
- **Must not include the ground plane, shadow geometry, or a backdrop.**
- **Must not bake lighting or ambient occlusion into base color.** Lighting is
  a user control and gets stated in figure captions.
- **Must not use emissive materials.** Nothing on a tire glows.
- **Must not depend on a texture larger than 2048 × 2048.**

---

## 7. Checklist before submitting

- [ ] Single mesh, `.glb`, meters, Y-up
- [ ] Origin exactly on the rotation axis, at the wheel center
- [ ] Rotation axis is local **+X**
- [ ] Modeled at the reference size for its slot
- [ ] Within the triangle budget
- [ ] PBR metallic-roughness; no baked lighting; no emissive
- [ ] Loads in a plain glTF viewer with no warnings
- [ ] Manifest entry added, with `reference` dimensions and a credit line
- [ ] Checked in a figure against the procedural version at the same camera —
      the silhouette should sit within a few millimeters

---

## 7a. What actually ships (searched 2026-08-03)

A real search was carried out across the CC0 libraries. Result:

- **Shipped:** one CC0 PBR **texture** set (ambientCG `Rubber004`) providing
  tire surface micro-detail. 114 KB, tiled at true physical scale. See
  `assets/textures/CREDITS.md`.
- **Not shipped:** any third-party **mesh**. No CC0 truck wheel, truck tire
  or aircraft landing gear model exists in the libraries searched. The two
  candidate CC0 wheel meshes are junkyard **car** parts that exceed this
  document's own 1.6× distortion cap when scaled to truck sizes (1.76× and
  2.62×). Full numbers in `CREDITS.md`.

The conclusion worth carrying forward: for this app **textures are where
third-party assets pay off and meshes are not**. Gear3D's geometry is
parametric and dimensionally exact for any tire designation, including sizes
nobody has modeled — a mesh can only ever approximate that, and must be
distorted to fit. Surface micro-detail is the opposite: it carries no
dimensional meaning, so measured data is strictly better than procedural
noise and costs nothing in accuracy.

## 8. Status

**No assets ship, and none are required.** The procedural path is the reference
implementation, not a placeholder: it is deterministic, it scales to any
designation in the library including sizes nobody has modeled, and it is what
the test suite exercises. Authored meshes are an enhancement to appearance only
— they must never become a prerequisite for a correct figure.

**The loader is implemented** (`src/geometry/assets.js`, v1.1). It is inert
until an `assets/manifest.json` appears, so the app runs unchanged with no
assets present. Drop a manifest and a `.glb` in and it is picked up. Every
resolution, scale factor and fallback is logged to the console — a figure
rendered with a silently substituted or silently stretched mesh is a figure
whose provenance nobody can reconstruct later.

### 8.1 On sourcing meshes from the internet

Worth stating plainly, because "free to download" is not the same as "free to
put in this repository".

This site is a **public GitHub Pages repo under a named academic's domain**.
Committing a mesh here redistributes it. That is a stricter bar than personal
use, and most "free" 3D marketplace licenses (Sketchfab free, TurboSquid free,
CGTrader free) permit use but **prohibit redistribution of the asset itself**.
Dropping one in would create a real liability for the repository owner, in the
exact place — an academic portfolio — where it would be most damaging.

**Acceptable sources, in order of preference:**

1. **CC0 / public domain.** No attribution required, redistribution explicitly
   permitted. Poly Haven and ambientCG are CC0 across their whole libraries.
   Verify the license on the asset page, not the site's front page.
2. **CC-BY.** Fine, but the attribution must travel with the file: record it in
   the manifest's `credit` field and add it to this document.
3. **Author it yourself**, or commission it.

**Not acceptable:** anything whose license is unstated, "free for personal use",
"free with attribution" where the attribution cannot be surfaced, or scraped
from a manufacturer's CAD portal. A wheel modeled from a real manufacturer's
product may also carry design-right and trade-dress considerations that a
license file says nothing about.

Before adding any asset, record in the manifest entry: the source URL, the
license identifier, and the author. If those three cannot be stated, the asset
does not go in.
