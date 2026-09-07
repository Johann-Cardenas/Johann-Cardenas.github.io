/* Miniatures share the full labs' geometry and renderer; no duplicate visual model. */
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.LabScene || !window.THREE) return;
    const style = document.createElement("style");
    style.textContent = `.lab-preview{position:absolute;inset:0;z-index:1;pointer-events:none}.lab-preview canvas{display:block;width:100%;height:100%}.app-card.lab-preview-ready .app-card__banner,.app-card.lab-preview-ready .app-card__canvas,.app-card.lab-preview-ready .app-card__hover-text{display:none!important}.lab-preview-caption{position:absolute;z-index:2;bottom:14px;left:16px;right:16px;display:flex;justify-content:space-between;gap:8px;color:#c6e8e0;font:9px/1.4 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;pointer-events:none}.lab-preview-caption span:last-child{color:#829eb2}.app-card.lab-preview-ready .status-badge{z-index:3}`;
    document.head.appendChild(style);
    const scenes = [];
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const card = entry.target;
          observer.unobserve(card);
          const bg = card.querySelector(".app-card__animated-bg"),
            host = document.createElement("div");
          host.className = "lab-preview";
          host.setAttribute("aria-hidden", "true");
          bg.appendChild(host);
          const scene = new LabScene(host, { mini: true });
          if (scene.failed) {
            host.remove();
            return;
          }
          scene.setPlaying(false);
          scene.phi = 1.12;
          scene.theta = 0.32;
          if (card.dataset.animation === "finite-elemented") {
            const result = LabModels.solveFE({
              density: 3,
              type: "Q4",
              load: 1000,
            });
            scene.setFE(result, { gain: 20, ghost: true });
            scene.radius = 9.4;
          } else {
            scene.setCluster({ processors: 24, parallel: 0.95 });
            scene.radius = 9.1;
          }
          const caption = document.createElement("div");
          caption.className = "lab-preview-caption";
          caption.innerHTML =
            card.dataset.animation === "finite-elemented"
              ? "<span>Explore finite elements</span><span>4 guided courses</span>"
              : "<span>Explore computing</span><span>4 guided courses</span>";
          bg.appendChild(caption);
          caption.style.color = "var(--text-primary)";
          caption.style.background = "var(--bg-box)";
          caption.style.padding = "7px 9px";
          caption.style.borderRadius = "6px";
          caption.lastElementChild.style.color = "var(--text-secondary)";
          card.classList.add("lab-preview-ready");
          function motion() {
            scene.setPlaying(
              !matchMedia("(prefers-reduced-motion: reduce)").matches &&
                (card.matches(":hover") ||
                  card.contains(document.activeElement)),
            );
          }
          card.addEventListener("mouseenter", motion);
          card.addEventListener("mouseleave", motion);
          card.addEventListener("focusin", motion);
          card.addEventListener("focusout", () => setTimeout(motion, 0));
          scenes.push(scene);
        }),
      { rootMargin: "150px" },
    );
    document
      .querySelectorAll(
        '.app-card[data-animation="finite-elemented"],.app-card[data-animation="frontier"]',
      )
      .forEach((c) => observer.observe(c));
    window.addEventListener("pagehide", (e) => {
      if (e.persisted) return;
      observer.disconnect();
      scenes.forEach((s) => s.dispose());
    });
    window.addEventListener("pageshow", () =>
      scenes.forEach((s) => s.request()),
    );
  });
})();
