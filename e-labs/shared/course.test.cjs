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
    for (const [tool, kind, count] of [
      ["finite-elemented", "fea", 22],
      ["frontier", "hpc", 19],
    ]) {
      await visit(tool);
      assert.equal(await page.evaluate(() => LabApp.lessons.length), count);
      const ids = await page.evaluate(() => LabApp.lessons.map((l) => l.id));
      for (const id of ids) {
        await page.evaluate((id) => LabApp.go(id), id);
        await page.waitForFunction(
          (id) =>
            LabApp.lesson.id === id &&
            document.getElementById("intro-copy").textContent ===
              LabApp.lesson.intro,
          id,
        );
        await page.waitForTimeout(180);
        assert.equal(await page.locator(".step-panel:visible").count(), 1);
        assert(await page.locator("#understand").isVisible());
        await page.locator('[data-step="1"]').click();
        assert(await page.locator("#inspector").isVisible());
        assert(
          (await page.locator("#inspector .control:visible").count()) <= 3,
          id + " progressive controls",
        );
        await page.locator('[data-step="2"]').click();
        await page.waitForTimeout(180);
        assert(await page.locator("#explain").isVisible());
        assert(
          !/NaN|undefined/.test(await page.locator("#metrics").innerText()),
          id,
        );
        await page.locator('[data-step="3"]').click();
        const correct = await page.evaluate(() => LabApp.lesson.correct);
        await page.locator(`[data-answer="${correct}"]`).click();
        assert.match(await page.locator("#feedback").innerText(), /Correct/);
        assert(await page.evaluate((id) => !!LabApp.completed[id], id));
        const bounds = await page.locator("#stage").boundingBox();
        if (bounds.height < 280 || bounds.height >= 600)
          await page.screenshot({
            path: path.join(out, "layout-failure.png"),
            fullPage: true,
          });
        assert(
          bounds.height >= 280 && bounds.height < 600,
          id + JSON.stringify(bounds),
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          id,
        );
        console.log("PASS", kind, id);
      }
      await page.locator("#open-library").click();
      assert.equal(await page.locator("#modules>details").count(), 4);
      await page.locator("#close-library").click();
      await visit(tool, ids[0]);
      await page.screenshot({
        path: path.join(out, kind + "-light.png"),
        fullPage: true,
      });
      await page.locator(".theme-toggle").click();
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.theme),
        "dark",
      );
      await page.screenshot({
        path: path.join(out, kind + "-dark.png"),
        fullPage: true,
      });
      await page.locator('[data-step="2"]').click();
      await page.reload();
      assert(await page.locator("#explain").isVisible());
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.theme),
        "dark",
      );
      await page.locator(".theme-toggle").click();
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "light",
      );
    }
    await visit("frontier", "rightsizing");
    await page.locator('[data-step="1"]').click();
    await page.locator("#match-task").click();
    assert.match(await page.locator("#task-feedback").innerText(), /Good fit/);
    for (let i = 0; i < 12; i++) {
      await page.locator("#next-task").click();
    }
    assert.match(
      await page.locator("#task-count").innerText(),
      /Task 1 of 12/i,
    );
    await visit("frontier", "workflow");
    await page.locator('[data-step="1"]').click();
    await page.locator("#run-pipeline").click();
    await page.waitForFunction(
      () =>
        /Completed/.test(document.getElementById("result-status").textContent),
      null,
      { timeout: 15000 },
    );
    await set("memoryGB", 4);
    await page.locator("#run-pipeline").click();
    await page.waitForFunction(
      () =>
        /^Out of memory ·/.test(
          document.getElementById("result-status").textContent,
        ),
      null,
      { timeout: 15000 },
    );
    await visit("frontier", "render-race");
    await page.locator('[data-step="1"]').click();
    await page.locator("#run-race").click();
    await page.waitForFunction(
      () =>
        document
          .getElementById("result-status")
          .textContent.includes("Both renders complete"),
      null,
      { timeout: 15000 },
    );
    assert.deepEqual(await page.evaluate(() => LabApp.scene.raceProgress), {
      cpu: 1,
      gpu: 1,
    });
    await visit("finite-elemented", "shape");
    await page.locator('[data-step="1"]').click();
    await page.goto(url + "/e-labs/finite-elemented/index.html");
    await page.waitForFunction(
      () => window.LabApp && LabApp.lesson.id === "shape",
    );
    assert(await page.locator("#inspector").isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tool of ["finite-elemented", "frontier"]) {
      await visit(tool, tool === "frontier" ? "hardware" : "shape");
      await page.locator('[data-step="1"]').click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(out, tool + "-mobile.png"),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await visit("finite-elemented", "convergence");
    await page.locator('[data-step="1"]').click();
    await page.locator("#run-study").click();
    await page.waitForFunction(
      () =>
        document.getElementById("chart-tag").textContent === "6 ACTUAL SOLVES",
      null,
      { timeout: 30000 },
    );
    await page.locator('[data-step="2"]').click();
    assert.match(
      await page.locator("#chart-caption").innerText(),
      /All algebraic solves/,
    );
    await visit("finite-elemented", "mapping");
    await set("warp", 1.6);
    assert.match(await page.locator("#metrics").innerText(), /Invalid/);
    await visit("finite-elemented", "abaqus");
    await page.locator('[data-step="1"]').click();
    await set("type", "T3");
    await page.waitForFunction(() => LabApp.result.options.type === "T3");
    const exported = page.waitForEvent("download");
    await page.locator("#export-deck").click();
    const deck = await exported;
    assert.match(
      fs.readFileSync(await deck.path(), "utf8"),
      /\*Element, type=CPS3/,
    );
    await visit("finite-elemented", "axial-bar");
    await page.locator("#open-library").click();
    const saved = page.waitForEvent("download");
    await page.locator("#save").click();
    const json = JSON.parse(
      fs.readFileSync(await (await saved).path(), "utf8"),
    );
    assert(json.result.u.length === 5);
    await page.locator("#close-library").click();
    await visit("frontier", "workflow");
    await page.locator('[data-step="1"]').click();
    await set("walltime", 1);
    await page.locator("#run-pipeline").click();
    await page.waitForFunction(
      () =>
        /^Time limit reached ·/.test(
          document.getElementById("result-status").textContent,
        ),
      null,
      { timeout: 15000 },
    );
    await page.locator("#run-pipeline").click();
    await page.locator("#run-pipeline").click();
    assert.match(await page.locator("#result-status").innerText(), /cancelled/);
    await page.locator("#reset").click();
    assert.equal(await page.locator("#c-walltime").inputValue(), "30");
    await visit("frontier", "animation-batch");
    await page.locator('[data-step="1"]').click();
    await page.locator("#run-race").click();
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(out, "animation-race.png"),
      fullPage: true,
    });
    await page.locator("#reset").click();
    assert.equal(await page.evaluate(() => LabGuide.timer), null);
    await visit("frontier", "roofline");
    await set("intensity", 0.5);
    assert.match(await page.locator("#metrics").innerText(), /Memory/);
    await set("intensity", 64);
    assert.match(await page.locator("#metrics").innerText(), /Compute/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await visit("frontier", "render-race");
    await page.waitForFunction(
      () => document.getElementById("play").textContent === "Play motion",
    );
    assert.equal(await page.locator("#play").innerText(), "Play motion");
    await page.locator('[data-step="1"]').click();
    await page.locator("#run-race").click();
    await page.waitForFunction(
      () =>
        document
          .getElementById("result-status")
          .textContent.includes("Both renders complete"),
      null,
      { timeout: 15000 },
    );
    await page.goto(url + "/E-Labs.html");
    for (const id of ["finite-elemented", "frontier"]) {
      await page.locator(`[data-animation="${id}"]`).scrollIntoViewIfNeeded();
      await page.waitForSelector(`[data-animation="${id}"].lab-preview-ready`);
      await page
        .locator(`[data-animation="${id}"]`)
        .screenshot({ path: path.join(out, id + "-miniature-light.png") });
    }
    await page.locator(".theme-toggle").click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    for (const id of ["finite-elemented", "frontier"])
      await page
        .locator(`[data-animation="${id}"]`)
        .screenshot({ path: path.join(out, id + "-miniature-dark.png") });
    const blocked = await browser.newPage();
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error("Storage blocked");
      };
      Storage.prototype.setItem = () => {
        throw new Error("Storage blocked");
      };
    });
    const blockedErrors = [];
    blocked.on("pageerror", (e) => blockedErrors.push(e.message));
    await blocked.goto(url + "/e-labs/frontier/index.html");
    await blocked.waitForFunction(() => window.LabApp);
    await blocked.locator(".theme-toggle").click();
    await blocked.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    assert.deepEqual(blockedErrors, []);
    await blocked.close();
    const fallback = await browser.newPage();
    await fallback.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/i.test(type) ? null : get.call(this, type, ...args);
      };
    });
    await fallback.goto(url + "/e-labs/frontier/index.html#hardware");
    await fallback.waitForFunction(() => window.LabApp);
    assert(await fallback.locator("#understand").isVisible());
    await fallback.close();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 41 lessons, course navigation, both themes, quizzes, task deck, job success/OOM, rendering, resume, mobile and WebGL fallback. Screenshots:",
      out,
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  server.close();
});
