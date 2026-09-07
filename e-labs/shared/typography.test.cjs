const { chromium } = require(process.argv[2]);
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../.."),
  out = path.join(require("node:os").tmpdir(), "elabs-course-review");
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  let p = path.resolve(root, "." + decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    if (fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
    res.setHeader(
      "Content-Type",
      {
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".png": "image/png",
        ".json": "application/json",
      }[path.extname(p)] || "application/octet-stream",
    );
    res.end(fs.readFileSync(p));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port,
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    }),
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const visit = async (tool, id = "") => {
    await page.goto(`${url}/e-labs/${tool}/index.html${id ? "#" + id : ""}`);
    await page.waitForFunction(
      () => window.LabApp && document.getElementById("intro-copy").textContent,
    );
  };
  const set = async (k, v) => {
    await page.locator("#c-" + k).evaluate((e, v) => {
      e.value = v;
      e.dispatchEvent(
        new Event(e.type === "range" ? "input" : "change", { bubbles: true }),
      );
    }, String(v));
    await page.waitForTimeout(250);
  };
  try {
    for (const tool of ["finite-elemented", "frontier"]) {
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({width,height:1000});
        await visit(tool, tool === "finite-elemented" ? "materials" : "hardware");
        for (const step of [0, 1, 2, 3]) {
          await page.locator(`[data-step="${step}"]`).click();
          await page.waitForTimeout(100);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tool} ${width} step ${step} overflow`);
          if (tool === "finite-elemented") assert(await page.locator(".legend-values").evaluate(e => {
            const labels = [...e.children];
            return labels.length < 2 || labels[0].getBoundingClientRect().right <= labels[1].getBoundingClientRect().left;
          }), "Field legend values must not overlap");
          const sizes = await page.evaluate(() => Object.fromEntries(["#lesson-body", "#intro-copy", "#key-terms dd", ".equation", ".chart text", ".module-button", ".chart-caption"].map(s => [s, parseFloat(getComputedStyle(document.querySelector(s)).fontSize)])));
          for (const [selector, minimum] of [["#lesson-body",17],["#intro-copy",21],["#key-terms dd",17],[".equation",16],[".chart text",14],[".module-button",16],[".chart-caption",14]]) assert(sizes[selector] === minimum, `${selector}: ${sizes[selector]} < ${minimum}`);

        }
        await page.locator('[data-step="2"]').click();
        await page.evaluate(() => window.scrollTo(0,0));
        await page.screenshot({path:path.join(out, `${tool}-desktop-${width}.png`),fullPage:false});
        await page.locator("#open-library").click();
        await page.locator("#course-overview").waitFor({state:"visible"});
        assert(await page.locator(".lesson-link > span:not(.lesson-state)").first().evaluate(e => parseFloat(getComputedStyle(e).fontSize) >= 17));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await page.locator(".theme-toggle").click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.screenshot({path:path.join(out, tool + "-overview-desktop-dark.png"),fullPage:false});
      await page.locator(".theme-toggle").click();
      for (const width of [390,320]) {
        await page.setViewportSize({width,height:900});
        await visit(tool, tool === "finite-elemented" ? "materials" : "hardware");
        await page.locator(".reading-toggle").click();
        for (const step of [0,1,2,3]) {
          await page.locator(`[data-step="${step}"]`).click();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tool} mobile ${width} step ${step} overflow`);

        }
        await page.locator(".reading-toggle").click();
      }
      console.log("PASS", tool, "desktop type scale at 1280/1440/1920, overview text, restored font sizes, mobile and large text");
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  server.close();
});
