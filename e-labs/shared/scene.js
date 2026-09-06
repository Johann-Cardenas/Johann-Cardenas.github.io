/* Shared, locally hosted Three.js visual laboratory. No network dependencies. */
(function () {
  "use strict";
  const T = window.THREE;
  const palette = [
    "#262b70",
    "#335fbd",
    "#189cab",
    "#72d4ae",
    "#eddf78",
    "#f6a45e",
    "#ec6265",
  ];
  function color(t) {
    const x = Math.max(0, Math.min(1, t)) * (palette.length - 1),
      i = Math.min(palette.length - 2, Math.floor(x));
    return new T.Color(palette[i]).lerp(new T.Color(palette[i + 1]), x - i);
  }
  function material(c, options = {}) {
    return new T.MeshStandardMaterial({
      color: c,
      roughness: 0.48,
      metalness: 0.25,
      ...options,
    });
  }
  function box(w, h, d, c) {
    return new T.Mesh(new T.BoxGeometry(w, h, d), material(c));
  }
  function label(text, x, y, z, size = 0.2, c = "#c8dbed") {
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 80;
    const ctx = cv.getContext("2d");
    ctx.font = "500 30px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = c;
    ctx.fillText(text, 256, 48);
    const texture = new T.CanvasTexture(cv),
      sprite = new T.Sprite(
        new T.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
        }),
      );
    sprite.position.set(x, y, z);
    sprite.scale.set(size * 12.8, size * 2, 1);
    return sprite;
  }
  function dispose(group) {
    group.traverse((o) => {
      o.geometry?.dispose();
      const mats = o.material
        ? Array.isArray(o.material)
          ? o.material
          : [o.material]
        : [];
      mats.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
    });
    group.clear();
  }
  class LabScene {
    constructor(host, { mini = false, onPick = () => {} } = {}) {
      this.host = host;
      this.mini = mini;
      this.onPick = onPick;
      this.time = 0;
      this.visible = true;
      this.playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.theta = 0.34;
      this.phi = 1.17;
      this.radius = mini ? 9 : 9.5;
      this.raf = 0;
      this.last = 0;
      this.scene = new T.Scene();
      this.scene.background = new T.Color("#0b1423");
      this.scene.fog = new T.Fog("#0b1423", 16, 35);
      this.camera = new T.PerspectiveCamera(38, 1, 0.1, 80);
      try {
        this.renderer = new T.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "low-power",
        });
      } catch (e) {
        host.insertAdjacentHTML(
          "beforeend",
          '<div class="webgl-fallback"><strong>3D view unavailable</strong><p>This browser could not create a WebGL context. The controls, calculations, charts, and lessons below remain available.</p></div>',
        );
        this.failed = true;
        return;
      }
      this.renderer.setPixelRatio(
        Math.min(devicePixelRatio || 1, mini ? 1.5 : 2),
      );
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.25;
      this.renderer.domElement.setAttribute(
        "aria-label",
        "Interactive 3D experiment. Drag to orbit, scroll to zoom. Use the view buttons for keyboard camera control.",
      );
      this.renderer.domElement.setAttribute("role", "img");
      host.appendChild(this.renderer.domElement);
      this.scene.add(new T.HemisphereLight("#c2e7ff", "#243249", 2.3));
      const key = new T.DirectionalLight("#e6efff", 3);
      key.position.set(-3, 6, 5);
      this.scene.add(key);
      const rim = new T.PointLight("#47dcca", 22, 18);
      rim.position.set(4, 2, -3);
      this.scene.add(rim);
      const grid = new T.GridHelper(28, 56, "#254354", "#15283a");
      grid.position.y = -2.2;
      grid.material.transparent = true;
      grid.material.opacity = 0.65;
      this.scene.add(grid);
      this.content = new T.Group();
      this.scene.add(this.content);
      this.pickables = [];
      this.ray = new T.Raycaster();
      this.resize = new ResizeObserver(() => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        if (!this.userCamera)
          this.radius = Math.max(
            this.mini ? 6.8 : 6.4,
            10.6 / this.camera.aspect,
          );
        this.request();
      });
      this.resize.observe(host);
      this.observer = new IntersectionObserver((entries) => {
        this.visible = entries[0].isIntersecting;
        this.last = 0;
        if (this.visible) this.request();
      });
      this.observer.observe(host);
      this.visibility = () => {
        this.last = 0;
        if (!document.hidden) this.request();
      };
      document.addEventListener("visibilitychange", this.visibility);
      this.motion = matchMedia("(prefers-reduced-motion: reduce)");
      this.motionHandler = () => {
        if (this.motion.matches) this.setPlaying(false);
      };
      this.motion.addEventListener("change", this.motionHandler);
      if (!mini) this.bind();
      this.request();
    }
    bind() {
      const cv = this.renderer.domElement;
      let down = null;
      cv.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        down = {
          x: e.clientX,
          y: e.clientY,
          startX: e.clientX,
          startY: e.clientY,
        };
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener("pointermove", (e) => {
        if (!down) return;
        this.userCamera = true;
        this.theta -= (e.clientX - down.x) * 0.007;
        this.phi = Math.max(
          0.25,
          Math.min(2.6, this.phi + (e.clientY - down.y) * 0.007),
        );
        down.x = e.clientX;
        down.y = e.clientY;
        this.request();
      });
      cv.addEventListener("pointerup", (e) => {
        if (
          down &&
          Math.hypot(e.clientX - down.startX, e.clientY - down.startY) < 5
        ) {
          const r = cv.getBoundingClientRect();
          this.ray.setFromCamera(
            new T.Vector2(
              ((e.clientX - r.left) / r.width) * 2 - 1,
              (-(e.clientY - r.top) / r.height) * 2 + 1,
            ),
            this.camera,
          );
          const hit = this.ray.intersectObjects(this.pickables, false)[0];
          if (hit) {
            const id =
              hit.object.userData.elementIds?.[hit.faceIndex] ??
              hit.object.userData.id ??
              0;
            if (this.kind === "fea") this.highlightElement?.(id);
            this.onPick(id);
          }
        }
        down = null;
      });
      cv.addEventListener("pointercancel", () => (down = null));
      cv.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          this.zoom(Math.exp(e.deltaY * 0.001));
        },
        { passive: false },
      );
    }
    zoom(f) {
      this.userCamera = true;
      this.radius = Math.max(4, Math.min(18, this.radius * f));
      this.request();
    }
    view(name) {
      const from = [this.theta, this.phi, this.radius];
      if (name === "front") {
        this.theta = 0;
        this.phi = Math.PI / 2;
      } else if (name === "top") {
        this.theta = 0;
        this.phi = 0.05;
      } else {
        this.userCamera = false;
        this.theta = 0.34;
        this.phi = 1.17;
        this.radius = Math.max(
          this.mini ? 6.8 : 6.4,
          10.6 / this.camera.aspect,
        );
      }
      if (!this.motion?.matches)
        this.cameraTween = {
          from,
          to: [this.theta, this.phi, this.radius],
          start: performance.now(),
        };
      this.request();
    }
    setPlaying(v) {
      this.playing = v;
      this.last = 0;
      this.request();
    }
    request() {
      if (this.failed || this.raf || !this.visible || document.hidden) return;
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
    frame(t) {
      this.raf = 0;
      if (!this.visible || document.hidden) return;
      const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0;
      this.last = t;
      if (this.playing) this.time += dt;
      if (this.cameraTween) {
        const a = this.cameraTween,
          k = Math.min(1, (t - a.start) / 450),
          ease = k * k * (3 - 2 * k),
          v = a.from.map((x, i) => x + (a.to[i] - x) * ease);
        [this.theta, this.phi, this.radius] = v;
        if (k === 1) this.cameraTween = null;
      }
      this.camera.position.set(
        this.radius * Math.sin(this.phi) * Math.sin(this.theta),
        this.radius * Math.cos(this.phi),
        this.radius * Math.sin(this.phi) * Math.cos(this.theta),
      );
      this.camera.lookAt(0, 0, 0);
      this.animate?.(this.time, dt);
      this.renderer.render(this.scene, this.camera);
      if (this.playing || this.cameraTween) this.request();
    }
    clear() {
      if (this.failed) return;
      dispose(this.content);
      this.pickables = [];
      this.animate = null;
    }
    setFE(
      result,
      {
        gain = 20,
        field = "vm",
        ghost = true,
        mesh = true,
        mode = "stress",
        frequency = 1,
        explode = 0,
      } = {},
    ) {
      if (this.failed) return;
      this.clear();
      this.kind = "fea";
      const r = result,
        scale = 0.05,
        positions = [],
        colors = [],
        refs = [],
        elementIds = [],
        edgePositions = [],
        edgeRefs = [];
      const value = (i) => {
        if (mode === "modal") {
          const x = r.elements[i].reduce(
              (s, n) => s + r.nodes[n][0] / 120 / r.elements[i].length,
              0,
            ),
            b =
              frequency === 1
                ? 1.875104
                : frequency === 2
                  ? 4.694091
                  : 7.854757,
            c = (Math.cosh(b) + Math.cos(b)) / (Math.sinh(b) + Math.sin(b));
          return (
            Math.abs(
              Math.cosh(b * x) -
                Math.cos(b * x) -
                c * (Math.sinh(b * x) - Math.sin(b * x)),
            ) / 2
          );
        }
        return field === "displacement"
          ? Math.max(
              ...r.elements[i].map((n) =>
                Math.hypot(r.u[n * 2], r.u[n * 2 + 1]),
              ),
            )
          : r.stresses[i][field];
      };
      const max =
          mode === "modal"
            ? 1
            : field === "displacement"
              ? r.maxDisplacement
              : Math.max(...r.stresses.map((s) => Math.abs(s[field]))),
        signed =
          mode !== "modal" &&
          (field === "sx" || field === "sy" || field === "tau");
      const centers = r.elements.map((e) =>
        e.reduce(
          (s, i) => [
            s[0] + r.nodes[i][0] / e.length,
            s[1] + r.nodes[i][1] / e.length,
          ],
          [0, 0],
        ),
      );
      const add = (id, z, ei) => {
        const p = r.nodes[id];
        positions.push((p[0] - 60) * scale, (p[1] - r.H / 2) * scale, z);
        refs.push([id, z, ei]);
        const c = color(
          signed
            ? 0.5 + (0.5 * value(ei)) / (max || 1)
            : value(ei) / (max || 1),
        );
        colors.push(c.r, c.g, c.b);
      };
      r.elements.forEach((e, ei) => {
        const tris =
          e.length === 3
            ? [[0, 1, 2]]
            : [
                [0, 1, 2],
                [0, 2, 3],
              ];
        for (const tr of tris) {
          tr.forEach((k) => add(e[k], 0.14, ei));
          elementIds.push(ei);
          [...tr].reverse().forEach((k) => add(e[k], -0.14, ei));
          elementIds.push(ei);
        }
        for (let k = 0; k < e.length; k++) {
          const a = e[k],
            b = e[(k + 1) % e.length];
          [a, b, b, a, b, a].forEach((id, j) =>
            add(id, [0.14, 0.14, -0.14, 0.14, -0.14, -0.14][j], ei),
          );
          elementIds.push(ei, ei);
          for (const z of [0.145, -0.145]) {
            for (const id of [a, b]) {
              const p = r.nodes[id];
              edgePositions.push(
                (p[0] - 60) * scale,
                (p[1] - r.H / 2) * scale,
                z,
              );
              edgeRefs.push([id, z, ei]);
            }
          }
        }
      });
      const geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const solid = new T.Mesh(
        geometry,
        material("#ffffff", {
          vertexColors: true,
          side: T.DoubleSide,
          metalness: 0.12,
          roughness: 0.62,
        }),
      );
      solid.userData.elementIds = elementIds;
      this.content.add(solid);
      this.pickables.push(solid);
      const eg = new T.BufferGeometry();
      eg.setAttribute(
        "position",
        new T.Float32BufferAttribute(edgePositions, 3),
      );
      const edges = new T.LineSegments(
        eg,
        new T.LineBasicMaterial({
          color: "#0e2233",
          transparent: true,
          opacity: 0.6,
        }),
      );
      edges.visible = mesh;
      this.content.add(edges);
      if (ghost) {
        const gg = eg.clone();
        this.content.add(
          new T.LineSegments(
            gg,
            new T.LineBasicMaterial({
              color: "#c8e6f2",
              transparent: true,
              opacity: 0.14,
            }),
          ),
        );
      }
      const clamp = box(0.16, r.H * scale + 0.35, 0.65, "#526c86");
      clamp.position.set(-3.12, 0, 0);
      this.content.add(clamp);
      for (let y = (-r.H * scale) / 2; y <= (r.H * scale) / 2; y += 0.25) {
        const bolt = new T.Mesh(
          new T.SphereGeometry(0.045, 8, 8),
          material("#a4bacd"),
        );
        bolt.position.set(-3.22, y, 0.34);
        this.content.add(bolt);
      }
      const tension = r.options.preset === "tension",
        ay = (r.options.preset === "bracket" ? -r.H / 2 + 12 : 0) * scale;
      const arrow = new T.ArrowHelper(
        new T.Vector3(tension ? 1 : 0, tension ? 0 : -1, 0),
        new T.Vector3(tension ? 3.05 : 3, ay + (tension ? 0 : 1.1), 0.25),
        0.9,
        "#f6a45e",
        0.22,
        0.13,
      );
      this.content.add(arrow);
      this.content.add(label("FIXED", -3.1, (-r.H * scale) / 2 - 0.4, 0, 0.15));
      if (mode !== "modal")
        this.content.add(
          label(
            `${r.options.load.toLocaleString()} N`,
            3,
            ay + 1.4,
            0.2,
            0.17,
            "#ffc690",
          ),
        );
      const update = (attr, list, factor) => {
        for (let k = 0; k < list.length; k++) {
          const [i, z, ei] = list[k],
            p = r.nodes[i];
          let dx = r.u[2 * i] * gain * factor,
            dy = r.u[2 * i + 1] * gain * factor;
          if (mode === "modal") {
            const x = p[0] / 120,
              beta =
                frequency === 1
                  ? 1.875104
                  : frequency === 2
                    ? 4.694091
                    : 7.854757,
              c =
                (Math.cosh(beta) + Math.cos(beta)) /
                (Math.sinh(beta) + Math.sin(beta));
            dy =
              (12 *
                (Math.cosh(beta * x) -
                  Math.cos(beta * x) -
                  c * (Math.sinh(beta * x) - Math.sin(beta * x))) *
                Math.sin(this.time * 2.2)) /
              2;
            dx = 0;
          }
          attr.setXYZ(
            k,
            (p[0] - 60 + dx + (centers[ei][0] - 60) * explode * 0.4) * scale,
            (p[1] - r.H / 2 + dy + (centers[ei][1] - r.H / 2) * explode * 0.8) *
              scale,
            z,
          );
        }
        attr.needsUpdate = true;
      };
      this.highlightElement = (i) => {
        const ca = geometry.attributes.color;
        for (let k = 0; k < refs.length; k++) {
          const ei = refs[k][2],
            c =
              ei === i
                ? new T.Color("#fff2b2")
                : color(
                    signed
                      ? 0.5 + (0.5 * value(ei)) / (max || 1)
                      : value(ei) / (max || 1),
                  );
          ca.setXYZ(k, c.r, c.g, c.b);
        }
        ca.needsUpdate = true;
        this.request();
      };
      this.animate = (t) => {
        const factor = this.playing ? 0.65 + 0.35 * Math.sin(t * 1.6) : 1;
        update(geometry.attributes.position, refs, factor);
        update(eg.attributes.position, edgeRefs, factor);
        if (mode !== "modal") {
          arrow.position.x =
            (tension ? 3.05 : 3) +
            (tension ? r.tip * gain * scale * factor : 0);
          arrow.position.y =
            ay +
            (tension ? 0 : 1.1) +
            (tension ? 0 : r.tip * gain * scale * factor);
        } else arrow.visible = false;
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
      };
      this.request();
    }
    setSurface(
      kind,
      { node = 0, warp = 0.4, xi = 0, eta = 0, hot = 100, cold = 20 } = {},
    ) {
      if (this.failed) return;
      this.clear();
      if (!this.userCamera) {
        this.phi = kind === "shape" ? 0.72 : 1.17;
        this.theta = kind === "shape" ? 0.45 : 0.34;
      }
      const n = 24,
        pos = [],
        cols = [],
        indices = [],
        values = [];
      const corners = [
        [-2, -1.5],
        [2, -1.5],
        [2 - warp * 2, 1.5 - warp * 1.2],
        [-2, 1.5],
      ];
      for (let j = 0; j <= n; j++)
        for (let i = 0; i <= n; i++) {
          const u = (i / n) * 2 - 1,
            v = (j / n) * 2 - 1,
            N = LabModels.shape(u, v);
          let x = u * 2,
            y = v * 1.5,
            z = 0,
            val = 0;
          if (kind === "shape") {
            val = N[node];
            z = y;
            y = val * 2 - 0.7;
          } else if (kind === "mapping") {
            x = N.reduce((s, a, k) => s + a * corners[k][0], 0);
            y = N.reduce((s, a, k) => s + a * corners[k][1], 0);
            val = LabModels.quadB(corners, u, v).det / 3;
            z = 0.05;
          } else {
            const temperature = hot + ((cold - hot) * (u + 1)) / 2;
            val =
              (temperature - Math.min(hot, cold)) / (Math.abs(hot - cold) || 1);
            z = 0.2 * Math.sin((Math.PI * i) / n) * Math.sin((Math.PI * j) / n);
          }
          const c =
            kind === "mapping" && val <= 0
              ? new T.Color("#f36c70")
              : color(val);
          pos.push(x, y, z);
          cols.push(c.r, c.g, c.b);
          values.push(val);
        }
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = j * (n + 1) + i;
          indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
        }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new T.Float32BufferAttribute(cols, 3));
      g.setIndex(indices);
      g.computeVertexNormals();
      const surface = new T.Mesh(
        g,
        material("#ffffff", { vertexColors: true, side: T.DoubleSide }),
      );
      this.content.add(surface);
      const wire = new T.LineSegments(
        new T.WireframeGeometry(g),
        new T.LineBasicMaterial({
          color: "#132538",
          transparent: true,
          opacity: 0.25,
        }),
      );
      this.content.add(wire);
      if (kind === "shape") {
        const N = LabModels.shape(xi, eta),
          p = new T.Mesh(
            new T.SphereGeometry(0.08, 16, 12),
            material("#ffffff", {
              emissive: "#79e5d6",
              emissiveIntensity: 0.7,
            }),
          );
        p.position.set(xi * 2, N[node] * 2 - 0.62, eta * 1.5);
        this.content.add(p);
        this.content.add(
          label(
            `N${node + 1} = ${N[node].toFixed(3)}`,
            xi * 2,
            N[node] * 2 - 0.3,
            eta * 1.5,
            0.2,
          ),
        );
        this.content.add(label("ξ = −1             ξ = +1", 0, -1, 1.7, 0.18));
        this.content.add(label("η = +1", -2.5, -0.7, 1.5, 0.18));
        this.content.add(label("N · basis value", -2.1, 1.65, -1.5, 0.18));
      }
      if (kind !== "shape")
        this.content.add(
          label(
            kind === "heat" ? `${hot} °C · prescribed temperature` : "η = +1",
            0,
            2,
            0,
            0.18,
          ),
        );
      if (kind !== "shape")
        this.content.add(
          label(
            kind === "heat"
              ? `${cold} °C at right edge`
              : "ξ = −1                    ξ = +1",
            0,
            -2,
            0,
            0.18,
          ),
        );
      if (kind === "mapping")
        corners.forEach((p, i) =>
          this.content.add(label(String(i + 1), p[0], p[1] + 0.2, 0.1, 0.2)),
        );
      this.animate = (t) => {
        if (kind === "heat") {
          surface.material.emissive.set("#144d59");
          surface.material.emissiveIntensity = 0.1 + 0.08 * Math.sin(t);
        }
      };
      this.request();
    }
    setInterpolation(n, p) {
      if (this.failed) return;
      this.clear();
      const data = LabModels.interpolateError(n, p);
      for (const [index, c] of [
        [1, "#69d9bc"],
        [2, "#f6a45e"],
      ]) {
        const points = data.points.map(
          (v) =>
            new T.Vector3(
              v[0] * 6 - 3,
              v[index] * 2 - 1,
              index === 1 ? 0.12 : 0,
            ),
        );
        this.content.add(
          new T.Line(
            new T.BufferGeometry().setFromPoints(points),
            new T.LineBasicMaterial({ color: c }),
          ),
        );
      }
      for (let e = 0; e <= n; e++) {
        const x = (e / n) * 6 - 3;
        this.content.add(
          new T.Line(
            new T.BufferGeometry().setFromPoints([
              new T.Vector3(x, -1.1, 0),
              new T.Vector3(x, 1.2, 0),
            ]),
            new T.LineBasicMaterial({
              color: "#355062",
              transparent: true,
              opacity: 0.5,
            }),
          ),
        );
      }
      for (let k = 0; k <= n * p; k++) {
        const x = k / (n * p),
          m = new T.Mesh(
            new T.SphereGeometry(0.055, 12, 10),
            material("#a7f1d6"),
          );
        m.position.set(x * 6 - 3, Math.sin(Math.PI * x) * 2 - 1, 0.12);
        this.content.add(m);
      }
      this.content.add(
        label(`${n} elements · polynomial order ${p}`, 0, 1.7, 0, 0.22),
      );
      this.content.add(
        label("INTERPOLANT   /   EXACT SINE FIELD", 0, -1.5, 0, 0.18),
      );
      this.request();
    }
    setCluster({
      processors = 16,
      parallel = 0.95,
      overhead = 0.01,
      weak = false,
      mode = "scaling",
      intensity = 8,
      phase = "idle",
      progress = 0,
    } = {}) {
      if (this.failed) return;
      this.clear();
      this.kind = "hpc";
      const nodes = [],
        packets = [];
      if (mode === "architecture") {
        for (const [name, nx, ny, ox, c] of [
          ["CPU · 8 teaching lanes", 4, 2, -2.1, "#f6a45e"],
          ["GPU · 96 teaching lanes", 12, 8, 1.7, "#54dcca"],
        ]) {
          const base = box(3.4, 0.14, 2.7, "#25364a");
          base.position.set(ox, -0.2, 0);
          this.content.add(base);
          for (let j = 0; j < ny; j++)
            for (let i = 0; i < nx; i++) {
              const chip = box((2.9 / nx) * 0.8, 0.15, (2.1 / ny) * 0.8, c);
              chip.position.set(
                ox + ((i - (nx - 1) / 2) * 2.9) / nx,
                0,
                ((j - (ny - 1) / 2) * 2.1) / ny,
              );
              chip.userData.id = nodes.length;
              this.content.add(chip);
              nodes.push(chip);
              this.pickables.push(chip);
            }
          this.content.add(label(name, ox, 0.8, 0, 0.2));
        }
        this.animate = (t) =>
          nodes.forEach((m, i) => {
            m.material.emissive.set(i < 8 ? "#fa9c51" : "#3ce0c5");
            m.material.emissiveIntensity =
              (Math.sin(t * (i < 8 ? 2 : 5) - i * 0.4) + 1) * 0.35;
          });
      } else if (mode === "memory") {
        const layers = [
          ["Registers", 0.8, "#f6b373"],
          ["L1 / L2 cache", 1.6, "#e7d57e"],
          ["Main memory", 2.5, "#57d7c8"],
          ["Storage", 3.6, "#688fda"],
        ];
        layers.forEach(([name, w, c], i) => {
          const m = box(w, 0.28, 1.3 + i * 0.25, c);
          m.position.set(-0.8, 1.1 - i * 0.7, 0);
          this.content.add(m);
          this.content.add(label(name, 2.05, 1.1 - i * 0.7, 0, 0.18));
          nodes.push(m);
        });
        this.animate = (t) =>
          nodes.forEach((m, i) => {
            m.material.emissive.set(m.material.color);
            m.material.emissiveIntensity = 0.12 + 0.15 * Math.sin(t * 2 - i);
          });
      } else {
        const count = 32,
          cols = 4,
          rows = 8;
        for (let c = 0; c < cols; c++) {
          const rack = box(1.14, 2.65, 0.95, "#1c3046");
          rack.position.set((c - 1.5) * 1.48, -0.06, 0);
          this.content.add(rack);
          const cap = box(1.18, 0.08, 1.01, "#657a90");
          cap.position.set(rack.position.x, 1.3, 0);
          this.content.add(cap);
          this.content.add(
            label(`RACK 0${c + 1}`, rack.position.x, 1.67, 0, 0.16),
          );
          for (let j = 0; j < rows; j++) {
            const idx = c * rows + j,
              active = idx < Math.min(processors, 32),
              m = box(0.96, 0.22, 0.86, active ? "#367b8c" : "#243c50");
            m.position.set(rack.position.x, 1.02 - j * 0.3, 0.07);
            m.userData.id = idx;
            this.content.add(m);
            nodes.push(m);
            this.pickables.push(m);
            const led = box(0.04, 0.035, 0.02, active ? "#6ff4c8" : "#48617a");
            led.position.set(m.position.x - 0.36, m.position.y, 0.512);
            this.content.add(led);
            const vent = new T.LineSegments(
              new T.EdgesGeometry(new T.BoxGeometry(0.68, 0.1, 0.02)),
              new T.LineBasicMaterial({
                color: active ? "#64c7ce" : "#3b526b",
              }),
            );
            vent.position.set(m.position.x + 0.03, m.position.y, 0.51);
            this.content.add(vent);
          }
        }
        const switchBox = box(5.6, 0.14, 0.55, "#476b84");
        switchBox.position.set(0, -1.52, 0.25);
        this.content.add(switchBox);
        const packetGeometry = new T.SphereGeometry(0.034, 6, 6),
          packetMaterial = material("#78ffe0", {
            emissive: "#45d8c0",
            emissiveIntensity: 2,
          });
        const inst = new T.InstancedMesh(packetGeometry, packetMaterial, 64),
          dummy = new T.Object3D();
        this.content.add(inst);
        for (let i = 0; i < 64; i++)
          packets.push({ from: i % 4, to: (i * 3 + 1) % 4, offset: i / 64 });
        this.content.add(
          label("HIGH-SPEED INTERCONNECT", 0, -1.95, 0.2, 0.18, "#79c9cd"),
        );
        const timing = LabModels.scaling({
          processors,
          parallel,
          overhead,
          weak,
          work: 1,
        });
        this.animate = (t) => {
          const phase = (t % 10) / 10,
            serialPhase = phase < timing.serial / timing.time,
            communicating =
              phase >= (timing.serial + timing.compute) / timing.time;
          if (mode === "scaling" || mode === "energy")
            this.onPhase?.(
              serialPhase
                ? "SERIAL WORK"
                : communicating
                  ? "COMMUNICATION"
                  : "PARALLEL WORK",
            );
          nodes.forEach((m, i) => {
            const active = i < Math.min(processors, count),
              busy = active && !communicating && (!serialPhase || i === 0),
              workflowIdle = mode === "workflow" && this.jobPhase !== "running";
            m.material.color.set(active ? "#367b8c" : "#243c50");
            m.material.emissive.set(serialPhase ? "#f6a45e" : "#44ccb8");
            m.material.emissiveIntensity =
              busy && !workflowIdle
                ? 0.15 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3 + i * 0.6))
                : 0.015;
          });
          packets.forEach((p, i) => {
            const a = (t * (mode === "network" ? 1.1 : 0.45) + p.offset) % 1,
              x = (p.from - 1.5) * 1.48 + (p.to - p.from) * 1.48 * a;
            dummy.position.set(x, -1.37 + Math.sin(a * Math.PI) * 0.15, 0.6);
            dummy.scale.setScalar(
              processors > 1 &&
                (mode === "network" || communicating) &&
                (mode !== "workflow" || this.jobPhase === "running")
                ? 1
                : 0,
            );
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
          });
          inst.instanceMatrix.needsUpdate = true;
        };
      }
      this.jobPhase = phase;
      this.request();
    }
    dispose() {
      if (this.failed) return;
      cancelAnimationFrame(this.raf);
      this.resize.disconnect();
      this.observer.disconnect();
      document.removeEventListener("visibilitychange", this.visibility);
      this.motion.removeEventListener("change", this.motionHandler);
      dispose(this.scene);
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
  window.LabScene = LabScene;
})();
