# Gear3D vehicle body assets

These are illustrative visual models, not measured manufacturer CAD. They are
separate from the cited axle/gear data. Assets are served locally and loaded only
when Show vehicle body is enabled. No original textures or liveries are shipped.

## Aircraft

* **B737.glb, A380.glb, B787.glb, A320.glb, A350.glb**: AMV Lab, [aircraft-models](https://github.com/amvlab/aircraft-models), plain/logo-free variants. [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
* **B747.glb**: [“boeing 747” by zairiq-123](https://sketchfab.com/3d-models/boeing-747-9b16672038ba48f98e6d80a159044ed9), [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Downloaded from [God's Eye View's prepared asset](https://github.com/bilawalsidhu/gods-eye-view/blob/main/public/models/README.md), which already simplified geometry/materials and baked orientation and scale.

CEE-406 changes: textures/materials removed; node transforms baked; nose oriented
toward render -Z; longitudinal origin moved to the nose; position/normal buffers
re-exported as GLB. Triangles retained. Runtime adds a dimmed material and scales
and places the body using representative gear stations (13% and 54% of body
length). These stations are assumptions, not manufacturer measurements.

The 737 gear uses the 737 body, the 747 variants use the 747 body, and the A380
uses the A380 body. The 757 uses a representative 737 silhouette; the 767
uses a representative 787 silhouette. These substitutions are named in the UI;
they do not claim variant-specific wing, fuselage or engine dimensions.

## Road vehicles

* **sedan.glb, truck.glb, delivery.glb, delivery-flat.glb, trailer.glb**: [Kenney Car Kit 3.1](https://kenney.nl/assets/car-kit), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). `truck` is the pickup body. `delivery` supplies a rigid truck; `delivery-flat` supplies the tractor/cab reference.
* **bus.glb**: Quaternius, [Public Transport Pack](https://quaternius.com/packs/publictransport.html), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Converted from the author's original Bus.obj.
* **motorcycle.glb**: AliceCassie, [Cartoony Purple Motorcycle](https://poly.pizza/m/j20srJUjpB), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

CEE-406 changes: separate wheel meshes removed from Kenney and Quaternius models;
wheel-region triangles removed from the motorcycle's combined meshes; textures
and materials replaced (bus surface names retained); transforms and orientation baked; GLB re-exported. Road
body wheel stations come from source wheel centers (motorcycle centers were
identified from the mesh). Runtime stretches the wheelbase to the selected axles,
preserves overhang proportions relative to width, and adapts height and width.
The trailer asset crops the original delivery-truck cargo shell above its wheel
wells and behind the cab, preserving the retained source surfaces. Runtime
stretches that cargo shell around the selected trailer axle groups. Body
placement and trailer proportions remain illustrative.

## Reuse and figures

Retain the aircraft credits, license links, and modification statement when
redistributing these models or figures made with them. The credits do not imply
endorsement by any original creator.

See [`docs/gear3d-body-review/README.md`](https://github.com/ictuillinois/CEE-406/blob/main/docs/gear3d-body-review/README.md)
in the CEE-406 repository for the render comparisons and limitations.

Runtime refinements include bus glazing/trim, doors, mirrors, lamps, roof equipment, enlarged tractor cabs, chassis details, open dump beds and subtle aircraft intake shading. These additions are illustrative and do not alter engineering exports.


## Authored conventional tractor and trailers

Classes 8–13 now use local procedural meshes rather than the stretched delivery-flat cab and cropped trailer GLB. Proportions reference the [Cascadia 126 specification sheet (June 2024), page 2](https://www.freightliner.com.au/siteassets/documents/cascadia-spec-sheet-126-2024.pdf): 3,220 mm day-cab BBC, 4,520 mm 60-inch XT sleeper BBC, 3,455 mm XT cab height and 1,315 mm front overhang. The hood, cab, glazing, fenders and trailer details are original simplified interpretations. No Freightliner mesh, logo or texture is distributed. These are illustrative conventional trucks, not exact Freightliner replicas. Existing GLB credits and comparisons remain applicable to the retained assets only.

The reviewed A320, A350 and 787 entries use their matching AMV family mesh.
Their runtime uniform scale uses manufacturer length and nose-to-nose-gear
distance; source proportions and triangles are retained. A family mesh is not
variant-specific CAD, so wingspan and wing/engine stations remain illustrative.
Unknown aircraft families receive no substitute body.

## Additional aircraft: FlightGear / Flightradar24 (GPL v2)

A319.glb, A321.glb, A330-200.glb, A330-300.glb, A220-100.glb,
A220-300.glb, B777.glb, E170.glb, E190.glb, CRJ700.glb, CRJ900.glb,
DHC8-400.glb, ATR42.glb, B757-200.glb, B757-300.glb, B767-200.glb,
B767-300.glb and B767-400.glb are adapted from the FlightGear/FGMEMBERS
contributors' aircraft, distributed by
[Flightradar24/fr24-3d-models](https://github.com/Flightradar24/fr24-3d-models).
These eighteen derived assets are licensed under [GNU GPL v2](sources/GPL-2.0.txt).
The other assets retain their separately stated licenses above.

| Body | Upstream authors/project | Corresponding editable source and original GLB |
| --- | --- | --- |
| A319 | [FGMEMBERS A320-family](https://github.com/FGMEMBERS/A320-family) | [a319-source.zip](sources/a319-source.zip) |
| A321 | [FGMEMBERS A320-family](https://github.com/FGMEMBERS/A320-family) | [a321-source.zip](sources/a321-source.zip) |
| A330-200 | [FGMEMBERS A330-200](https://github.com/FGMEMBERS/A330-200) | [a332-source.zip](sources/a332-source.zip) |
| A330-300 | [FGMEMBERS A330-300](https://github.com/FGMEMBERS/A330-300) | [a333-source.zip](sources/a333-source.zip) |
| A220-100 | [FGMEMBERS CSeries](https://github.com/FGMEMBERS/CSeries), CS100 model | [cs100-source.zip](sources/cs100-source.zip) |
| A220-300 | [FGMEMBERS CSeries](https://github.com/FGMEMBERS/CSeries), CS300 model | [cs300-source.zip](sources/cs300-source.zip) |
| B777 | [FGMEMBERS 777](https://github.com/FGMEMBERS/777), 777-300 model | [b773-source.zip](sources/b773-source.zip) |
| E170 / E190 | [FGMEMBERS E-jet-family](https://github.com/FGMEMBERS/E-jet-family) | [e170-source.zip](sources/e170-source.zip), [e190-source.zip](sources/e190-source.zip) |
| CRJ700 / CRJ900 | [FGMEMBERS CRJ700-family](https://github.com/FGMEMBERS/CRJ700-family) | [crj700-source.zip](sources/crj700-source.zip), [crj900-source.zip](sources/crj900-source.zip) |
| DHC8-400 | [FGMEMBERS Q400](https://github.com/FGMEMBERS/Q400) | [q400-source.zip](sources/q400-source.zip) |
| ATR42 | [FGMEMBERS ATR-42-500](https://github.com/FGMEMBERS/ATR-42-500) | [atr42-source.zip](sources/atr42-source.zip) |
| B757-200 / B757-300 | [FGMEMBERS 757-200](https://github.com/FGMEMBERS/757-200) | [b752-source.zip](sources/b752-source.zip), [b753-source.zip](sources/b753-source.zip) |
| B767-200 / B767-400 | [FGMEMBERS 767](https://github.com/FGMEMBERS/767) | [b762-source.zip](sources/b762-source.zip), [b764-source.zip](sources/b764-source.zip) |
| B767-300 | [FGMEMBERS 767-300](https://github.com/FGMEMBERS/767-300) | [b763-source.zip](sources/b763-source.zip) |

Changes by CEE-406: glTF 1 converted to glTF 2 with gltf-pipeline 4.3.1;
textures and materials removed; named gear nodes excluded; transforms baked;
identical x-ray surfaces combined into one mesh with shared vertices.
No triangle simplification. Runtime applies translucent materials and illustrative
placement. The 777-300 mesh represents the 777 family, including the 300ER gear
entry; it does not assert exact 300ER wingspan or engine geometry.

The source archives include the supplied editable Blender files, upstream ZIP
sources, original glTF inputs, and GPL license. Reproduction scripts are in
[the CEE-406 repository](https://github.com/ictuillinois/CEE-406/tree/main/scripts):
`convert-gear3d-fr24.mjs`, `build-gear3d-bodies.mjs`, and `gear3d-body-assets/`.
Archive and input SHA-256 hashes are recorded in [sources/manifest.json](sources/manifest.json).
Source archives are downloaded only when requested; they are never loaded by the viewer.

Regional-aircraft additions retain static propellers and the source surface detail.
The ATR42 source wing is over-wide: vertices beyond 6 source units from the
centerline are compressed laterally to the manufacturer's 24.572 m span at
22.67 m body length. Fuselage, nacelles, propellers and inner wing remain intact;
no triangles are removed by this correction. The archived original is unchanged.
Pixel comparisons use this explicitly corrected source as their reference.
Runtime ground height is calibrated for turboprops and CRJs, with illustrative
strut attachment heights for nacelle/sponson gears. These overlays are not CAD.

The five 757/767 models are pinned to FR24 commit
`dd53267690c6a4ecbb290a3acf0284333a5d68a9`. Each variant uses its own mesh.
The 757-200 source winglets are retained; its span therefore differs from the
non-winglet ACAP drawing. The 767-300 mesh represents the 300ER entry.
Engine options and mesh details remain illustrative. Ground attitude uses
the midpoint of each published tail-clearance range; attachment heights are
visually calibrated. No source geometry is stretched to create another variant.
