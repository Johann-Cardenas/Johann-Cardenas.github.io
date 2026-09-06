// Rebuild the small static entry points. All experiments live in e-labs/shared.
import { writeFileSync, readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
for (const [slug, name, kind, description] of [
  [
    "finite-elemented",
    "Finite-Elemented",
    "fea",
    "Explore finite element analysis through 14 visual experiments: real plane-stress solutions, meshing, shape functions, convergence, vibration, and heat conduction.",
  ],
  [
    "frontier",
    "Frontier",
    "hpc",
    "Explore high-performance computing through 9 visual experiments: parallel scaling, job scheduling, CPU and GPU architectures, memory, roofline analysis, and energy.",
  ],
]) {
  writeFileSync(
    new URL(`e-labs/${slug}/index.html`, root),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#20352f">
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
  <link rel="stylesheet" href="../shared/lab.css">
  <script src="../../assets/js/three.min.js" defer></script>
  <script src="../shared/models.js" defer></script>
  <script src="../shared/scene.js" defer></script>
  <script src="../shared/curriculum.js" defer></script>
  <script src="../shared/app.js" defer></script>
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
  .replace('width="1200" height="628"', 'width="1310" height="790"');
writeFileSync(catalogURL, catalog);
