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
    for (const [tool, kind, total] of [["finite-elemented", "fea", 22], ["frontier", "hpc", 19]]) {
      await visit(tool);
      assert(await page.locator("#course-overview").isVisible());
      assert.equal(await page.locator('[data-status="not-started"]').count(), total);
      assert.equal(await page.evaluate(() => Object.keys(LabGuide.activity).length), 0, "Overview must not start a lesson");
      const ids = await page.evaluate(() => LabApp.lessons.map(l => l.id));
      await page.locator("#resume-course").click();
      await page.locator("#understand").waitFor({ state: "visible" });
      assert.match(await page.locator("#lesson-state").innerText(), /In progress/);
      await page.locator('[data-step="2"]').click();
      assert.match(await page.locator("#step-progress").innerText(), /2\/4/);
      await page.locator("#open-library").click();
      await page.locator("#course-overview").waitFor({ state: "visible" });
      assert.equal(await page.locator('[data-status="in-progress"]').count(), 1);
      assert.equal(await page.locator("#overall-progress").getAttribute("value"), "0");
      await page.reload();
      await page.locator("#course-overview").waitFor({ state: "visible" });
      await page.locator("#resume-course").click();
      await page.locator("#explain").waitFor({ state: "visible" });
      await page.locator('[data-step="3"]').click();
      const correct = await page.evaluate(() => LabApp.lesson.correct);
      await page.locator(`[data-answer="${(correct + 1) % 3}"]`).click();
      assert.match(await page.locator("#lesson-state").innerText(), /In progress/);
      await page.locator(`[data-answer="${correct}"]`).click();
      assert.match(await page.locator("#lesson-state").innerText(), /Completed/);
      assert.match(await page.locator("#lesson-course-count").innerText(), new RegExp(`1/${total}`));
      await page.locator("#open-library").click();
      await page.locator("#course-overview").waitFor({ state: "visible" });
      await page.locator("#progress-filter").selectOption("completed");
      assert.equal(await page.locator(".lesson-link").count(), 1);
      await page.locator("#progress-filter").selectOption("in-progress");
      assert.equal(await page.locator(".lesson-link").count(), 0);
      await page.locator("#progress-filter").selectOption("all");
      await page.locator("#next-unfinished").click();
      await page.waitForFunction(id => LabApp.lesson.id === id, ids[1]);
      await page.locator('[data-step="1"]').click();
      await page.goto(`${url}/e-labs/${tool}/`);
      await page.locator("#course-overview").waitFor({ state: "visible" });
      assert.equal(await page.locator('[data-status="completed"]').count(), 1);
      assert.equal(await page.locator('[data-status="in-progress"]').count(), 1);
      await page.screenshot({path: path.join(out, kind + "-overview-progress.png"), fullPage: true});
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator(".reading-toggle").click();
        assert.equal(await page.locator(".reading-toggle").getAttribute("aria-pressed"), "true");
        await page.reload();
        await page.locator("#course-overview").waitFor({ state: "visible" });
        assert.equal(await page.locator(".reading-toggle").getAttribute("aria-pressed"), "true");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert(await page.evaluate(() => {
          const header = document.querySelector(".topbar").getBoundingClientRect();
          return [...document.querySelectorAll(".topbar button")].every(b => b.getBoundingClientRect().bottom <= header.bottom);
        }), "Wrapped controls must stay inside the header");
        await page.locator("#resume-course").click();
        await page.locator(width === 1440 ? "#inspector" : "#explain").waitFor({ state: "visible" });
        await page.locator('[data-step="2"]').click();
        await page.waitForTimeout(250);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Large text must not overflow page");
        assert(await page.locator("#lesson-body").evaluate(e => parseFloat(getComputedStyle(e).fontSize) >= 19));
        assert(await page.locator(".chart text").first().evaluate(e => parseFloat(getComputedStyle(e).fontSize) >= 14));
        await page.screenshot({path: path.join(out, `${kind}-large-${width}.png`), fullPage: true});
        await page.locator(".reading-toggle").click();
        await page.locator("#open-library").click();
        await page.locator("#course-overview").waitFor({ state: "visible" });
        await page.goBack();
        await page.locator("#explain").waitFor({ state: "visible" });
        await page.goForward();
        await page.locator("#course-overview").waitFor({ state: "visible" });
      }
      await page.locator(".theme-toggle").click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.screenshot({path: path.join(out, kind + "-overview-dark-mobile.png"), fullPage:true});
      await page.locator(".theme-toggle").click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      await page.locator(".skip").focus();
      await page.locator(".skip").press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "course-overview");
      const tooSmall = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(e => !e.children.length && e.textContent.trim() && e.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(e).fontSize) < 14).map(e => [e.tagName, e.className, getComputedStyle(e).fontSize]));
      assert.deepEqual(tooSmall, [], "Visible overview labels must be at least 14 px");
      await page.setViewportSize({width:1440,height:1000});
      await visit(tool, "invalid-lesson");
      assert(await page.locator("#course-overview").isVisible());
      await visit(tool, ids[2]);
      assert(await page.locator("#understand").isVisible(), "Valid lesson links remain directly accessible");
      console.log("PASS", kind, "overview, activity, completion, filters, resume, history, large text and mobile");
    }
    const legacy = await browser.newPage();
    await legacy.addInitScript(() => {
      localStorage.setItem("elabs-v2-fea", JSON.stringify({ materials: true }));
      localStorage.setItem("elabs-course-fea", JSON.stringify({ lesson: "shape", step: 2 }));
    });
    await legacy.goto(url + "/e-labs/finite-elemented/");
    await legacy.locator("#course-overview").waitFor({state:"visible"});
    assert.equal(await legacy.locator('[data-status="completed"]').count(), 1);
    assert.equal(await legacy.locator('[data-status="in-progress"]').count(), 1);
    await legacy.locator("#resume-course").click();
    await legacy.locator("#explain").waitFor({state:"visible"});
    assert.equal(await legacy.evaluate(() => LabApp.lesson.id), "shape");
    await legacy.close();
    const blocked = await browser.newPage();
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error("Blocked"); };
    });
    await blocked.goto(url + "/e-labs/frontier/");
    await blocked.locator("#course-overview").waitFor({ state: "visible" });
    assert.match(await blocked.locator("#overview-progress").innerText(), /session only/);
    await blocked.locator("#resume-course").click();
    await blocked.locator("#understand").waitFor({ state: "visible" });
    assert.match(await blocked.locator("#lesson-state").innerText(), /In progress/);
    await blocked.close();
    assert.deepEqual(errors, []);
    console.log("PASS blocked storage and no browser errors");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  server.close();
});
