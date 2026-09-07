/* Additional teaching models. Deliberately independent of the interface. */
(function (root) {
  "use strict";
  const M =
    typeof module !== "undefined" && module.exports
      ? require("./models.js")
      : root.LabModels;
  function axialBar({
    segments = 4,
    E = 70000,
    area = 144,
    length = 120,
    force = 1000,
    distributed = 10,
  } = {}) {
    const h = length / segments,
      k = (E * area) / h,
      rows = Array.from({ length: segments }, () => new Map()),
      f = new Float64Array(segments);
    for (let e = 0; e < segments; e++) {
      for (let a = 0; a < 2; a++) {
        const i = e + a - 1;
        if (i < 0) continue;
        f[i] += (distributed * h) / 2;
        for (let b = 0; b < 2; b++) {
          const j = e + b - 1;
          if (j >= 0)
            rows[i].set(j, (rows[i].get(j) || 0) + (a === b ? k : -k));
        }
      }
    }
    f[segments - 1] += force;
    const solved = M.cg(rows, f),
      u = [0, ...solved.x],
      exact = (x) =>
        (force * x + distributed * (length * x - (x * x) / 2)) / (E * area),
      points = [];
    let error = 0;
    for (let i = 0; i <= 120; i++) {
      const x = (length * i) / 120,
        e = Math.min(segments - 1, Math.floor(x / h)),
        t = x / h - e,
        v = u[e] * (1 - t) + u[e + 1] * t;
      points.push([x, v, exact(x)]);
      error = Math.max(error, Math.abs(v - exact(x)));
    }
    return {
      u,
      points,
      error,
      tip: u.at(-1),
      reaction: -(force + distributed * length),
      converged: solved.converged,
    };
  }
  function quadrature({ points = 2, degree = 4 } = {}) {
    const rules = {
      1: [[0], [2]],
      2: [
        [-1 / Math.sqrt(3), 1 / Math.sqrt(3)],
        [1, 1],
      ],
      3: [
        [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)],
        [5 / 9, 8 / 9, 5 / 9],
      ],
      4: [
        [
          -0.8611363115940526, -0.3399810435848563, 0.3399810435848563,
          0.8611363115940526,
        ],
        [
          0.3478548451374538, 0.6521451548625461, 0.6521451548625461,
          0.3478548451374538,
        ],
      ],
    };
    const [x, w] = rules[points],
      estimate = x.reduce((s, v, i) => s + w[i] * v ** degree, 0),
      exact = degree % 2 ? 0 : 2 / (degree + 1);
    return { x, w, estimate, exact, error: Math.abs(estimate - exact) };
  }
  function job({
    processors = 16,
    memoryGB = 64,
    problem = 2,
    walltime = 30,
  } = {}) {
    const required = [8, 48, 192][problem - 1],
      base = [30, 120, 480][problem - 1],
      parallel = [0.6, 0.9, 0.97][problem - 1],
      s = M.scaling({ processors, parallel, overhead: 0.005, work: base });
    return {
      ...s,
      required,
      fits: memoryGB >= required,
      memoryUtilization: required / memoryGB,
      queue: 0.5 + processors / 32 + memoryGB / 256,
      walltime,
      processors,
      memoryGB,
      problem,
      serviceUnits: (processors * Math.min(s.time, walltime)) / 60,
    };
  }
  function renderCost({ resolution = 128, frames = 1, launch = 0.12 } = {}) {
    const pixels = resolution ** 2,
      cpu = (frames * pixels) / 8192,
      gpu = frames * (launch + pixels / 131072);
    return { pixels, cpu, gpu, speedup: cpu / gpu };
  }
  function renderProgress(
    elapsed,
    { resolution = 128, frames = 1, launch = 0.12 } = {},
  ) {
    const cost = renderCost({ resolution, frames, launch }),
      perFrame = cost.gpu / frames,
      compute = resolution ** 2 / 131072;
    return {
      cpu: Math.min(1, elapsed / cost.cpu),
      gpu:
        elapsed >= cost.gpu
          ? 1
          : (Math.floor(elapsed / perFrame) +
              Math.max(0, ((elapsed % perFrame) - launch) / compute)) /
            frames,
    };
  }
  const resources = {
    laptop: { name: "Laptop", cores: 8, ram: 32, vram: 0 },
    workstation: { name: "Workstation", cores: 64, ram: 256, vram: 24 },
    cluster: { name: "Cluster", cores: 4096, ram: 4096, vram: 512 },
  };
  const tasks = [
    {
      name: "Presentation slides",
      cores: 2,
      ram: 4,
      vram: 0,
      fit: "laptop",
      why: "An interactive task with modest CPU and memory needs.",
    },
    {
      name: "Spreadsheet analysis",
      cores: 2,
      ram: 8,
      vram: 0,
      fit: "laptop",
      why: "This dataset fits in laptop RAM; extra nodes add no benefit.",
    },
    {
      name: "Online lectures",
      cores: 2,
      ram: 8,
      vram: 0,
      fit: "laptop",
      why: "Streaming depends more on network access than parallel compute.",
    },
    {
      name: "Media browsing",
      cores: 4,
      ram: 16,
      vram: 0,
      fit: "laptop",
      why: "The workload fits locally and needs an interactive response.",
    },
    {
      name: "Single-GPU model training",
      cores: 16,
      ram: 64,
      vram: 16,
      fit: "workstation",
      why: "The model fits one accelerator and benefits from local GPU access.",
    },
    {
      name: "Building design / CAD",
      cores: 16,
      ram: 64,
      vram: 12,
      fit: "workstation",
      why: "Interactive graphics, local memory, and a dedicated GPU matter.",
    },
    {
      name: "Interactive 3D visualization",
      cores: 12,
      ram: 32,
      vram: 12,
      fit: "workstation",
      why: "A local GPU supports low-latency graphics; distribution is unnecessary.",
    },
    {
      name: "4K video editing",
      cores: 16,
      ram: 64,
      vram: 12,
      fit: "workstation",
      why: "Local storage bandwidth and GPU effects suit a workstation.",
    },
    {
      name: "Large engineering simulation",
      cores: 256,
      ram: 512,
      vram: 0,
      fit: "cluster",
      why: "This explicitly distributed solver exceeds workstation resources.",
    },
    {
      name: "Trajectory ensemble",
      cores: 128,
      ram: 256,
      vram: 0,
      fit: "cluster",
      why: "Many independent trajectories can run across nodes. A single serial orbit need not use HPC.",
    },
    {
      name: "Distributed AI training",
      cores: 512,
      ram: 1024,
      vram: 256,
      fit: "cluster",
      why: "This training job is designed to distribute data and accelerator work.",
    },
    {
      name: "Continental weather model",
      cores: 2048,
      ram: 2048,
      vram: 512,
      fit: "cluster",
      why: "The specified domain-decomposed workload requires a large allocation.",
    },
  ];
  function matchTask(index, resource) {
    const t = tasks[index],
      r = resources[resource];
    return {
      correct: t.fit === resource,
      fits: t.cores <= r.cores && t.ram <= r.ram && t.vram <= r.vram,
      task: t,
      resource: r,
    };
  }
  const api = {
    axialBar,
    quadrature,
    job,
    renderCost,
    renderProgress,
    resources,
    tasks,
    matchTask,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CourseModels = api;
})(typeof window === "undefined" ? globalThis : window);
