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
    await visit("frontier","render-race");
    await page.waitForFunction(()=>!LabApp.scene.raceLoading);
    assert.equal(await page.locator("#render-visual option").count(),9);
    await page.locator("#render-play").waitFor({state:"visible"});
    for(const visual of ["mandelbrot","sphere3d","raymarching","galaxy","ocean","tunnel","terrain3d","particles","plasma"]) {
      await page.selectOption("#render-visual",visual);
      await page.waitForFunction(()=>!LabApp.scene.raceLoading);
      assert.match(await page.locator("#render-message").textContent(),/Preview ready/);
    }
    await page.locator("#render-play").click();
    await page.waitForTimeout(200);
    assert.match(await page.locator("#render-play").textContent(),/Cancel/);
    assert(await page.locator("#render-visual").isDisabled());
    await page.waitForFunction(()=>LabApp.scene.raceElapsed>0);
    await page.locator("#render-play").click();
    assert.match(await page.locator("#render-message").textContent(),/cancelled/);
    await page.locator("#render-play").click();
    await page.waitForFunction(()=>!LabGuide.timer,{},{timeout:20000});
    assert.match(await page.locator("#render-message").textContent(),/Both renders complete/);
    assert.equal(await page.locator("#cpu-progress").evaluate(e=>e.value),1);
    const same = await page.evaluate(()=> {
      const maps=[]; LabApp.scene.content.traverse(o=>{if(o.material?.map?.image?.width===LabApp.state.resolution)maps.push(o.material.map.image.toDataURL());});
      return maps.length===2 && maps[0]===maps[1];
    });
    assert(same,"both processors finish the identical image");
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,"frontier-render-restored-mobile.png"),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(out,"frontier-render-restored-desktop.png"),fullPage:true});
    await visit("frontier","animation-batch");
    await page.waitForFunction(()=>!LabApp.scene.raceLoading);
    await page.locator("#render-play").click();
    await page.waitForFunction(()=>LabApp.scene.raceElapsed>0);
    await page.locator("#play").click();
    const paused = await page.evaluate(()=>LabApp.scene.raceElapsed);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>LabApp.scene.raceElapsed),paused);
    await page.locator("#play").click();
    await page.waitForFunction(t=>LabApp.scene.raceElapsed>t,paused);
    await page.locator("#render-play").click();
    await page.evaluate(()=> { location.hash="hardware"; });
    await page.waitForFunction(()=>LabApp.lesson.id==="hardware");
    assert.equal(await page.locator(".render-actions:visible").count(),0);
    await visit("frontier","hardware");
    assert.equal(await page.locator(".render-studio:visible").count(),0);
    // A slow worker finishing after navigation must not revive the rendering panel.
    await page.route("**/frontier-render-worker.js*",async route=>{
      await new Promise(resolve=>setTimeout(resolve,350));
      await route.continue();
    });
    await visit("frontier","render-race");
    await page.evaluate(()=>{location.hash="hardware";});
    await page.waitForFunction(()=>LabApp.lesson.id==="hardware");
    await page.waitForTimeout(700);
    assert.equal(await page.locator(".render-actions:visible").count(),0);
    assert.equal(await page.locator(".render-studio:visible").count(),0);
    await page.unroute("**/frontier-render-worker.js*");
    assert.deepEqual(errors,[]);
    console.log("PASS restored visual chooser, play/cancel/replay, matching final images, timing and mobile layout");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  server.close();
});
