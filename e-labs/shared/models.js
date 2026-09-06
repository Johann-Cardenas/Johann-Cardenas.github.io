/* Pure numerical models. Units in the structural lab: N, mm, MPa. */
(function (root) {
  "use strict";
  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  function cg(rows, b, tol = 1e-9) {
    const n = b.length,
      x = new Float64Array(n),
      r = Float64Array.from(b),
      z = new Float64Array(n),
      p = new Float64Array(n),
      ap = new Float64Array(n);
    const entries = rows.map((row) => Array.from(row)),
      diag = rows.map((row, i) => row.get(i) || 1),
      norm = Math.sqrt(dot(b, b));
    if (!norm) return { x, residuals: [0], iterations: 0, converged: true };
    for (let i = 0; i < n; i++) p[i] = z[i] = r[i] / diag[i];
    let rz = dot(r, z),
      residuals = [1];
    for (let k = 0; k < Math.max(100, n * 3); k++) {
      for (let i = 0; i < n; i++) {
        ap[i] = 0;
        for (const [j, v] of entries[i]) ap[i] += v * p[j];
      }
      const pap = dot(p, ap);
      if (!(pap > 0)) break;
      const a = rz / pap;
      for (let i = 0; i < n; i++) {
        x[i] += a * p[i];
        r[i] -= a * ap[i];
      }
      const rel = Math.sqrt(dot(r, r)) / norm;
      residuals.push(rel);
      if (rel < tol)
        return { x, residuals, iterations: k + 1, converged: true };
      for (let i = 0; i < n; i++) z[i] = r[i] / diag[i];
      const next = dot(r, z),
        beta = next / rz;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      rz = next;
    }
    return { x, residuals, iterations: residuals.length - 1, converged: false };
  }
  function shape(xi, eta) {
    return [
      ((1 - xi) * (1 - eta)) / 4,
      ((1 + xi) * (1 - eta)) / 4,
      ((1 + xi) * (1 + eta)) / 4,
      ((1 - xi) * (1 + eta)) / 4,
    ];
  }
  function quadB(points, xi, eta) {
    const dx = [-(1 - eta), 1 - eta, 1 + eta, -(1 + eta)].map((v) => v / 4),
      dy = [-(1 - xi), -(1 + xi), 1 + xi, 1 - xi].map((v) => v / 4);
    let a = 0,
      b = 0,
      c = 0,
      d = 0;
    points.forEach((p, i) => {
      a += dx[i] * p[0];
      b += dx[i] * p[1];
      c += dy[i] * p[0];
      d += dy[i] * p[1];
    });
    const det = a * d - b * c,
      B = Array.from({ length: 3 }, () => Array(8).fill(0));
    if (det <= 0) return { B, det };
    for (let i = 0; i < 4; i++) {
      const gx = (d * dx[i] - b * dy[i]) / det,
        gy = (-c * dx[i] + a * dy[i]) / det;
      B[0][i * 2] = gx;
      B[1][i * 2 + 1] = gy;
      B[2][i * 2] = gy;
      B[2][i * 2 + 1] = gx;
    }
    return { B, det };
  }
  function triB(p) {
    const twice =
      (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) -
      (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    const B = Array.from({ length: 3 }, () => Array(6).fill(0));
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3,
        k = (i + 2) % 3,
        gx = (p[j][1] - p[k][1]) / twice,
        gy = (p[k][0] - p[j][0]) / twice;
      B[0][2 * i] = gx;
      B[1][2 * i + 1] = gy;
      B[2][2 * i] = gy;
      B[2][2 * i + 1] = gx;
    }
    return { B, det: twice / 2 };
  }
  function solveFE(options = {}) {
    const o = {
      density: 4,
      type: "Q4",
      preset: "beam",
      E: 70000,
      nu: 0.3,
      thickness: 6,
      load: 1000,
      ...options,
    };
    if (o.E <= 0 || o.thickness <= 0 || o.nu <= -1 || o.nu >= 0.5)
      throw Error("Invalid material");
    const n = Math.max(1, Math.min(10, Math.round(o.density))),
      nx = 5 * n,
      ny = o.preset === "bracket" ? 3 * n : n,
      L = 120,
      H = o.preset === "bracket" ? 72 : 24;
    const nodes = [],
      elements = [],
      lookup = new Map();
    function node(i, j) {
      const key = i + "," + j;
      if (!lookup.has(key)) {
        lookup.set(key, nodes.length);
        nodes.push([(L * i) / nx, (H * j) / ny]);
      }
      return lookup.get(key);
    }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (o.preset === "bracket" && i >= n * 2 && j >= n) continue;
        const q = [
          node(i, j),
          node(i + 1, j),
          node(i + 1, j + 1),
          node(i, j + 1),
        ];
        if (o.type === "T3")
          elements.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
        else elements.push(q);
      }
    const nd = nodes.length * 2,
      K = Array.from({ length: nd }, () => new Map()),
      f = new Float64Array(nd),
      C = o.E / (1 - o.nu * o.nu),
      D = [
        [C, C * o.nu, 0],
        [C * o.nu, C, 0],
        [0, 0, (C * (1 - o.nu)) / 2],
      ],
      g = 1 / Math.sqrt(3);
    const samples = [];
    for (const e of elements) {
      const pts = e.map((i) => nodes[i]),
        dofs = e.flatMap((i) => [2 * i, 2 * i + 1]),
        local = Array.from({ length: dofs.length }, () =>
          Array(dofs.length).fill(0),
        );
      const ips =
        e.length === 3
          ? [triB(pts)]
          : [
              quadB(pts, -g, -g),
              quadB(pts, g, -g),
              quadB(pts, g, g),
              quadB(pts, -g, g),
            ];
      for (const { B, det } of ips) {
        if (det <= 0) throw Error("Inverted element");
        for (let a = 0; a < dofs.length; a++)
          for (let b = 0; b < dofs.length; b++)
            for (let s = 0; s < 3; s++)
              for (let t = 0; t < 3; t++)
                local[a][b] += B[s][a] * D[s][t] * B[t][b] * det * o.thickness;
      }
      for (let a = 0; a < dofs.length; a++)
        for (let b = 0; b < dofs.length; b++) {
          const row = K[dofs[a]],
            col = dofs[b];
          row.set(col, (row.get(col) || 0) + local[a][b]);
        }
      samples.push(e.length === 3 ? triB(pts).B : quadB(pts, 0, 0).B);
    }
    const edge = nodes
      .map((p, i) => (p[0] === L ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => nodes[a][1] - nodes[b][1]);
    // Consistent edge traction: half the load on the two end nodes.
    const direction = o.preset === "tension" ? 0 : 1;
    edge.forEach((i, k) => {
      f[2 * i + direction] =
        ((direction === 0 ? 1 : -1) *
          o.load *
          (k === 0 || k === edge.length - 1 ? 0.5 : 1)) /
        (edge.length - 1);
    });
    const free = [],
      fixed = [];
    nodes.forEach((p, i) => {
      for (let d = 0; d < 2; d++) (p[0] === 0 ? fixed : free).push(2 * i + d);
    });
    const remap = new Map(free.map((d, i) => [d, i]));
    const rows = free.map(
      (d) =>
        new Map(
          Array.from(K[d])
            .filter(([j]) => remap.has(j))
            .map(([j, v]) => [remap.get(j), v]),
        ),
    );
    const result = cg(rows, Float64Array.from(free.map((d) => f[d]))),
      u = new Float64Array(nd);
    free.forEach((d, i) => (u[d] = result.x[i]));
    const stresses = elements.map((e, i) => {
      const ue = e.flatMap((j) => [u[j * 2], u[j * 2 + 1]]),
        strain = samples[i].map((row) => dot(row, ue)),
        s = D.map((row) => dot(row, strain));
      return {
        sx: s[0],
        sy: s[1],
        tau: s[2],
        vm: Math.sqrt(
          s[0] * s[0] - s[0] * s[1] + s[1] * s[1] + 3 * s[2] * s[2],
        ),
      };
    });
    const reactions = [0, 0];
    for (const d of fixed) {
      let r = -f[d];
      for (const [j, v] of K[d]) r += v * u[j];
      reactions[d % 2] += r;
    }
    const tip =
      edge.reduce((s, i) => s + u[i * 2 + direction], 0) / edge.length;
    const maxDisplacement = Math.max(
        ...nodes.map((_, i) => Math.hypot(u[2 * i], u[2 * i + 1])),
      ),
      maxStress = Math.max(...stresses.map((s) => s.vm));
    const reference =
      o.preset === "tension"
        ? (o.load * L) / (o.E * 24 * o.thickness)
        : (o.load * L ** 3) / ((3 * o.E * o.thickness * 24 ** 3) / 12);
    const patternSize = 32,
      pattern = Array(patternSize * patternSize).fill(0);
    rows.forEach((row, i) => {
      for (const [j, v] of row)
        if (v !== 0)
          pattern[
            Math.floor((i / rows.length) * patternSize) * patternSize +
              Math.floor((j / rows.length) * patternSize)
          ]++;
    });
    return {
      options: o,
      nodes,
      elements,
      u: Array.from(u),
      stresses,
      tip,
      maxDisplacement,
      maxStress,
      reactions,
      residuals: result.residuals,
      iterations: result.iterations,
      converged: result.converged,
      energy: dot(u, f) / 2,
      reference,
      dofs: free.length,
      L,
      H,
      nonzeros: rows.reduce((s, r) => s + r.size, 0),
      pattern,
      patternSize,
    };
  }
  function scaling({
    processors = 16,
    parallel = 0.95,
    overhead = 0.01,
    work = 120,
    weak = false,
  } = {}) {
    const p = processors,
      serial = work * (1 - parallel),
      compute = work * parallel * (weak ? 1 : 1 / p),
      communication = work * overhead * Math.log2(p),
      time = serial + compute + communication;
    const baseline = weak ? work * (1 - parallel + parallel * p) : work;
    return {
      serial,
      compute,
      communication,
      time,
      speedup: baseline / time,
      efficiency: baseline / time / p,
      cost: time * p,
      ideal: weak
        ? 1 - parallel + parallel * p
        : 1 / (1 - parallel + parallel / p),
    };
  }
  function roofline({ intensity = 8, bandwidth = 200, peak = 4000 } = {}) {
    return {
      performance: Math.min(peak, bandwidth * intensity),
      ridge: peak / bandwidth,
      bound: intensity < peak / bandwidth ? "Memory bound" : "Compute bound",
    };
  }
  function interpolateError(n, p) {
    function exact(x) {
      return Math.sin(Math.PI * x);
    }
    const points = [];
    let error = 0;
    for (let k = 0; k <= 200; k++) {
      const x = k / 200,
        e = Math.min(n - 1, Math.floor(x * n)),
        t = x * n - e;
      let y = 0;
      for (let j = 0; j <= p; j++) {
        let v = exact((e + j / p) / n);
        for (let m = 0; m <= p; m++)
          if (m !== j) v *= (t - m / p) / (j / p - m / p);
        y += v;
      }
      points.push([x, y, exact(x)]);
      error = Math.max(error, Math.abs(y - exact(x)));
    }
    return { points, error, dofs: n * p + 1 };
  }
  const api = {
    solveFE,
    cg,
    shape,
    quadB,
    scaling,
    roofline,
    interpolateError,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LabModels = api;
})(typeof window === "undefined" ? globalThis : window);
