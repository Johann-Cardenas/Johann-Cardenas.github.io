# Road Bike Project: Synapse digital twin

A buildless E-Labs app for a Cannondale Synapse Carbon 51 (likely MY2012). Serve the repository
root (`python -m http.server 8000`) and open `/e-labs/road-bike/`.

| Tab | What it shows |
|---|---|
| Build | Procedural 3D model in the photographed paint; click a part for its spec sheet (beside the installed part, copyable as rows for a spreadsheet); pick parts, paint, tape colour and style, gloss/satin/matte frame, a colour for every component (22 finishes plus tyre sidewalls), fit and pose |
| CAD | The SolidWorks assembly: 53 parts, each volume- and centroid-checked |
| Aero | Wind tunnel at 40 km/h, head-on and in crosswind (yaw): drag by part, surface pressure, animated flow, a cut plane you slide or scan through the flow (speed, pressure, total-pressure loss, vorticity), wake and vortex-core isosurfaces, an unsteady playback of instantaneous snapshots, a bike that rolls and pedals in the selected gear, an on-stage colour key, yaw sweep, drag built up nose to tail, solver convergence, power vs speed |
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
for y in 0 5 10 15: python cad/wind_tunnel.py --yaw $y --dx 8 --flows 2.2 --avg 0.8 && python cad/cfd_post.py yaw<yy>_dx8   (~70 min each)
python cad/wind_tunnel.py --yaw 0 --dx 8 --flows 2.2 --avg 0.5 --snaps 120 --snap-every 20 --tag snap && python cad/cfd_post.py yaw00_dx8 --unsteady yaw00_dx8_snap
python cad/fe_prepare.py
cd %LOCALAPPDATA%\road-bike-cad\build\fe && abaqus cae noGUI=abaqus_frame.py && abaqus job=frame_fe cpus=8 interactive && abaqus python abaqus_extract.py
python cad/fe_web.py
```

### Variant builds and the upgrade study

`cad/export.py --variant <name> --set slot=id ...` builds the CAD with other catalog parts and writes
`data/cad/variants/<name>/parts.*` (STEP into the build folder's `variants/<name>/`); it refuses `--set`
without `--variant`, so the installed pack is never overwritten. `wind_tunnel.py --cad <pack> --tag <name>
--label "<text>"` runs that pack, and `cfd_post.py` records the pack in the case, so the Aero tab loads the
right geometry for the surface Cp. The Aero panel offers one chip per build in the tunnel.

```
python cad/export.py --variant st28 --set wheels=wheels_superteam_50c --set tires=tires_gp5000_as_tr_28
for y in 0 10 5 15: python cad/wind_tunnel.py --yaw $y --dx 8 --flows 2.2 --avg 0.8 --cad data/cad/variants/st28/parts --tag st28 --label "Superteam 50 + GP5000 AS TR 28" && python cad/cfd_post.py yaw<yy>_dx8_st28
```

**Upgrade study** (`js/model/study.js`, shown at the top of the Aero panel): pairs installed and
variant cases at the same yaw and lattice, averages ΔCdA over an assumed time-at-yaw (35/35/20/10 % at
0/5/10/15°), scales it by 0.70–1.00 (centre 0.85) for the tunnel's resolution bias (sphere check), adds
it to the rider-plus-bike CdA of the chosen position and runs the road power model with each build's
Crr. GP5000 AS TR Crr are Bicycle Rolling Resistance tubeless drum figures; on a bike with butyl tubes
(the Superteam rims are tube-only) `perf.setup` adds 0.0006. Repeatability: two independent runs of
the installed build at 0° differ by 0.041 N (0.5 %). The Rubino Pro and Fulcrum are unweighed, so the
flat-road result holds mass equal and the panel gives the climbing cost per 100 g instead.

### Wind tunnel

Lattice Boltzmann D3Q19, regularized BGK with Smagorinsky LES, half-way bounce-back walls and
momentum-exchange forces per part, numba on the CPU. Standard bike-only assumptions: air at 20 °C,
40 km/h, free stream (no ground), static wheels; spokes, chain, cables and the rider omitted.
Yaw turns the bike about the vertical axis in the tunnel; side force is reported in the bike frame.

`cad/cfd_post.py` writes, per case: three full-resolution planes, streamlines through the mean
field, surface Cp at every CAD vertex, a 16 mm volume of speed, Cp, |ω| and the Q criterion round the
bike and its wake (the browser derives total-pressure loss from it, slices it anywhere and meshes
isosurfaces with surface nets), and the time-averaged force per 16 mm slab and drag group (drag
build-up, centre of pressure). `data/cfd/cases.json` indexes the cases for the yaw sweep.

**Unsteady wake.** `wind_tunnel.py --snaps N` saves N instantaneous snapshots at the end of a run: the
Q criterion on the 16 mm flow volume and the spanwise vorticity on the centre plane at full
resolution. `cfd_post.py <case> --unsteady <snap case>` packs them as `<case>_unsteady.*` (Q sparse:
varint index deltas + uint8 above 15 % of its 99.5th percentile; ω_z signed uint8, block-averaged to 16 mm) and links the pack
from the case. The browser meshes one vortex surface per frame in the background and plays them in
order with the centre plane.

**What the browser shows.** Surface Cp on a CFD rainbow over −0.5…+0.5 (the 5th–95th percentile of
the skin is −0.35…+0.30; stagnation saturates), smoothed over the mesh. Particles ride the mean-flow
streamlines at the local speed (time of flight ds/|u|), as comets whose tails are spaced in time, so
the wake shows as slow, short streaks. Playback runs at 5.5 % of real time; the wake and vortex
surfaces carry bands that move downstream on the same clock, and the wheels and cranks turn on it
too (40 km/h, selected gear) with the rim and tyre Cp held where it is in the tunnel. The tunnel ran
with the wheels still; the rolling is illustration.

SOLIDWORKS Flow Simulation is installed, but its automation interface on this machine exposes no
setter for the inflow condition (the parameter export/apply pair drives parametric studies only),
and Abaqus/CFD is unavailable in CAE 2022–2025. The LBM solver runs on the same CAD geometry.

**Force averaging.** The wall force on some parts (frame, bottles) alternates from one lattice step to
the next. Runs before 2026-11-17 recorded forces every 10th step, i.e. always the same phase, and
reported drag 2-3× too high (19.0 N / CdA 0.256 at 0°). Forces now come from the mean over every step
(`wind_tunnel.py` writes 10-step block means to the history); `cfd_post.py` rebuilds older runs from
their per-slab profile, which was always summed every step. Corrected: CdA 0.104 m² at 0°, 0.130 at
5°, 0.188 at 10°.

**Accuracy.** A sphere at Re 5×10⁴ reads Cd 0.60 at 24 cells per diameter and 0.69 at 12, against
0.47–0.50. The bike's tubes get about 6–8 cells, so absolute drag reads high; differences between
configurations, the breakdown and the flow structure are the use.

### Frame FE

Abaqus 2025 Standard. The frame and fork CAD solids become their outer skins (S4R/S3R, 5 mm),
with an equivalent quasi-isotropic CFRP laminate (E 50 GPa) and walls per tube from
`data/geometry.json`. The fork joins the head tube through kinematic couplings at the bearings;
loads enter through distributing couplings. Five linear-perturbation load cases (ISO 4210-6
magnitudes, for orientation) and the natural modes with the axles held. The mesh is built from the
current one-piece filleted frame (re-run 2026-11-17; the earlier mesh came from the 35-part CAD, whose
seat tube stopped short of the top tube and moved on its own). The colour scale tops out at
the 99th-percentile stress; the local peak sits at a sharp, unfilleted tube junction.

## Catalog

Edit `tools/build_catalog.mjs`, then `node tools/build_catalog.mjs`; a test fails on drift.

## Checks

```
node --test e-labs/road-bike/tests/*.test.js     # 40 checks: models, catalog, data packs, module syntax
python e-labs/road-bike/tools/validate_site.py
python e-labs/road-bike/cad/lbm_check.py 24 9000  # sphere validation of the wind tunnel
```
