// Rebuild the small static entry points. All experiments live in e-labs/shared.
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
// Changed interactive assets receive new URLs on repeat visits.
const asset = (name) => {
  const names = name.startsWith("frontier-") && name.endsWith(".js") ? ["frontier-models.js", "frontier-scenes.js", "frontier-render-worker.js"] : [name];
  const hash = createHash("sha256").update(names.map(n => readFileSync(new URL(`e-labs/shared/${n}`, root))).join("\n")).digest("hex").slice(0, 12);
  return `../shared/${name}?v=${hash}`;
};
for (const [slug, name, kind, description] of [
  [
    "finite-elemented",
    "Finite-Elemented",
    "fea",
    "Learn finite element analysis step by step through four courses and 22 visual lessons, from forces and nodes to numerical integration, real solutions, and verification.",
  ],
  [
    "frontier",
    "Frontier",
    "hpc",
    "Learn high-performance computing step by step through four courses and 19 visual lessons, from computer fundamentals to resource sizing, job workflows, parallelism, and GPU rendering.",
  ],
]) {
  writeFileSync(
    new URL(`e-labs/${slug}/index.html`, root),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#ffffff">
  <script>try{document.documentElement.dataset.theme=localStorage.getItem('theme-preference')==='dark'?'dark':'light';}catch{document.documentElement.dataset.theme='light';}</script>
  <title>${name} · Interactive Learning Lab | E-Labs</title>
  <meta name="description" content="${description}">
  <meta name="author" content="Johann Cardenas">
  <link rel="canonical" href="https://www.johanncardenas.com/e-labs/${slug}/">
  <meta property="og:title" content="${name} · Interactive Learning Lab">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://www.johanncardenas.com/e-labs/${slug}/">
  <meta property="og:image" content="https://www.johanncardenas.com/images/e-labs/E-Labs_${name}.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="${asset("lab.css")}">
  <link rel="stylesheet" href="../shared/site-palette.css">
  <link rel="stylesheet" href="${asset("course.css")}">
  <script src="../../assets/js/theme-toggle.js" defer></script>
  <script src="../../assets/js/three.min.js" defer></script>
  <script src="../shared/models.js" defer></script>
  <script src="../shared/course-models.js" defer></script>
  <script src="${asset("scene.js")}" defer></script>
  <script src="../shared/scene-concepts.js" defer></script>
${kind === "hpc" ? `<link rel="stylesheet" href="${asset("frontier.css")}"><script src="${asset("frontier-models.js")}" defer></script><script src="${asset("frontier-scenes.js")}" defer></script>` : ""}
  <script src="../shared/curriculum.js" defer></script>
  <script src="../shared/courses.js" defer></script>
  <script src="${asset("guide.js")}" defer></script>
  <script src="${asset("app.js")}" defer></script>
</head>
<body data-lab="${kind}">
  <div id="app"></div>
  <noscript><main style="padding:3rem;max-width:50rem;margin:auto"><h1>${name}</h1><p>${description}</p><p>Enable JavaScript to use these interactive experiments. All numerical models execute in your browser.</p><a href="../../E-Labs.html">Return to E-Labs</a></main></noscript>
</body>
</html>
`,
  );
}
const catalogURL = new URL("E-Labs.html", root);
// Derive the labs' palette from the website rather than maintaining another palette.
const mainCSS = readFileSync(new URL("assets/css/main.css", root), "utf8");
const light = mainCSS.match(
  /:root, \[data-theme="light"\] \{([\s\S]*?)\n\}/,
)[1];
const dark = mainCSS.match(/^\[data-theme="dark"\] \{([\s\S]*?)^\}/m)[1];
const tokens = (block) =>
  Array.from(
    block.matchAll(
      /--(?:bg-page|bg-box|bg-box-alt|bg-input|bg-code|text-primary|text-secondary|text-muted|border-light|border-medium|accent-primary|accent-primary-hover):[^;]+;/g,
    ),
  )
    .map((m) => m[0])
    .join("\n  ");
writeFileSync(
  new URL("e-labs/shared/site-palette.css", root),
  `/* Generated from assets/css/main.css by scripts/build-learning-labs.mjs. */\n:root { --accent-primary: #18a9a8; --accent-primary-hover: #14908f; --accent-secondary: #6366f1; }\n:root, [data-theme="light"] {\n  ${tokens(light)}\n}\n[data-theme="dark"] {\n  ${tokens(dark)}\n}\n`,
);
let catalog = readFileSync(catalogURL, "utf8");
if (!catalog.includes("e-labs-lab-previews.js"))
  catalog = catalog.replace(
    '<script src="assets/js/e-labs-canvas.js" defer></script>',
    `<script src="assets/js/three.min.js" defer></script>
            <script src="e-labs/shared/models.js" defer></script>
            <script src="e-labs/shared/scene.js" defer></script>
            <script src="assets/js/e-labs-lab-previews.js" defer></script>
            <script src="assets/js/e-labs-canvas.js" defer></script>`,
  );
catalog = catalog
  .replace(
    /twelve modules spanning weak forms, meshing, isoparametric mapping,/,
    "fourteen visual experiments spanning weak forms, meshing, isoparametric mapping,",
  )
  .replace(
    /convergence, and solvers, capped by a live 2D plane-stress lab/,
    "convergence, dynamics, and heat, anchored by a real plane-stress solver",
  )
  .replace(
    '<span class="tag">12 Modules</span>',
    '<span class="tag">14 Visual Labs</span>',
  );
catalog = catalog
  .replace(
    "images/e-labs/E-Labs_Frontier.webp",
    "images/e-labs/E-Labs_Frontier.png",
  )
  .replace(
    /(src="images\/e-labs\/E-Labs_Frontier.png"[^>]*?)width="1200" height="628"/,
    '$1width="1310" height="790"',
  );
catalog = catalog
  .replace(
    "fourteen visual experiments spanning weak forms, meshing, isoparametric mapping,",
    "four guided courses and 22 lessons spanning forces, weak forms, meshing, integration,",
  )
  .replace(
    '<span class="tag">14 Visual Labs</span>',
    '<span class="tag">4 Guided Courses</span>',
  )
  .replace(
    "A hands-on, user-friendly High Performance Computing intuition engine.",
    "Learn high-performance computing one idea at a time across four guided courses.",
  )
  .replace(
    "Build understanding of processing power,  parallel computing concepts,",
    "Explore 19 lessons in computer fundamentals, resource sizing, parallel work,",
  )
  .replace(
    "job scheduling, and distributed systems through interactive simulations.",
    "job workflows, and CPU/GPU rendering through interactive 3D experiments.",
  );
writeFileSync(catalogURL, catalog);
