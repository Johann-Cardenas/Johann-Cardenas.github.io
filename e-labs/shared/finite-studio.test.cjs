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
    await visit("finite-elemented","stress");
    await page.locator("#finite-play").waitFor({state:"visible"});
    assert.equal(await page.locator("#finite-position").inputValue(),"100");
    const original = await page.evaluate(()=>Array.from(LabApp.result.u));
    await page.locator("#finite-position").fill("0");
    assert.equal(await page.evaluate(()=>LabApp.scene.feDisplayFactor),0);
    await page.locator("#finite-play").click();
    await page.waitForFunction(()=>LabApp.scene.feDisplayFactor>.05);
    await page.locator("#finite-play").click();
    const held = await page.evaluate(()=>LabApp.scene.feDisplayFactor);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>LabApp.scene.feDisplayFactor),held);
    assert.deepEqual(await page.evaluate(()=>Array.from(LabApp.result.u)),original);
    await page.locator("#finite-play").click();
    await page.waitForFunction(()=>LabApp.scene.feDisplayFactor===1);
    await page.selectOption("#finite-preset","bracket");
    await page.waitForFunction(()=>LabApp.state.preset==="bracket" && document.getElementById("finite-preset").value==="bracket");
    await page.selectOption("#finite-field","displacement");
    await page.waitForFunction(()=>LabApp.state.field==="displacement");
    await page.waitForFunction(()=>document.getElementById("result-status").textContent.startsWith("Solved"));
    await page.waitForTimeout(150);
    await page.selectOption("#finite-element","1");
    assert.equal(await page.locator("#finite-element").inputValue(),"1");
    assert.equal(await page.locator("#element-select").inputValue(),"1");
    assert.match(await page.locator("#finite-values").textContent(),/von Mises/);
    await page.screenshot({path:path.join(out,"finite-studio-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,"finite-studio-mobile.png"),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await visit("finite-elemented","dynamics");
    await page.locator("#finite-play").waitFor({state:"visible"});
    await page.locator("#finite-position").fill("25");
    assert.equal(await page.evaluate(()=>LabApp.scene.feModalPhase),Math.PI/2);
    assert.equal(await page.locator("#finite-inspection:visible").count(),0);
    await page.selectOption("#finite-mode","2");
    await page.waitForFunction(()=>LabApp.state.mode===2);
    await page.locator("#finite-play").click();
    await page.waitForFunction(()=>LabApp.scene.feModalPhase>.1);
    await page.locator("#play").click();
    const phase = await page.evaluate(()=>LabApp.scene.feModalPhase);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>LabApp.scene.feModalPhase),phase);
    await page.evaluate(()=>{location.hash="shape";});
    await page.waitForFunction(()=>LabApp.lesson.id==="shape");
    assert.equal(await page.locator(".finite-controls:visible").count(),0);
    assert.deepEqual(errors,[]);
    console.log("PASS deformation scrub/play/hold, unchanged solve, geometry and field choices, element values, modal phases and mobile layout");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  server.close();
});
