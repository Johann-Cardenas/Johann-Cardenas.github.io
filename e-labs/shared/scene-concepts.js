(function () {
  "use strict";
  const T = THREE,
    { box, label, material, color } = LabVisuals;
  LabScene.prototype.setHardware = function ({
    nodes = 2,
    coresPerNode = 8,
    resource,
  } = {}) {
    if (this.failed) return;
    this.clear();
    if (resource === "laptop" || resource === "workstation") {
      const laptop = resource === "laptop",
        base = box(3.4, 0.13, 2, "#475569");
      base.position.set(0, -0.65, 0.2);
      this.content.add(base);
      const screen = box(3.4, 2.1, 0.13, "#334155");
      screen.position.set(0, 0.45, -0.85);
      this.content.add(screen);
      const glass = box(3.08, 1.79, 0.02, "#18a9a8");
      glass.position.set(0, 0.45, -0.77);
      this.content.add(glass);
      if (!laptop) {
        const tower = box(0.8, 2, 1.1, "#334155");
        tower.position.set(2.4, -0.1, 0);
        this.content.add(tower);
        for (let i = 0; i < 3; i++) {
          const disk = box(0.5, 0.08, 0.03, "#6366f1");
          disk.position.set(2.4, 0.4 - i * 0.3, 0.57);
          this.content.add(disk);
        }
      }
      this.content.add(
        label(laptop ? "LAPTOP" : "WORKSTATION", 0, 1.85, 0, 0.24),
      );
      this.request();
      return;
    }
    const count = resource === "cluster" ? 8 : nodes,
      cols = Math.min(4, count),
      rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
      const x = ((i % cols) - (cols - 1) / 2) * 1.7,
        z = (Math.floor(i / cols) - (rows - 1) / 2) * 1.8,
        board = box(1.45, 0.17, 1.3, "#334155");
      board.position.set(x, -0.2, z);
      board.userData.id = i;
      this.content.add(board);
      this.pickables.push(board);
      const lanes = Math.min(coresPerNode, 32),
        ncols = lanes > 16 ? 8 : Math.min(4, lanes);
      for (let k = 0; k < lanes; k++) {
        const chip = box(lanes > 16 ? 0.11 : 0.18, 0.1, 0.18, "#18a9a8");
        chip.position.set(
          x + ((k % ncols) - (ncols - 1) / 2) * (lanes > 16 ? 0.14 : 0.25),
          -0.065,
          z +
            (Math.floor(k / ncols) - (Math.ceil(lanes / ncols) - 1) / 2) * 0.22,
        );
        this.content.add(chip);
      }
      const ram = box(1.1, 0.08, 0.12, "#6366f1");
      ram.position.set(x, -0.04, z + 0.48);
      this.content.add(ram);
      this.content.add(
        label(
          resource === "cluster"
            ? `NODE GROUP ${i + 1}`
            : `NODE ${i + 1} · ${coresPerNode} CORES`,
          x,
          0.48,
          z,
          0.16,
        ),
      );
    }
    if (count > 1) {
      const network = [];
      for (let i = 1; i < count; i++) {
        const position = (k) =>
          new T.Vector3(
            ((k % cols) - (cols - 1) / 2) * 1.7,
            -0.34,
            (Math.floor(k / cols) - (rows - 1) / 2) * 1.8,
          );
        network.push(position(i - 1), position(i));
      }
      this.content.add(
        new T.LineSegments(
          new T.BufferGeometry().setFromPoints(network),
          new T.LineBasicMaterial({ color: "#6366f1" }),
        ),
      );
    }
    this.content.add(label("LOCAL RAM ON EACH NODE", 0, -0.85, 1.6, 0.2));
    if (!this.userCamera) this.phi = 0.8;
    this.request();
  };
  LabScene.prototype.setPipeline = function () {
    if (this.failed) return;
    this.clear();
    this.pipelinePhase = 0;
    const stations = [];
    ["SUBMIT", "QUEUE", "ALLOCATE", "EXECUTE", "COLLECT"].forEach((name, i) => {
      const x = (i - 2) * 1.45,
        m = box(1.1, 0.7, 0.8, "#334155");
      m.position.set(x, 0, 0);
      this.content.add(m);
      stations.push(m);
      this.content.add(label(name, x, 0.85, 0, 0.16));
      for (let k = 0; k < 3; k++) {
        const bar = box(0.65, 0.045, 0.03, "#18a9a8");
        bar.position.set(x, 0.19 - k * 0.16, 0.42);
        this.content.add(bar);
      }
    });
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints([
        new T.Vector3(-3, -0.7, 0.6),
        new T.Vector3(3, -0.7, 0.6),
      ]),
      new T.LineBasicMaterial({ color: "#6366f1" }),
    );
    this.content.add(line);
    const packet = box(0.16, 0.16, 0.16, "#18a9a8");
    this.content.add(packet);
    this.animate = (t) => {
      stations.forEach((m, i) => {
        m.material.emissive.set("#18a9a8");
        m.material.emissiveIntensity = i === this.pipelinePhase ? 0.5 : 0;
      });
      packet.position.set((this.pipelinePhase - 2) * 1.45, -0.7, 0.6);
    };
    this.request();
  };
  LabScene.prototype.setWorkQueue = function ({
    workUnits = 32,
    serialPercent = 25,
    processors = 4,
  } = {}) {
    if (this.failed) return;
    this.clear();
    const serial = Math.round((workUnits * serialPercent) / 100),
      parallel = workUnits - serial,
      lanes = Math.min(processors, 8),
      tiles = [];
    const columns = Math.max(1, Math.ceil(parallel / lanes)),
      spacing = Math.min(0.32, 5 / columns);
    for (let i = 0; i < workUnits; i++) {
      const isSerial = i < serial,
        k = isSerial ? i : i - serial,
        col = isSerial ? k % 16 : Math.floor(k / lanes),
        row = isSerial ? Math.floor(k / 16) : k % lanes,
        m = box(
          Math.min(0.22, spacing * 0.8),
          0.15,
          0.22,
          isSerial ? "#f59e0b" : "#18a9a8",
        );
      m.position.set(
        -2.5 + col * (isSerial ? 0.32 : spacing),
        -0.05,
        isSerial ? -1.2 - row * 0.3 : -0.45 + row * 0.3,
      );
      this.content.add(m);
      tiles.push(m);
    }
    this.content.add(label(`${serial} SERIAL TASKS`, 0, 0.8, -1.2, 0.2));
    this.content.add(
      label(
        `${parallel} INDEPENDENT TASKS · ${processors} WORKERS`,
        0,
        0.65,
        1.8,
        0.2,
      ),
    );
    this.animate = (t) =>
      tiles.forEach((m, i) => {
        const start =
            i < serial ? i : serial + Math.floor((i - serial) / processors),
          phase = t % (serial + Math.ceil(parallel / processors) + 2);
        m.material.emissive.set(i < serial ? "#f59e0b" : "#18a9a8");
        m.material.emissiveIntensity =
          phase >= start && phase < start + 1 ? 0.5 : 0;
      });
    if (!this.userCamera) this.phi = 0.7;
    this.request();
  };
  LabScene.prototype.setFamily = function (family) {
    if (this.failed) return;
    this.clear();
    let g;
    if (family === "beam") g = new T.BoxGeometry(5, 0.24, 0.24);
    else if (family === "shell") g = new T.BoxGeometry(3.8, 0.12, 2.5, 5, 1, 4);
    else if (family === "tetra") g = new T.TetrahedronGeometry(1.8);
    else g = new T.BoxGeometry(2.5, 2.5, 2.5, 2, 2, 2);
    const m = new T.Mesh(
      g,
      material("#18a9a8", { transparent: true, opacity: 0.8 }),
    );
    this.content.add(m);
    this.content.add(
      new T.LineSegments(
        new T.WireframeGeometry(g),
        new T.LineBasicMaterial({ color: "#6366f1" }),
      ),
    );
    this.content.add(
      label(family.toUpperCase() + " IDEALIZATION", 0, 2, 0, 0.25),
    );
    if (!this.userCamera) this.phi = 0.9;
    this.request();
  };
  LabScene.prototype.setCurve = function (
    points,
    { samples = [], caption = "" } = {},
  ) {
    if (this.failed) return;
    this.clear();
    const max = Math.max(...points.map((p) => Math.abs(p[1])), 0.001),
      xmin = points[0][0],
      xmax = points.at(-1)[0],
      pos = (p) =>
        new T.Vector3(
          ((p[0] - xmin) / (xmax - xmin)) * 5 - 2.5,
          (p[1] / max) * 1.7 - 0.6,
          0,
        );
    this.content.add(
      new T.Line(
        new T.BufferGeometry().setFromPoints(points.map(pos)),
        new T.LineBasicMaterial({ color: "#18a9a8" }),
      ),
    );
    samples.forEach((p) => {
      const m = new T.Mesh(
        new T.SphereGeometry(0.07, 16, 12),
        material("#6366f1"),
      );
      m.position.copy(pos(p));
      this.content.add(m);
    });
    this.content.add(label(caption, 0, 1.9, 0, 0.22));
    this.request();
  };
  LabScene.prototype.setRace = function ({
    resolution = 128,
    frames = 1,
  } = {}) {
    if (this.failed) return;
    this.clear();
    this.raceProgress = { cpu: 1, gpu: 1 };
    const panels = [];
    for (const [i, name] of ["CPU", "GPU"].entries()) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = resolution;
      const ctx = cv.getContext("2d"),
        source = document.createElement("canvas");
      source.width = source.height = resolution;
      const sc = source.getContext("2d"),
        im = sc.createImageData(resolution, resolution);
      for (let y = 0; y < resolution; y++)
        for (let x = 0; x < resolution; x++) {
          const k = (y * resolution + x) * 4,
            r = Math.hypot(x / resolution - 0.5, y / resolution - 0.5),
            v =
              0.5 + 0.5 * Math.cos(r * 35 + Math.sin((x / resolution) * 9) * 2),
            c = color(v).convertLinearToSRGB();
          im.data[k] = Math.round(c.r * 255);
          im.data[k + 1] = Math.round(c.g * 255);
          im.data[k + 2] = Math.round(c.b * 255);
          im.data[k + 3] = 255;
        }
      sc.putImageData(im, 0, 0);
      const texture = new T.CanvasTexture(cv),
        m = new T.Mesh(
          new T.PlaneGeometry(2.65, 2.65),
          new T.MeshBasicMaterial({
            map: texture,
            side: T.DoubleSide,
            toneMapped: false,
          }),
        );
      texture.colorSpace = T.SRGBColorSpace;
      m.position.set(i ? 1.6 : -1.6, 0, 0.05);
      this.content.add(m);
      const frame = box(2.8, 2.8, 0.1, "#334155");
      frame.position.set(m.position.x, 0, -0.03);
      this.content.add(frame);
      this.content.add(label(name, m.position.x, 1.8, 0, 0.26));
      panels.push({ name: name.toLowerCase(), ctx, source, texture, last: -1 });
    }
    this.animate = () =>
      panels.forEach((p) => {
        const progress = this.raceProgress[p.name],
          f = progress === 1 ? 1 : (progress * frames) % 1,
          n = Math.floor(f * resolution ** 2),
          frame = Math.min(frames - 1, Math.floor(progress * frames)),
          key = frame * resolution ** 2 + n;
        const dark = document.documentElement.dataset.theme === "dark";
        if (key === p.last && dark === p.dark) return;
        p.last = key;
        p.dark = dark;
        p.ctx.fillStyle = dark ? "#0f172a" : "#f8fafc";
        p.ctx.fillRect(0, 0, resolution, resolution);
        p.ctx.save();
        p.ctx.translate(resolution / 2, resolution / 2);
        p.ctx.rotate((frame / Math.max(frames, 1)) * Math.PI * 2);
        p.ctx.drawImage(p.source, -resolution / 2, -resolution / 2);
        p.ctx.restore();
        p.ctx.fillStyle =
          document.documentElement.dataset.theme === "dark"
            ? "#1e293b"
            : "#e2e8f0";
        const row = Math.floor(n / resolution),
          col = n % resolution;
        p.ctx.fillRect(col, row, resolution - col, 1);
        p.ctx.fillRect(0, row + 1, resolution, resolution - row - 1);
        p.texture.needsUpdate = true;
      });
    if (!this.userCamera) {
      this.phi = 1.3;
      this.theta = 0.12;
    }
    this.request();
  };
})();
