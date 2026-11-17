# Road Bike Project: Synapse digital twin

A buildless E-Labs app for a Cannondale Synapse Carbon (51 cm, likely MY2012). Serve the
repository root (`python -m http.server 8000`) and open `/e-labs/road-bike/`.

## What it does

| Tab | Content |
|---|---|
| Build | Parametric 3D model; pick any part from the catalog, paint scheme, bar tape, pose (gear, crank angle, steering). Click a part to inspect it. |
| Upgrades | Staged bundles and every researched part, each checked against the installed interfaces. |
| Gearing | Range, steps, chain wrap, chain length, speed per gear, cross-chaining. |
| Performance | Steady-state power model: speed at a given power, power split, ride times, with every input's source. |
| Frame FE | 3D beam finite-element model of frame and fork under five load cases; stiffness figures. |
| Geometry & fit | Catalog geometry, derived trail/wheelbase/ETT, fit sliders, dimensions drawn on the model. |
| Spec sheet | Bill of materials with evidence classes, CSV export, measurement plan, CAD status, history. |

State lives in the URL hash: `slot=id` for parts that differ from the installed build,
`p.key=value` for parameters that differ from their defaults, `view=` for the tab.

## Evidence

Every value carries one of **C** confirmed by owner, **L** listing, **S** stock or published
reference, **M** must be measured. `null` means unknown and is never counted as zero: an
unknown mass makes a total or a delta unknown rather than wrong.

## Layout

```
js/geo/        3D builders (mm, BB origin, +X forward, +Y up, +Z drive side)
  kit.js         sweep / lathe / plate / sprocket tooth form / merge helpers
  frame.js       frame, fork, headset          wheels.js   rims, lacing, hubs, tyres, QR
  drivetrain.js  cranks, rings, cassette, chain, derailleurs, pedals
  brakes.js      dual-pivot calipers           cockpit.js  stem, bar, levers, cables, accessories
  seat.js        seatpost, saddle, cages       materials.js  PBR materials, paint and decal textures
  bike.js        assembly and pose
js/model/      pure functions, tested under Node
  derived.js     hardpoints, trail, ETT, fit   gearing.js  gear table, chain length
  physics.js     power model                   perf.js     configuration -> power-model inputs
  frame-fe.js    beam FE solver and load cases belt.js     chain path through the derailleur
js/viewer.js   on-demand renderer, picking, explode, dimensions, FE overlay
js/app.js      state, URL, Build panel       js/views.js  the other tabs
tools/build_catalog.mjs   catalog source -> data/components.json
tools/banner.html         E-Labs card banner (1310x790)
reference/                photo shot list; reference/photos/ is gitignored
```

## How the model is built

Standard parts follow their standards: sprockets have a 12.7 mm pitch tooth form, rims are
ETRTO 622, the chain is laid one link at a time along a solved path, and the derailleur cage
swings to whatever angle takes up exactly the chain's length (big-big plus one link pair).
Brake reach is solved so the pads sit on the brake track.

The frame is not measured. Hardpoints come from catalog geometry; tube sections in
`data/geometry.json` (`tubes`) are illustrative, which is also what the FE model uses.

## Analysis limits

- **Performance**: CdA is a published range by position; Crr is a drum-test figure only where
  one exists (otherwise a generic value and no gain is claimed); bike mass is assumed 8.8 kg
  until weighed. No CFD.
- **Frame FE**: Euler-Bernoulli beams, thin-walled elliptical sections, one isotropic laminate
  modulus, assumed wall thickness. ISO 4210-6 force magnitudes for orientation only. It ranks
  load paths; it is not a strength or safety assessment.

## Catalog

Edit `tools/build_catalog.mjs`, then `node tools/build_catalog.mjs`. A test fails if
`data/components.json` drifts from its source. Prices are approximate US street prices
(November 2026).

## Checks

```
node --test e-labs/road-bike/tests/*.test.js     # 30 checks
python e-labs/road-bike/tools/validate_site.py
python e-labs/road-bike/tools/hardpoints.py      # SolidWorks design-variable CSV
```

## Towards SolidWorks

SolidWorks is scriptable on the workstation (the GPR-Mount builder uses the same COM route).
A native model needs the reference photos and the M01-M18 measurements first; see
`reference/README.md` for the shot list and `tools/measurements.csv` for the worksheet.
Raw CAD, CFD and identifiers stay out of this public repository.
