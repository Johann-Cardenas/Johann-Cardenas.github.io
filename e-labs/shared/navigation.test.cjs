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
    for (const [tool, kind] of [["finite-elemented", "fea"], ["frontier", "hpc"]]) {
      await visit(tool);
      const courses = await page.evaluate(() => LabCourses[LabApp.kind]);
      assert.equal(await page.locator("#course-picker button").count(), 5);
      await page.locator('[data-course="2"]').click();
      assert.equal(await page.locator(".course-card").count(), 1);
      assert.equal(await page.locator(".lesson-link").count(), courses[2].ids.length);
      assert.equal(await page.locator('[data-course="2"]').getAttribute("aria-pressed"), "true");
      await page.locator("#lesson-search").fill("no such lesson");
      assert.equal(await page.locator(".lesson-link").count(), 0);
      await page.locator("#clear-course-filters").click();
      assert.equal(await page.locator(".course-card").count(), 4);
      assert.equal(await page.locator("#lesson-search").inputValue(), "");
      await page.locator("#lesson-search").fill(courses[3].title);
      assert.equal(await page.locator(".lesson-link").count(), courses[3].ids.length);
      await page.locator("#clear-course-filters").click();
      await page.locator(".lesson-link").first().click();
      await page.locator("#understand").waitFor({state:"visible"});
      assert(await page.locator("#previous-step").isDisabled());
      await page.locator('[data-step="3"]').click();
      assert.match(await page.locator("#next").innerText(), /without completing/);
      const correct = await page.evaluate(() => LabApp.lesson.correct);
      await page.locator(`[data-answer="${(correct + 1) % 3}"]`).click();
      const goal = await page.evaluate(() => LabApp.lesson.takeaway);
      assert((await page.locator("#feedback").innerText()).includes(goal));
      assert(!(await page.locator("#check-milestone").isVisible()));
      await page.locator("#revisit-experiment").click();
      await page.locator("#inspector").waitFor({state:"visible"});
      await page.locator('[data-step="3"]').click();
      await page.locator(`[data-answer="${correct}"]`).click();
      assert.match(await page.locator("#milestone-title").innerText(), /Lesson complete/);
      assert.match(await page.locator("#next").innerText(), /^Next lesson/);
      await page.locator("#next").click();
      await page.locator("#understand").waitFor({state:"visible"});
      assert.match(await page.locator("#previous-step").innerText(), /Previous lesson/);
      await page.locator("#previous-step").click();
      await page.waitForFunction(id => LabApp.lesson.id === id && LabGuide.step === 3, courses[0].ids[0]);
      for (const id of courses[0].ids.slice(1)) {
        await page.evaluate(id => LabApp.go(id), id);
        await page.waitForFunction(id => LabApp.lesson.id === id, id);
        await page.locator('[data-step="3"]').click();
        const answer = await page.evaluate(() => LabApp.lesson.correct);
        await page.locator(`[data-answer="${answer}"]`).click();
      }
      assert.match(await page.locator("#milestone-title").innerText(), /^Module complete$/);
      assert.equal(await page.locator("#module-next").getAttribute("href"), "#" + courses[1].ids[0]);
      await page.locator("#review-module").click();
      await page.locator("#course-overview").waitFor({state:"visible"});
      assert.equal(await page.locator(".course-card").count(), 1);
      assert.equal(await page.locator('[data-course="0"]').getAttribute("aria-pressed"), "true");
      assert.match(await page.locator('[data-course="0"] span').innerText(), new RegExp(`${courses[0].ids.length}/${courses[0].ids.length}`));
      for (const width of [390, 320]) {
        await page.setViewportSize({width,height:844});
        await page.locator("#clear-course-filters").click();
        await page.screenshot({path:path.join(out, `${kind}-module-picker-${width}.png`),fullPage:false});
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.locator('[data-course="3"]').click();
        await page.locator(".lesson-link").first().click();
        await page.locator(".step-panel:visible").waitFor();
        await page.locator('[data-step="1"]').click();
        const bounds = await page.locator("#inspector").boundingBox();
        assert(bounds.y >= 0 && bounds.y < 400, "Selected content must scroll into view below mobile progress");
        await page.locator('[data-step="3"]').click();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Incomplete-check actions must fit mobile");
        await page.locator("#open-library").click();
        await page.locator("#course-overview").waitFor({state:"visible"});
      }
      await page.setViewportSize({width:1440,height:1000});
      console.log("PASS", kind, "module filters, search recovery, previous lesson, retry, completion milestones and mobile step focus");
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
