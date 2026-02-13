"""
Asphera Preprocessing Script  v2
=================================
Converts FEM pkl.bz2 data into lightweight JSON files for the Asphera web app.

Outputs:
  - data/<CASE>/structure.json   : Layer geometry & model metadata
  - data/<CASE>/profiles.json    : Critical depth-profile curves (grouped by layer)
  - data/<CASE>/contours.json    : Cross-section heatmaps + multi-field animation
  - data/<CASE>/pointcloud.json  : 3D grid point cloud for isometric view

Usage:
  python preprocess.py
"""

import json, os, sys
import numpy as np
import pandas as pd
from scipy.interpolate import NearestNDInterpolator, griddata

# ──────────────────────────────────────────────────────
#  CONFIGURATION  (mirrors the Jupyter notebook)
# ──────────────────────────────────────────────────────
CASES = {"TK_P1_SL0": list(range(1, 19))}
TSTEP_RANGE = [4, 16]

MODEL_LENGTH  = 9520.0
WHEEL_LENGTH  = 1320.0
MODEL_WIDTH   = 8432.0
WHEEL_WIDTH   = 232.0
MODEL_DEPTH   = 5000.0

STRUCTURE   = ["AC1", "AC2", "B1", "SG1"]
LABELS      = ["HMA\u2081", "HMA\u2082", "Base", "Subgrade"]
THICKNESSES = [40.0, 115.0, 305.0, 4540.0]
COLORS      = ["#2d2d2d", "#4a4a4a", "#c9a96e", "#8B7355"]

SOURCE_DIR = r"C:\Users\johannc2\Box\R27-252 EV\Tasks\Task 3 - Pavement FEM\Post-Processing"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "data")

IGNORE_SURFACE = 5.0

# Profile definitions: (component, detection_layer, category, label, viewType, layerGroup)
PROFILE_DEFS = [
    # --- HMA group (AC1/AC2 click) ---
    ("E11", "AC2", "HMA Layer",              "Tensile Strain \u03b5\u2081\u2081",     "full", "HMA"),
    ("E33", "AC2", "HMA Layer",              "Tensile Strain \u03b5\u2083\u2083",     "full", "HMA"),
    ("E23", "AC2", "HMA Layer",              "Shear Strain \u03b5\u2082\u2083",       "full", "HMA"),
    ("E13", "AC1", "Near-Surface Responses", "Shear Strain \u03b5\u2081\u2083",      "near", "HMA"),
    ("E12", "AC1", "Near-Surface Responses", "Shear Strain \u03b5\u2081\u2082",      "near", "HMA"),
    ("E23", "AC2", "Near-Surface Responses", "Shear Strain \u03b5\u2082\u2083",      "near", "HMA"),
    # --- Base group (B1 click) ---
    ("E22", "B1",  "Base Layer",             "Compressive Strain \u03b5\u2082\u2082", "full", "B1"),
    ("E23", "B1",  "Base Layer",             "Shear Strain \u03b5\u2082\u2083",       "full", "B1"),
    ("E13", "B1",  "Base Layer",             "Shear Strain \u03b5\u2081\u2083",       "full", "B1"),
    # --- Subgrade group (SG1 click) ---
    ("E22", "SG1", "Subgrade Layer",         "Compressive Strain \u03b5\u2082\u2082", "full", "SG1"),
    ("E23", "SG1", "Subgrade Layer",         "Shear Strain \u03b5\u2082\u2083",       "full", "SG1"),
    ("E13", "SG1", "Subgrade Layer",         "Shear Strain \u03b5\u2081\u2083",       "full", "SG1"),
]

CONTOUR_FIELDS = ["E11", "E22", "E33", "E23", "E13", "U2", "SMises"]

# 3D grid resolution
GRID_NX, GRID_NZ = 22, 18


# ──────────────────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────────────────
def build_y_ranges():
    y_ranges, cum = {}, 0.0
    for layer, thick in zip(STRUCTURE, THICKNESSES):
        y_ranges[layer] = (MODEL_DEPTH - cum - thick, MODEL_DEPTH - cum)
        cum += thick
    return y_ranges

Y_RANGES = build_y_ranges()


def resolve_contour_slice_by_layers(slc, a1, a2):
    """
    Resolve duplicate (a1, a2) at layer interfaces so each coordinate appears once.
    At interfaces, nodes from the layer above and below share the same coordinates;
    we assign them consistently: top layer keeps 'first', bottom keeps 'last',
    middle layers: upper interface keep 'last', lower interface keep 'first'.
    (Mirrors process_layers logic from the original implementation.)
    """
    y_col = a2  # Yn_elem in both XY and YZ planes
    layers_dfs = []
    for i, lay in enumerate(STRUCTURE):
        y_lower, y_upper = Y_RANGES[lay]
        dfl = slc[slc[y_col].between(y_lower, y_upper)]
        if dfl.empty:
            continue
        if i == 0:
            dedup = dfl.drop_duplicates(subset=[a1, a2], keep="first")
        elif i == len(STRUCTURE) - 1:
            dedup = dfl.drop_duplicates(subset=[a1, a2], keep="last")
        else:
            interior = dfl[(dfl[y_col] > y_lower) & (dfl[y_col] < y_upper)]
            df_int_high = dfl[dfl[y_col] == y_upper].drop_duplicates(subset=[a1, a2], keep="last")
            df_int_low = dfl[dfl[y_col] == y_lower].drop_duplicates(subset=[a1, a2], keep="first")
            dedup = pd.concat([interior, df_int_low, df_int_high], ignore_index=True)
        layers_dfs.append(dedup)
    combined = pd.concat(layers_dfs, ignore_index=True)
    # At shared interfaces the same (a1, a2) can appear in two adjacent layers; keep first (top layer wins)
    return combined.drop_duplicates(subset=[a1, a2], keep="first")


def find_critical_timestep(data_list, component, det_layer):
    y_lo, y_hi = Y_RANGES[det_layer]
    best_val, best_idx = None, 0
    start = TSTEP_RANGE[0] - 1
    end   = TSTEP_RANGE[1]
    for i in range(start, min(end, len(data_list))):
        df = data_list[i]
        layer = df[df["Yn_elem"].between(y_lo, y_hi)]
        if det_layer == "AC1":
            layer = layer[layer["Yn_elem"].between(y_lo, y_hi - IGNORE_SURFACE)]
        if layer.empty:
            continue
        if component in ("E11", "E33"):
            val = layer[component].max()
        elif component == "E22":
            val = layer[component].min()
        else:
            mx, mn = layer[component].max(), layer[component].min()
            val = mx if abs(mx) >= abs(mn) else mn
        if best_val is None:
            best_val, best_idx = val, i
        else:
            if component in ("E11", "E33") and val > best_val:
                best_val, best_idx = val, i
            elif component == "E22" and val < best_val:
                best_val, best_idx = val, i
            elif component not in ("E11", "E33", "E22") and abs(val) > abs(best_val):
                best_val, best_idx = val, i
    return best_idx, best_val


def extract_profile(data_list, component, det_layer):
    ts_idx, _ = find_critical_timestep(data_list, component, det_layer)
    df_full = data_list[ts_idx]
    y_lo, y_hi = Y_RANGES[det_layer]
    layer = df_full[df_full["Yn_elem"].between(y_lo, y_hi)]
    if det_layer == "AC1":
        layer = layer[layer["Yn_elem"].between(y_lo, y_hi - IGNORE_SURFACE)]
    if component in ("E11", "E33"):
        crit_idx = layer[component].idxmax()
    elif component == "E22":
        crit_idx = layer[component].idxmin()
    else:
        mx, mn = layer[component].max(), layer[component].min()
        crit_idx = layer[component].idxmax() if abs(mx) >= abs(mn) else layer[component].idxmin()
    loc = layer.loc[crit_idx, ["Xn_elem", "Yn_elem", "Zn_elem"]]
    crit_value = float(layer.loc[crit_idx, component])
    profile = df_full[(df_full["Xn_elem"] == loc["Xn_elem"]) &
                      (df_full["Zn_elem"] == loc["Zn_elem"])]
    profile = profile.sort_values(by=["Yn_elem", "Node"], ascending=[False, True])
    depths = (MODEL_DEPTH - profile["Yn_elem"].values)
    values = (profile[component].values * 1e6)
    crit_depth = float(MODEL_DEPTH - loc["Yn_elem"])
    return {
        "depths":        [round(float(d), 2) for d in depths],
        "values":        [round(float(v), 4) for v in values],
        "criticalDepth": round(crit_depth, 2),
        "criticalValue": round(crit_value * 1e6, 4),
        "timestep":      ts_idx + 1,
        "location": {"x": round(float(loc["Xn_elem"]), 2),
                     "y": round(float(loc["Yn_elem"]), 2),
                     "z": round(float(loc["Zn_elem"]), 2)},
    }


def extract_contour_slice(df_full, plane, coord_val, fields, grid_res=80,
                          x_center=0.0, z_center=0.0):
    """
    Extract interpolated 2D contour grids for multiple fields at once.
    Returns dict with centered axis1, depths, and per-field values.
    """
    tol = 20.0
    if plane == "XY":
        slc = df_full[df_full["Zn_elem"].between(coord_val - tol, coord_val + tol)]
        a1, a2 = "Xn_elem", "Yn_elem"
        center_shift = x_center
    else:
        slc = df_full[df_full["Xn_elem"].between(coord_val - tol, coord_val + tol)]
        a1, a2 = "Zn_elem", "Yn_elem"
        center_shift = z_center

    if slc.empty or len(slc) < 10:
        return None

    # Resolve duplicate (a1, a2) at layer interfaces so contours don't jump at boundaries
    slc = resolve_contour_slice_by_layers(slc, a1, a2)

    pts = slc[[a1, a2]].values
    a1_min, a1_max = pts[:, 0].min(), pts[:, 0].max()
    a2_min, a2_max = pts[:, 1].min(), pts[:, 1].max()

    g1 = np.linspace(a1_min, a1_max, grid_res)
    g2_upper = np.linspace(a2_max, a2_max - 600, int(grid_res * 0.6))
    g2_lower = np.linspace(a2_max - 600, a2_min, int(grid_res * 0.4))
    g2 = np.concatenate([g2_upper, g2_lower[1:]])

    grid_a1, grid_a2 = np.meshgrid(g1, g2)
    depth_vals = MODEL_DEPTH - g2
    centered_a1 = g1 - center_shift

    result = {
        "axis1":  [round(float(x), 1) for x in centered_a1],
        "depths": [round(float(d), 1) for d in depth_vals],
        "fields": {},
    }

    for field in fields:
        vals = slc[field].values
        grid_vals = griddata(pts, vals, (grid_a1, grid_a2), method="linear")
        # Convert units
        if field.startswith("E"):
            grid_vals = grid_vals * 1e6
            unit = "\u00b5\u03b5"
        elif field == "U2":
            unit = "mm"
        else:
            unit = "MPa"
        result["fields"][field] = {
            "values": [[round(float(v), 4) if not np.isnan(v) else None
                        for v in row] for row in grid_vals.tolist()],
            "unit": unit,
        }
    return result


def extract_3d_grid(df_full, x_center, z_center):
    """Extract a 3D regular grid of interpolated field values."""
    print("    Deduplicating nodes ...")
    df_u = df_full.groupby(["Xn_elem", "Yn_elem", "Zn_elem"], as_index=False).mean(numeric_only=True)
    print(f"    Unique nodes: {len(df_u)}")

    coords = df_u[["Xn_elem", "Yn_elem", "Zn_elem"]].values
    x_min, x_max = coords[:, 0].min(), coords[:, 0].max()
    z_min, z_max = coords[:, 2].min(), coords[:, 2].max()

    # Build grid: uniform in X and Z, non-uniform in depth (dense near surface)
    gx = np.linspace(x_min, x_max, GRID_NX)
    gz = np.linspace(z_min, z_max, GRID_NZ)
    # Depth points (from surface): dense near top
    depth_pts = np.array([0, 5, 15, 30, 50, 80, 120, 155, 200, 305, 460, 600, 800, 1200])
    gy = MODEL_DEPTH - depth_pts  # convert back to Yn_elem

    grid_x, grid_y, grid_z = np.meshgrid(gx, gy, gz, indexing="ij")
    target_pts = np.column_stack([grid_x.ravel(), grid_y.ravel(), grid_z.ravel()])

    print(f"    3D grid: {GRID_NX} x {len(depth_pts)} x {GRID_NZ} = {len(target_pts)} points")
    print("    Building interpolator ...")
    interp = NearestNDInterpolator(coords, np.arange(len(coords)))

    # Use nearest neighbor to get field values at grid points
    nn_idx = interp(target_pts).astype(int)

    result = {
        "x": [round(float(v - x_center), 1) for v in gx],
        "depths": [round(float(d), 1) for d in depth_pts],
        "z": [round(float(v - z_center), 1) for v in gz],
        "nx": GRID_NX,
        "ny": len(depth_pts),
        "nz": GRID_NZ,
        "fields": {},
    }

    for field in CONTOUR_FIELDS:
        print(f"    Interpolating {field} ...")
        raw = df_u[field].values[nn_idx]
        if field.startswith("E"):
            raw = raw * 1e6
            unit = "\u00b5\u03b5"
        elif field == "U2":
            unit = "mm"
        else:
            unit = "MPa"
        result["fields"][field] = {
            "values": [round(float(v), 4) for v in raw],
            "unit": unit,
        }

    return result


# ──────────────────────────────────────────────────────
#  MAIN
# ──────────────────────────────────────────────────────
def main():
    for case, ts_list in CASES.items():
        print(f"\n{'='*60}")
        print(f"  Processing case: {case}")
        print(f"{'='*60}")

        out_dir = os.path.join(OUTPUT_DIR, case.replace("_SL0", ""))
        os.makedirs(out_dir, exist_ok=True)

        # Load all timesteps
        data_all = []
        for ts in ts_list:
            fn = f"{case}_3DResponse_tire{ts}.pkl.bz2"
            fp = os.path.join(SOURCE_DIR, case, fn)
            if not os.path.exists(fp):
                print(f"  [SKIP] {fn} not found")
                continue
            print(f"  Loading {fn} ...")
            df = pd.read_pickle(fp, compression="bz2")
            data_all.append(df.sort_values(by="Node", ascending=True))
        print(f"  Loaded {len(data_all)} timesteps.\n")

        # Compute axis centers
        df_ref = data_all[TSTEP_RANGE[1] - 1]  # use last critical timestep
        x_center = float(df_ref["Xn_elem"].median())
        z_center = float(df_ref["Zn_elem"].median())
        print(f"  Axis centers: X={x_center:.0f}, Z={z_center:.0f}\n")

        # ── 1. Structure metadata ───────────────────
        interfaces = []
        cum = 0.0
        for layer, label, thick, color in zip(STRUCTURE, LABELS, THICKNESSES, COLORS):
            interfaces.append({
                "id": layer, "label": label,
                "thickness": thick, "color": color,
                "depthTop": cum, "depthBottom": cum + thick,
            })
            cum += thick

        structure = {
            "id":   case.replace("_SL0", ""),
            "name": "Arterial Section",
            "description": "SEC, 7.5 kips, 0% Slope",
            "model": {
                "length": MODEL_LENGTH, "width": MODEL_WIDTH,
                "depth": MODEL_DEPTH,
                "wheelPathLength": WHEEL_LENGTH, "wheelPathWidth": WHEEL_WIDTH,
                "xCenter": x_center, "zCenter": z_center,
            },
            "layers": interfaces,
            "timesteps": {"start": TSTEP_RANGE[0], "end": TSTEP_RANGE[1],
                          "total": TSTEP_RANGE[1] - TSTEP_RANGE[0] + 1},
        }
        _write(os.path.join(out_dir, "structure.json"), structure)

        # ── 2. Critical depth profiles ──────────────
        profiles = []
        for comp, det, cat, lbl, vtype, lgroup in PROFILE_DEFS:
            print(f"  Profile: {comp} @ {det} ({lgroup}) ...")
            p = extract_profile(data_all, comp, det)
            p.update({"component": comp, "detectionLayer": det, "category": cat,
                       "label": lbl, "viewType": vtype, "layerGroup": lgroup})
            profiles.append(p)
        _write(os.path.join(out_dir, "profiles.json"), {"profiles": profiles})

        # ── 3. Contour data + multi-field animation ─
        overview_ts = next(
            (p["timestep"] - 1 for p in profiles if p.get("layerGroup") == "B1"),
            profiles[0]["timestep"] - 1,
        )

        print(f"\n  Static contours (ts={overview_ts+1}) ...")
        df_static = data_all[overview_ts]

        contours = {
            "timestep": overview_ts + 1,
            "axisLabels": {
                "longitudinal": "X - Traffic Direction (mm)",
                "transverse":   "Z - Transverse Direction (mm)",
            },
        }

        # Static longitudinal slice
        print(f"  Longitudinal slice (XY @ Z={z_center:.0f}) ...")
        c_long = extract_contour_slice(df_static, "XY", z_center, CONTOUR_FIELDS,
                                       grid_res=80, x_center=x_center, z_center=z_center)
        # Static transverse slice
        print(f"  Transverse slice (YZ @ X={x_center:.0f}) ...")
        c_trans = extract_contour_slice(df_static, "YZ", x_center, CONTOUR_FIELDS,
                                        grid_res=80, x_center=x_center, z_center=z_center)
        contours["longitudinal"] = c_long
        contours["transverse"]   = c_trans

        # Animation: longitudinal (XY) and transverse (YZ) at each timestep, ALL fields
        print(f"\n  Animation frames (ts {TSTEP_RANGE[0]}-{TSTEP_RANGE[1]}, all fields) ...")
        # Longitudinal (XY plane at Z = z_center)
        first_long = extract_contour_slice(
            data_all[TSTEP_RANGE[0] - 1], "XY", z_center, CONTOUR_FIELDS,
            grid_res=60, x_center=x_center, z_center=z_center)
        anim_frames_long = []
        for i in range(TSTEP_RANGE[0] - 1, min(TSTEP_RANGE[1], len(data_all))):
            print(f"    Frame ts={i+1} (XY) ...")
            frame_data = extract_contour_slice(
                data_all[i], "XY", z_center, CONTOUR_FIELDS,
                grid_res=60, x_center=x_center, z_center=z_center)
            if frame_data is None:
                continue
            frame = {"timestep": i + 1, "fields": {}}
            for fld in CONTOUR_FIELDS:
                frame["fields"][fld] = frame_data["fields"][fld]
            anim_frames_long.append(frame)
        # Transverse (YZ plane at X = x_center)
        first_trans = extract_contour_slice(
            data_all[TSTEP_RANGE[0] - 1], "YZ", x_center, CONTOUR_FIELDS,
            grid_res=60, x_center=x_center, z_center=z_center)
        anim_frames_trans = []
        for i in range(TSTEP_RANGE[0] - 1, min(TSTEP_RANGE[1], len(data_all))):
            print(f"    Frame ts={i+1} (YZ) ...")
            frame_data = extract_contour_slice(
                data_all[i], "YZ", x_center, CONTOUR_FIELDS,
                grid_res=60, x_center=x_center, z_center=z_center)
            if frame_data is None:
                continue
            frame = {"timestep": i + 1, "fields": {}}
            for fld in CONTOUR_FIELDS:
                frame["fields"][fld] = frame_data["fields"][fld]
            anim_frames_trans.append(frame)

        contours["animation"] = {
            "longitudinal": {
                "axis1":  first_long["axis1"],
                "depths": first_long["depths"],
                "frames": anim_frames_long,
            },
            "transverse": {
                "axis1":  first_trans["axis1"],
                "depths": first_trans["depths"],
                "frames": anim_frames_trans,
            },
        }

        _write(os.path.join(out_dir, "contours.json"), contours)

        # ── 4. 3D point cloud grid ──────────────────
        print(f"\n  3D point cloud (ts={overview_ts+1}) ...")
        pc = extract_3d_grid(df_static, x_center, z_center)
        pc["timestep"] = overview_ts + 1
        _write(os.path.join(out_dir, "pointcloud.json"), pc)

        # Report
        print(f"\n  Output files:")
        for fn in sorted(os.listdir(out_dir)):
            if fn.endswith(".json"):
                sz = os.path.getsize(os.path.join(out_dir, fn))
                print(f"    {fn}: {sz/1024:.1f} KB" if sz < 1024*1024
                      else f"    {fn}: {sz/1024/1024:.1f} MB")

    print("\n[DONE] Preprocessing complete!")


def _write(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    name = os.path.basename(path)
    sz = os.path.getsize(path)
    print(f"  [OK] {name} ({sz/1024:.1f} KB)" if sz < 1024*1024
          else f"  [OK] {name} ({sz/1024/1024:.1f} MB)")


if __name__ == "__main__":
    main()
