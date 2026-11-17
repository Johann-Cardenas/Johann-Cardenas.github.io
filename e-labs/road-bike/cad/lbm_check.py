"""Benchmark and validate the LBM solver on a sphere (subcritical drag, Cd about 0.4-0.5 for 1e4 < Re < 2e5)."""

import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import lbm  # noqa: E402
import lbm_kernel as K  # noqa: E402


def sphere_mesh(r, n=48):
    th = np.linspace(0, math.pi, n + 1)
    ph = np.linspace(0, 2 * math.pi, 2 * n, endpoint=False)
    v = np.array([[r * math.sin(a) * math.cos(b), r * math.cos(a), r * math.sin(a) * math.sin(b)] for a in th for b in ph])
    m = 2 * n
    t = []
    for i in range(n):
        for j in range(m):
            a, b = i * m + j, i * m + (j + 1) % m
            c, d = a + m, b + m
            t += [[a, c, b], [b, c, d]]
    return v, np.array(t)


def main(D_cells=24, steps=4000, nthreads=None):
    nx, ny, nz = 10 * D_cells, 5 * D_cells, 5 * D_cells
    dx = 1.0
    v, t = sphere_mesh(D_cells / 2)
    v = v + np.array([6.5 * D_cells, 2.5 * D_cells, 2.5 * D_cells])
    solid, part = lbm.voxelise([(1, v, t)], (0.0, 0.0, 0.0), dx, (nx, ny, nz))
    print(f"grid {nx}x{ny}x{nz} = {nx * ny * nz / 1e6:.2f} M cells, solid {solid.sum()} (sphere {math.pi / 6 * D_cells ** 3:.0f})")
    uin, Re = 0.06, 5e4
    nu = uin * D_cells / Re
    tau0 = 3 * nu + 0.5
    # ghost layer of one cell on every face
    solid = np.pad(solid, 1); part = np.pad(part, 1)
    f = np.empty((19, nx + 2, ny + 2, nz + 2), np.float32)
    lbm.init(f, solid, uin)
    g = f.copy()
    force = np.zeros((2, nx + 2, 3), np.float64)
    hist = []
    k0 = 18.0 * math.sqrt(2.0) * 0.17 ** 2
    t0 = time.time()
    K.ghosts(f, uin); K.step(f, g, solid, part, tau0, k0, force); f, g = g, f
    tc = time.time() - t0
    t0 = time.time()
    for s in range(1, steps):
        force[:] = 0
        K.ghosts(f, uin)
        K.step(f, g, solid, part, tau0, k0, force)
        f, g = g, f
        hist.append(force[1, :, 0].sum())
    el = time.time() - t0
    mlups = (nx * ny * nz - solid.sum()) * (steps - 1) / el / 1e6
    A = math.pi * (D_cells / 2) ** 2
    cd = -np.mean(hist[len(hist) // 2:]) / (0.5 * uin ** 2 * A)  # drag acts along -X (the wind direction)
    print(f"compile {tc:.1f}s, {el / (steps - 1) * 1000:.1f} ms/step, {mlups:.0f} MLUPS")
    print(f"sphere Cd (second half, Re {Re:.0e}, {D_cells} cells per D) = {cd:.3f}")
    return cd, mlups


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 24, int(sys.argv[2]) if len(sys.argv) > 2 else 4000)
