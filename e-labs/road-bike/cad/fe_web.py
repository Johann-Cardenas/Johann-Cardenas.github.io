"""Pack the Abaqus extraction (<build>/fe/fe_web.*) for the website: data/fe/frame.json + frame.bin.

Positions int16 (quantised over the model box), triangles uint32, displacements and mode shapes
float16, von Mises float16. Run after abaqus_extract.py:  python cad/fe_web.py
"""

import json
import os
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FE = Path(os.environ.get("ROADBIKE_BUILD", Path(os.environ["LOCALAPPDATA"]) / "road-bike-cad" / "build")) / "fe"


def main():
    d = json.loads((FE / "fe_web.json").read_text(encoding="utf-8"))
    b = (FE / "fe_web.bin").read_bytes()
    n = d["n_nodes"]
    get = lambda off, dt, cnt: np.frombuffer(b, dt, cnt, off)
    P = get(d["positions"], np.float32, n * 3).reshape(-1, 3)
    T = get(d["triangles"], np.uint32, d["n_tris"] * 3)
    part = get(d["part"], np.uint8, n)
    lo, hi = P.min(0), P.max(0)
    sc = (hi - lo) / 65534.0
    blob = bytearray()

    def put(a, align=4):
        while len(blob) % align:
            blob.append(0)
        off = len(blob)
        blob.extend(np.ascontiguousarray(a).tobytes())
        return off

    out = {"schema": "synapse-fe/1", "source": "Abaqus 2025 Standard, S4R/S3R shells on the CAD skin (cad/abaqus_frame.py)",
           "units": "mm, N, MPa", "n_nodes": n, "n_tris": d["n_tris"], "offset": lo.tolist(), "scale": sc.tolist(),
           "positions": put(np.round((P - lo) / sc - 32767).astype(np.int16)), "triangles": put(T), "part": put(part),
           "laminate": d["laminate"], "mesh": d["mesh"], "walls": d["walls"], "cases": [], "modes": [],
           "rp": {k: v["at"] for k, v in json.loads((FE / "fe_model.json").read_text(encoding="utf-8"))["rp"].items()}}
    for c in d["cases"]:
        U = get(c["U"], np.float32, n * 3)
        S = get(c["mises"], np.float32, n)
        out["cases"].append({k: c[k] for k in ("name", "label", "peak_mises", "peak_at", "p99_mises", "max_disp", "max_disp_at", "loads", "bcs")}
                            | {"U": put(U.astype(np.float16), 2), "mises": put(S.astype(np.float16), 2)})
    for m in d["modes"]:
        out["modes"].append({"hz": m["hz"], "U": put(get(m["U"], np.float32, n * 3).astype(np.float16), 2)})
    while len(blob) % 4:
        blob.append(0)
    out["bytes"] = len(blob)
    dst = ROOT / "data" / "fe"
    dst.mkdir(parents=True, exist_ok=True)
    (dst / "frame.bin").write_bytes(bytes(blob))
    (dst / "frame.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"{n} nodes, {d['n_tris']} triangles, {len(blob) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
