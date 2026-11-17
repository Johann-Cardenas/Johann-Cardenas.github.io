"""Build the SolidWorks parts and assemblies from the CadQuery STEP exports.

Follows the GPR-Mount builder: each part is reconstructed from its STEP file, checked
against the CadQuery volume and centroid, coloured, given custom properties and saved as
SLDPRT. Two assemblies are written, every component inserted at the identity transform
and fixed:

  synapse.SLDASM       the whole bike
  synapse_aero.SLDASM  the wind-tunnel model (no spokes): input to Flow Simulation

Run after cad/export.py, with the GPR-Mount Python (pywin32):  python cad/solidworks_build.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = Path(os.environ.get("ROADBIKE_BUILD", Path(os.environ["LOCALAPPDATA"]) / "road-bike-cad" / "build"))
SW = {
    "type_library": "C:/Program Files/SOLIDWORKS Corp/SOLIDWORKS/sldworks.tlb",
    "assembly_template": "C:/ProgramData/SOLIDWORKS/SOLIDWORKS 2026/templates/MBD/assembly 1001mm and larger.asmdot",
}
VOLUME_TOL, VOLUME_ABS_MM3, CENTROID_TOL_MM = 0.02, 1000.0, 0.5  # 2 % or 1 cm3 (spline-surface mass properties differ slightly); catches gross import failures


class Builder:
    def __init__(self):
        import pythoncom
        import win32com.client as win32
        from win32com.client import gencache

        lib = pythoncom.LoadTypeLib(SW["type_library"])
        attr = lib.GetLibAttr()
        self.api = gencache.EnsureModule(attr[0], attr[1], attr[3], attr[4])
        self.app = self.api.ISldWorks(win32.Dispatch("SldWorks.Application")._oleobj_)
        self.app.UserControl = True
        self.pythoncom, self.win32 = pythoncom, win32

    def doubles(self, values):
        return self.win32.VARIANT(self.pythoncom.VT_ARRAY | self.pythoncom.VT_R8, values)

    def strings(self, values):
        return self.win32.VARIANT(self.pythoncom.VT_ARRAY | self.pythoncom.VT_BSTR, values)

    def close(self, path):
        doc = self.app.GetOpenDocumentByName(str(path))
        if doc is not None:
            self.app.CloseDoc(self.api.IModelDoc2(doc._oleobj_).GetTitle())

    def part(self, rec, out):
        path = out / f"{rec['name']}.SLDPRT"
        self.close(path)
        data = self.app.GetImportFileData(rec["step"])
        raw, errors = self.app.LoadFile4(rec["step"], "r", data, 0)
        if raw is None:
            raise RuntimeError(f"STEP import failed for {rec['name']}: {errors}")
        doc = self.api.IModelDoc2(raw._oleobj_)
        try:
            doc.ForceRebuild3(False)
            bodies = self.api.IPartDoc(doc._oleobj_).GetBodies2(0, True) or []
            vol, cg = 0.0, [0.0, 0.0, 0.0]
            for b in bodies:
                mp = b.GetMassProperties(1)  # unit density: x, y, z (m), volume (m3), ...
                vol += mp[3]
                for k in range(3):
                    cg[k] += mp[k] * mp[3]
            if vol <= 0:
                raise RuntimeError(f"{rec['name']}: SolidWorks reports no volume")
            cg = [c / vol * 1000 for c in cg]
            vol_mm3 = vol * 1e9
            rel = abs(vol_mm3 - rec["volume_mm3"]) / rec["volume_mm3"]
            dcg = max(abs(a - b) for a, b in zip(cg, rec["centroid_mm"]))
            if (rel > VOLUME_TOL and abs(vol_mm3 - rec['volume_mm3']) > VOLUME_ABS_MM3) or dcg > CENTROID_TOL_MM:
                raise RuntimeError(f"{rec['name']}: SolidWorks volume/centroid differ (rel {rel:.4f}, {dcg:.2f} mm)")
            r, g, b = rec["color"]
            # R, G, B, ambient, diffuse, specular, shininess, transparency, emission -- must be a typed double array:
            # a plain tuple is marshalled wrongly and lands blue in the transparency slot
            vals = self.doubles((r, g, b, 1.0, 1.0, 0.5, 0.4, 0.0, 0.0))
            doc.MaterialPropertyValues = vals
            for body in bodies:  # imported bodies carry their own appearance; colour them directly
                body.MaterialPropertyValues2 = vals
            props = doc.Extension.CustomPropertyManager("")
            for k, v in {"Slot": rec["slot"], "WindTunnel": "yes" if rec["aero"] else "no", "FE": "yes" if rec["fe"] else "no",
                         "Source": "cad/bike_cad.py via STEP", "Volume_cm3": f"{vol_mm3 / 1000:.2f}"}.items():
                props.Add3(k, 30, str(v), 2)
            doc.ShowNamedView2("*Isometric", 7)
            doc.ViewZoomtofit2()
            if doc.SaveAs3(str(path), 0, 1) != 0:
                raise RuntimeError(f"Save failed: {rec['name']}")
            return {"name": rec["name"], "bodies": len(bodies), "volume_mm3": vol_mm3, "volume_rel": rel, "centroid_dmm": dcg, "path": str(path)}
        finally:
            self.app.CloseDoc(doc.GetTitle())

    def assembly(self, paths, out_path):
        self.close(out_path)
        raw = self.app.NewDocument(os.path.normpath(SW["assembly_template"]), 0, 0, 0)  # forward slashes fail here
        doc, asm = self.api.IModelDoc2(raw._oleobj_), self.api.IAssemblyDoc(raw._oleobj_)
        identity = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0)
        added = asm.AddComponents3(self.strings(paths), self.doubles(identity * len(paths)), self.strings([""] * len(paths)))
        if added is None or len(added) != len(paths):
            raise RuntimeError("Assembly insertion did not return every component")
        doc.ClearSelection2(True)
        for c in added:
            self.api.IComponent2(c._oleobj_).Select4(True, None, False)
        asm.FixComponent()
        doc.ClearSelection2(True)
        doc.ShowNamedView2("*Isometric", 7)
        doc.ViewZoomtofit2()
        if doc.SaveAs3(str(out_path), 0, 1) != 0:
            raise RuntimeError(f"Assembly save failed: {out_path}")
        return doc


def main():
    manifest = json.loads((BUILD / "manifest.json").read_text(encoding="utf-8"))
    out = BUILD / "solidworks"
    out.mkdir(parents=True, exist_ok=True)
    b = Builder()
    b.app.CloseAllDocuments(True)  # an open assembly locks its part files
    b.app.DocumentVisible(False, 1)
    report = []
    try:
        for rec in manifest["parts"]:
            r = b.part(rec, out)
            report.append(r)
            print(f"  {r['name']:22s} bodies={r['bodies']} dV={r['volume_rel'] * 100:.3f}% dCG={r['centroid_dmm']:.3f} mm", flush=True)
    finally:
        b.app.DocumentVisible(True, 1)
    whole = [r["path"] for r in report]
    aero = [r["path"] for r, rec in zip(report, manifest["parts"]) if rec["aero"]]
    b.assembly(whole, out / "synapse.SLDASM")
    b.app.CloseDoc("synapse.SLDASM")
    b.assembly(aero, out / "synapse_aero.SLDASM")
    (BUILD / "solidworks_validation.json").write_text(json.dumps({"revision": b.app.RevisionNumber(), "parts": report}, indent=1), encoding="utf-8")
    # the website's copy (CAD tab and tests/data.test.js): same records without the local paths
    web = {"revision": b.app.RevisionNumber(), "parts": [{k: (round(v, 6) if isinstance(v, float) else v) for k, v in r.items() if k != "path"} for r in report]}
    (ROOT / "data" / "cad" / "solidworks.json").write_text(json.dumps(web, indent=1), encoding="utf-8")
    print(f"{len(report)} parts; assemblies: synapse.SLDASM ({len(whole)}), synapse_aero.SLDASM ({len(aero)})")


if __name__ == "__main__":
    sys.exit(main())
