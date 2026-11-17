"""Extract the frame FE results for the website.

Run from <build>/fe:  abaqus python abaqus_extract.py
Writes fe_web.json (index, summary) and fe_web.bin:
  positions float32 [n,3] mm, triangles uint32 [m,3],
  per load case: displacement float32 [n,3] mm, von Mises float32 [n] MPa (max over section points, averaged at nodes),
  per mode: displacement float32 [n,3], normalised to a unit maximum.
"""

import json
import os

import numpy as np
from odbAccess import openOdb

HERE = os.getcwd()


def main():
    spec = json.load(open(os.path.join(HERE, "fe_model.json")))
    meta = json.load(open(os.path.join(HERE, "fe_meta.json")))
    odb = openOdb(os.path.join(HERE, "frame_fe.odb"), readOnly=True)
    asm = odb.rootAssembly
    index, coords, tris, part_of = {}, [], [], []
    elem_nodes = {}
    for iname in ("FRAME", "FORK"):
        inst = asm.instances[iname]
        for nd in inst.nodes:
            index[(iname, nd.label)] = len(coords)
            coords.append(nd.coordinates)
            part_of.append(0 if iname == "FRAME" else 1)
        for el in inst.elements:
            c = [index[(iname, k)] for k in el.connectivity]
            elem_nodes[(iname, el.label)] = c
            tris.append([c[0], c[1], c[2]])
            if len(c) == 4:
                tris.append([c[0], c[2], c[3]])
    n = len(coords)
    coords = np.array(coords, np.float32)
    tris = np.array(tris, np.uint32)
    blob = bytearray()

    def put(arr):
        off = len(blob)
        blob.extend(np.ascontiguousarray(arr).tobytes())
        return off

    out = {"positions": put(coords), "n_nodes": n, "triangles": put(tris), "n_tris": int(len(tris)), "part": put(np.array(part_of, np.uint8)),
           "cases": [], "modes": [], "laminate": spec["laminate"], "mesh": meta["parts"], "walls": meta["walls"]}
    while len(blob) % 4:
        blob.append(0)
    for c in spec["cases"]:
        step = odb.steps[c["name"]]
        fr = step.frames[-1]
        U = np.zeros((n, 3), np.float32)
        for v in fr.fieldOutputs["U"].values:
            if v.instance is not None and (v.instance.name, v.nodeLabel) in index:
                U[index[(v.instance.name, v.nodeLabel)]] = v.data
        emax = {}
        for v in fr.fieldOutputs["S"].values:
            if v.instance is None:
                continue
            key = (v.instance.name, v.elementLabel)
            if v.mises > emax.get(key, -1.0):
                emax[key] = v.mises
        acc, cnt = np.zeros(n), np.zeros(n)
        for key, s in emax.items():
            for k in elem_nodes[key]:
                acc[k] += s
                cnt[k] += 1
        mises = (acc / np.maximum(cnt, 1)).astype(np.float32)
        kpeak = max(emax, key=emax.get)
        peak_at = coords[elem_nodes[kpeak]].mean(0)
        mag = np.linalg.norm(U, axis=1)
        entry = {"name": c["name"], "label": c["label"], "U": put(U), "mises": put(mises),
                 "peak_mises": float(emax[kpeak]), "peak_at": peak_at.tolist(), "peak_part": kpeak[0].lower(),
                 "p99_mises": float(np.percentile(list(emax.values()), 99)), "max_disp": float(mag.max()), "max_disp_at": coords[int(mag.argmax())].tolist(),
                 "loads": c["loads"], "bcs": c["bcs"]}
        out["cases"].append(entry)
    st = odb.steps["modes"]
    for i in range(1, len(st.frames)):  # ODB sequences do not support slicing
        fr = st.frames[i]
        U = np.zeros((n, 3), np.float32)
        for v in fr.fieldOutputs["U"].values:
            if v.instance is not None and (v.instance.name, v.nodeLabel) in index:
                U[index[(v.instance.name, v.nodeLabel)]] = v.data
        U /= max(float(np.linalg.norm(U, axis=1).max()), 1e-12)
        out["modes"].append({"hz": float(fr.frequency), "U": put(U.astype(np.float32))})
    odb.close()
    out["bytes"] = len(blob)
    open(os.path.join(HERE, "fe_web.bin"), "wb").write(bytes(blob))
    json.dump(out, open(os.path.join(HERE, "fe_web.json"), "w"), indent=1)
    print("nodes", n, "tris", len(tris), "bytes", len(blob))


main()
