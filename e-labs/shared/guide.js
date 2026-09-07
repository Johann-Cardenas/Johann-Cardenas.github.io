(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    C = window.CourseModels;
  const steps = ["Understand", "Experiment", "Explain", "Check"];
  const G = (window.LabGuide = {
    step: 0,
    timer: null,
    current: null,
    init(api) {
      this.api = api;
      document.querySelector(".skip").onclick = e => {
        e.preventDefault();
        const target = this.overviewVisible ? $("course-overview") : $("main");
        target.focus();
        target.scrollIntoView({ block: "start" });
      };
      $("chart").tabIndex = 0;
      $("chart").setAttribute("role", "region");
      $("chart").setAttribute("aria-label", "Chart; scroll horizontally if needed");
      const chartHint = document.createElement("p");
      chartHint.className = "chart-scroll-hint";
      chartHint.textContent = "Scroll the chart horizontally to see the full axes →";
      chartHint.hidden = true;
      $("chart").after(chartHint);
      new ResizeObserver(() => {
        chartHint.hidden = $("chart").scrollWidth <= $("chart").clientWidth + 1;
      }).observe($("chart"));
      this.initialOverview = !api.lessons.some(l => "#" + l.id === location.hash);
      this.activity = {};
      this.storageAvailable = true;
      try {
        const saved = JSON.parse(localStorage.getItem("elabs-activity-" + api.kind) || "{}");
        for (const l of api.lessons) {
          const item = saved?.[l.id];
          if (item && Number.isInteger(item.step) && item.step >= 0 && item.step < 4 && Number.isInteger(item.visited) && item.visited > 0 && item.visited < 16)
            this.activity[l.id] = { step: item.step, visited: item.visited };
        }
      } catch { this.storageAvailable = false; }
      const reading = document.createElement("button");
      reading.className = "reading-toggle";
      reading.textContent = "Larger text";
      const setReading = large => {
        document.documentElement.dataset.readingSize = large ? "large" : "standard";
        reading.setAttribute("aria-pressed", String(large));
      };
      try { setReading(localStorage.getItem("elabs-reading-size") === "large"); } catch { setReading(false); }
      reading.onclick = () => {
        const large = reading.getAttribute("aria-pressed") !== "true";
        setReading(large);
        try { localStorage.setItem("elabs-reading-size", large ? "large" : "standard"); } catch {}
        api.scene.request();
      };
      document.querySelector(".top-links").append(reading);
      this.selectedCourse = null;
      const journey = document.querySelector(".journey");
      journey.classList.add("course-sidebar");
      const home = document.createElement("button");
      home.className = "overview-link";
      home.textContent = "← Course overview";
      home.onclick = () => { location.hash = "overview"; };
      journey.prepend(home);
      const open = document.createElement("button");
      open.id = "open-library";
      open.textContent = "Course overview";
      open.onclick = home.onclick;
      document.querySelector(".top-links").prepend(open);
      const overview = document.createElement("main");
      overview.id = "course-overview";
      overview.hidden = true;
      overview.innerHTML = `<header class="overview-heading"><span class="eyebrow">Interactive learning path</span><h1 tabindex="-1">${api.kind === "fea" ? "Finite-Elemented" : "Frontier"}</h1><p>Build your understanding, one experiment at a time. Explore any module or follow the sequence below.</p><div class="overview-actions"><button id="resume-course" class="primary"></button><a id="next-unfinished"></a></div><div id="overview-stats" class="overview-stats"></div><progress id="overall-progress" value="0" max="${api.lessons.length}" aria-label="Completed lesson checks"></progress><p id="overview-progress" role="status"></p></header><nav id="course-picker" aria-label="Choose a module"></nav><div class="course-search"><label for="lesson-search">Find a lesson or concept</label><input id="lesson-search" type="search" placeholder="Search titles, concepts, and experiments…"><div class="progress-filter"><label for="progress-filter">Show lessons</label><select id="progress-filter"><option value="all">All lessons</option><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="completed">Completed</option></select></div><p id="search-status" role="status"></p><button id="clear-course-filters" hidden>Show all lessons</button></div><div id="course-grid"></div>`;
      document.querySelector(".workspace").before(overview);
      $("resume-course").onclick = () => { this.resume = { lesson: api.lesson.id, step: this.step }; location.hash = api.lesson.id; };
      $("lesson-search").oninput = () => this.renderOverview();
      $("progress-filter").onchange = () => this.renderOverview();
      $("clear-course-filters").onclick = () => {
        this.selectedCourse = null;
        $("lesson-search").value = "";
        $("progress-filter").value = "all";
        this.renderOverview();
        $("lesson-search").focus();
      };
      const picker = $("course-picker");
      for (const course of [{ index: null, title: "All modules" }, ...LabCourses[api.kind]]) {
        const button = document.createElement("button");
        button.dataset.course = course.index === null ? "all" : course.index;
        button.innerHTML = `<strong>${course.index === null ? "" : "0" + (course.index + 1) + " · "}${course.title}</strong><span></span>`;
        button.onclick = () => { this.selectedCourse = course.index; this.renderOverview(); };
        picker.append(button);
      }
      window.addEventListener("hashchange", () => this.showOverview(!api.lessons.some(l => "#" + l.id === location.hash), true));
      const progress = document.createElement("section");
      progress.className = "learning-progress";
      progress.setAttribute("aria-label", "Learning progress");
      progress.innerHTML = '<a href="#overview">← Overview</a><strong id="lesson-state"></strong><span id="step-progress"></span><progress id="lesson-course-progress" max="' + api.lessons.length + '" value="0" aria-label="Completed lesson checks"></progress><span id="lesson-course-count"></span>';
      document.querySelector(".heading").before(progress);
      const stepper = document.createElement("nav");
      stepper.className = "stepper";
      stepper.setAttribute("aria-label", "Lesson steps");
      stepper.innerHTML = steps
        .map(
          (s, i) =>
            `<button data-step="${i}"><span>${i + 1}</span>${s}</button>`,
        )
        .join("");
      document.querySelector(".heading").after(stepper);
      stepper
        .querySelectorAll("button")
        .forEach(
          (b) => (b.onclick = () => this.setStep(+b.dataset.step, true)),
        );
      const panel = document.createElement("div");
      panel.className = "lesson-panel";
      panel.innerHTML =
        '<section id="understand" class="step-panel"><span class="eyebrow">Start here</span><h2 id="intro-title">The idea</h2><p id="intro-copy" class="intro-copy"></p><dl id="key-terms"></dl><div class="learning-goal"><span class="eyebrow">Your experiment</span><p id="learning-goal"></p></div></section>';
      const inspector = $("inspector"),
        article = document.querySelector(".below article"),
        evidence = document.querySelector(
          '[aria-label="Quantitative evidence"]',
        ),
        check = document.querySelector(".challenge");
      inspector.classList.add("step-panel");
      const explain = document.createElement("section");
      explain.id = "explain";
      explain.className = "step-panel";
      explain.append(article, evidence, document.querySelector(".details"));
      const example = document.createElement("details");
      example.className = "worked-example";
      example.innerHTML = '<summary>Worked example & reflection</summary><p id="example-copy"></p>';
      explain.append(example);
      check.id = "check";
      check.classList.add("step-panel");
      const review = document.createElement("button");
      review.id = "revisit-experiment";
      review.textContent = "Revisit the experiment";
      review.onclick = () => this.setStep(1, true);
      const milestone = document.createElement("section");
      milestone.id = "check-milestone";
      milestone.setAttribute("aria-label", "Module progress");
      milestone.innerHTML = '<h3 id="milestone-title"></h3><p id="milestone-copy"></p><a id="module-next"></a><button id="review-module">Review this module</button>';
      check.append(review, milestone);
      milestone.querySelector("#review-module").onclick = () => {
        this.selectedCourse = api.lesson.course;
        $("lesson-search").value = "";
        $("progress-filter").value = "all";
        location.hash = "overview";
      };
      panel.append(inspector, explain, check);
      document.querySelector(".experiment").append(panel);
      document.querySelector(".lesson-bottom").prepend($("save"));
      const previous = document.createElement("button");
      previous.id = "previous-step";
      previous.textContent = "← Previous";
      $("next").before(previous);
      previous.onclick = () => {
        if (this.step > 0) this.setStep(this.step - 1, true);
        else if (api.lesson.index > 0) {
          const prior = api.lessons[api.lesson.index - 1];
          this.resume = { lesson: prior.id, step: 3 };
          api.go(prior.id);
        }
      };
      $("next").onclick = () => {
        if (this.step < 3) this.setStep(this.step + 1, true);
        else if (api.lesson.index < api.lessons.length - 1)
          api.go(api.lessons[api.lesson.index + 1].id);
        else location.hash = "overview";
      };
      try {
        const saved = JSON.parse(
          localStorage.getItem("elabs-course-" + api.kind) || "null",
        );
        if (saved && (this.initialOverview || location.hash === "#" + saved.lesson)) {
          const l = api.lessons.find((l) => l.id === saved.lesson);
          if (l) {
            api.lesson = l;
            this.resume = Number.isInteger(saved.step) && saved.step >= 0 && saved.step < 4 ? saved : null;
            if (this.resume && saved.step > 0 && !this.activity[l.id]) {
              this.activity[l.id] = { step: saved.step, visited: 1 << saved.step };
            }
            if (!this.initialOverview) history.replaceState(null, "", "#" + l.id);
          }
        }
      } catch { this.storageAvailable = false; }
      const syncTheme = () => {
        const b = document.querySelector(".theme-toggle");
        if (b) {
          document.querySelector(".top-links").append(b);
          b.textContent =
            document.documentElement.dataset.theme === "dark"
              ? "☀ Light"
              : "☾ Dark";
        }
      };
      syncTheme();
      document.addEventListener("DOMContentLoaded", syncTheme);
      new MutationObserver(syncTheme).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      window.addEventListener("pagehide", () => this.cancel());
    },
    showOverview(show, focus = false) {
      this.overviewVisible = show;
      $("course-overview").hidden = !show;
      document.querySelector(".workspace").hidden = show;
      document.querySelector(".skip").href = show ? "#course-overview" : "#main";
      document.querySelector(".skip").textContent = show ? "Skip to course overview" : "Skip to lesson";
      $("course-overview").tabIndex = -1;
      if (show) this.renderOverview();
      else { this.recordActivity(); this.api.scene.request(); }
      if (focus) {
        const heading = show ? $("course-overview").querySelector("h1") : $("title");
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        window.scrollTo(0, 0);
      }
    },
    renderOverview() {
      const a = this.api, query = $("lesson-search").value.trim().toLowerCase();
      const count = a.lessons.filter(l => a.completed[l.id]).length;
      const active = a.lessons.filter(l => this.status(l.id) === "in-progress").length;
      $("resume-course").textContent = `${this.activity[a.lesson.id] || count ? "Resume" : "Start learning"}: ${a.lesson.nav} →`;
      $("overview-stats").innerHTML = `<div><strong>${count}</strong><span>Completed</span></div><div><strong>${active}</strong><span>In progress</span></div><div><strong>${a.lessons.length - count - active}</strong><span>Not started</span></div>`;
      $("overall-progress").value = count;
      $("overview-progress").textContent = `${Math.round(count / a.lessons.length * 100)}% complete · ${count} of ${a.lessons.length} checks passed. ${this.storageAvailable ? "Progress saves in this browser." : "Progress lasts for this session only; browser storage is unavailable."}`;
      const next = a.lessons.find(l => !a.completed[l.id]);
      $("next-unfinished").hidden = !next || next.id === a.lesson.id;
      if (next) { $("next-unfinished").href = "#" + next.id; $("next-unfinished").textContent = "Next unfinished: " + next.nav + " →"; }
      const filter = $("progress-filter").value;
      const filtering = query || filter !== "all" || this.selectedCourse !== null;
      $("clear-course-filters").hidden = !filtering;
      document.querySelectorAll("[data-course]").forEach(button => {
        const index = button.dataset.course === "all" ? null : +button.dataset.course;
        button.setAttribute("aria-pressed", String(index === this.selectedCourse));
        const ids = index === null ? a.lessons.map(l => l.id) : LabCourses[a.kind][index].ids;
        button.querySelector("span").textContent = `${ids.filter(id => a.completed[id]).length}/${ids.length} completed`;
      });
      const grid = $("course-grid");
      grid.replaceChildren();
      let matches = 0;
      for (const course of LabCourses[a.kind]) {
        if (this.selectedCourse !== null && this.selectedCourse !== course.index) continue;
        const lessons = a.lessons.filter(l => course.ids.includes(l.id) && (filter === "all" || this.status(l.id) === filter) && (!query || [course.title, l.nav, l.intro, l.takeaway, ...l.terms.flat()].join(" ").toLowerCase().includes(query)));
        if (!lessons.length) continue;
        matches += lessons.length;
        const card = document.createElement("section");
        card.className = "course-card";
        const completed = course.ids.filter(id => a.completed[id]).length;
        const started = course.ids.filter(id => this.status(id) === "in-progress").length;
        card.innerHTML = `<span class="eyebrow">Module 0${course.index + 1} · ${course.ids.length} lessons</span><h2>${course.title}</h2><p>${course.outcome}</p><p class="module-prerequisite">${course.index ? "Suggested preparation: " + LabCourses[a.kind][course.index - 1].title : "Start here · No prior experience required"}</p><progress value="${completed}" max="${course.ids.length}" aria-label="${course.title} completion"></progress><small>${completed}/${course.ids.length} checks completed · ${started} in progress</small>`;
        for (const l of lessons) {
          const link = document.createElement("a");
          link.className = "lesson-link";
          link.href = "#" + l.id;
          link.dataset.status = this.status(l.id);
          link.innerHTML = `<span class="lesson-state">${String(l.index + 1).padStart(2, "0")} · ${this.statusLabel(l.id)}${this.status(l.id) === "in-progress" ? " · " + [0, 1, 2, 3].filter(i => this.activity[l.id].visited & (1 << i)).length + "/4 steps visited" : ""}</span><strong>${l.nav} <span aria-hidden="true">↗</span></strong><span>${l.intro}</span><small>Try it: ${l.takeaway}</small>`;
          card.append(link);
        }
        grid.append(card);
      }
      $("search-status").textContent = filtering ? `${matches} matching lessons${matches ? "" : ". Try another progress filter or clear the search."}` : `${a.lessons.length} lessons across four modules · Select any lesson to begin`;
    },
    status(id) {
      return this.api.completed[id] ? "completed" : this.activity[id] ? "in-progress" : "not-started";
    },
    statusLabel(id) {
      return { "completed": "✓ Completed", "in-progress": "In progress", "not-started": "Not started" }[this.status(id)];
    },
    recordActivity() {
      if (this.initialOverview || this.overviewVisible) return;
      const id = this.api.lesson.id;
      this.activity[id] = { step: this.step, visited: (this.activity[id]?.visited || 0) | (1 << this.step) };
      try {
        localStorage.setItem("elabs-activity-" + this.api.kind, JSON.stringify(this.activity));
        localStorage.setItem("elabs-course-" + this.api.kind, JSON.stringify({ lesson: id, step: this.step }));
      } catch { this.storageAvailable = false; }
      this.renderProgress();
    },
    renderProgress() {
      if (!$("lesson-state")) return;
      const a = this.api, id = a.lesson.id, visited = this.activity[id]?.visited || 0;
      const count = a.lessons.filter(l => a.completed[l.id]).length;
      $("lesson-state").textContent = this.statusLabel(id);
      $("step-progress").textContent = `${[0, 1, 2, 3].filter(i => visited & (1 << i)).length}/4 steps visited · Complete the check to finish`;
      if (a.completed[id]) $("step-progress").textContent = "Check passed · Revisit any step";
      $("lesson-course-progress").value = count;
      $("lesson-course-count").textContent = `${count}/${a.lessons.length} lessons complete`;
      document.querySelectorAll("[data-step]").forEach((b, i) => {
        const seen = !!(visited & (1 << i));
        b.classList.toggle("visited", seen);
        b.setAttribute("aria-label", `${steps[i]}${seen ? ", visited" : ""}`);
        let mark = b.querySelector(".step-visited");
        if (!mark) { mark = document.createElement("small"); mark.className = "step-visited"; mark.setAttribute("aria-hidden", "true"); b.append(mark); }
        mark.textContent = seen ? "✓" : "";
      });
      document.querySelectorAll("[data-module]").forEach(b => {
        let label = b.querySelector(".nav-state");
        if (!label) { label = document.createElement("small"); label.className = "nav-state"; b.lastElementChild.append(label); }
        label.textContent = this.statusLabel(b.dataset.module);
      });
      $("progress-label").textContent = `${count} of ${a.lessons.length} lessons complete`;
      this.renderMilestone();
      this.renderStepActions();
    },
    renderMilestone() {
      if (!$("check-milestone")) return;
      const a = this.api, course = LabCourses[a.kind][a.lesson.course];
      const completed = course.ids.filter(id => a.completed[id]).length;
      const done = completed === course.ids.length;
      $("check-milestone").hidden = !a.completed[a.lesson.id];
      $("milestone-title").textContent = done ? "Module complete" : "Lesson complete";
      $("milestone-copy").textContent = `${course.title}: ${completed} of ${course.ids.length} checks passed. ${done ? "You can revisit the lessons or continue your learning path." : "Continue with another lesson in this module."}`;
      const next = (done ? a.lessons : a.lessons.filter(l => course.ids.includes(l.id))).find(l => !a.completed[l.id]);
      $("module-next").hidden = !next;
      if (next) { $("module-next").href = "#" + next.id; $("module-next").textContent = "Continue: " + next.nav + " →"; }
      if (a.lessons.every(l => a.completed[l.id])) {
        $("milestone-title").textContent = "Learning path complete";
        $("milestone-copy").textContent = "You have passed every lesson check. Revisit an experiment with different settings and explain how the result changes.";
      }
    },
    renderStepActions() {
      $("previous-step").disabled = this.step === 0 && this.api.lesson.index === 0;
      $("previous-step").textContent = this.step === 0 && this.api.lesson.index > 0 ? "← Previous lesson" : "← Previous step";
      $("next").textContent = this.step < 3 ? `${steps[this.step + 1]} →`
        : this.api.lesson.index === this.api.lessons.length - 1 ? "Review courses →"
        : this.api.completed[this.api.lesson.id] ? "Next lesson →" : "Continue without completing →";
    },
    prepare(l) {
      this.cancel();
      this.visualKey = null;
      this.current = l.id;
      Object.assign(this.api.state, this.api.defaults, l.defaults);
      this.step =
        this.resume?.lesson === l.id
          ? Math.min(3, Math.max(0, this.resume.step || 0))
          : this.activity[l.id]?.step || 0;
      this.resume = null;
    },
    renderNavigation() {
      if (!this.api) return;
      const nav = $("modules");
      const buttons = [...nav.querySelectorAll("[data-module]")];
      for (const course of LabCourses[this.api.kind]) {
        const d = document.createElement("details");
        d.open = course.index === this.api.lesson.course;
        const count = course.ids.filter((id) => this.api.completed[id]).length;
        d.innerHTML = `<summary><span>0${course.index + 1} · ${course.title}</span><small>${count}/${course.ids.length}</small></summary>`;
        for (const id of course.ids) {
          const b = buttons.find((b) => b.dataset.module === id);
          if (b) {
            d.append(b);
            b.addEventListener("click", () => {
              this.showOverview(false);
              if (id === this.api.lesson.id) this.setStep(this.step);
            });
          }
        }
        nav.append(d);
      }
      this.renderProgress();
    },
    onLesson() {
      const l = this.api.lesson;
      $("lesson-eyebrow").textContent =
        `Course ${l.course + 1} · ${l.courseTitle}`;
      $("intro-copy").textContent = l.intro;
      const examples = this.api.kind === "fea" ? [
        "For a uniform bar with E = 70,000 N/mm², A = 144 mm², L = 120 mm, and end force P = 1,000 N, u(L) = PL/(EA) ≈ 0.01190 mm. Set distributed load to zero in the bar lesson to compare. Reflect: why does doubling E halve displacement?",
        "The integral of ξ⁴ from −1 to 1 is 2/5 = 0.4. Two-point Gauss quadrature gives 2/9 ≈ 0.2222; three points recover 0.4. Reflect: why can an accurately solved system still have integration error?",
        "For Ku = f, the residual r = f − Ku measures how well the discrete equations are solved. Tightening tolerance on a fixed mesh does not improve its approximation space. Reflect: if displacement still changes under mesh refinement, should you improve the mesh or keep tightening solver tolerance?",
        "A 1,000 N axial force requires a summed axial support reaction of −1,000 N when no other axial loads act. Balance is necessary but cannot prove local stress accuracy. Reflect: why can a displacement stabilize while peak stress near an idealized corner keeps increasing?"
      ] : [
        "Four nodes with eight cores and 64 GB each provide 32 cores and 256 GB in aggregate. A serial process cannot automatically pool that memory. Reflect: would another identical node make a serial 100 GB job fit?",
        "Eight cores for 30 minutes cost 4 allocated core-hours. Sixteen cores for 20 minutes cost about 5.33 core-hours. The second run finishes sooner but costs more under this illustrative accounting rule. Reflect: how would a deadline change your choice?",
        "With 10% serial work, Amdahl’s model gives S(8) = 1/(0.1 + 0.9/8) ≈ 4.71 and efficiency ≈ 58.8%. The theoretical speedup ceiling is 10 before communication overhead. Reflect: near that ceiling, should you add workers or reduce serial work?",
        "At the lab’s synthetic rates, a 128 × 128 image takes 2 s on the CPU and 0.125 s on the GPU before overhead. Adding 0.2 s launch/transfer gives 0.325 s and about 6.15× speedup. Reflect: what happens when the image shrinks but overhead stays fixed?"
      ];
      $("example-copy").textContent = examples[l.course];
      $("learning-goal").textContent = l.takeaway;
      const terms = l.terms || [];
      $("key-terms").replaceChildren();
      for (const [term, definition] of terms.slice(0, 2)) {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = term;
        dd.textContent = definition;
        $("key-terms").append(dt, dd);
      }
      this.setStep(this.step);
      this.showOverview(this.initialOverview || !this.api.lessons.some(l => "#" + l.id === location.hash));
      this.initialOverview = false;
      if (this.hasRendered && !this.overviewVisible) {
        window.scrollTo({ top: 0, behavior: "auto" });
        $("title").tabIndex = -1;
        $("title").focus({ preventScroll: true });
      }
      this.hasRendered = true;
    },
    setStep(n, focus = false) {
      this.step = n;
      ["understand", "inspector", "explain", "check"].forEach(
        (id, i) => ($(id).hidden = i !== n),
      );
      document.querySelectorAll("[data-step]").forEach((b, i) => {
        b.classList.toggle("active", i === n);
        if (i === n) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      });
      this.renderStepActions();
      document.querySelector(".lesson-bottom small").textContent =
        `Step ${n + 1} of 4 · ${this.api.lesson.nav}`;
      this.recordActivity();
      if (focus) {
        const p = $(["understand", "inspector", "explain", "check"][n]);
        p.tabIndex = -1;
        p.focus({ preventScroll: true });
        p.scrollIntoView({ block: "start", behavior: "auto" });
      }
      this.api.scene.request();
    },
    controls(l, s, { range: r, select: q, check: k }) {
      switch (l.id) {
        case "fea-intro":
          return r("density", "Mesh density", 1, 8, 1);
        case "materials":
          return (
            r("E", "Young’s modulus", 10000, 210000, 10000, " MPa") +
            r("load", "Axial force", 100, 5000, 100, " N")
          );
        case "axial-bar":
        case "weak-form":
          return (
            r("segments", "Bar elements", 1, 12, 1) +
            r("distributed", "Distributed load", 0, 30, 1, " N/mm")
          );
        case "element-library":
          return q("family", "Element geometry", [
            ["beam", "Beam · 1D"],
            ["shell", "Shell · thin surface"],
            ["tetra", "Tetrahedron · 3D"],
            ["hex", "Hexahedron · 3D"],
          ]);
        case "quadrature":
          return (
            r("gaussPoints", "Gauss points", 1, 4, 1) +
            r("degree", "Polynomial degree", 0, 6, 1)
          );
        case "hpc-intro":
        case "hardware":
        case "memory-models":
          return (
            r("nodes", "Compute nodes", 1, 8, 1) +
            r("coresPerNode", "Cores per node", 2, 16, 2)
          );
        case "rightsizing":
          return (
            '<div class="task-card"><span id="task-count" class="eyebrow"></span><h3 id="task-name"></h3><p id="task-needs"></p></div>' +
            q("resourceChoice", "Choose a machine", [
              ["laptop", "Laptop"],
              ["workstation", "Workstation"],
              ["cluster", "Cluster"],
            ]) +
            '<div class="action-row"><button id="match-task" class="primary">Check choice</button><button id="next-task">Next task →</button></div><p id="task-feedback" role="status"></p><details><summary>Need a hint?</summary><p id="task-hint"></p></details>'
          );
        case "allocations":
        case "workflow":
        case "accounting":
          return (
            q("problem", "Problem size", [
              [1, "Small · 8 GB"],
              [2, "Medium · 48 GB"],
              [3, "Large · 192 GB"],
            ]) +
            r("processors", "Allocated CPU cores", 1, 32, 1) +
            r("memoryGB", "Requested RAM", 4, 256, 4, " GB") +
            r("walltime", "Walltime limit", 1, 120, 1, " min") +
            (l.id === "workflow"
              ? '<button id="run-pipeline" class="primary">Submit simulated job</button>'
              : "")
          );
        case "storage":
          return (
            r("dataGB", "Output size", 1, 100, 1, " GB") +
            r("ioBandwidth", "Storage bandwidth", 0.1, 10, 0.1, " GB/s")
          );
        case "parallel-work":
          return (
            r("workUnits", "Work units", 8, 48, 4) +
            r("processors", "Workers", 1, 8, 1) +
            r("serialPercent", "Serial work", 0, 75, 5, "%")
          );
        case "strong-weak":
          return (
            r("processors", "Workers", 1, 64, 1) +
            r("parallel", "Parallel fraction", 50, 99, 1, "%") +
            k("weak", "Weak scaling: grow parallel work with workers")
          );
        case "render-race":
        case "animation-batch":
          return (
            q("resolution", "Image resolution", [
              [32, "32 × 32"],
              [64, "64 × 64"],
              [128, "128 × 128"],
              [256, "256 × 256"],
            ]) +
            (l.id === "animation-batch"
              ? r("frames", "Frame count", 1, 60, 1) +
                r("fps", "Playback frame rate", 12, 60, 12, " fps")
              : "") +
            r("launch", "GPU launch / transfer per frame", 0, 1, 0.02, " s") +
            '<button id="run-race" class="primary">Run rendering race</button>'
          );
      }
    },
    onControls() {
      const id = this.api.lesson.id,
        primary = {
          foundations: ["preset", "load"],
          mesh: ["preset", "density"],
          elements: ["type", "density"],
          assembly: ["density", "explode"],
          stress: ["load", "field"],
          abaqus: ["type", "density"],
          convergence: ["type", "density"],
          conditioning: ["density"],
          integration: ["type", "density"],
          workflow: ["problem", "processors", "memoryGB"],
          allocations: ["problem", "processors", "memoryGB"],
          accounting: ["problem", "processors"],
          "render-race": ["resolution"],
          "animation-batch": ["resolution", "frames"],
        };
      const controls = [...$("inspector").querySelectorAll(".control")],
        keys =
          primary[id] ||
          controls
            .slice(0, 3)
            .map((c) => c.querySelector("[data-key]")?.dataset.key);
      const extra = controls.filter(
        (c) => !keys.includes(c.querySelector("[data-key]")?.dataset.key),
      );
      if (extra.length) {
        const d = document.createElement("details");
        d.className = "advanced-settings";
        d.innerHTML = "<summary>More settings</summary>";
        extra[0].before(d);
        extra.forEach((c) => d.append(c));
      }
      const p = document.createElement("p");
      p.className = "experiment-prompt";
      p.textContent = this.api.lesson.takeaway;
      document.querySelector(".inspector-head").after(p);
      if ($("match-task"))
        $("match-task").onclick = () => {
          const m = C.matchTask(
            this.api.state.task,
            this.api.state.resourceChoice,
          );
          $("task-feedback").textContent =
            (m.correct
              ? "Good fit. "
              : m.fits
                ? "It fits, but reserves more hardware than needed. "
                : "This configuration is too small. ") + m.task.why;
        };
      if ($("next-task"))
        $("next-task").onclick = () => {
          this.api.state.task = (this.api.state.task + 1) % C.tasks.length;
          this.api.update();
        };
      if ($("run-pipeline")) $("run-pipeline").onclick = () => this.runJob();
      if ($("run-race")) $("run-race").onclick = () => this.runRace();
    },
    update() {
      const a = this.api,
        s = a.state,
        id = a.lesson.id,
        scene = a.scene,
        f = a.format;
      const show = (title, caption, items) => {
        a.evidence(title, caption, "Teaching model");
        a.metrics(items);
        $("stage-name").textContent = a.lesson.nav;
        $("live-pill").textContent = "VISUAL MODEL";
        $("legend").textContent = "";
        $("scene-note").textContent = "Drag to explore";
        $("result-status").textContent = "Ready to explore.";
      };
      if (["hpc-intro", "hardware", "memory-models"].includes(id)) {
        scene.setHardware(s);
        show(
          "Inside the cluster",
          "Each illustrated node has 64 GB of local RAM. A serial process cannot automatically pool it across nodes.",
          [
            ["Nodes", s.nodes],
            ["Total cores", s.nodes * s.coresPerNode],
            ["RAM per node", 64, "GB"],
          ],
        );
        a.bars(
          [
            ["Per node", 64],
            ["All nodes", s.nodes * 64],
          ],
          { unit: "GB" },
        );
        return true;
      }
      if (id === "rightsizing") {
        const t = C.tasks[s.task],
          r = C.resources[s.resourceChoice];
        scene.setHardware({ resource: s.resourceChoice });
        show(
          "Capacity for this task",
          "Illustrative configurations and workload requirements; cluster capacities are aggregate and require distributed software.",
          [
            ["CPU cores", r.cores],
            ["RAM", r.ram, "GB"],
            ["GPU memory", r.vram, "GB"],
          ],
        );
        $("task-count").textContent = `Task ${s.task + 1} of ${C.tasks.length}`;
        $("task-name").textContent = t.name;
        $("task-needs").textContent =
          `Needs ${t.cores} cores · ${t.ram} GB RAM · ${t.vram} GB GPU memory`;
        $("task-hint").textContent = t.why;
        $("task-feedback").textContent = "";
        a.bars(
          [
            ["CPU fit", Math.min(100, (r.cores / t.cores) * 100)],
            ["RAM fit", Math.min(100, (r.ram / t.ram) * 100)],
            ["GPU fit", t.vram ? Math.min(100, (r.vram / t.vram) * 100) : 100],
          ],
          { unit: "%" },
        );
        return true;
      }
      if (["axial-bar", "weak-form"].includes(id)) {
        const b = C.axialBar(s);
        scene.setCurve(
          b.points.map((p) => [p[0], p[1]]),
          {
            samples: b.u.map((u, i) => [(i * 120) / s.segments, u]),
            caption: "LINEAR BAR · SHARED NODAL DISPLACEMENTS",
          },
        );
        show(
          "Exact field and finite-element interpolation",
          "Uniform bar: E = 70,000 MPa, A = 144 mm², L = 120 mm; fixed left end, 1,000 N right-end force plus distributed axial load. Error is sampled between nodes.",
          [
            ["Elements", s.segments],
            ["Tip displacement", f(b.tip, 5), "mm"],
            ["Maximum error", f(b.error, 6), "mm"],
          ],
        );
        a.chart(
          [
            {
              points: b.points.map((p) => [p[0], p[2]]),
              name: "Exact",
              color: "#6366f1",
            },
            {
              points: b.points.map((p) => [p[0], p[1]]),
              name: "Finite elements",
            },
          ],
          {
            xLabel: "Position (mm)",
            yLabel: "Displacement (mm)",
            yMax: b.tip * 1.1,
          },
        );
        return true;
      }
      if (id === "quadrature") {
        const b = C.quadrature({ points: s.gaussPoints, degree: s.degree }),
          points = Array.from({ length: 81 }, (_, i) => {
            const x = -1 + i / 40;
            return [x, x ** s.degree];
          });
        scene.setCurve(points, {
          samples: b.x.map((x) => [x, x ** s.degree]),
          caption: `GAUSS QUADRATURE · ${s.gaussPoints} WEIGHTED SAMPLES`,
        });
        show(
          "Weighted samples versus exact integral",
          "Integrating ξⁿ on [−1, 1]. The three-dimensional curve shows sample locations; weights are listed below.",
          [
            ["Estimate", f(b.estimate, 5)],
            ["Exact", f(b.exact, 5)],
            ["Absolute error", f(b.error, 5)],
          ],
        );
        a.bars([
          ["Estimate", b.estimate],
          ["Exact", b.exact],
        ]);
        $("probe").textContent = b.x
          .map((x, i) => `ξ ${f(x, 3)} · weight ${f(b.w[i], 3)}`)
          .join(" | ");
        return true;
      }
      if (id === "element-library") {
        scene.setFamily(s.family);
        show(
          "Choose by geometry and physics",
          "These are geometric teaching models. The structural solver elsewhere uses plane-stress T3 and Q4 elements only.",
          [
            ["Geometry", s.family],
            [
              "Dimension",
              s.family === "beam"
                ? "1D"
                : s.family === "shell"
                  ? "Surface"
                  : "3D",
            ],
            ["Purpose", "Idealization"],
          ],
        );
        $("chart").textContent =
          "Beams model slender members; shells model thin surfaces; solids resolve volume behavior.";
        return true;
      }
      if (["allocations", "workflow", "accounting"].includes(id)) {
        const j = C.job(s);
        if (id === "workflow") {
          if (this.visualKey !== id) {
            scene.setPipeline();
            this.visualKey = id;
          }
        } else scene.setHardware({ nodes: 1, coresPerNode: s.processors });
        show(
          "Resource request and predicted use",
          "One node; illustrative fixed-work runtime and queue model. One SU is one allocated core-hour. Actual centers use their own accounting and scheduling policies.",
          [
            ["Runtime", f(j.time, 1), "min"],
            ["Required RAM", j.required, "GB"],
            [
              "Allocated cost",
              j.fits ? f(j.serviceUnits, 2) : "Cannot run",
              "SU",
            ],
          ],
        );
        a.bars(
          [
            ["Requested RAM", s.memoryGB],
            ["Required RAM", j.required],
          ],
          { unit: "GB" },
        );
        $("result-status").textContent = !j.fits
          ? "Insufficient RAM: the job cannot run."
          : j.time > s.walltime
            ? "Walltime is too short for the predicted runtime."
            : "The request fits the modeled workload.";
        if (id === "workflow" && this.timer)
          $("result-status").textContent = "Simulation in progress…";
        return true;
      }
      if (id === "storage") {
        scene.setHardware({ nodes: 2 });
        show(
          "Sequential file transfer",
          "Constant sustained bandwidth, decimal GB; excludes caching, metadata, and computation overlap.",
          [
            ["Data", s.dataGB, "GB"],
            ["Bandwidth", s.ioBandwidth, "GB/s"],
            ["Transfer time", f(s.dataGB / s.ioBandwidth, 1), "s"],
          ],
        );
        a.bars([["Transfer", s.dataGB / s.ioBandwidth]], { unit: "s" });
        return true;
      }
      if (id === "parallel-work") {
        scene.setWorkQueue(s);
        const serial = Math.round((s.workUnits * s.serialPercent) / 100),
          time = serial + Math.ceil((s.workUnits - serial) / s.processors),
          speed = s.workUnits / time;
        show(
          "Serial tasks, parallel batches",
          "Each tile takes one time unit. Serial tasks run first; remaining tasks fill worker lanes in batches. No communication cost is included.",
          [
            ["Elapsed", time, "units"],
            ["Speedup", f(speed), "×"],
            ["Efficiency", f((100 * speed) / s.processors, 1), "%"],
          ],
        );
        a.bars(
          [
            ["One worker", s.workUnits],
            ["Allocation", time],
          ],
          { unit: "units" },
        );
        return true;
      }
      if (id === "strong-weak") {
        const opts = {
            processors: s.processors,
            parallel: s.parallel / 100,
            overhead: 0,
            weak: s.weak,
            work: 100,
          },
          v = LabModels.scaling(opts);
        scene.setCluster({
          processors: s.processors,
          parallel: s.parallel / 100,
        });
        show(
          "Workload size changes the comparison",
          "Strong scaling fixes total work. Weak scaling keeps parallel work per worker fixed; this model retains a fixed serial component.",
          [
            ["Workers", s.processors],
            ["Runtime", f(v.time, 2), "units"],
            ["Scaling", s.weak ? "Weak" : "Strong"],
          ],
        );
        a.chart(
          [
            {
              points: Array.from({ length: 64 }, (_, i) => [
                i + 1,
                LabModels.scaling({ ...opts, processors: i + 1 }).time,
              ]),
            },
          ],
          { xLabel: "Workers", yLabel: "Runtime" },
        );
        return true;
      }
      if (["render-race", "animation-batch"].includes(id)) {
        const v = C.renderCost({
          ...s,
          frames: id === "render-race" ? 1 : s.frames,
        });
        scene.setRace({
          resolution: s.resolution,
          frames: id === "render-race" ? 1 : s.frames,
        });
        show(
          "Same image, different processing models",
          "Synthetic rates: CPU 8,192 pixels/s; GPU 131,072 pixels/s plus per-frame launch/transfer. This is an illustrative model, not a measured hardware benchmark.",
          [
            ["CPU", f(v.cpu, 2), "s"],
            ["GPU", f(v.gpu, 2), "s"],
            [
              id === "animation-batch" ? "Clip duration" : "Speedup",
              id === "animation-batch"
                ? f(s.frames / s.fps, 2)
                : f(v.speedup, 2),
              id === "animation-batch" ? "s" : "×",
            ],
          ],
        );
        a.bars(
          [
            ["CPU", v.cpu],
            ["GPU", v.gpu],
          ],
          { unit: "s" },
        );
        return true;
      }
      return false;
    },
    exportResult() {
      const s = this.api.state;
      switch (this.api.lesson.id) {
        case "axial-bar":
        case "weak-form":
          return C.axialBar(s);
        case "quadrature":
          return C.quadrature({ points: s.gaussPoints, degree: s.degree });
        case "allocations":
        case "workflow":
        case "accounting":
          return C.job(s);
        case "rightsizing":
          return C.matchTask(s.task, s.resourceChoice);
        case "render-race":
        case "animation-batch":
          return C.renderCost({
            ...s,
            frames: this.api.lesson.id === "render-race" ? 1 : s.frames,
          });
        case "hardware":
        case "hpc-intro":
        case "memory-models":
          return {
            nodes: s.nodes,
            totalCores: s.nodes * s.coresPerNode,
            ramPerNodeGB: 64,
          };
        case "storage":
          return { transferSeconds: s.dataGB / s.ioBandwidth };
        case "element-library":
          return {
            family: s.family,
            scope: "Geometric idealization, not a finite-element solution",
          };
        case "parallel-work": {
          const serial = Math.round((s.workUnits * s.serialPercent) / 100);
          return {
            serial,
            parallel: s.workUnits - serial,
            time: serial + Math.ceil((s.workUnits - serial) / s.processors),
          };
        }
        case "strong-weak":
          return LabModels.scaling({
            processors: s.processors,
            parallel: s.parallel / 100,
            overhead: 0,
            weak: s.weak,
            work: 100,
          });
      }
    },
    cancel() {
      clearInterval(this.timer);
      this.timer = null;
      document
        .querySelectorAll("#inspector [data-key]")
        .forEach((e) => (e.disabled = false));
    },
    runJob() {
      if (this.timer) {
        this.cancel();
        $("result-status").textContent = "Job cancelled.";
        $("run-pipeline").textContent = "Submit simulated job";
        return;
      }
      const a = this.api,
        j = C.job(a.state);
      let elapsed = 0;
      const runtime = j.fits ? Math.min(j.time, j.walltime) : 0.4,
        finish = 1 + j.queue + runtime + 1;
      if (!a.scene.playing) $("play").click();
      $("run-pipeline").textContent = "Cancel simulated job";
      document
        .querySelectorAll("#inspector [data-key]")
        .forEach((e) => (e.disabled = true));
      this.timer = setInterval(() => {
        if (document.hidden || !a.scene.playing) return;
        elapsed += Math.max(0.1, finish / 80);
        const phase =
          elapsed < 0.5
            ? 0
            : elapsed < 0.5 + j.queue
              ? 1
              : elapsed < 1 + j.queue
                ? 2
                : elapsed < 1 + j.queue + runtime
                  ? 3
                  : 4;
        a.scene.pipelinePhase = phase;
        a.scene.request();
        const label = [
          "Submitting",
          "Queued",
          "Allocating",
          j.fits ? "Executing" : "Out of memory",
          !j.fits || j.time > j.walltime
            ? "Collecting diagnostics"
            : "Collecting results",
        ][phase];
        a.metrics([
          ["Job state", label],
          ["Elapsed model time", a.format(elapsed, 1), "min"],
          ["RAM use", a.format((j.required / j.memoryGB) * 100, 0), "%"],
        ]);
        $("result-status").textContent =
          `${label} · accelerated illustrative playback`;
        if (elapsed >= finish) {
          this.cancel();
          const outcome = !j.fits
            ? "Out of memory"
            : j.time > j.walltime
              ? "Time limit reached"
              : "Completed";
          $("result-status").textContent =
            outcome +
            " · " +
            (j.fits
              ? a.format((j.processors * runtime) / 60, 2) +
                " allocated core-hours."
              : "Request enough RAM and resubmit.");
          $("run-pipeline").textContent = "Submit simulated job";
          a.metrics([
            ["Job state", outcome],
            ["Runtime", a.format(runtime, 1), "min"],
            ["Core-hours", a.format((j.processors * runtime) / 60, 2)],
          ]);
        }
      }, 100);
    },
    runRace() {
      if (this.timer) {
        this.cancel();
        $("run-race").textContent = "Run rendering race";
        $("result-status").textContent = "Rendering cancelled.";
        return;
      }
      if (!this.api.scene.playing) document.getElementById("play").click();
      const a = this.api,
        s = a.state,
        v = C.renderCost({
          ...s,
          frames: a.lesson.id === "render-race" ? 1 : s.frames,
        }),
        duration = Math.max(v.cpu, v.gpu),
        rate = Math.max(1, duration / 8);
      let elapsed = 0;
      a.scene.raceProgress = { cpu: 0, gpu: 0 };
      $("run-race").textContent = "Cancel rendering";
      document
        .querySelectorAll("#inspector [data-key]")
        .forEach((e) => (e.disabled = true));
      this.timer = setInterval(() => {
        if (document.hidden || !a.scene.playing) return;
        elapsed += 0.05 * rate;
        a.scene.raceProgress = C.renderProgress(elapsed, {
          ...s,
          frames: a.lesson.id === "render-race" ? 1 : s.frames,
        });
        a.scene.request();
        $("result-status").textContent =
          `CPU ${Math.round(a.scene.raceProgress.cpu * 100)}% · GPU ${Math.round(a.scene.raceProgress.gpu * 100)}% · ${a.format(rate, 1)}× playback`;
        if (elapsed >= duration) {
          this.cancel();
          $("run-race").textContent = "Run rendering race";
          $("result-status").textContent =
            "Both renders complete. Compare predicted times in Explain.";
        }
      }, 50);
    },
  });
})();
