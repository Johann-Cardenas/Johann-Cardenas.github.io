# Road Bike Project: Synapse digital twin

A buildless E-Labs app for a Cannondale Synapse Carbon 51 (likely MY2012). Serve the repository
root (`python -m http.server 8000`) and open `/e-labs/road-bike/`.

| Tab | What it shows |
|---|---|
| Build | Procedural 3D model in the photographed paint; pick parts, paint, tape, fit and pose |
| CAD | The SolidWorks assembly: 35 parts, each volume- and centroid-checked |
| Aero | Wind tunnel at 40 km/h: drag by part, surface pressure, animated flow, field planes, ride model |
| Structure | Abaqus shell model: five ISO 4210-6 load cases and the natural modes; a live beam model beside it |
| Gearing · Upgrades · Spec | Gear table, interface-checked upgrades, bill of materials |

Typography is Archivo (SIL OFL, `assets/fonts/`), as on the GPR-Mount results site.

## Evidence

**C** confirmed · **L** listing or owner photo · **S** published reference · **M** must be measured.
`null` is unknown and never counted as zero.

From the owner's photos (`reference/photos/`, gitignored): Vittoria Rubino Pro 23-622 tyres,
Fulcrum Racing 622×15C wheels, FSA Gossamer BB30 50/34, Shimano 105 calipers and derailleur,
Serfas 155 saddle, the paint layout and the side-view tube heights (scaled from the rim).

## Pipeline

```
data/geometry.json + data/components.json
  └─ cad/bike_cad.py         CadQuery B-rep, one geometry source (mm, BB origin, +X fwd, +Y up, +Z drive side)
      ├─ cad/export.py        STEP per part → build; data/cad/parts.{json,bin} for the web
      ├─ cad/solidworks_build.py   SolidWorks 2026 parts + synapse.SLDASM / synapse_aero.SLDASM, volume-checked
      ├─ cad/wind_tunnel.py   LBM-LES wind tunnel (cad/lbm.py, generated cad/lbm_kernel.py) → cad/cfd_post.py → data/cfd/
      └─ cad/fe_prepare.py    → Abaqus: cad/abaqus_frame.py (CAE) → solve → cad/abaqus_extract.py → cad/fe_web.py → data/fe/
```

Run with the GPR-Mount Python (CadQuery, pywin32, numba); builds go to `%LOCALAPPDATA%\road-bike-cad\build`,
outside the repo:

```
python cad/export.py && python cad/solidworks_build.py
python cad/wind_tunnel.py --yaw 0 --dx 8 --flows 2.2 --avg 0.8 && python cad/cfd_post.py yaw00_dx8
python cad/fe_prepare.py
cd %LOCALAPPDATA%\road-bike-cad\build\fe && abaqus cae noGUI=abaqus_frame.py && abaqus job=frame_fe cpus=8 interactive && abaqus python abaqus_extract.py
python cad/fe_web.py
```

### Wind tunnel

Lattice Boltzmann D3Q19, regularized BGK with Smagorinsky LES, half-way bounce-back walls and
momentum-exchange forces per part, numba on the CPU. Standard bike-only assumptions: air at 20 °C,
40 km/h head-on, free stream (no ground), static wheels; spokes, chain, cables and the rider omitted.

SOLIDWORKS Flow Simulation is installed, but its automation interface on this machine exposes no
setter for the inflow condition (the parameter export/apply pair drives parametric studies only),
and Abaqus/CFD is unavailable in CAE 2022–2025. The LBM solver runs on the same CAD geometry.

**Accuracy.** A sphere at Re 5×10⁴ reads Cd 0.60 at 24 cells per diameter and 0.69 at 12, against
0.47–0.50. The bike's tubes get about 6–8 cells, so absolute drag reads high; differences between
configurations, the breakdown and the flow structure are the use.

### Frame FE

Abaqus 2025 Standard. The frame and fork CAD solids become their outer skins (S4R/S3R, 5 mm),
with an equivalent quasi-isotropic CFRP laminate (E 50 GPa) and walls per tube from
`data/geometry.json`. The fork joins the head tube through kinematic couplings at the bearings;
loads enter through distributing couplings. Five linear-perturbation load cases (ISO 4210-6
magnitudes, for orientation) and the natural modes with the axles held. The colour scale tops out at
the 99th-percentile stress; the local peak sits at a sharp, unfilleted tube junction.

## Catalog

Edit `tools/build_catalog.mjs`, then `node tools/build_catalog.mjs`; a test fails on drift.

## Checks

```
node --test e-labs/road-bike/tests/*.test.js     # 33 checks: models, catalog, data packs
python e-labs/road-bike/tools/validate_site.py
python e-labs/road-bike/cad/lbm_check.py 24 9000  # sphere validation of the wind tunnel
```
