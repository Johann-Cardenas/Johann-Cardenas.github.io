/* Usage: node browser.test.cjs <path-to-playwright> [artifact-directory] */
const { chromium } = require(process.argv[2]);
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../.."),
  artifacts =
    process.argv[3] || path.join(require("node:os").tmpdir(), "elabs-review");
fs.mkdirSync(artifacts, { recursive: true });
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const server = http.createServer((req, res) => {
  let p;
  try {
    p = path.resolve(root, "." + decodeURIComponent(req.url.split("?")[0]));
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (p !== root && !p.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    if (fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
    const bytes = fs.readFileSync(p);
    res.writeHead(200, {
      "Content-Type": types[path.extname(p)] || "application/octet-stream",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  await page.addInitScript(() => {
    Object.defineProperty(window, "LabScene", {
      configurable: true,
      set(Base) {
        Object.defineProperty(window, "LabScene", {
          configurable: true,
          value: class extends Base {
            constructor(...args) {
              super(...args);
              window.inspectedScene = this;
            }
          },
        });
      },
    });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  async function set(key, value) {
    await page.locator("#c-" + key).evaluate((e, v) => {
      e.value = v;
      e.dispatchEvent(
        new Event(e.type === "range" ? "input" : "change", { bubbles: true }),
      );
    }, String(value));
    await page.waitForTimeout(200);
    await page.waitForFunction(
      () =>
        !document
          .getElementById("result-status")
          .textContent.includes("Assembling"),
    );
  }
  async function visit(tool, id) {
    await page.goto(`${url}/e-labs/${tool}/index.html${id ? "#" + id : ""}`);
    await page.waitForSelector("#stage canvas");
    await page.waitForFunction(
      () =>
        document.getElementById("result-status").textContent &&
        !document
          .getElementById("result-status")
          .textContent.includes("Assembling"),
    );
  }
  try {
    if (process.argv.includes("--shape-only")) {
      await visit("finite-elemented", "shape");
      await set("node", 2);
      await set("xi", 0.5);
      await page.locator("#play").click();
      await page.waitForFunction(
        () => inspectedScene.renderer.info.render.calls > 1,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(artifacts, "finite-elemented-shape.png"),
        fullPage: true,
      });
      assert.match(await page.locator("#metrics").innerText(), /0.375/);
      assert.deepEqual(errors, []);
      console.log(
        "PASS: shape-function surface, probe value, and browser rendering.",
      );
      return;
    }
    await visit("finite-elemented");
    await page.locator("#play").click();
    assert.ok(
      await page
        .locator("#stage")
        .evaluate((e) => e.clientHeight >= 300 && e.clientHeight <= 650),
      "3D viewport has a stable bounded height",
    );
    await page.screenshot({
      path: path.join(artifacts, "finite-elemented-desktop.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelector(".stage-caption").getBoundingClientRect()
            .bottom <
          document.querySelector(".stage-toolbar").getBoundingClientRect().top,
      ),
      "Legend stays inside viewport",
    );
    const feIds = await page
      .locator("[data-module]")
      .evaluateAll((es) => es.map((e) => e.dataset.module));
    for (const id of feIds) {
      await page.locator(`[data-module="${id}"]`).click();
      await page.waitForFunction(
        () =>
          document.getElementById("result-status").textContent &&
          !document
            .getElementById("result-status")
            .textContent.includes("Assembling"),
      );
      assert.ok(
        (await page.locator("#metrics").innerText()).length > 10,
        id + " metrics",
      );
      assert.equal(await page.locator("#answers button").count(), 3);
      console.log("FE lesson:", id);
    }
    await page.locator('[data-module="stress"]').click();
    await set("load", 2000);
    assert.match(await page.locator("#result-status").innerText(), /Solved/);
    await set("type", "T3");
    await set("preset", "bracket");
    await set("density", 8);
    assert.match(await page.locator("#result-status").innerText(), /Solved/);
    await page.screenshot({
      path: path.join(artifacts, "finite-elemented-bracket.png"),
      fullPage: true,
    });
    await page.locator("#element-select").selectOption("5");
    assert.match(await page.locator("#probe").innerText(), /von Mises/);
    await page.locator('[data-module="convergence"]').click();
    await page.locator("#run-study").click();
    await page.waitForFunction(
      () =>
        document.getElementById("chart-tag").textContent === "6 ACTUAL SOLVES",
      {},
      { timeout: 30000 },
    );
    assert.match(
      await page.locator("#chart-caption").innerText(),
      /All algebraic solves/,
    );
    await page.locator('[data-module="mapping"]').click();
    await set("warp", 1.6);
    assert.match(await page.locator("#metrics").innerText(), /Invalid/);
    await page.locator('[data-module="shape"]').click();
    await set("node", 2);
    await set("xi", 0.5);
    await page.screenshot({
      path: path.join(artifacts, "finite-elemented-shape.png"),
      fullPage: true,
    });
    await page.locator('[data-module="stress"]').click();
    await page.locator('[data-answer="1"]').click();
    assert.match(await page.locator("#feedback").innerText(), /Try again/);
    await page.locator('[data-answer="0"]').click();
    assert.match(await page.locator("#feedback").innerText(), /Correct/);
    await page.locator('[data-module="abaqus"]').click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-deck").click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "finite-elemented.inp");
    const deck = fs.readFileSync(await download.path(), "utf8");
    assert.match(deck, /\*Element, type=CPS3/);
    assert.match(deck, /\*End Step/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#mobile-module").selectOption("stress");
    await page.waitForTimeout(250);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "FE mobile overflow",
    );
    await page.screenshot({
      path: path.join(artifacts, "finite-elemented-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await visit("frontier");
    await page.locator("#play").click();
    await page.screenshot({
      path: path.join(artifacts, "frontier-desktop.png"),
      fullPage: true,
    });
    const hpcIds = await page
      .locator("[data-module]")
      .evaluateAll((es) => es.map((e) => e.dataset.module));
    for (const id of hpcIds) {
      await page.locator(`[data-module="${id}"]`).click();
      assert.ok((await page.locator("#metrics").innerText()).length > 10);
      console.log("HPC lesson:", id);
    }
    await page.locator('[data-module="scaling"]').click();
    await set("processors", 1);
    assert.match(await page.locator("#metrics").innerText(), /1.00/);
    await set("processors", 64);
    await set("parallel", 0);
    await set("overhead", 0);
    assert.match(await page.locator("#metrics").innerText(), /1.00/);
    await page.locator('[data-module="rightsizing"]').click();
    await set("workload", "large");
    await set("resource", "laptop");
    assert.match(await page.locator("#metrics").innerText(), /Does not fit/);
    await page.locator('[data-module="workflow"]').click();
    await set("walltime", 1);
    await page.locator("#submit-job").click();
    await page.waitForFunction(
      () =>
        document
          .getElementById("result-status")
          .textContent.includes("Time limit"),
      {},
      { timeout: 20000 },
    );
    await page.locator('[data-module="architecture"]').click();
    await page.screenshot({
      path: path.join(artifacts, "frontier-architecture.png"),
      fullPage: true,
    });
    await page.locator('[data-module="roofline"]').click();
    await set("intensity", 0.5);
    assert.match(await page.locator("#metrics").innerText(), /Memory/);
    await set("intensity", 64);
    assert.match(await page.locator("#metrics").innerText(), /Compute/);
    await page.locator('[data-module="scheduling"]').click();
    await set("policy", "fifo");
    assert.match(await page.locator("#metrics").innerText(), /13/);
    await set("policy", "backfill");
    assert.match(await page.locator("#metrics").innerText(), /10/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#mobile-module").selectOption("scaling");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "HPC mobile overflow",
    );
    await page.screenshot({
      path: path.join(artifacts, "frontier-mobile.png"),
      fullPage: true,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await visit("frontier");
    assert.equal(await page.locator("#play").innerText(), "Play motion");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url + "/E-Labs.html");
    await page
      .locator('[data-animation="finite-elemented"]')
      .scrollIntoViewIfNeeded();
    await page.waitForSelector(
      '[data-animation="finite-elemented"].lab-preview-ready',
    );
    await page.waitForSelector('[data-animation="frontier"].lab-preview-ready');
    await page.locator('[data-animation="finite-elemented"]').screenshot({
      path: path.join(artifacts, "finite-elemented-miniature.png"),
    });
    await page
      .locator('[data-animation="frontier"]')
      .screenshot({ path: path.join(artifacts, "frontier-miniature.png") });
    const fallback = await browser.newPage();
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/i.test(type) ? null : original.call(this, type, ...args);
      };
    });
    await fallback.goto(url + "/e-labs/finite-elemented/index.html");
    await fallback.waitForSelector(".webgl-fallback");
    await fallback.waitForFunction(() =>
      document.getElementById("result-status").textContent.startsWith("Solved"),
    );
    assert.ok(
      (await fallback.locator("#metrics").innerText()).includes("1.183"),
    );
    await fallback.close();
    if (process.argv.includes("--posters"))
      for (const [tool, title] of [
        ["finite-elemented", "Finite-Elemented"],
        ["frontier", "Frontier"],
      ]) {
        await page.setViewportSize({ width: 1310, height: 790 });
        await visit(tool);
        await page.evaluate((tool) => {
          document.getElementById("app").style.display = "none";
          document.body.insertAdjacentHTML(
            "beforeend",
            '<div id="poster" style="width:1310px;height:790px;position:relative"></div>',
          );
          const scene = new LabScene(document.getElementById("poster"), {
            mini: true,
          });
          scene.setPlaying(false);
          if (tool === "finite-elemented")
            scene.setFE(LabModels.solveFE({ density: 4 }), { gain: 20 });
          else {
            scene.time = 4;
            scene.setCluster({ processors: 24 });
          }
          window.posterScene = scene;
        }, tool);
        await page.waitForTimeout(250);
        await page.locator("#poster").screenshot({
          path: path.join(root, "images", "e-labs", `E-Labs_${title}.png`),
        });
      }
    assert.deepEqual(errors, [], "browser errors");
    console.log(
      "PASS: all 23 lessons, actual solver interactions, convergence, exports, quiz feedback, HPC edge cases, job timeout, mobile overflow, reduced motion, WebGL fallback, both miniature views.",
    );
    console.log("Screenshots:", artifacts);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
