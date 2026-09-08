(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const studio = {
    hide() {
      this.running = false;
      if (this.controls) this.controls.hidden = true;
      if (this.details) this.details.hidden = true;
    },
    change(key,value) {
      const input = document.querySelector(`#inspector [data-key="${key}"]`);
      if (!input) return;
      input.value = value;
      input.dispatchEvent(new Event(input.type === "range" ? "input" : "change",{bubbles:true}));
    },
    show(scene,result,options) {
      this.scene = scene; this.result = result; this.modal = options.mode === "modal";
      this.position = this.modal ? 0 : 1; this.running = false;
      if (!this.controls) {
        this.controls = document.createElement("section");
        this.controls.className = "finite-controls";
        this.controls.setAttribute("aria-label","Interactive model controls");
        this.controls.innerHTML = '<div id="finite-choices"></div><div class="finite-playback"><button id="finite-play" class="primary" type="button"></button><label for="finite-position"><span id="finite-position-label"></span><input id="finite-position" type="range" min="0" max="100" step="1"></label><output id="finite-position-value" for="finite-position"></output></div>';
        $("stage").before(this.controls);
        this.details = document.createElement("section");
        this.details.className = "finite-details";
        this.details.setAttribute("aria-label","Model interpretation and element values");
        this.details.innerHTML = '<p id="finite-explanation"></p><div id="finite-inspection"><label for="finite-element">Inspect element</label><select id="finite-element"></select><output id="finite-values" for="finite-element"></output></div><p id="finite-status" role="status"></p>';
        document.querySelector(".stage-caption").after(this.details);
        $("finite-play").onclick = () => {
          this.running = this.running && !this.scene.playing ? true : !this.running;
          if(this.running) {
            if(!this.modal && this.position >= 1) this.position = 0;
            this.scene.setPlaying(true);
          }
          this.sync(); this.scene.request();
        };
        $("finite-position").oninput = e => {
          this.running = false; this.position = +e.target.value/100;
          this.sync(); this.scene.request();
        };
        $("finite-element").onchange = e => this.inspect(+e.target.value);
      }
      this.controls.hidden = this.details.hidden = false;
      const keys = this.modal ? [["mode","Bending mode"]] : [["preset","Geometry & loading"],["field","Color field"]];
      $("finite-choices").replaceChildren();
      for(const [key,title] of keys) {
        const original = document.querySelector(`#inspector select[data-key="${key}"]`);
        if(!original) continue;
        const label = document.createElement("label"); label.textContent = title;
        const select = document.createElement("select"); select.id = `finite-${key}`;
        label.htmlFor = select.id;
        select.innerHTML = original.innerHTML; select.value = original.value;
        select.onchange = e => this.change(key,e.target.value);
        label.append(select); $("finite-choices").append(label);
      }
      $("finite-position-label").textContent = this.modal ? "Cycle position" : "Displayed deformation";
      $("finite-explanation").textContent = this.modal
        ? "Scrub a complete vibration cycle to compare positive and negative deflection. This is a normalized analytical mode, not a transient finite-element solution. Playback speed is illustrative; colors show absolute mode amplitude, not stress."
        : `Play the transition from the undeformed mesh to the solved shape, or scrub to compare them. Deformation is exaggerated ${options.gain ?? 20}×. This is a visual interpolation, not a time-dependent solve: colors and element values always show the full applied-load solution.`;
      $("finite-inspection").hidden = this.modal;
      if(!this.modal) {
        $("finite-element").innerHTML = result.elements.map((_,i)=>`<option value="${i}">Element ${i+1}</option>`).join("");
        this.inspect(0,false);
      }
      this.sync();
    },
    inspect(index,highlight=true) {
      if(this.modal || this.controls.hidden) return;
      index = Math.max(0,Math.min(this.result.elements.length-1,index));
      $("finite-element").value = index;
      const stress = this.result.stresses[index], f = LabApp.format;
      $("finite-values").textContent = `σₓ ${f(stress.sx,2)} · σᵧ ${f(stress.sy,2)} · τₓᵧ ${f(stress.tau,2)} MPa · von Mises ${f(stress.vm,2)} MPa · ${this.result.elements[index].length} nodes`;
      if(highlight) {
        this.scene.highlightElement?.(index);
        const inspector = $("element-select");
        if(inspector && +inspector.value !== index) {
          inspector.value = index;
          inspector.dispatchEvent(new Event("change",{bubbles:true}));
        }
      }
    },
    sync() {
      const percent = Math.round(this.position*100);
      this.scene.feDisplayFactor = this.modal ? 1 : this.position;
      this.scene.feModalPhase = this.modal ? this.position*Math.PI*2 : undefined;
      $("finite-position").value = percent;
      $("finite-position-value").textContent = this.modal ? `${Math.round(this.position*360)}°` : `${percent}%`;
      $("finite-position").setAttribute("aria-valuetext",this.modal ? `${Math.round(this.position*360)} degrees of the cycle` : `${percent} percent of displayed deformation`);
      $("finite-play").textContent = this.running && this.scene.playing ? "❚❚ Pause animation" : this.modal ? "▶ Play mode" : this.position >= 1 ? "▶ Replay deformation" : "▶ Play deformation";
      const message = this.running && this.scene.playing ? "Animation playing. Use the slider to inspect a specific position." : this.modal ? "Mode held at the selected cycle position." : this.position === 1 ? "Full solved shape displayed." : "Deformation held at the selected position.";
      if($("finite-status").textContent!==message) $("finite-status").textContent = message;
    }
  };
  const clear = LabScene.prototype.clear, setFE = LabScene.prototype.setFE;
  LabScene.prototype.clear = function () {
    studio.hide(); this.feDisplayFactor = this.feModalPhase = undefined;
    return clear.call(this);
  };
  LabScene.prototype.setFE = function (result,options={}) {
    setFE.call(this,result,options);
    if(this.failed) return;
    studio.show(this,result,options);
    const animate = this.animate;
    this.animate = (time,dt=0) => {
      if(studio.running && this.playing) {
        studio.position += dt*this.playbackRate/3;
        if(studio.position>=1) {
          if(studio.modal) studio.position %= 1;
          else { studio.position=1; studio.running=false; }
        }
        studio.sync();
      }
      animate(time,dt);
    };
    if(!this.finitePickInstalled) {
      const pick = this.onPick;
      this.onPick = index => { pick(index); if(!studio.controls.hidden) studio.inspect(index); };
      this.finitePickInstalled = true;
    }
    if(!this.finitePlaybackInstalled) {
      const changed = this.onPlaybackChange;
      this.onPlaybackChange = () => { changed?.(); if(studio.controls && !studio.controls.hidden) studio.sync(); };
      this.finitePlaybackInstalled = true;
    }
    this.animate(this.time,0); this.request();
  };
})();
