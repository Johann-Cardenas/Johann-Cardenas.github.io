(function () {
  "use strict";
  const M = FrontierModels, T = THREE, base = new URL(document.currentScript.src);
  let worker, sequence = 0, active = 0;
  const pending = new Map(), cache = new Map();
  function source(visual, resolution) {
    const key = `${visual}:${resolution}`;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (!worker) {
      worker = new Worker(new URL(`frontier-render-worker.js${base.search}`, base));
      worker.onmessage = ({data}) => {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        if (data.error) request.reject(new Error(data.error));
        else request.resolve(data.pixels);
      };
      worker.onerror = () => {
        pending.forEach(p => p.reject(new Error("Unable to prepare this visual. Please try again.")));
        pending.clear(); worker.terminate(); worker = null;
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      worker.postMessage({id, visual, resolution});
    }).then(pixels => {
      if (cache.size >= 6) cache.delete(cache.keys().next().value);
      cache.set(key, pixels); return pixels;
    });
  }
  const UI = window.FrontierUI = {
    hide() { active++; if (this.panel) this.panel.hidden = true; if (this.actions) this.actions.hidden = true; },
    show(scene, options) {
      this.scene = scene; this.options = options;
      if (!this.panel) {
        this.panel = document.createElement("section");
        this.panel.className = "render-studio";
        this.panel.setAttribute("aria-label", "Rendering controls and timing");
        this.panel.innerHTML = `<div class="render-actions"><label for="render-visual">Visual to render<select id="render-visual">${Object.entries(M.visuals).map(([key,name])=>`<option value="${key}">${name}</option>`).join("")}</select></label><button id="render-play" class="primary" type="button">▶ Play rendering</button></div><p id="render-message" role="status">Preparing visual…</p><div class="render-timings">${["cpu","gpu"].map(name=>`<div><strong>${name.toUpperCase()}</strong><span id="${name}-phase"></span><progress id="${name}-progress" max="1" value="0" aria-label="${name.toUpperCase()} render progress"></progress><output id="${name}-timing"></output></div>`).join("")}</div><p class="render-explanation">CPU fills scanlines; GPU fills many tiles together after launch / transfer. These are illustrative scheduling patterns. Timings use fixed synthetic pixel rates, not measured browser or hardware speed; changing the visual does not change the predicted workload.</p>`;
        document.querySelector(".stage-caption").after(this.panel);
        this.actions = this.panel.querySelector(".render-actions");
        document.getElementById("stage").before(this.actions);
        document.getElementById("render-visual").onchange = e => {
          LabGuide.api.state.visual = e.target.value; LabGuide.api.update();
        };
        document.getElementById("render-play").onclick = () => {
          if (this.error) { LabGuide.api.update(); return; }
          LabGuide.runRace(); this.sync(); this.scene.request();
        };
      }
      this.panel.hidden = false; this.actions.hidden = false; this.error = null;
      this.panel.querySelector(".render-explanation").textContent = "CPU fills scanlines; GPU fills many tiles together after launch / transfer. These are illustrative scheduling patterns. Timings use fixed synthetic pixel rates, not measured browser or hardware speed; changing the visual does not change the predicted workload." + (options.frames > 1 ? " Each frame rotates the same source image; the GPU pays launch / transfer overhead again for every frame." : "");
      document.getElementById("render-visual").value = options.visual;
      this.sync();
    },
    sync() {
      if (!this.panel || this.panel.hidden) return;
      const s = this.scene, running = !!window.LabGuide?.timer, preview = s.raceElapsed == null;
      const stages = M.renderStage(s.raceElapsed || 0, this.options);
      const button = document.getElementById("render-play");
      button.disabled = !!s.raceLoading;
      button.textContent = this.error ? "Retry visual" : s.raceLoading ? "Preparing visual…" : running ? "■ Cancel rendering" : preview ? "▶ Play rendering" : "↻ Replay rendering";
      document.getElementById("render-visual").disabled = running;
      const inspectorPlay = document.getElementById("run-race");
      if (inspectorPlay) inspectorPlay.disabled = !!s.raceLoading || !!this.error;
      const message = this.error || (s.raceLoading ? "Preparing visual…" : preview ? "Preview ready. Play to compare rendering time." : running ? "Rendering · use Pause or Playback speed to inspect the race." : stages.cpu.phase === "Complete" && stages.gpu.phase === "Complete" ? "Both renders complete. Compare the elapsed times below." : "Rendering cancelled. Replay to start again.");
      const status = document.getElementById("render-message");
      if (status.textContent !== message) status.textContent = message;
      for (const name of ["cpu", "gpu"]) {
        const v = stages[name];
        document.getElementById(`${name}-phase`).textContent = preview ? "Preview" : `${v.phase} · frame ${v.frame+1}/${this.options.frames}`;
        document.getElementById(`${name}-progress`).value = preview ? 0 : v.progress;
        document.getElementById(`${name}-timing`).textContent = `${LabGuide.api.format(v.time,2)} s elapsed / ${LabGuide.api.format(v.total,2)} s predicted`;
      }
    }
  };
  LabScene.prototype.setRace = function ({resolution=128,frames=1,launch=.12,visual="plasma"}={}) {
    const token = ++active, options = {resolution,frames,launch,visual};
    if (!this.failed) this.clear();
    this.raceElapsed = null; this.raceLoading = true;
    this.raceProgress = {cpu:1,gpu:1};
    UI.show(this, options);
    Promise.resolve().then(() => source(visual,resolution)).then(pixels => {
      if (token !== active) return;
      this.raceLoading = false;
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = sourceCanvas.height = resolution;
      sourceCanvas.getContext("2d").putImageData(new ImageData(pixels,resolution,resolution),0,0);
      if (this.failed) { UI.error = "3D rendering is unavailable in this browser. Predicted timing remains available."; UI.sync(); return; }
      const panels = ["cpu","gpu"].map((name,i)=> {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = resolution;
        const ctx = canvas.getContext("2d"), texture = new T.CanvasTexture(canvas);
        texture.colorSpace = T.SRGBColorSpace;
        texture.magFilter = T.NearestFilter;
        const mesh = new T.Mesh(new T.PlaneGeometry(2.65,2.65),new T.MeshBasicMaterial({map:texture,side:T.DoubleSide,toneMapped:false}));
        mesh.position.set(i ? 1.6 : -1.6,0,.05); this.content.add(mesh);
        const frame = LabVisuals.box(2.8,2.8,.1,"#334155"); frame.position.set(mesh.position.x,0,-.03); this.content.add(frame);
        this.content.add(LabVisuals.label(name.toUpperCase(),mesh.position.x,1.8,0,.26));
        return {name,ctx,texture,order:M.pixelOrder(resolution,!!i),image:ctx.createImageData(resolution,resolution),last:""};
      });
      const rotated = document.createElement("canvas"); rotated.width = rotated.height = resolution;
      const rc = rotated.getContext("2d",{willReadFrequently:true});
      this.animate = () => {
        const stages = M.renderStage(this.raceElapsed || 0,options);
        for(const p of panels) {
          const stage = stages[p.name], preview = this.raceElapsed == null;
          const n = preview ? resolution**2 : stage.pixels, frame = preview ? 0 : stage.frame;
          const key = `${n}:${frame}:${document.documentElement.dataset.theme}`;
          if (key === p.last) continue; p.last = key;
          rc.fillStyle = "#0f172a"; rc.fillRect(0,0,resolution,resolution);
          rc.save(); rc.translate(resolution/2,resolution/2); rc.rotate(frame/frames*Math.PI*2); rc.drawImage(sourceCanvas,-resolution/2,-resolution/2); rc.restore();
          const src = rc.getImageData(0,0,resolution,resolution).data, dst = p.image.data;
          const dark = document.documentElement.dataset.theme === "dark";
          for(let k=0;k<dst.length;k+=4) { dst[k]=dark?30:226; dst[k+1]=dark?41:232; dst[k+2]=dark?59:240; dst[k+3]=255; }
          for(let k=0;k<n;k++) {const j=p.order[k]*4;dst[j]=src[j];dst[j+1]=src[j+1];dst[j+2]=src[j+2];}
          p.ctx.putImageData(p.image,0,0); p.texture.needsUpdate = true;
        }
      };
      this.animate();
      if (!this.userCamera) { this.phi = Math.PI/2; this.theta = 0; }
      this.request(); UI.sync();
    }).catch(error => { if(token!==active)return; this.raceLoading=false; UI.error=error.message; UI.sync(); });
  };
})();
