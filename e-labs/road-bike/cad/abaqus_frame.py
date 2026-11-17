"""Abaqus/CAE (noGUI) builder for the frame and fork shell model.

Run from <build>/fe:  abaqus cae noGUI=abaqus_frame.py
Standard library + numpy + Abaqus modules only. Units: mm, N, t, s, MPa.
Reads fe_model.json (written by cad/fe_prepare.py) and writes frame_fe.inp + fe_meta.json.
"""

import json
import math
import os
import traceback

import assembly  # noqa: F401 -- these imports register the CAE methods (openStep, Coupling, ...)
import interaction  # noqa: F401
import job  # noqa: F401
import load  # noqa: F401
import material  # noqa: F401
import mesh  # noqa: F401
import numpy as np
import part  # noqa: F401
import regionToolset
import section  # noqa: F401
import step  # noqa: F401
from abaqus import mdb
from abaqusConstants import (BOTTOM_SURFACE, DEFORMABLE_BODY, DISTRIBUTING, FREE, KINEMATIC, NO_IDEALIZATION, OFF, ON, QUAD_DOMINATED,
                             STANDARD, THREE_D, TOP_SURFACE, TRI, UNIFORM, UNSET, WHOLE_SURFACE)
from mesh import ElemType
from abaqusConstants import S3R, S4R

HERE = os.getcwd()
LOG = open(os.path.join(HERE, "abaqus_frame.log"), "w")


def log(msg):
    LOG.write(str(msg) + "\n")
    LOG.flush()


def seg_dist(p, a, b):
    ab = b - a
    t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-12), 0.0, 1.0)
    return np.linalg.norm(p - (a + t * ab))


def line_dist(p, pts):
    best = 1e18
    for i in range(len(pts) - 1):
        d = seg_dist(p, pts[i], pts[i + 1])
        if d < best:
            best = d
    return best


def main():
    spec = json.load(open(os.path.join(HERE, "fe_model.json")))
    lam = spec["laminate"]
    model = mdb.Model(name="bike")
    mat = model.Material(name="cfrp_qi")
    mat.Elastic(table=((lam["E"], lam["nu"]),))
    mat.Density(table=((lam["rho"],),))
    lines = [dict(c, path=np.array(c["path"])) for c in spec["centrelines"]]
    rear, front = np.array(spec["rp"]["REAR_L"]["at"][:2]), np.array(spec["rp"]["FRONT_L"]["at"][:2])
    parts, meta = {}, {"parts": {}, "walls": {}}
    for name in ("frame", "fork"):
        geom = mdb.openStep(fileName=os.path.join(HERE, name + ".step"), scaleFromFile=OFF)
        p = model.PartFromGeometryFile(name=name, geometryFile=geom, combine=False, dimensionality=THREE_D, type=DEFORMABLE_BODY)
        p.RemoveCells(cellList=p.cells[:])  # solid -> its outer skin, meshed as shells
        groups, mass = {}, 0.0
        for f in p.faces:
            pt = np.array(f.pointOn[0])
            if np.linalg.norm(pt[:2] - (rear if name == "frame" else front)) < 24:
                key, wall = "dropout", 3.0
            else:
                cands = [(line_dist(pt, c["path"]), c) for c in lines if c["part"] == name]
                d, c = min(cands, key=lambda x: x[0])
                key, wall = c["name"], c["wall"]
            groups.setdefault((key, wall), []).append(f.pointOn)
        for (key, wall), pts in groups.items():
            sec = "sh_%s_%s" % (name, key)
            model.HomogeneousShellSection(name=sec, material="cfrp_qi", thickness=wall, idealization=NO_IDEALIZATION, numIntPts=5)
            faces = p.faces.findAt(*pts)
            region = p.Set(faces=faces, name="F_" + key)
            p.SectionAssignment(region=region, sectionName=sec, offsetType=TOP_SURFACE)
            area = p.getArea(faces)
            mass += area * wall * lam["rho"] * 1000.0  # kg
            meta["walls"]["%s/%s" % (name, key)] = {"wall_mm": wall, "faces": len(pts), "area_mm2": area}
        ok = False
        for shape, size in ((QUAD_DOMINATED, spec["mesh_size"]), (TRI, spec["mesh_size"]), (TRI, spec["mesh_size"] * 0.7)):
            try:
                p.deleteMesh()
                p.setMeshControls(regions=p.faces, elemShape=shape, technique=FREE)
                p.setElementType(regions=(p.faces,), elemTypes=(ElemType(elemCode=S4R, elemLibrary=STANDARD), ElemType(elemCode=S3R, elemLibrary=STANDARD)))
                p.seedPart(size=size, deviationFactor=0.06, minSizeFactor=0.2)
                p.generateMesh()
                if len(p.elements) > 0 and not p.getUnmeshedRegions():
                    ok = True
                    log("%s meshed: %s, size %.1f, %d elements, %d nodes" % (name, shape, size, len(p.elements), len(p.nodes)))
                    break
            except Exception as e:
                log("%s mesh attempt failed: %s" % (name, e))
        if not ok:
            raise RuntimeError("could not mesh " + name)
        parts[name] = p
        meta["parts"][name] = {"elements": len(p.elements), "nodes": len(p.nodes), "mass_kg": mass}

    a = model.rootAssembly
    inst = {n: a.Instance(name=n, part=p, dependent=ON) for n, p in parts.items()}
    coords = {n: np.array([nd.coordinates for nd in i.nodes]) for n, i in inst.items()}
    labels = {n: np.array([nd.label for nd in i.nodes]) for n, i in inst.items()}
    rpr = {}
    for key, r in spec["rp"].items():
        at, b = np.array(r["at"], float), r["band"]
        ax = np.array(b["axis"], float); ax /= np.linalg.norm(ax)
        sel = []
        for n in (["frame", "fork"] if r["part"] == "both" else [r["part"]]):
            rel = coords[n] - at
            h = rel.dot(ax)
            rad = np.linalg.norm(rel - np.outer(h, ax), axis=1)
            m = (h >= b["h"][0]) & (h <= b["h"][1]) & (rad >= b["r"][0]) & (rad <= b["r"][1])
            if m.any():
                sel.append(inst[n].nodes.sequenceFromLabels([int(x) for x in labels[n][m]]))
            meta.setdefault("couplings", {})[key + "/" + n] = int(m.sum())
        if not sel:
            raise RuntimeError("no nodes for reference point " + key)
        nodes = sel[0]
        for s in sel[1:]:
            nodes = nodes + s
        nset = a.Set(nodes=nodes, name="N_" + key)
        ref = a.ReferencePoint(point=tuple(at))
        rregion = regionToolset.Region(referencePoints=(a.referencePoints[ref.id],))
        a.Set(referencePoints=(a.referencePoints[ref.id],), name="RP_" + key)
        rpr[key] = a.sets["RP_" + key]
        model.Coupling(name="C_" + key, controlPoint=rregion, surface=nset, influenceRadius=WHOLE_SURFACE,
                       couplingType=KINEMATIC if r["kind"] == "KINEMATIC" else DISTRIBUTING,
                       localCsys=None, u1=ON, u2=ON, u3=ON, ur1=ON, ur2=ON, ur3=ON,
                       **({} if r["kind"] == "KINEMATIC" else {"weightingMethod": UNIFORM}))

    prev = "Initial"
    for c in spec["cases"]:
        model.StaticLinearPerturbationStep(name=c["name"], previous=prev, description=c["label"])
        prev = c["name"]
        for key, dofs in c["bcs"]:
            kw = {("u%d" % d if d <= 3 else "ur%d" % (d - 3)): 0.0 for d in dofs}
            model.DisplacementBC(name="BC_%s_%s" % (c["name"], key), createStepName=c["name"], region=rpr[key], **kw)
        for key, v in c["loads"]:
            if any(abs(x) > 0 for x in v[:3]):
                model.ConcentratedForce(name="F_%s_%s" % (c["name"], key), createStepName=c["name"], region=rpr[key], cf1=v[0], cf2=v[1], cf3=v[2])
            if any(abs(x) > 0 for x in v[3:]):
                model.Moment(name="M_%s_%s" % (c["name"], key), createStepName=c["name"], region=rpr[key], cm1=v[3], cm2=v[4], cm3=v[5])
    model.FrequencyStep(name="modes", previous=prev, numEigen=spec["modes"], description="Natural modes, wheels' axles held")
    for key, dofs in spec["cases"][0]["bcs"]:
        kw = {("u%d" % d if d <= 3 else "ur%d" % (d - 3)): 0.0 for d in dofs}
        model.DisplacementBC(name="BC_modes_%s" % key, createStepName="modes", region=rpr[key], **kw)
    model.fieldOutputRequests[list(model.fieldOutputRequests.keys())[0]].setValues(variables=("S", "U", "RF"))
    job = mdb.Job(name="frame_fe", model="bike", numCpus=4, numDomains=4)
    job.writeInput(consistencyChecking=OFF)
    json.dump(meta, open(os.path.join(HERE, "fe_meta.json"), "w"), indent=1)
    log("wrote frame_fe.inp")


try:
    main()
except Exception:
    log(traceback.format_exc())
    raise
