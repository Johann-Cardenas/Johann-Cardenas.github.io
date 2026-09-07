(function () {
  "use strict";
  const kind = document.body.dataset.lab,
    fea = kind === "fea",
    lessons = LabCurriculum[kind],
    name = fea ? "Finite-Elemented" : "Frontier",
    M = LabModels;
  const defaults = fea
    ? {
        preset: "beam",
        type: "Q4",
        density: 4,
        E: 70000,
        load: 1000,
        gain: 20,
        field: "vm",
        mesh: true,
        ghost: true,
        explode: 0,
        node: 0,
        xi: 0,
        eta: 0,
        warp: 0.4,
        n: 3,
        p: 1,
        mode: 1,
        hot: 100,
        cold: 20,
        conductivity: 180,
      }
    : {
        processors: 16,
        parallel: 95,
        overhead: 1,
        weak: false,
        workload: "render",
        resource: "gpu",
        walltime: 15,
        batch: 1000,
        transfer: 2,
        hit: 90,
        intensity: 8,
        bandwidth: 200,
        peak: 4000,
        message: 4,
        latency: 5,
        networkBandwidth: 25,
        policy: "backfill",
        workerPower: 12,
      };
  let state = { ...defaults },
    lesson = lessons.find((l) => l.id === location.hash.slice(1)) || lessons[0],
    result = null,
    completed = {},
    convergence = null,
    solveKey = "",
    solveTimer = 0,
    jobTimer = 0,
    jobElapsed = 0,
    jobPhase = "idle",
    jobSnapshot = null;
  try {
    const saved = JSON.parse(localStorage.getItem("elabs-v2-" + kind) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) completed = saved;
  } catch {}
  const $ = (id) => document.getElementById(id),
    esc = (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const format = (n, d = 2) =>
    Number.isFinite(n)
      ? Math.abs(n) >= 1e5
        ? n.toExponential(2)
        : n.toLocaleString("en-US", {
            maximumFractionDigits: d,
            minimumFractionDigits: d,
          })
      : "—";
  $("app").innerHTML =
    `<a class="skip" href="#main">Skip to experiment</a><header class="topbar"><a class="brand" href="../../E-Labs.html"><span class="brand-mark">${fea ? "◇" : "⌘"}</span><span>${name}<small>AN E-LABS EXPLORATION</small></span></a><div class="top-links"><a href="../../E-Labs.html">← All E-Labs</a><a href="../${fea ? "frontier" : "finite-elemented"}/index.html">${fea ? "Explore computing" : "Explore finite elements"} ↗</a><span class="lab-status"><span class="dot"></span> Runs in your browser</span></div></header>
  <div class="workspace"><aside class="journey" aria-label="Learning path"><div class="journey-head"><span class="eyebrow">Your learning path</span><span>${lessons.length} labs</span></div><nav class="module-list" id="modules"></nav><div class="journey-footer"><strong id="progress-label"></strong><div class="progress-track"><span id="progress-bar"></span></div>Answer each prediction to record your progress on this device.<a href="#" id="save">↓ Save experiment data</a></div></aside><main class="main" id="main" tabindex="-1"><div class="mobile-nav"><label for="mobile-module">Explore</label><select id="mobile-module">${lessons.map((l) => `<option value="${l.id}">${String(l.index + 1).padStart(2, "0")} · ${l.nav}</option>`).join("")}</select></div>
  <div class="heading"><div><div class="eyebrow" id="lesson-eyebrow"></div><h1 id="title"></h1><p id="subtitle"></p></div><span class="lesson-count" id="lesson-count"></span></div>
  <section class="experiment" aria-label="Interactive experiment"><div class="visual-column"><div class="stage-top"><span class="stage-name" id="stage-name"></span><span class="live-pill" id="live-pill">LIVE EXPERIMENT</span></div><div class="stage" id="stage"></div><div class="stage-caption"><div class="legend" id="legend"></div><span class="scene-note" id="scene-note"></span></div><div class="stage-toolbar"><div class="tool-group"><button id="play" aria-pressed="false">Pause motion</button><button data-view="iso" title="Reset to perspective view">3D</button><button data-view="front" title="Front view">Front</button><button data-view="top" title="Top view">Top</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button></div><span class="camera-hint">Drag to orbit · scroll to zoom</span></div><div class="metrics" id="metrics"></div></div><aside class="inspector" id="inspector" aria-label="Experiment controls"></aside></section>
  <div class="below"><article class="card"><div class="eyebrow">Understand the experiment</div><h2 id="lesson-heading"></h2><p id="lesson-body"></p><div class="equation" id="equation"></div><div class="takeaway"><p><strong>Try this.</strong> <span id="takeaway"></span></p></div></article><section class="card" aria-label="Quantitative evidence"><div class="chart-heading"><h2 id="chart-title"></h2><small id="chart-tag"></small></div><div id="chart"></div><p class="chart-caption" id="chart-caption"></p><div class="probe" id="probe"></div></section><section class="card challenge"><div><div class="eyebrow">Pause. Predict. Understand.</div><h2 id="question"></h2><p>Make a prediction, then use the experiment to test your reasoning.</p></div><div><div class="answers" id="answers"></div><div class="feedback" id="feedback" role="status"></div></div></section></div>
  <div class="lesson-bottom"><small>Explore freely. Predictions save locally; calculations stay on your device.</small><button class="primary" id="next">Next experiment →</button></div><details class="details"><summary>Model assumptions, sources & accessibility</summary><div id="model-notes"></div><p>The 3D viewport supports drag and wheel navigation. Front, top, perspective, and zoom buttons provide keyboard alternatives. Numerical values and an element selector provide an alternative to picking objects. Pause motion at any time; reduced-motion preferences are respected.</p></details></main></div>`;
  $("stage").appendChild(document.querySelector(".stage-caption"));
  const scene = new LabScene($("stage"), { onPick: (i) => probe(i) });
  scene.onPhase = (phase) => {
    if (!fea) $("live-pill").textContent = phase;
  };
  function syncPlay() {
    const p = !!scene.playing;
    $("play").textContent = p ? "Pause motion" : "Play motion";
    $("play").setAttribute("aria-pressed", String(p));
    if ($("motion-status")) $("motion-status").textContent = scene.suspended ? "Paused while browsing" : p ? `Playing · ${scene.playbackRate}× speed` : "Paused";
  }
  scene.onPlaybackChange = syncPlay;
  syncPlay();
  $("play").onclick = () => {
    scene.setPlaying(!scene.playing);
    syncPlay();
  };
  scene.motion?.addEventListener("change", syncPlay);
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => scene.view(b.dataset.view)));
  $("zoom-in").onclick = () => scene.zoom(0.85);
  $("zoom-out").onclick = () => scene.zoom(1.18);
  $("mobile-module").onchange = (e) => go(e.target.value);
  $("save").onclick = (e) => {
    e.preventDefault();
    download(
      `${name}-experiment.json`,
      JSON.stringify(
        {
          tool: name,
          version: 2,
          lesson: lesson.id,
          parameters: state,
          result:
            window.LabGuide?.exportResult() ??
            (fea ? result : M.scaling(hpcOptions())),
          assumptions: lesson.body,
        },
        null,
        2,
      ),
      "application/json",
    );
  };
  $("next").onclick = () => go(lessons[(lesson.index + 1) % lessons.length].id);
  function go(id) {
    if (location.hash.slice(1) === id) return;
    location.hash = id;
  }
  window.addEventListener("hashchange", () => {
    const found = lessons.find((l) => l.id === location.hash.slice(1));
    if (found && found !== lesson) {
      lesson = found;
      renderLesson();
    }
  });
  function nav() {
    $("modules").innerHTML = lessons
      .map(
        (l) =>
          `<button class="module-button ${l === lesson ? "active" : ""} ${completed[l.id] ? "completed" : ""}" data-module="${l.id}" ${l === lesson ? 'aria-current="step"' : ""}><span class="num">${completed[l.id] ? "✓" : String(l.index + 1).padStart(2, "0")}</span><span>${l.nav}</span></button>`,
      )
      .join("");
    document
      .querySelectorAll("[data-module]")
      .forEach((b) => (b.onclick = () => go(b.dataset.module)));
    const count = lessons.filter((l) => completed[l.id]).length;
    $("progress-label").textContent =
      `${count} of ${lessons.length} predictions understood`;
    $("progress-bar").style.width = (count / lessons.length) * 100 + "%";
    window.LabGuide?.renderNavigation();
  }
  function renderLesson() {
    solveGeneration++;
    clearTimeout(solveTimer);
    clearInterval(jobTimer);
    jobTimer = 0;
    jobPhase = "idle";
    jobElapsed = 0;
    jobSnapshot = null;
    scene.jobPhase = "idle";
    window.LabGuide?.prepare(lesson);
    nav();
    $("mobile-module").value = lesson.id;
    $("lesson-eyebrow").textContent =
      `${fea ? "Mechanics, made tangible" : "Computing, made tangible"} / ${lesson.nav}`;
    $("title").textContent = lesson.title;
    $("subtitle").textContent = lesson.subtitle;
    $("lesson-count").textContent =
      `LAB ${String(lesson.index + 1).padStart(2, "0")} / ${lessons.length}`;
    $("lesson-heading").textContent = lesson.nav;
    $("lesson-body").textContent = lesson.body;
    $("equation").textContent = lesson.equation;
    $("takeaway").textContent = lesson.takeaway;
    $("question").textContent = lesson.question;
    $("feedback").textContent = completed[lesson.id]
      ? "Previously understood. Try the experiment again with a different configuration."
      : "";
    $("answers").innerHTML = lesson.answers
      .map((a, i) => `<button data-answer="${i}">${esc(a)}</button>`)
      .join("");
    document.querySelectorAll("[data-answer]").forEach(
      (b) =>
        (b.onclick = () => {
          const correct = +b.dataset.answer === lesson.correct;
          b.classList.add(correct ? "correct" : "incorrect");
          $("feedback").textContent =
            (correct ? "Correct. " : "Try again. ") +
            (correct
              ? lesson.feedback
              : "Test your prediction: " + lesson.takeaway);
          if (correct) {
            completed[lesson.id] = true;
            try {
              localStorage.setItem(
                "elabs-v2-" + kind,
                JSON.stringify(completed),
              );
            } catch { window.LabGuide.storageAvailable = false; }
            nav();
          }
        }),
    );
    $("chart").innerHTML = "";
    $("probe").innerHTML = "";
    $("chart-tag").textContent = "";
    $("next").textContent =
      lesson.index === lessons.length - 1
        ? "Return to first experiment ↺"
        : "Next experiment →";
    $("model-notes").innerHTML = fea
      ? '<p>Structural results: small-strain, isotropic linear elasticity; plane stress; thickness 6 mm; Poisson ratio 0.3; fully fixed left edge; consistent edge-traction nodal loads. Q4 uses full 2 × 2 Gauss integration; T3 uses constant strain. Stresses are element-center values without nodal smoothing. The mesh and deformation are extruded for display only. Modal, conduction, and interpolation experiments explicitly use separate analytical models.</p><p>Numerical method: <a href="https://www.netlib.org/linalg/old_html_templates/subsection2.6.3.1.html" target="_blank" rel="noopener">Netlib’s conjugate-gradient reference</a>. Export format: <a href="https://docs.software.vt.edu/abaqusv2024/English/SIMACAEELMRefMap/simaelm-r-2delem.htm" target="_blank" rel="noopener">Abaqus two-dimensional solid elements</a>. Rendering: <a href="https://threejs.org/" target="_blank" rel="noopener">Three.js</a>, hosted with this site.</p>'
      : '<p>This is an educational computing model, not a benchmark or a replica of the ORNL Frontier system. Workers, lane counts, queue delays, bandwidths, and power values are explicit illustrative assumptions. No jobs are submitted to external machines. Scaling assumes a fixed serial component and a log₂(P) communication term; weak scaling grows only the parallel workload with worker count.</p><p>Further reading: <a href="https://hpc-wiki.info/hpc/Scaling" target="_blank" rel="noopener">HPC Wiki: scaling</a>, <a href="https://crd.lbl.gov/divisions/amcr/computer-science-amcr/par/research/roofline/" target="_blank" rel="noopener">Berkeley Lab: Roofline performance model</a>, and <a href="https://slurm.schedmd.com/sbatch.html" target="_blank" rel="noopener">Slurm batch job documentation</a>.</p>';
    renderControls();
    update();
    window.LabGuide?.onLesson();
  }
  const range = (key, label, min, max, step, unit = "", tip = "") =>
    `<div class="control"><label for="c-${key}">${label}<output id="o-${key}" for="c-${key}">${state[key]}${unit}</output></label><input id="c-${key}" data-key="${key}" data-unit="${unit}" type="range" min="${min}" max="${max}" step="${step}" value="${state[key]}"><div class="range-ends"><span>${min}${unit}</span><span>${max}${unit}</span></div>${tip ? `<small>${tip}</small>` : ""}</div>`;
  const select = (key, label, options) =>
    `<div class="control"><label for="c-${key}">${label}</label><select id="c-${key}" data-key="${key}" ${typeof state[key] === "number" ? 'data-number="true"' : ""}>${options.map(([v, t]) => `<option value="${v}" ${String(state[key]) === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
  const check = (key, label) =>
    `<div class="control check"><label for="c-${key}"><input type="checkbox" id="c-${key}" data-key="${key}" ${state[key] ? "checked" : ""}>${label}</label></div>`;
  function renderControls() {
    let html = "";
    const id = lesson.id;
    const guided = window.LabGuide?.controls(lesson, state, {
      range,
      select,
      check,
    });
    if (guided !== undefined) html = guided;
    else if (fea) {
      if (id === "shape")
        html =
          select("node", "Basis function", [
            [0, "N₁ · bottom left"],
            [1, "N₂ · bottom right"],
            [2, "N₃ · top right"],
            [3, "N₄ · top left"],
          ]) +
          range("xi", "Natural coordinate ξ", -1, 1, 0.05) +
          range("eta", "Natural coordinate η", -1, 1, 0.05);
      else if (id === "mapping")
        html = range(
          "warp",
          "Corner distortion",
          -0.4,
          1.6,
          0.05,
          "",
          "Moves the top-right corner. Red indicates non-positive det J.",
        );
      else if (id === "refinement")
        html =
          range("n", "Elements (h refinement)", 1, 8, 1) +
          range("p", "Polynomial order", 1, 4, 1);
      else if (id === "heat")
        html =
          range("hot", "Left temperature", 0, 200, 5, " °C") +
          range("cold", "Right temperature", 0, 200, 5, " °C") +
          range("conductivity", "Conductivity", 10, 400, 10, " W/mK");
      else if (id === "dynamics")
        html =
          select("mode", "Bending mode", [
            [1, "01 · fundamental"],
            [2, "02 · second mode"],
            [3, "03 · third mode"],
          ]) +
          select("E", "Young’s modulus", [
            [70000, "70 GPa"],
            [110000, "110 GPa"],
            [210000, "210 GPa"],
          ]);
      else
        html =
          select("preset", "Geometry & loading", [
            ["beam", "Cantilever · bending"],
            ["tension", "Straight bar · tension"],
            ["bracket", "L-bracket · bending"],
          ]) +
          select("type", "Element family", [
            ["Q4", "Q4 · bilinear quadrilateral"],
            ["T3", "T3 · linear triangle"],
          ]) +
          range("density", "Mesh density", 1, 8, 1) +
          range("load", "Total applied force", 100, 3000, 100, " N") +
          select("E", "Young’s modulus", [
            [70000, "Aluminum-like · 70 GPa"],
            [110000, "Titanium-like · 110 GPa"],
            [210000, "Steel-like · 210 GPa"],
          ]) +
          select("field", "Color field", [
            ["vm", "von Mises stress · MPa"],
            ["sx", "Normal stress σₓ · MPa"],
            ["sy", "Normal stress σᵧ · MPa"],
            ["tau", "Shear stress τₓᵧ · MPa"],
            ["displacement", "Displacement · mm"],
          ]) +
          range("gain", "Deformation scale", 0, 80, 1, "×") +
          check("mesh", "Show element edges") +
          check("ghost", "Show undeformed reference");
      if (["assembly", "mesh", "elements"].includes(id))
        html += range(
          "explode",
          "Separate elements",
          0,
          1,
          0.05,
          "",
          "Inspection only. Separation does not change the solved mesh.",
        );
      if (id === "convergence")
        html +=
          '<button class="primary" id="run-study">Run convergence study</button>';
      if (id === "abaqus")
        html +=
          '<button class="primary" id="export-deck">Export Abaqus .inp ↓</button>';
    } else {
      if (["scaling", "energy"].includes(id))
        html =
          range("processors", "Parallel workers", 1, 64, 1) +
          range("parallel", "Parallel fraction", 0, 100, 1, "%") +
          range("overhead", "Communication coefficient", 0, 5, 0.1, "%") +
          (id === "scaling"
            ? check("weak", "Weak scaling · grow the problem")
            : range("workerPower", "Power per worker", 5, 50, 1, " W"));
      else if (id === "rightsizing")
        html =
          select("workload", "Workload", [
            ["serial", "Serial analysis · 8 GB"],
            ["render", "Batch rendering · GPU ready · 24 GB"],
            ["large", "Distributed simulation · 512 GB"],
            ["memory", "Shared-memory analysis · 100 GB"],
          ]) +
          select("resource", "Resource", [
            ["laptop", "Workstation · 8 cores · 16 GB"],
            ["cpu", "CPU node · 32 cores · 128 GB"],
            ["gpu", "GPU node · 16 cores · 48 GB GPU"],
            ["cluster", "Cluster · 128 cores · 1 TB total"],
          ]);
      else if (id === "workflow")
        html =
          range("processors", "Requested workers", 1, 32, 1) +
          range("parallel", "Parallel fraction", 10, 100, 5, "%") +
          range("walltime", "Walltime limit", 1, 30, 1, " min") +
          '<button class="primary" id="submit-job">Submit simulated job</button><div class="phase-strip" id="phases"></div><div class="terminal" id="terminal"></div>';
      else if (id === "architecture")
        html =
          range("batch", "Independent tasks", 10, 10000, 10) +
          range("transfer", "Transfer + launch overhead", 0, 20, 0.5, " ms");
      else if (id === "memory")
        html = range("hit", "Cache hit rate", 0, 100, 1, "%");
      else if (id === "roofline")
        html =
          range("intensity", "Arithmetic intensity", 0.5, 64, 0.5, " FLOP/B") +
          range("bandwidth", "Memory bandwidth", 50, 1000, 25, " GB/s") +
          range("peak", "Peak compute", 1000, 16000, 500, " GFLOP/s");
      else if (id === "network")
        html =
          range("processors", "Workers", 2, 64, 1) +
          range("message", "Message size", 0.01, 64, 0.01, " MB") +
          range("latency", "Startup latency", 1, 100, 1, " μs") +
          range("networkBandwidth", "Link bandwidth", 1, 100, 1, " GB/s");
      else if (id === "scheduling")
        html = select("policy", "Scheduling policy", [
          ["fifo", "First in, first out"],
          ["backfill", "Reservation-safe backfill"],
        ]);
    }
    $("inspector").innerHTML =
      '<div class="inspector-head"><h2>Experiment settings</h2><button id="reset">Reset ↺</button></div>' +
      html +
      '<div class="result-status" id="result-status" role="status"></div><p class="inspector-note">' +
      (fea
        ? "Change one variable at a time. Color scales update with the result; always compare the numerical values."
        : "Illustrative model · not a hardware benchmark. Read the assumptions below each experiment.") +
      "</p>";
    document.querySelectorAll("[data-key]").forEach((input) =>
      input.addEventListener(
        input.type === "range" ? "input" : "change",
        () => {
          const key = input.dataset.key;
          state[key] =
            input.type === "checkbox"
              ? input.checked
              : input.type === "range" || input.dataset.number
                ? Number(input.value)
                : input.value;
          const out = $("o-" + key);
          if (out) out.textContent = state[key] + input.dataset.unit;
          clearTimeout(solveTimer);
          solveTimer = setTimeout(update, input.type === "range" ? 100 : 0);
        },
      ),
    );
    $("reset").onclick = () => {
      state = { ...defaults, ...lesson.defaults };
      window.LabGuide?.cancel();
      if (window.LabGuide) window.LabGuide.visualKey = null;
      convergence = null;
      clearInterval(jobTimer);
      jobTimer = 0;
      jobPhase = "idle";
      jobElapsed = 0;
      jobSnapshot = null;
      scene.jobPhase = "idle";
      scene.view("iso");
      renderControls();
      update();
    };
    if ($("run-study")) $("run-study").onclick = runConvergence;
    if ($("export-deck"))
      $("export-deck").onclick = () => {
        if (result)
          download("finite-elemented.inp", abaqus(result), "text/plain");
      };
    if ($("submit-job")) $("submit-job").onclick = submitJob;
    window.LabGuide?.onControls();
  }
  function metrics(items) {
    $("metrics").innerHTML = items
      .map(
        ([label, value, unit = ""]) =>
          `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}<small>${unit}</small></div></div>`,
      )
      .join("");
  }
  function legend(label, min, max) {
    $("legend").innerHTML =
      !fea && /Worker|Lane/.test(label)
        ? '<span>ACTIVITY KEY</span><div class="legend-values" style="margin-top:6px"><span style="color:#ffc08f">● Serial</span><span style="color:#82e3cb">● Parallel</span><span style="color:#9bb8dd">○ Idle</span></div>'
        : `<span>${label}</span><div class="legend-gradient"></div><div class="legend-values"><span>${min}</span><span>${max}</span></div>`;
  }
  function evidence(title, caption, tag = "") {
    $("chart-title").textContent = title;
    $("chart-caption").textContent = caption;
    $("chart-tag").textContent = tag;
  }
  function chart(
    series,
    { xLabel = "", yLabel = "", xMax, yMax, yMin = 0, log = false } = {},
  ) {
    const W = 440,
      H = 230,
      L = 68,
      R = 24,
      TOP = 28,
      B = 48,
      iw = W - L - R,
      ih = H - TOP - B;
    const all = series.flatMap((s) => s.points),
      xm = xMax || Math.max(...all.map((p) => p[0]), 1),
      ym = yMax || Math.max(...all.map((p) => p[1]), 1) * 1.08;
    const lo = log ? Math.log10(Math.max(yMin, 1e-12)) : yMin,
      hi = log ? Math.log10(ym) : ym;
    const x = (v) => L + (v / xm) * iw,
      y = (v) =>
        TOP +
        ih *
          (1 -
            ((log ? Math.log10(Math.max(v, 1e-12)) : v) - lo) / (hi - lo || 1));
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc($("chart-title").textContent)}"><title>${esc($("chart-title").textContent)}</title>`;
    for (let i = 0; i <= 4; i++) {
      const value = lo + ((hi - lo) * i) / 4,
        Y = TOP + ih - (ih * i) / 4;
      svg += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${Y}" y2="${Y}"/><text x="${L - 7}" y="${Y + 3}" text-anchor="end">${log ? "10^" + Math.round(value) : format(value, value < 10 ? 1 : 0)}</text><text x="${L + (iw * i) / 4}" y="${H - 26}" text-anchor="middle">${format((xm * i) / 4, xm < 5 ? 1 : 0)}</text>`;
    }
    for (const s of series) {
      svg += `<path d="${s.points.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(2) + "," + y(p[1]).toFixed(2)).join(" ")}" fill="none" stroke="${s.color || "var(--accent)"}" stroke-width="2.4" ${s.dash ? 'stroke-dasharray="5 4"' : ""}/>`;
      if (s.dots)
        s.points.forEach(
          (p) =>
            (svg += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="3.2" fill="${s.color || "var(--accent)"}"/>`),
        );
    }
    svg += `<text x="${W / 2}" y="${H - 5}" text-anchor="middle">${esc(xLabel)}</text><text x="${L}" y="16">${esc(yLabel)}</text></svg>`;
    if (series.some((s) => s.name))
      svg +=
        '<div class="chart-legend">' +
        series
          .map(
            (s) =>
              `<span><i style="background:${s.color || "var(--accent)"}"></i>${esc(s.name || "")}</span>`,
          )
          .join("") +
        "</div>";
    $("chart").innerHTML = svg;
  }
  function bars(items, { unit = "" } = {}) {
    const max = Math.max(...items.map((i) => i[1]), 1);
    $("chart").innerHTML =
      `<svg class="chart" viewBox="0 0 440 ${items.length * 64 + 12}" role="img" aria-label="${esc($("chart-title").textContent)}">${items.map(([label, v, c], i) => `<text x="0" y="${i * 64 + 18}">${esc(label)}</text><rect x="0" y="${i * 64 + 30}" width="${(v / max) * 300}" height="17" rx="3" fill="${c || "var(--accent)"}"/><text x="315" y="${i * 64 + 44}">${format(v, v < 10 ? 2 : 0)} ${unit}</text>`).join("")}</svg>`;
  }
  let worker = null,
    requestID = 0;
  const pending = new Map();
  try {
    worker = new Worker("../shared/solver-worker.js");
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.error ? p.reject(Error(data.error)) : p.resolve(data);
    };
    worker.onerror = () => {
      pending.forEach((p) =>
        p.reject(
          Error(
            "The solver worker could not start. Reload this page through a local web server.",
          ),
        ),
      );
      pending.clear();
      worker.terminate();
      worker = null;
    };
  } catch {}
  function calculate(action, options) {
    return new Promise((resolve, reject) => {
      if (worker) {
        const id = ++requestID;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, action, options });
      } else
        setTimeout(() => {
          try {
            resolve(
              action === "convergence"
                ? {
                    results: [1, 2, 3, 4, 6, 8].map((density) => {
                      const r = M.solveFE({ ...options, density });
                      return {
                        density,
                        tip: Math.abs(r.tip),
                        dofs: r.dofs,
                        converged: r.converged,
                      };
                    }),
                  }
                : { result: M.solveFE(options) },
            );
          } catch (e) {
            reject(e);
          }
        }, 0);
    });
  }
  function feOptions() {
    return {
      preset: lesson.id === "dynamics" ? "beam" : state.preset,
      type: state.type,
      density: state.density,
      E: state.E,
      load: state.load,
    };
  }
  let solveGeneration = 0;
  async function updateFE() {
    const id = lesson.id;
    $("stage-name").textContent = [
      "shape",
      "mapping",
      "refinement",
      "heat",
    ].includes(id)
      ? lesson.nav
      : "PLANE STRESS / " + state.type + " ELEMENTS";
    $("live-pill").textContent = "LIVE MODEL";
    $("scene-note").textContent = "";
    if (["shape", "mapping", "refinement", "heat"].includes(id)) {
      solveGeneration++;
      solveKey = "";
      updateSpecialFE();
      return;
    }
    const options = feOptions(),
      key = JSON.stringify(options);
    if (key !== solveKey || !result) {
      const generation = ++solveGeneration;
      $("result-status").textContent = "Assembling and solving…";
      try {
        const data = await calculate("solve", options);
        if (generation !== solveGeneration) return;
        result = data.result;
        solveKey = key;
      } catch (e) {
        if (generation !== solveGeneration) return;
        $("result-status").textContent = e.message;
        return;
      }
    }
    if (
      lesson.id !== id ||
      ["shape", "mapping", "refinement", "heat"].includes(lesson.id)
    )
      return;
    $("result-status").textContent = result.converged
      ? `Solved · ${result.dofs} free DOFs · ${result.iterations} iterations`
      : "Solver did not reach tolerance. Treat results as unconverged.";
    scene.setFE(result, {
      gain: state.gain,
      showNodes: id === "fea-intro",
      field: state.field,
      ghost: state.ghost,
      mesh: state.mesh,
      mode: id === "dynamics" ? "modal" : "stress",
      frequency: state.mode,
      explode: ["assembly", "mesh", "elements"].includes(id)
        ? state.explode
        : 0,
    });
    const max =
        state.field === "displacement"
          ? result.maxDisplacement
          : Math.max(...result.stresses.map((s) => Math.abs(s[state.field]))),
      signed = ["sx", "sy", "tau"].includes(state.field);
    legend(
      state.field === "displacement"
        ? "Displacement · mm"
        : { vm: "von Mises", sx: "σₓ", sy: "σᵧ", tau: "τₓᵧ" }[state.field] +
            " · MPa",
      format(signed ? -max : 0),
      format(max),
    );
    $("scene-note").textContent =
      `Peak-load field · deformation ${state.gain}×`;
    metrics([
      ["Tip displacement", format(Math.abs(result.tip), 3), "mm"],
      ["Peak von Mises", format(result.maxStress, 1), "MPa"],
      ["Elements", result.elements.length, state.type],
    ]);
    const section = [];
    for (let i = 0; i < result.elements.length; i++) {
      const e = result.elements[i],
        x = e.reduce((s, n) => s + result.nodes[n][0], 0) / e.length;
      section.push([x, result.stresses[i].vm]);
    }
    const bins = new Map();
    section.forEach(([x, v]) => bins.set(x, Math.max(bins.get(x) || 0, v)));
    const envelope = Array.from(bins).sort((a, b) => a[0] - b[0]);
    evidence(
      "Stress along the structure",
      "Maximum element-center von Mises stress in each x slice. Clamped-edge and corner peaks depend on the mesh.",
      "COMPUTED",
    );
    chart([{ points: envelope }], {
      xLabel: "x position · mm",
      yLabel: "MPa",
      xMax: 120,
    });
    if (id === "fea-intro") {
      metrics([
        ["Nodes", result.nodes.length],
        ["Free DOFs", result.dofs],
        ["Elements", result.elements.length],
      ]);
      evidence(
        "Nodes, elements, and unknowns",
        "Each node carries two displacement components. Prescribed components on the fixed edge are removed from the system of free unknowns.",
        "ACTUAL MESH",
      );
      bars([
        ["Nodes", result.nodes.length],
        ["Free DOFs", result.dofs],
        ["Elements", result.elements.length],
      ]);
    } else if (id === "assembly") {
      evidence(
        "How connectivity creates sparsity",
        `Actual reduced stiffness matrix: ${result.dofs} × ${result.dofs}, shown in 32 × 32 bins. Darker cells contain more nonzero coefficients. ${result.nonzeros.toLocaleString()} entries are stored. Changing the mesh changes this pattern.`,
        "ASSEMBLED K",
      );
      const peak = Math.max(...result.pattern);
      $("chart").innerHTML =
        '<div class="matrix" style="grid-template-columns:repeat(32,1fr);gap:1px" role="img" aria-label="Binned sparsity pattern of the actual assembled stiffness matrix">' +
        result.pattern
          .map(
            (v) =>
              `<span style="background:${v ? `rgba(24,169,168,${0.25 + (0.75 * v) / peak})` : "var(--bg-box-alt)"}"></span>`,
          )
          .join("") +
        '</div><div class="matrix-key">Rows / columns are free displacement DOFs</div>';
    } else if (id === "solvers" || id === "conditioning") {
      evidence(
        "Residual history",
        "Jacobi-preconditioned conjugate gradient. Values are recorded during this actual solve. A non-monotone residual is not necessarily a failure.",
        "RELATIVE NORM",
      );
      chart([{ points: result.residuals.map((r, i) => [i, r]) }], {
        xLabel: "iteration",
        yLabel: "‖r‖ / ‖f‖",
        log: true,
        yMin: 1e-10,
        yMax: Math.max(...result.residuals, 1) * 1.05,
      });
    } else if (id === "convergence") {
      renderConvergence();
    } else if (id === "foundations" || id === "verification") {
      const dir = state.preset === "tension" ? 0 : 1,
        applied = state.preset === "tension" ? state.load : -state.load,
        imbalance = Math.abs(result.reactions[dir] + applied) / state.load;
      evidence(
        "Equilibrium check",
        "Magnitude of the applied force and summed support reaction. Balance is necessary but does not validate the material or geometry.",
        "N",
      );
      bars([
        ["Applied", state.load, "#d87942"],
        ["Reaction", Math.abs(result.reactions[dir])],
      ]);
      metrics([
        ["Force imbalance", imbalance.toExponential(1), "relative"],
        ["Strain energy", format(result.energy, 2), "N·mm"],
        ["Free DOFs", result.dofs, ""],
      ]);
    } else if (id === "dynamics") {
      const betas = [1.875104, 4.694091, 7.854757],
        freq = betas.map(
          (b) =>
            ((b * b) / (2 * Math.PI * 0.12 ** 2)) *
            Math.sqrt(
              (state.E * 1e6 * ((0.006 * 0.024 ** 3) / 12)) /
                (2700 * 0.006 * 0.024),
            ),
        );
      $("stage-name").textContent = "ANALYTICAL CANTILEVER MODES";
      $("scene-note").textContent = "Normalized motion · slowed playback";
      legend("Mode shape", "−amplitude", "+amplitude");
      metrics([
        ["Selected frequency", format(freq[state.mode - 1], 1), "Hz"],
        ["Mode", state.mode, ""],
        ["Density", 2700, "kg/m³"],
      ]);
      evidence(
        "Natural frequencies",
        "Analytical Euler–Bernoulli beam; L = 120 mm, h = 24 mm, t = 6 mm. Density is held fixed while modulus varies.",
        "ANALYTICAL",
      );
      bars(
        freq.map((v, i) => [
          "Mode " + (i + 1),
          v,
          i === state.mode - 1 ? "#d87942" : "var(--accent)",
        ]),
        { unit: "Hz" },
      );
    }
    probe(0);
    if (id === "dynamics") legend("Normalized |mode shape|", "0", "1");
  }
  function updateSpecialFE() {
    const id = lesson.id;
    $("result-status").textContent = "Analytical teaching model";
    $("probe").innerHTML = "";
    if (id === "shape") {
      scene.setSurface("shape", state);
      const N = M.shape(state.xi, state.eta);
      legend("Selected basis value", 0, 1);
      metrics([
        ["Basis at probe", format(N[state.node], 3), ""],
        [
          "Partition of unity",
          format(
            N.reduce((a, b) => a + b),
            2,
          ),
          "",
        ],
        ["Node", state.node + 1, ""],
      ]);
      evidence(
        "Basis values at the probe",
        "These four values weight the nodal unknowns. They always sum to one.",
        "Q4",
      );
      bars(
        N.map((v, i) => [
          "N" + (i + 1),
          v,
          i === state.node ? "#d87942" : "var(--accent)",
        ]),
      );
    } else if (id === "mapping") {
      scene.setSurface("mapping", state);
      const p = [
          [-2, -1.5],
          [2, -1.5],
          [2 - state.warp * 2, 1.5 - state.warp * 1.2],
          [-2, 1.5],
        ],
        values = [];
      for (let j = 0; j <= 20; j++)
        for (let i = 0; i <= 20; i++)
          values.push(M.quadB(p, -1 + i / 10, -1 + j / 10).det);
      const min = Math.min(...values),
        max = Math.max(...values);
      legend("det J · normalized", 0, 1);
      metrics([
        ["Minimum det J", format(min, 3), ""],
        ["Maximum det J", format(max, 3), ""],
        [
          "Mapping",
          min <= 0 ? "Invalid" : min / max < 0.2 ? "Distorted" : "Valid",
          "",
        ],
      ]);
      evidence(
        "Jacobian across the element",
        "Sampled along the diagonal ξ = η. The validity result also checks a 21 × 21 grid including corners. Red surface regions are inverted.",
        "GEOMETRY",
      );
      chart(
        [
          {
            points: Array.from({ length: 21 }, (_, i) => [
              i / 10,
              M.quadB(p, -1 + i / 10, -1 + i / 10).det,
            ]),
          },
        ],
        {
          xLabel: "ξ + 1 along diagonal",
          yLabel: "det J",
          xMax: 2,
          yMin: Math.min(min, 0),
        },
      );
    } else if (id === "refinement") {
      scene.setInterpolation(state.n, state.p);
      const d = M.interpolateError(state.n, state.p);
      legend("Basis approximation", "nodal samples", "smooth field");
      metrics([
        ["Max sampled error", d.error.toExponential(2), ""],
        ["Interpolation DOFs", d.dofs, ""],
        ["Polynomial order", state.p, ""],
      ]);
      evidence(
        "Approximation versus exact field",
        "The error is measured at 201 equally spaced points; it is a sampled maximum, not a rigorous error bound.",
        "INTERPOLATION",
      );
      chart(
        [
          {
            points: d.points.map((p) => [p[0], p[2]]),
            name: "Exact sine",
            color: "#d87942",
            dash: true,
          },
          { points: d.points.map((p) => [p[0], p[1]]), name: "Interpolant" },
        ],
        { xLabel: "x", xMax: 1 },
      );
    } else {
      scene.setSurface("heat", state);
      const flux = (state.conductivity * (state.hot - state.cold)) / 0.12;
      legend("Temperature · °C", state.cold, state.hot);
      metrics([
        ["Heat flux", format(flux / 1000, 2), "kW/m²"],
        ["Temperature drop", state.hot - state.cold, "°C"],
        ["Conductivity", state.conductivity, "W/mK"],
      ]);
      evidence(
        "Steady temperature profile",
        "Exact solution for uniform conductivity, no internal heat source, and insulated top and bottom edges. Positive heat flux points to the right.",
        "ANALYTICAL",
      );
      chart(
        [
          {
            points: [
              [0, state.hot],
              [120, state.cold],
            ],
          },
        ],
        {
          xLabel: "x position · mm",
          yLabel: "°C",
          xMax: 120,
          yMax: Math.max(state.hot, state.cold, 1) * 1.1,
        },
      );
    }
    if (id === "heat")
      legend(
        "Temperature · °C",
        Math.min(state.hot, state.cold),
        Math.max(state.hot, state.cold),
      );
  }
  function probe(i) {
    if (!fea) {
      if (lesson.id === "architecture") {
        $("probe").innerHTML =
          `<strong>${i < 8 ? "CPU lane " + (i + 1) : "GPU lane " + (i - 7)}</strong><br>Illustrative processing lanes. These counts define the throughput model below, not a specific processor’s hardware.`;
      } else {
        const p =
            lesson.id === "workflow" && jobSnapshot
              ? jobSnapshot.processors
              : state.processors,
          q = Math.floor(p / 32),
          extra = p % 32,
          count = q + (i < extra ? 1 : 0),
          first = i * q + Math.min(i, extra) + 1;
        $("probe").innerHTML =
          `<strong>Compute sled ${i + 1}</strong><br>${count ? `Workers ${first}${count > 1 ? "–" + (first + count - 1) : ""} allocated to this sled.` : "This sled is unallocated."}<br>The 32 sleds group up to 64 workers. Click another sled to inspect its allocation.`;
      }
      return;
    }
    if (
      !result ||
      ["shape", "mapping", "refinement", "heat", "dynamics"].includes(lesson.id)
    ) {
      if (lesson.id === "dynamics")
        $("probe").textContent =
          "The mode animation is analytical and normalized; its speed and color do not encode physical stress.";
      return;
    }
    i = Math.max(0, Math.min(result.elements.length - 1, i));
    const s = result.stresses[i];
    $("probe").innerHTML =
      `<div class="probe-row"><strong>Element inspector</strong><select id="element-select" aria-label="Select element">${result.elements.map((_, k) => `<option value="${k}" ${i === k ? "selected" : ""}>Element ${k + 1}</option>`).join("")}</select></div>σₓ ${format(s.sx, 2)} · σᵧ ${format(s.sy, 2)} · τₓᵧ ${format(s.tau, 2)} MPa<br>von Mises ${format(s.vm, 2)} MPa · ${result.elements[i].length} nodes<br>Click the mesh or use the selector to inspect an element.`;
    $("element-select").onchange = (e) => {
      scene.highlightElement?.(+e.target.value);
      probe(+e.target.value);
    };
  }
  async function runConvergence() {
    const options = feOptions(),
      key = JSON.stringify({ ...options, density: 0 }),
      button = $("run-study");
    button.disabled = true;
    button.textContent = "Solving six meshes…";
    $("result-status").textContent = "Running a mesh study in the background…";
    try {
      const data = await calculate("convergence", options);
      convergence = { key, results: data.results };
      if (lesson.id === "convergence") {
        renderConvergence();
        $("result-status").textContent =
          "Six meshes solved. Compare the trend and final relative change.";
      }
    } catch (e) {
      if ($("result-status")) $("result-status").textContent = e.message;
    } finally {
      if ($("run-study")) {
        $("run-study").disabled = false;
        $("run-study").textContent = "Run convergence study";
      }
    }
  }
  function renderConvergence() {
    const key = JSON.stringify({ ...feOptions(), density: 0 });
    if (!convergence || convergence.key !== key) {
      evidence(
        "Build a convergence study",
        "Run six meshes with the current geometry, element family, material, and force. Changing those parameters requires a new study.",
        "READY",
      );
      $("chart").innerHTML =
        '<div class="takeaway" style="margin-top:24px"><p>Use <strong>Run convergence study</strong> to calculate displacement at six mesh resolutions. Each point is an independent solve.</p></div>';
      return;
    }
    const points = convergence.results.map((r) => [r.dofs, r.tip]),
      last = points.at(-1)[1],
      prev = points.at(-2)[1],
      series = [{ points, dots: true, name: state.type + " finite elements" }];
    if (state.preset !== "bracket")
      series.push({
        points: [
          [0, result.reference],
          [points.at(-1)[0], result.reference],
        ],
        dash: true,
        color: "#d87942",
        name: state.preset === "tension" ? "Axial theory" : "Beam theory",
      });
    evidence(
      "Tip displacement under refinement",
      `Final successive-mesh change: ${format((Math.abs(last - prev) / last) * 100, 2)}%. ${convergence.results.every((r) => r.converged) ? "All algebraic solves reached tolerance." : "Some algebraic solves did not converge."}`,
      "6 ACTUAL SOLVES",
    );
    chart(series, { xLabel: "free degrees of freedom", yLabel: "tip · mm" });
  }
  function abaqus(r) {
    const lines = [
      "*Heading",
      "Finite-Elemented | N, mm, MPa | linear plane stress",
      "*Node",
    ];
    r.nodes.forEach((p, i) => lines.push(`${i + 1}, ${p[0]}, ${p[1]}`));
    lines.push(
      `*Element, type=${r.options.type === "T3" ? "CPS3" : "CPS4"}, elset=BODY`,
    );
    r.elements.forEach((e, i) =>
      lines.push(`${i + 1}, ${e.map((n) => n + 1).join(", ")}`),
    );
    lines.push(
      "*Material, name=ELASTIC",
      "*Elastic",
      `${r.options.E}, ${r.options.nu}`,
      "*Solid Section, elset=BODY, material=ELASTIC",
      String(r.options.thickness),
      "*Boundary",
    );
    r.nodes.forEach((p, i) => {
      if (p[0] === 0) lines.push(`${i + 1}, 1, 2, 0`);
    });
    lines.push("*Step, name=LOAD", "*Static", "*Cload");
    const edge = r.nodes
        .map((p, i) => (p[0] === 120 ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => r.nodes[a][1] - r.nodes[b][1]),
      axial = r.options.preset === "tension";
    edge.forEach((i, k) =>
      lines.push(
        `${i + 1}, ${axial ? 1 : 2}, ${((axial ? 1 : -1) * r.options.load * (k === 0 || k === edge.length - 1 ? 0.5 : 1)) / (edge.length - 1)}`,
      ),
    );
    lines.push(
      "*Output, field",
      "*Node Output",
      "U, RF",
      "*Element Output",
      "S, E",
      "*End Step",
    );
    return lines.join("\n") + "\n";
  }
  function download(filename, text, type) {
    const a = document.createElement("a"),
      url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function hpcOptions() {
    return {
      processors: state.processors,
      parallel: state.parallel / 100,
      overhead: state.overhead / 100,
      work: 120,
      weak: lesson.id === "scaling" && state.weak,
    };
  }
  function update() {
    if (window.LabGuide?.update()) return;
    if (fea) updateFE();
    else updateHPC();
  }
  // HPC experiments follow below.
  function updateHPC() {
    const id = lesson.id,
      o = hpcOptions(),
      s = M.scaling(o);
    $("stage-name").textContent =
      id === "architecture"
        ? "PARALLEL PROCESSING / TEACHING LANES"
        : id === "memory"
          ? "MEMORY HIERARCHY"
          : "COMPUTE FABRIC / " + state.processors + " WORKERS";
    $("live-pill").textContent = "ILLUSTRATIVE MODEL";
    $("scene-note").textContent = "Sleds represent worker groups";
    $("result-status").textContent = "Ready · change a parameter to compare";
    scene.setCluster({
      processors:
        id === "workflow" && jobSnapshot
          ? jobSnapshot.processors
          : state.processors,
      parallel: state.parallel / 100,
      overhead: state.overhead / 100,
      weak: o.weak,
      mode: id,
      phase: jobPhase,
    });
    legend("Worker activity", "idle", "busy");
    metrics([
      ["Predicted runtime", format(s.time, 1), "s"],
      ["Speedup", format(s.speedup, 2), "×"],
      ["Efficiency", format(s.efficiency * 100, 1), "%"],
    ]);
    if (id === "scaling" && state.weak) {
      $("equation").textContent =
        "T(P) = T₁[1 + α log₂(P)] · scaled speedup = T₁[(1−f) + fP] / T(P)";
      metrics([
        ["Predicted runtime", format(s.time, 1), "s"],
        ["Scaled speedup", format(s.speedup, 2), "×"],
        ["Scaled efficiency", format(s.efficiency * 100, 1), "%"],
      ]);
    } else $("equation").textContent = lesson.equation;
    const points = Array.from({ length: 64 }, (_, i) => [
      i + 1,
      M.scaling({ ...o, processors: i + 1 }).speedup,
    ]);
    evidence(
      "Speedup versus allocation",
      "The ideal line includes the serial fraction but no communication cost. The colored curve includes the selected overhead.",
      "MODEL",
    );
    chart(
      [
        { points, name: "With communication" },
        {
          points: points.map(([p]) => [
            p,
            M.scaling({ ...o, processors: p, overhead: 0 }).speedup,
          ]),
          name: "No communication",
          color: "#d87942",
          dash: true,
        },
      ],
      { xLabel: "parallel workers", yLabel: "speedup", xMax: 64 },
    );
    $("probe").innerHTML =
      `<strong>Where the time goes</strong><br>Serial ${format(s.serial, 2)} s · parallel ${format(s.compute, 2)} s<br>Communication ${format(s.communication, 2)} s<br>${state.weak ? "Weak scaling: parallel work grows with P." : "Strong scaling: the total problem size is fixed."}`;
    if (id === "rightsizing") {
      const workloads = {
          serial: { memory: 8, parallel: 0.05, gpu: false, distributed: false },
          render: { memory: 24, parallel: 0.99, gpu: true, distributed: false },
          large: { memory: 512, parallel: 0.98, gpu: false, distributed: true },
          memory: {
            memory: 100,
            parallel: 0.65,
            gpu: false,
            distributed: false,
          },
        },
        resources = {
          laptop: { memory: 16, cores: 8, gpu: false },
          cpu: { memory: 128, cores: 32, gpu: false },
          gpu: { memory: 48, cores: 16, gpu: true },
          cluster: { memory: 1024, cores: 128, gpu: false },
        },
        w = workloads[state.workload],
        r = resources[state.resource],
        fits =
          w.memory <= r.memory &&
          (state.resource !== "cluster" || w.distributed || w.memory <= 128);
      const recommended =
          state.workload === "serial"
            ? "laptop"
            : state.workload === "render"
              ? "gpu"
              : state.workload === "large"
                ? "cluster"
                : "cpu",
        good = state.resource === recommended;
      metrics([
        ["Memory required", w.memory, "GB"],
        ["Available memory", r.memory, "GB"],
        [
          "Resource fit",
          !fits ? "Does not fit" : good ? "Well matched" : "Fits",
          "",
        ],
      ]);
      scene.setCluster({
        processors: Math.min(32, r.cores),
        parallel: w.parallel,
        mode: "rightsizing",
      });
      $("stage-name").textContent =
        "RESOURCE MATCH / " + state.resource.toUpperCase();
      evidence(
        "Memory capacity check",
        "Cluster memory is distributed. A shared-memory program cannot automatically pool it into one large address space.",
        "GB",
      );
      bars([
        ["Required", w.memory, "#d87942"],
        ["Available", r.memory],
      ]);
      $("probe").innerHTML =
        `<strong>${!fits ? "Insufficient or incompatible memory" : good ? "A suitable starting allocation" : "Fits, but consider a smaller or better-suited resource"}</strong><br>Suggested starting point: ${esc({ laptop: "workstation", cpu: "CPU node", gpu: "GPU node", cluster: "distributed cluster" }[recommended])}. ${w.gpu ? "This workload explicitly supports GPU execution." : "Extra accelerator capacity is not assumed to benefit this workload."}`;
    } else if (id === "workflow") {
      metrics([
        ["Job state", jobPhase, ""],
        ["Walltime", jobSnapshot?.walltime ?? state.walltime, "min"],
        ["Elapsed simulation", format(jobElapsed, 1), "min"],
      ]);
      renderJob();
      evidence(
        "Job execution timeline",
        "One second of playback represents one simulated minute. Queue delay is deterministic; runtime follows the same scaling model.",
        "SIMULATION",
      );
      bars(
        [
          ["Queued", jobSnapshot?.queue ?? 0, "#d87942"],
          ["Compute", jobSnapshot?.runtime ?? 0],
        ],
        { unit: "min" },
      );
      $("probe").textContent =
        "Submit starts a local demonstration. Pause motion affects the visual scene; Cancel stops the simulated job. No connection to an HPC system is made.";
    } else if (id === "architecture") {
      const cpu = (state.batch * 0.08) / 8,
        gpu = state.transfer + (state.batch * 0.04) / 96;
      metrics([
        ["CPU prediction", format(cpu, 2), "ms"],
        ["GPU prediction", format(gpu, 2), "ms"],
        ["CPU / GPU", format(cpu / gpu, 2), "×"],
      ]);
      $("scene-note").textContent = "8 / 96 lanes · illustrative";
      legend("Lane activity", "waiting", "executing");
      evidence(
        "When does acceleration pay off?",
        "CPU: 0.08 ms/task over 8 lanes. GPU: 0.04 ms/task over 96 lanes, plus the selected fixed overhead. Fractional waves are a simplified throughput model.",
        "PREDICTED ms",
      );
      chart(
        [
          {
            points: Array.from({ length: 51 }, (_, i) => [
              i * 200,
              (i * 200 * 0.08) / 8,
            ]),
            name: "CPU",
            color: "#d87942",
          },
          {
            points: Array.from({ length: 51 }, (_, i) => [
              i * 200,
              state.transfer + (i * 200 * 0.04) / 96,
            ]),
            name: "GPU",
          },
        ],
        { xLabel: "independent tasks", yLabel: "ms" },
      );
      $("probe").textContent =
        gpu < cpu
          ? "At this batch size, parallel throughput outweighs the assumed GPU overhead."
          : "At this batch size, the assumed GPU overhead outweighs its throughput advantage.";
    } else if (id === "memory") {
      const latency = (state.hit / 100) * 4 + (1 - state.hit / 100) * 100;
      metrics([
        ["Average access", format(latency, 2), "ns"],
        ["Cache hits", state.hit, "%"],
        ["DRAM accesses", 100 - state.hit, "%"],
      ]);
      $("scene-note").textContent = "Capacity increases downward";
      legend("Memory level", "larger / slower", "smaller / faster");
      evidence(
        "The cost of cache misses",
        "Assumed cache hit: 4 ns; miss serviced by DRAM: 100 ns total. Independent accesses and overlap are not represented.",
        "ns / ACCESS",
      );
      chart(
        [
          {
            points: [
              [0, 100],
              [100, 4],
            ],
          },
          { points: [[state.hit, latency]], dots: true, color: "#d87942" },
        ],
        { xLabel: "cache hit rate · %", yLabel: "ns", xMax: 100 },
      );
      $("probe").textContent =
        "Cache blocking, contiguous access, and reuse can improve locality. The hierarchy sizes in the scene are schematic, not proportional capacities.";
    } else if (id === "roofline") {
      const roof = M.roofline(state);
      metrics([
        ["Performance bound", format(roof.performance, 0), "GFLOP/s"],
        ["Ridge point", format(roof.ridge, 1), "FLOP/B"],
        [
          "Limiting factor",
          roof.bound === "Memory bound" ? "Memory" : "Compute",
          "",
        ],
      ]);
      evidence(
        "Arithmetic intensity meets the roof",
        "The marker is your kernel. The horizontal roof is peak throughput; the slope is the bandwidth limit. Both axes are linear here.",
        "UPPER BOUND",
      );
      chart(
        [
          {
            points: Array.from({ length: 129 }, (_, i) => [
              i * 0.5,
              Math.min(state.peak, state.bandwidth * i * 0.5),
            ]),
            name: "Machine roofline",
          },
          {
            points: [[state.intensity, roof.performance]],
            dots: true,
            color: "#d87942",
            name: "Selected kernel",
          },
        ],
        {
          xLabel: "arithmetic intensity · FLOP/byte",
          yLabel: "GFLOP/s",
          xMax: 64,
        },
      );
      $("probe").innerHTML =
        `<strong>${roof.bound}</strong><br>${roof.bound === "Memory bound" ? "Increase reuse or bandwidth to lift this bound." : "Peak compute now limits the roof; higher intensity alone does not lift it."}`;
    } else if (id === "network") {
      const transfer = (state.message * 1000) / state.networkBandwidth,
        one = state.latency + transfer,
        stages = Math.ceil(Math.log2(state.processors)),
        total = one * stages;
      metrics([
        ["One message", format(one, 1), "μs"],
        ["Tree collective", format(total / 1000, 2), "ms"],
        ["Stages", stages, ""],
      ]);
      evidence(
        "Latency versus transfer cost",
        "Decimal MB and GB. Each tree stage sends the selected message size. This excludes contention and overlap.",
        "μs",
      );
      bars([
        ["Startup", state.latency, "#d87942"],
        ["Transfer", transfer],
      ]);
      $("probe").textContent =
        `Transfer is ${format((transfer / one) * 100, 1)}% of this message cost. A tree with ${state.processors} workers requires ${stages} stages in this model.`;
    } else if (id === "scheduling") {
      const back = state.policy === "backfill",
        end = back ? 10 : 13;
      metrics([
        ["Makespan", end, "time units"],
        ["Utilization", format((38 / (4 * end)) * 100, 1), "%"],
        ["Job A starts", 4, "time units"],
      ]);
      evidence(
        "A reservation-safe schedule",
        "Initial job R: two slots, t = 0–4. A: four slots for six units. B: two slots for three units. Backfill runs B in the initially free slots.",
        "4 SLOTS",
      );
      const tasks = [
        { name: "R", start: 0, end: 4, y: 0, h: 2, c: "#899b91" },
        { name: "A", start: 4, end: 10, y: 0, h: 4, c: "var(--accent)" },
        {
          name: "B",
          start: back ? 0 : 10,
          end: back ? 3 : 13,
          y: back ? 2 : 0,
          h: 2,
          c: "#d87942",
        },
      ];
      $("chart").innerHTML =
        `<svg class="chart" viewBox="0 0 440 180" role="img" aria-label="${back ? "Backfill" : "FIFO"} job schedule">${Array.from({ length: 5 }, (_, i) => `<line class="gridline" x1="30" x2="427" y1="${20 + i * 29}" y2="${20 + i * 29}"/>`).join("")}${tasks.map((t) => `<rect x="${30 + t.start * 29}" y="${21 + t.y * 29}" width="${(t.end - t.start) * 29 - 2}" height="${t.h * 29 - 2}" rx="4" fill="${t.c}"/><text x="${42 + t.start * 29}" y="${42 + t.y * 29}" style="fill:white">${t.name}</text>`).join("")}${[0, 4, 10, 13].map((t) => `<text x="${30 + t * 29}" y="155" text-anchor="middle">${t}</text>`).join("")}<text x="220" y="175" text-anchor="middle">simulated time units</text></svg>`;
      $("probe").textContent = back
        ? "B finishes at t = 3, before A’s reservation at t = 4. Makespan improves without delaying A."
        : "B waits behind A even though two slots were free at the beginning. This is head-of-line blocking.";
    } else if (id === "energy") {
      const energy =
        ((80 + state.processors * state.workerPower) * s.time) / 3600;
      metrics([
        ["Runtime", format(s.time, 1), "s"],
        ["Allocated work", format(s.cost, 0), "worker·s"],
        ["Energy estimate", format(energy, 2), "Wh"],
      ]);
      evidence(
        "Energy versus allocation",
        "Assumed platform base: 80 W, plus selected power per allocated worker. Cooling and power-state changes are excluded.",
        "ILLUSTRATIVE",
      );
      chart(
        [
          {
            points: Array.from({ length: 64 }, (_, i) => [
              i + 1,
              ((80 + (i + 1) * state.workerPower) *
                M.scaling({ ...o, processors: i + 1, weak: false }).time) /
                3600,
            ]),
          },
        ],
        { xLabel: "parallel workers", yLabel: "Wh", xMax: 64 },
      );
      $("probe").textContent =
        "Compare the minimum of this energy curve with the runtime trend in Parallel scaling. Allocation cost here is worker-seconds, not currency.";
    }
  }
  function renderJob() {
    if (!$("phases")) return;
    $("phases").innerHTML = ["queued", "running", "complete"]
      .map(
        (p) => `<span class="${jobPhase === p ? "current" : ""}">${p}</span>`,
      )
      .join("");
    const config = jobSnapshot || {
      processors: state.processors,
      walltime: state.walltime,
    };
    $("terminal").textContent =
      `#!/bin/bash\n#SBATCH --job-name=frontier-demo\n#SBATCH --ntasks=${config.processors}\n#SBATCH --time=00:${String(config.walltime).padStart(2, "0")}:00\nsrun ./my_parallel_program\n\n# Local simulation: ${jobPhase}`;
    $("submit-job").textContent = jobTimer
      ? "Cancel simulated job"
      : "Submit simulated job";
    document
      .querySelectorAll("#inspector [data-key]")
      .forEach((e) => (e.disabled = !!jobTimer));
  }
  function submitJob() {
    if (jobTimer) {
      clearInterval(jobTimer);
      jobTimer = 0;
      jobPhase = "cancelled";
      scene.jobPhase = jobPhase;
      updateHPC();
      return;
    }
    const runtime = M.scaling({ ...hpcOptions(), weak: false }).time / 6;
    jobSnapshot = {
      processors: state.processors,
      walltime: state.walltime,
      runtime,
      queue: 1 + state.processors / 16,
    };
    jobElapsed = 0;
    jobPhase = "queued";
    scene.jobPhase = "queued";
    jobTimer = setInterval(() => {
      if (document.hidden) return;
      jobElapsed += 0.1;
      const runElapsed = jobElapsed - jobSnapshot.queue;
      if (runElapsed >= 0) jobPhase = "running";
      if (runElapsed >= Math.min(jobSnapshot.runtime, jobSnapshot.walltime)) {
        jobPhase =
          jobSnapshot.walltime < jobSnapshot.runtime ? "timed out" : "complete";
        clearInterval(jobTimer);
        jobTimer = 0;
      }
      scene.jobPhase = jobPhase;
      if (lesson.id === "workflow") {
        metrics([
          ["Job state", jobPhase, ""],
          ["Walltime", jobSnapshot.walltime, "min"],
          ["Elapsed simulation", format(jobElapsed, 1), "min"],
        ]);
        renderJob();
        $("result-status").textContent =
          jobPhase === "timed out"
            ? "Time limit reached before the modeled job finished."
            : jobPhase === "complete"
              ? "Job completed. Try changing the allocation."
              : `Simulated job ${jobPhase}…`;
      }
    }, 100);
    updateHPC();
  }
  window.addEventListener("pagehide", (e) => {
    if (e.persisted) return;
    clearInterval(jobTimer);
    worker?.terminate();
    scene.dispose();
  });
  window.addEventListener("pageshow", () => scene.request());
  window.LabApp = {
    kind,
    fea,
    name,
    lessons,
    scene,
    defaults,
    get lesson() {
      return lesson;
    },
    set lesson(value) {
      lesson = value;
    },
    get state() {
      return state;
    },
    get result() {
      return result;
    },
    get completed() {
      return completed;
    },
    go,
    renderControls,
    update,
    metrics,
    evidence,
    chart,
    bars,
    legend,
    download,
    format,
  };
  window.LabGuide?.init(window.LabApp);
  renderLesson();
})();
