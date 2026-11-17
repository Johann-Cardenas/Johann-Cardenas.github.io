"""Virtual wind tunnel: SOLIDWORKS Flow Simulation on the wind-tunnel assembly.

Standard bicycle-CFD assumptions (bike only, no rider):
  * air at 20 C and 101 325 Pa, incompressible regime (Mach 0.03)
  * 40 km/h (11.11 m/s) head-on; optional yaw by rotating the wind vector about +Y
  * free stream: no ground plane, wheels static, spokes, chain and cables omitted
  * Flow Simulation's k-epsilon model with two-scale wall functions; 0.1 % inflow turbulence
  * steady state

Settings are cloned from Flow Simulation's own external-air example (street canyon) and then
overridden; its goals and local mesh are deleted. Fields are sampled with the post-processor's
interpolator for the website; drag comes from integrating surface pressure over the CAD
tessellation plus a flat-plate skin-friction estimate (see cfd_post.py).

Run with the GPR-Mount Python:  python cad/flow_tunnel.py --level 3 --yaw 0
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import time
from pathlib import Path

import numpy as np
import pythoncom
import win32com.client as win32
from win32com.client import gencache

BUILD = Path(os.environ.get("ROADBIKE_BUILD", Path(os.environ["LOCALAPPDATA"]) / "road-bike-cad" / "build"))
WORK = BUILD.parent / "cfd"
FS = Path(r"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS Flow Simulation")
U_INF, T_K, P_PA = 40 / 3.6, 293.15, 101325.0
TI, TL = 0.001, 0.01  # inflow turbulence intensity and length scale (m)


def module(path):
    lib = pythoncom.LoadTypeLib(str(path))
    a = lib.GetLibAttr()
    return gencache.EnsureModule(a[0], a[1], a[3], a[4])


class Tunnel:
    def __init__(self):
        self.api = module("C:/Program Files/SOLIDWORKS Corp/SOLIDWORKS/sldworks.tlb")
        self.fw = module(FS / "binCFW" / "FW03.dll")
        self.sw = self.api.ISldWorks(win32.Dispatch("SldWorks.Application")._oleobj_)
        self.sw.Visible = True
        self.sw.LoadAddIn(str(FS / "binCFW" / "FW03.dll"))
        app = self.fw.IApp(self.sw.GetAddInObject("FloWorks.App")._oleobj_)
        self.appapi = self.fw.IAppApi(app.GetAPI()._oleobj_)

    def open(self, path, kind):
        raw = self.sw.OpenDoc6(str(path), kind, 1, "", 0, 0)
        raw = raw[0] if isinstance(raw, tuple) else raw
        if raw is None:
            raise RuntimeError(f"Could not open {path}")
        return self.api.IModelDoc2(raw._oleobj_)

    def close_all(self):
        self.sw.CloseAllDocuments(True)

    def setup(self, yaw_deg, level, name):
        """Fresh copy of the wind-tunnel assembly with one configured project."""
        self.close_all()
        WORK.mkdir(parents=True, exist_ok=True)
        case = WORK / name
        if case.exists():
            shutil.rmtree(case, ignore_errors=True)
        case.mkdir(parents=True)
        asm = case / "tunnel.SLDASM"
        shutil.copy2(BUILD / "solidworks" / "synapse_aero.SLDASM", asm)
        example = WORK / "example_street.sldprt"
        if not example.exists():
            shutil.copy2(FS / "Examples" / "d3 - street canyon" / "Ready" / "block.sldprt", example)
        src_doc = self.open(example, 1)
        src = self.fw.IDocumentApi(self.appapi.GetDocument(src_doc)._oleobj_).IActiveProject
        doc = self.open(asm, 2)
        dapi = self.fw.IDocumentApi(self.appapi.GetDocument(doc)._oleobj_)
        dapi.AddProject(dapi.CreateTemplateProject(src), name, "", True)
        p = self.fw.IProjectApiHandler(dapi.IActiveProject._oleobj_)
        p.ProjectName = name
        for f in p.EnumFeatures() or ():  # the example's goals, local mesh and tracer point at its own faces
            p.DeleteFeature(self.fw.IFeatureAPI(f._oleobj_).UUID_)
        # computational domain (m): bike bbox is about x -0.75..0.92, y -0.27..0.98, z -0.24..0.24
        dom = {"Xmin": -5.0, "Xmax": 3.0, "Ymin": -1.6, "Ymax": 2.4, "Zmin": -1.6, "Zmax": 1.6}
        for k, v in dom.items():
            setattr(p, f"ComputationalDomain{k}", v)
        # wind: the bike faces +X, so the air moves along -X; yaw turns it about +Y
        yaw = math.radians(yaw_deg)
        ux, uz = -U_INF * math.cos(yaw), U_INF * math.sin(yaw)
        k = 1.5 * (TI * U_INF) ** 2
        eps = 0.09 ** 0.75 * k ** 1.5 / TL
        exported = case / "params_in.xml"
        p.ExportParametersToFile(str(exported), 0)
        xml = exported.read_bytes().decode("utf-8")  # keep CRLF line endings as exported
        # only what differs from the example (it already holds 101 325 Pa and 293.2 K air)
        values = {"Velocity in X direction": ux, "Turbulent energy": k, "Turbulent dissipation": eps, "Level of Initial Mesh": level}
        if abs(uz) > 1e-9:
            values["Velocity in Z direction"] = uz

        def put(m):
            nm = m.group(1)
            if nm not in values:
                return m.group(0)
            v = values[nm]
            text = str(int(v)) if isinstance(v, int) else f"{v:.10f}"  # the parser rejects exponent notation
            return re.sub(r'<Value value="[^"]*"/>', f'<Value value="{text}"/>', m.group(0), count=1)
        xml = re.sub(r'<Name value="([^"]*)"/>.*?</PS_Parameters>', put, xml, flags=re.S)
        applied = case / "params_set.xml"
        applied.write_bytes(xml.encode("utf-8"))
        p.ApplyParametersFromFile3(str(applied), p, 0)
        p.Rebuild()
        self.sw.CloseDoc(src_doc.GetTitle())  # only now: closing the source earlier breaks ApplyParametersFromFile3
        check = case / "params_check.xml"
        p.ExportParametersToFile(str(check), 0)
        got = dict(re.findall(r'<Name value="([^"]*)"/>.*?<Value value="([^"]*)"/>', check.read_text(encoding="utf-8"), flags=re.S))
        report = {k: got.get(k) for k in values}
        doc.Save3(1, 0, 0)
        return doc, p, {"case": str(case), "domain_m": dom, "u_inf": U_INF, "yaw_deg": yaw_deg, "k": k, "eps": eps, "applied": report}

    def solve(self, p, cpus=16):
        calc = p.CalculationData
        try:
            calc.NumberOfProcessorsToUse = cpus
        except Exception:
            pass
        t = time.time()
        p.Solve(True, True, True, False)  # build mesh, recalculate, close monitor, no batch-results processing
        return time.time() - t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", type=int, default=3)
    ap.add_argument("--yaw", type=float, default=0.0)
    ap.add_argument("--setup-only", action="store_true")
    a = ap.parse_args()
    name = f"yaw{int(round(a.yaw)):02d}_L{a.level}"
    t = Tunnel()
    doc, p, info = t.setup(a.yaw, a.level, name)
    print(json.dumps(info, indent=1))
    if a.setup_only:
        return
    info["solve_s"] = t.solve(p)
    doc.Save3(1, 0, 0)
    (Path(info["case"]) / "case.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    print("solved in", round(info["solve_s"]), "s")


if __name__ == "__main__":
    main()
