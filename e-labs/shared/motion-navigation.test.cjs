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
      await visit(tool);
      await page.locator('.lesson-link').nth(8).scrollIntoViewIfNeeded();
      const scroll = await page.evaluate(() => scrollY);
      await page.locator('.lesson-link').nth(8).click();
      await page.locator('.step-panel:visible').waitFor();
      await page.locator('#open-library').click();
      await page.locator('#course-overview').waitFor({state:'visible'});
      assert(Math.abs(await page.evaluate(() => scrollY) - scroll) < 4, "Overview scroll position should be restored");
      await page.locator('#resume-course').click();
      await page.locator('.step-panel:visible').waitFor();
      await page.setViewportSize({width:390,height:844});
      await page.locator('#open-lessons').click();
      assert(await page.locator('#lesson-drawer').isVisible());
      assert.equal(await page.locator('#open-lessons').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#modules').count(), 1);
      await page.keyboard.press('Escape');
      assert(!(await page.locator('#lesson-drawer').isVisible()));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'open-lessons');
      await page.locator('#open-lessons').click();
      const target = await page.evaluate(() => LabApp.lessons[1].id);
      await page.locator('#modules details').first().evaluate(e => e.open = true);
      await page.locator(`[data-module="${target}"]`).click();
      await page.waitForFunction(id => LabApp.lesson.id === id, target);
      assert(!(await page.locator('#lesson-drawer').isVisible()));
      assert(await page.locator('#understand').isVisible());
      await page.locator('#open-lessons').click();
      await page.screenshot({path:path.join(out, tool + '-lesson-drawer.png'),fullPage:false});
      await page.setViewportSize({width:1440,height:1000});
      await page.locator("#lesson-drawer").waitFor({state:"hidden"});
      assert(!(await page.locator('#lesson-drawer').isVisible()));
      assert(await page.locator('.workspace > .course-sidebar').isVisible());
      assert.equal(await page.locator('#modules').count(), 1);
      console.log('PASS', tool, 'overview position, mobile drawer, Escape focus, navigation and responsive reparenting');
    }
    await visit('frontier', 'animation-batch');
    await page.locator('[data-step="1"]').click();
    await set('frames', 60);
    await set('resolution', 128);
    const prediction = await page.evaluate(() => LabGuide.exportResult());
    await page.locator('#run-race').click();
    await page.waitForTimeout(200);
    await page.locator('#open-library').click();
    await page.locator('#course-overview').waitFor({state:'visible'});
    const frozen = await page.evaluate(() => ({progress:LabApp.scene.raceProgress, time:LabApp.scene.time}));
    await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => ({progress:LabApp.scene.raceProgress,time:LabApp.scene.time})), frozen);
    await page.locator('#resume-course').click();
    await page.locator('#inspector').waitFor({state:'visible'});
    assert.equal(await page.locator('#c-frames').inputValue(), '60');
    assert.match(await page.locator('#run-race').innerText(), /Cancel/);
    await page.waitForTimeout(250);
    assert(await page.evaluate(v => LabApp.scene.raceProgress.cpu > v, frozen.progress.cpu));
    await page.locator('#play').click();
    const paused = await page.evaluate(() => LabApp.scene.raceProgress);
    await page.locator('#playback-speed').selectOption('2');
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(() => LabApp.scene.raceProgress), paused);
    assert.match(await page.locator('#motion-status').innerText(), /Paused/);
    assert.deepEqual(await page.evaluate(() => LabGuide.exportResult()), prediction, 'Playback speed must not alter predicted cost');
    await page.locator('#play').click();
    assert.match(await page.locator('#motion-status').innerText(), /2×/);
    await page.locator('#run-race').click();
    await visit('frontier', 'workflow');
    await page.locator('[data-step="1"]').click();
    await page.locator('#run-pipeline').click();
    await page.waitForTimeout(250);
    await page.locator('#open-library').click();
    await page.locator('#course-overview').waitFor({state:'visible'});
    const job = await page.locator('#metrics').textContent();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#metrics').textContent(), job);
    await page.locator('#resume-course').click();
    await page.locator('#inspector').waitFor({state:'visible'});
    assert.match(await page.locator('#run-pipeline').innerText(), /Cancel/);
    await page.locator('#run-pipeline').click();
    await page.locator('#stage').scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const before = await page.evaluate(() => { LabApp.scene.setPlaying(false); return [LabApp.scene.theta,LabApp.scene.phi,LabApp.scene.radius]; });
    const immediate = await page.evaluate(() => { LabApp.scene.view('front'); return [LabApp.scene.theta,LabApp.scene.phi,LabApp.scene.radius]; });
    assert.deepEqual(immediate, before, 'Camera tween must start at the displayed pose');
    await page.waitForTimeout(150);
    const zoom = await page.evaluate(() => { LabApp.scene.zoom(.85); return LabApp.scene.radius; });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => LabApp.scene.radius), zoom, 'Zoom must interrupt camera tween');
    assert.equal(await page.evaluate(() => LabApp.scene.cameraTween), null);
    await page.evaluate(() => LabApp.scene.view('iso'));
    const canvas = await page.locator('#stage canvas').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2 + 30, canvas.y + canvas.height / 2 + 10);
    await page.mouse.up();
    const dragged = await page.evaluate(() => [LabApp.scene.theta,LabApp.scene.phi]);
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => [LabApp.scene.theta,LabApp.scene.phi]), dragged, 'Dragging must interrupt camera tween');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(() => LabApp.scene.view('top'));
    assert.equal(await page.evaluate(() => LabApp.scene.phi), .05);
    assert.equal(await page.evaluate(() => LabApp.scene.cameraTween), null);
    await page.locator('[data-step="2"]').click();
    assert(await page.evaluate(() => !LabGuide.panelAnimation || LabGuide.panelAnimation.playState !== 'running'));
    console.log('PASS paused overview simulations, resume, speed-independent predictions, camera interruption and reduced motion');
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
