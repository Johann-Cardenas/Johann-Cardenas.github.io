# Road Bike Project — Synapse digital twin

Buildless E-Labs application. Serve the repository using `python -m http.server 8000`, then open `/e-labs/road-bike/`. This is the provisional Phase 1 implementation; geometry, component identity and reference masses are not measured validation.

Data lives in `data/geometry.json` and `data/components.json`. Null means unknown, never zero. C = confirmed by owner, L = listing, S = stock/reference, M = measurement required. Confidence applies to the identity unless a field notes otherwise. No serial, registration ID or Shield code is included.

Checks from repository root:

```
node --test e-labs/road-bike/tests/*.test.js
python e-labs/road-bike/tools/validate_site.py
python e-labs/road-bike/tools/hardpoints.py
```

The last command exports `data/cad/design_variables.csv`; `--write` also regenerates hardpoints. Record measurements in `tools/measurements.csv`, review them, and update geometry inputs before regeneration. CAD uses millimetres with the BB origin, +X forward, +Y up, +Z drive side. Web geometry uses metres.

`decodeConfig(hash,catalog)` merges installed required slots, validates slot membership and physical compatibility, and accepts `none` for optional slots. `encodeConfig(cfg,catalog)` preserves optional removals. `summarize` returns knownMass_g, unknownMassCount, totalMass_g, deltaMass_g, deltaPrice_usd, gearMin, gearMax, deltaCdA_m2 and changedCount. Unknown totals/deltas are null. No simulation is inferred.

CAD BOM/mass CSVs contain headers only until real exports exist. Aero results are empty until actual solver runs and mesh studies exist. No photoreal accuracy, measured fit, structural safety, CFD convergence, Lighthouse score or calibrated paint match is claimed. Detailed GLB hardpoint/material validation is future work; current validation checks files/budgets when model paths are supplied. Keep raw CAD, CFD and identifiers in private storage outside this public repository. `tools/seed_data.py` is initial fixture creation only: rerunning overwrites data.

GitHub Pages uses the repository's existing hosting arrangement. The scoped workflow runs validation and compatibility tests without replacing deployment.
