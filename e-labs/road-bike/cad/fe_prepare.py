"""Write <build>/fe/fe_model.json: everything the Abaqus scripts need, so they stay stdlib + numpy.

Shell model of the frame and fork skins (the outer surface of the CAD solids), quasi-isotropic
CFRP laminate, wall thickness per tube from data/geometry.json. Load cases mirror ISO 4210-6
force magnitudes for orientation (the same cases as the browser beam model). mm, N, t, s, MPa.
Run:  python cad/fe_prepare.py
"""

from __future__ import annotations

import json
import math
import os
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import bike_cad  # noqa: E402

BUILD = Path(os.environ.get("ROADBIKE_BUILD", Path(os.environ["LOCALAPPDATA"]) / "road-bike-cad" / "build"))
LAMINATE = {"name": "CFRP quasi-isotropic (equivalent)", "E": 50000.0, "nu": 0.3, "rho": 1.55e-9, "strength": 500.0,
            "note": "Assumed: quasi-isotropic T700-class laminate. No ply data for this frame exists."}


def main():
    geom, cfg = bike_cad.load_inputs()
    _, meta = bike_cad.build(geom, cfg, detail=False)
    hp = {k: np.array(v) for k, v in meta["hp"].items()}
    fit = {k: np.array(v) if isinstance(v, list) else v for k, v in meta["fit"].items()}
    up, sA = hp["up"], hp["s_axis"]
    fe = BUILD / "fe"
    fe.mkdir(parents=True, exist_ok=True)
    for name in ("frame", "fork"):
        shutil.copy2(BUILD / "step" / f"{name}.step", fe / f"{name}.step")
    W = 75 * 9.80665
    crank = geom["fit_defaults"]["crank_length_mm"]
    ring = cfg["crankset"]["provides"].get("ring_big", 50)
    Rr = 12.7 / (2 * math.sin(math.pi / ring))
    F, zc, zp = 1100.0, 43.5, 150.0
    Tc = F * crank / Rr  # chain tension that balances the pedal torque
    # reference points and the skin regions they couple to (cylindrical bands, mm)
    rp = {
        "BB": {"at": [0, 0, 0], "band": {"axis": [0, 0, 1], "r": [15, 32], "h": [-34, 34]}, "part": "frame", "kind": "DISTRIBUTING"},
        "REAR_L": {"at": [hp["ra"][0], hp["ra"][1], -66], "band": {"axis": [0, 0, 1], "r": [0, 26], "h": [-6, 6]}, "part": "frame", "kind": "KINEMATIC"},
        "REAR_R": {"at": [hp["ra"][0], hp["ra"][1], 66], "band": {"axis": [0, 0, 1], "r": [0, 26], "h": [-6, 6]}, "part": "frame", "kind": "KINEMATIC"},
        "FRONT_L": {"at": [hp["fa"][0], hp["fa"][1], -52.75], "band": {"axis": [0, 0, 1], "r": [0, 14], "h": [-5, 5]}, "part": "fork", "kind": "KINEMATIC"},
        "FRONT_R": {"at": [hp["fa"][0], hp["fa"][1], 52.75], "band": {"axis": [0, 0, 1], "r": [0, 14], "h": [-5, 5]}, "part": "fork", "kind": "KINEMATIC"},
        "SADDLE": {"at": (hp["st"] + sA * 2).tolist(), "band": {"axis": sA.tolist(), "r": [12, 24], "h": [-10, 12]}, "part": "frame", "kind": "DISTRIBUTING"},
        "HT_TOP": {"at": (hp["ht"] - up * 8).tolist(), "band": {"axis": up.tolist(), "r": [0, 30], "h": [-9, 9]}, "part": "both", "kind": "KINEMATIC"},
        "HT_BOT": {"at": (hp["hb"] + up * 6).tolist(), "band": {"axis": up.tolist(), "r": [0, 30], "h": [-8, 8]}, "part": "both", "kind": "KINEMATIC"},
        "BAR": {"at": (hp["ht"] + up * (15 + geom["fit_defaults"]["spacers_mm"] + 30)).tolist(), "band": {"axis": up.tolist(), "r": [10, 18], "h": [-12, 12]}, "part": "fork", "kind": "DISTRIBUTING"},
    }
    road = [["REAR_L", [1, 2, 3]], ["REAR_R", [2, 3]], ["FRONT_L", [2, 3]], ["FRONT_R", [2]]]
    # lever arms for transferring the seat and bar loads to the coupling points
    sad = fit["saddle"] - np.array(rp["SADDLE"]["at"])
    bar = fit["bar"] - np.array(rp["BAR"]["at"])
    moment_z = lambda arm, fy: arm[0] * fy  # Mz = x * Fy (Fx = 0)
    cases = [
        {"name": "seated", "label": "Seated, 1 g", "bcs": road, "loads": [
            ["SADDLE", [0, -0.55 * W, 0, 0, 0, moment_z(sad, -0.55 * W)]], ["BB", [0, -0.30 * W, 0, 0, 0, 0]], ["BAR", [0, -0.15 * W, 0, 0, 0, moment_z(bar, -0.15 * W)]]]},
        # pedal force -F (y) at (crank, 0, 150) from the BB; chain tension Tc at (0, Rr, 43.5) on the ring and at the
        # rear chainline, 22.5 mm inboard of the drive-side dropout point. Moments are r x F about each reference point.
        {"name": "pedalling", "label": "Out-of-saddle pedalling", "bcs": road, "loads": [
            ["BB", [-Tc, -F, 0, zp * F, -zc * Tc, -crank * F + Rr * Tc]], ["REAR_R", [Tc, 0, 0, 0, (zc - 66) * Tc, 0]]]},
        {"name": "fork", "label": "Rearward fork load", "bcs": [["REAR_L", [1, 2, 3]], ["REAR_R", [2, 3]], ["FRONT_L", [2, 3]], ["FRONT_R", [2]]],
         "loads": [["FRONT_L", [-300, 0, 0, 0, 0, 0]], ["FRONT_R", [-300, 0, 0, 0, 0, 0]]]},
        {"name": "saddle", "label": "Vertical saddle load", "bcs": road, "loads": [["SADDLE", [0, -1200, 0, 0, 0, moment_z(sad, -1200)]]]},
        {"name": "torsion", "label": "Head-tube torsion", "bcs": [["REAR_L", [1, 2, 3, 4, 5, 6]], ["REAR_R", [1, 2, 3, 4, 5, 6]], ["BB", [2]]],
         "loads": [["HT_BOT", [0, 0, 0, 100000.0, 0, 0]]]},
    ]
    doc = {
        "units": "mm, N, t, s, MPa", "laminate": LAMINATE, "mesh_size": 5.0,
        "centrelines": meta["centrelines"], "rp": rp, "cases": cases, "modes": 8, "crank_mm": crank, "chain_N": Tc,
        "default_wall": 1.5,
    }
    (fe / "fe_model.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")
    for s in ("abaqus_frame.py", "abaqus_extract.py"):
        shutil.copy2(Path(__file__).with_name(s), fe / s)
    print("wrote", fe / "fe_model.json", f"chain tension {Tc:.0f} N")


if __name__ == "__main__":
    main()
