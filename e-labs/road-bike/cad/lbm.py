"""Lattice-Boltzmann wind tunnel (D3Q19, regularized BGK + Smagorinsky LES), numba on the CPU.

Uniform cubic lattice, wind along -X (the bike faces +X).
  inlet   x = max face: equilibrium at the free-stream velocity
  outlet  x = 0 face: zero gradient
  sides   y and z faces: zero gradient (open)
  walls   half-way bounce-back on the voxelised solid; force by momentum exchange, per part id

Lattice units: rho = 1, dx = dt = 1. Physical scaling is done by the caller.
"""

from __future__ import annotations

import math

import numba as nb
import numpy as np

C = np.array([[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
              [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1],
              [0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1]], np.int64)
W = np.array([1 / 3] + [1 / 18] * 6 + [1 / 36] * 12, np.float64)
OPP = np.array([0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17], np.int64)
Q = 19


@nb.njit(cache=True, fastmath=True, inline="always")
def _feq(i, rho, ux, uy, uz, u2):
    cu = C[i, 0] * ux + C[i, 1] * uy + C[i, 2] * uz
    return W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * u2)


@nb.njit(parallel=True, cache=True, fastmath=True)
def step(f, g, solid, part, uin, tau0, cs2, force):
    """One stream-collide step: pull from f (post-collision), collide, write post-collision into g.

    force[p, x, k] accumulates the momentum delivered to part p by bounce-back links in slab x.
    """
    nx, ny, nz = solid.shape
    u2in = uin * uin
    k0 = 18.0 * math.sqrt(2.0) * cs2
    for x in nb.prange(nx):
        fl = np.empty(Q, np.float32)
        for y in range(ny):
            for z in range(nz):
                if solid[x, y, z]:
                    continue
                for i in range(Q):
                    xs, ys, zs = x - C[i, 0], y - C[i, 1], z - C[i, 2]
                    if xs >= nx:                       # inlet: free-stream equilibrium
                        fl[i] = _feq(i, 1.0, -uin, 0.0, 0.0, u2in)
                        continue
                    if xs < 0:
                        xs = 0                         # outlet: zero gradient
                    if ys < 0:
                        ys = 0
                    elif ys >= ny:
                        ys = ny - 1
                    if zs < 0:
                        zs = 0
                    elif zs >= nz:
                        zs = nz - 1
                    if solid[xs, ys, zs]:              # half-way bounce-back off the wall cell
                        o = OPP[i]
                        v = f[o, x, y, z]
                        fl[i] = v
                        p = part[xs, ys, zs]
                        force[p, x, 0] += 2.0 * C[o, 0] * v
                        force[p, x, 1] += 2.0 * C[o, 1] * v
                        force[p, x, 2] += 2.0 * C[o, 2] * v
                    else:
                        fl[i] = f[i, xs, ys, zs]
                rho = 0.0
                ux = 0.0
                uy = 0.0
                uz = 0.0
                for i in range(Q):
                    rho += fl[i]
                    ux += C[i, 0] * fl[i]
                    uy += C[i, 1] * fl[i]
                    uz += C[i, 2] * fl[i]
                ux /= rho
                uy /= rho
                uz /= rho
                u2 = ux * ux + uy * uy + uz * uz
                # non-equilibrium momentum flux
                pxx = 0.0
                pyy = 0.0
                pzz = 0.0
                pxy = 0.0
                pxz = 0.0
                pyz = 0.0
                for i in range(Q):
                    ne = fl[i] - _feq(i, rho, ux, uy, uz, u2)
                    cx, cy, cz = C[i, 0], C[i, 1], C[i, 2]
                    pxx += cx * cx * ne
                    pyy += cy * cy * ne
                    pzz += cz * cz * ne
                    pxy += cx * cy * ne
                    pxz += cx * cz * ne
                    pyz += cy * cz * ne
                qn = math.sqrt(2.0 * (pxx * pxx + pyy * pyy + pzz * pzz + 2.0 * (pxy * pxy + pxz * pxz + pyz * pyz)))
                tau = 0.5 * (tau0 + math.sqrt(tau0 * tau0 + k0 * qn / rho))
                om = 1.0 - 1.0 / tau
                for i in range(Q):
                    cx, cy, cz = C[i, 0], C[i, 1], C[i, 2]
                    tr = (cx * cx - 1.0 / 3.0) * pxx + (cy * cy - 1.0 / 3.0) * pyy + (cz * cz - 1.0 / 3.0) * pzz \
                        + 2.0 * (cx * cy * pxy + cx * cz * pxz + cy * cz * pyz)
                    g[i, x, y, z] = _feq(i, rho, ux, uy, uz, u2) + om * 4.5 * W[i] * tr


@nb.njit(parallel=True, cache=True)
def init(f, solid, uin):
    nx, ny, nz = solid.shape
    u2 = uin * uin
    for x in nb.prange(nx):
        for y in range(ny):
            for z in range(nz):
                for i in range(Q):
                    f[i, x, y, z] = 0.0 if solid[x, y, z] else _feq(i, 1.0, -uin, 0.0, 0.0, u2)


@nb.njit(parallel=True, cache=True)
def accumulate(f, solid, acc):
    """acc[0] += rho, acc[1:4] += u (for time averages)."""
    nx, ny, nz = solid.shape
    for x in nb.prange(nx):
        for y in range(ny):
            for z in range(nz):
                if solid[x, y, z]:
                    continue
                rho = 0.0
                ux = 0.0
                uy = 0.0
                uz = 0.0
                for i in range(Q):
                    v = f[i, x, y, z]
                    rho += v
                    ux += C[i, 0] * v
                    uy += C[i, 1] * v
                    uz += C[i, 2] * v
                acc[0, x, y, z] += rho
                acc[1, x, y, z] += ux / rho
                acc[2, x, y, z] += uy / rho
                acc[3, x, y, z] += uz / rho


# ------------------------------------------------------------------------------- voxelisation
@nb.njit(cache=True)
def _crossings(tris, x0, y0, dx, nx, ny, zbuf, zcount, cap):
    """Record z of every intersection of the +z rays through cell centres with the triangles."""
    for t in range(tris.shape[0]):
        ax, ay, az = tris[t, 0, 0], tris[t, 0, 1], tris[t, 0, 2]
        bx, by, bz = tris[t, 1, 0], tris[t, 1, 1], tris[t, 1, 2]
        cx, cy, cz = tris[t, 2, 0], tris[t, 2, 1], tris[t, 2, 2]
        i0 = max(int(math.ceil((min(ax, bx, cx) - x0) / dx - 0.5)), 0)
        i1 = min(int(math.floor((max(ax, bx, cx) - x0) / dx - 0.5)), nx - 1)
        j0 = max(int(math.ceil((min(ay, by, cy) - y0) / dx - 0.5)), 0)
        j1 = min(int(math.floor((max(ay, by, cy) - y0) / dx - 0.5)), ny - 1)
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-14:
            continue
        for i in range(i0, i1 + 1):
            px = x0 + (i + 0.5) * dx
            for j in range(j0, j1 + 1):
                py = y0 + (j + 0.5) * dx
                l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
                l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
                l3 = 1.0 - l1 - l2
                if l1 < 0 or l2 < 0 or l3 < 0:
                    continue
                k = zcount[i, j]
                if k < cap:
                    zbuf[i, j, k] = l1 * az + l2 * bz + l3 * cz
                    zcount[i, j] = k + 1


@nb.njit(parallel=True, cache=True)
def _fill(zbuf, zcount, z0, dx, nz, solid, part, pid):
    nx, ny = zcount.shape
    for i in nb.prange(nx):
        for j in range(ny):
            n = zcount[i, j]
            if n < 2:
                continue
            zs = np.sort(zbuf[i, j, :n])
            for a in range(0, n - 1, 2):
                k0 = max(int(math.ceil((zs[a] - z0) / dx - 0.5)), 0)
                k1 = min(int(math.floor((zs[a + 1] - z0) / dx - 0.5)), nz - 1)
                for k in range(k0, k1 + 1):
                    solid[i, j, k] = 1
                    part[i, j, k] = pid


def voxelise(meshes, origin, dx, shape):
    """meshes: list of (part_id, vertices (n,3), triangles (m,3)) in metres; parity fill along z."""
    nx, ny, nz = shape
    solid = np.zeros(shape, np.uint8)
    part = np.zeros(shape, np.int16)
    cap = 64
    for pid, v, t in meshes:
        tris = v[t].astype(np.float64)
        zbuf = np.zeros((nx, ny, cap), np.float64)
        zcount = np.zeros((nx, ny), np.int32)
        _crossings(tris, origin[0], origin[1], dx, nx, ny, zbuf, zcount, cap)
        _fill(zbuf, zcount, origin[2], dx, nz, solid, part, pid)
    return solid, part


def feq_np(rho, u):
    cu = np.einsum("qd,d...->q...", C.astype(np.float64), u)
    u2 = (u ** 2).sum(0)
    return W[:, None] * rho * (1 + 3 * cu + 4.5 * cu ** 2 - 1.5 * u2) if cu.ndim == 2 else None
