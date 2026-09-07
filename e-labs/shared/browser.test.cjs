/* The guided regression suite is the default; retain scene-only artifact modes. */
if (
  !process.argv.includes("--posters") &&
  !process.argv.includes("--shape-only")
) {
  require("./course.test.cjs");
  return;
}
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
    console.log("PASS: scene artifacts generated without browser errors.");
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
