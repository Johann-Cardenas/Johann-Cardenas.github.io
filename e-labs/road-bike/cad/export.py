"""Build the CAD model and write its exports.

  build/step/<part>.step       one STEP per part, for SolidWorks (outside the repo)
  build/manifest.json          part list with volumes and centroids, for the SolidWorks check
  data/cad/parts.json + .bin   tessellation for the website (quantised int16 positions, uint32 indices)

Run with the GPR-Mount Python (CadQuery):  python cad/export.py
"""

from __future__ import annotations

import json
import os
import struct
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import bike_cad  # noqa: E402

ROOT = bike_cad.ROOT
BUILD = Path(os.environ.get("ROADBIKE_BUILD", Path(os.environ["LOCALAPPDATA"]) / "road-bike-cad" / "build"))


def tessellate(shape, tol=0.3, ang=0.35):
    verts, tris = shape.tessellate(tol, ang)
    v = np.array([(p.x, p.y, p.z) for p in verts], np.float32)
    t = np.array(tris, np.uint32).reshape(-1, 3)
    return v, t


def main():
    t0 = time.time()
    parts, meta = bike_cad.build(detail=True)
    (BUILD / "step").mkdir(parents=True, exist_ok=True)
    web_dir = ROOT / "data" / "cad"
    web_dir.mkdir(parents=True, exist_ok=True)

    lo = np.array([1e9] * 3); hi = -lo
    meshes = []
    for p in parts:
        v, t = tessellate(p.solid, *p.extra.get("tess", (0.3, 0.35)))  # fine detail (chain) can ask for a coarser mesh
        meshes.append((p, v, t))
        lo, hi = np.minimum(lo, v.min(0)), np.maximum(hi, v.max(0))
    scale = (hi - lo) / 65534.0
    blob, entries = bytearray(), []
    manifest = []
    for p, v, t in meshes:
        q = np.round((v - lo) / scale - 32767).astype(np.int16)
        pos_off = len(blob); blob += q.tobytes()
        while len(blob) % 4: blob += b"\0"
        idx_off = len(blob); blob += t.astype(np.uint32).tobytes()
        solid = p.solid
        vol = float(solid.Volume())
        c = solid.Center()
        bb = solid.BoundingBox()
        entries.append({"name": p.name, "slot": p.slot, "color": [round(x, 3) for x in p.color], "aero": p.aero, "fe": p.fe,
                        "pos": [pos_off, len(v)], "idx": [idx_off, int(t.size)], "volume_cm3": round(vol / 1000, 2),
                        "centroid": [round(c.x, 1), round(c.y, 1), round(c.z, 1)], "note": p.note})
        step = BUILD / "step" / f"{p.name}.step"
        solid.exportStep(str(step))
        manifest.append({"name": p.name, "slot": p.slot, "color": list(p.color), "aero": p.aero, "fe": p.fe, "step": str(step),
                         "volume_mm3": vol, "centroid_mm": [c.x, c.y, c.z], "bbox_mm": [bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax]})
        print(f"  {p.name:22s} {len(t):7d} tris  {vol / 1000:8.1f} cm3", flush=True)

    (web_dir / "parts.bin").write_bytes(bytes(blob))
    doc = {"schema": "synapse-cad/1", "units": "mm", "frame": "BB origin, +X forward, +Y up, +Z drive side",
           "source": "cad/bike_cad.py (CadQuery B-rep), the same geometry exported to SolidWorks",
           "offset": lo.tolist(), "scale": scale.tolist(), "bytes": len(blob), "parts": entries,
           "ground_y": float(meta["hp"]["ra"][1] - meta["R"]), "wheel_radius_mm": meta["R"]}
    (web_dir / "parts.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")
    (BUILD / "manifest.json").write_text(json.dumps({"parts": manifest, "meta": meta}, indent=1), encoding="utf-8")
    tris = sum(e["idx"][1] for e in entries) // 3
    print(f"{len(parts)} parts, {tris:,} triangles, web blob {len(blob) / 1e6:.2f} MB, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
