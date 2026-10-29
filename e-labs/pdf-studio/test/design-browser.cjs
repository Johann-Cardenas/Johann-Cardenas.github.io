const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const P = require("../vendor/pdf-lib.min.js");
const base = process.env.PDF_STUDIO_TEST_URL || "http://127.0.0.1:8765";
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-studio-design-"));
  const doc = await P.PDFDocument.create();
  for (let i = 1; i <= 3; i++)
    doc.addPage([400, 600]).drawText(`PAGE ${i}`, { x: 30, y: 500, size: 24 });
  const source = path.join(dir, "pages.pdf");
  await fs.writeFile(source, await doc.save());
  const browser = await chromium.launch({
    executablePath:
      process.env.PDF_STUDIO_BROWSER ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/e-labs/pdf-studio/");
    await page.locator("#boot-screen").waitFor({ state: "detached" });
    assert.equal(await page.locator(".tool-miniature").count(), 12);
    assert.equal(await page.locator(".tool-card p").count(), 0);
    await page.locator("#show-all-tools").click();
    const miniatures = await page
      .locator(".tool-miniature")
      .evaluateAll((nodes) => nodes.map((node) => node.outerHTML));
    assert.equal(miniatures.length, 32);
    assert.equal(new Set(miniatures).size, 32);
    assert.equal(
      await page.locator('.tool-miniature[aria-hidden="true"]').count(),
      32,
    );
    console.log(
      "PASS 32 distinct decorative vector miniatures and concise cards",
    );
    const choose = async (name) => {
      await page.locator("#search").fill(name);
      await page
        .locator(".tool-card")
        .filter({ has: page.getByRole("heading", { name, exact: true }) })
        .click();
    };
    const idle = () =>
      page.waitForFunction(
        () =>
          document.querySelector("#workspace").getAttribute("aria-busy") ===
          "false",
      );
    await choose("Organize pages");
    await page.locator("#file-input").setInputFiles(source);
    await idle();
    const before = await page
      .locator(".page-card")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.pageId));
    await page.locator(".page-preview img").nth(2).waitFor();
    await page
      .locator("#pages")
      .evaluate((node) =>
        Promise.all(
          node
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished),
        ),
      );
    await page
      .locator(".page-preview")
      .nth(0)
      .dragTo(page.locator(".page-preview").nth(2));
    const after = await page
      .locator(".page-card")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.pageId));
    assert.deepEqual(after, [before[1], before[2], before[0]]);
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#run").click();
    const download = await downloadPromise,
      output = path.join(dir, "reordered.pdf");
    await download.saveAs(output);
    await idle();
    const texts = await page.evaluate(
      async (bytes) => {
        const lib = await import("/pdfjs/build/pdf.mjs"),
          doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise,
          text = [];
        for (let i = 1; i <= doc.numPages; i++)
          text.push(
            (await (await doc.getPage(i)).getTextContent()).items
              .map((item) => item.str || "")
              .join(""),
          );
        await doc.destroy();
        return text;
      },
      Array.from(await fs.readFile(output)),
    );
    assert.deepEqual(texts, ["PAGE 2", "PAGE 3", "PAGE 1"]);
    await page.locator("#undo-pages").click();
    assert.deepEqual(
      await page
        .locator(".page-card")
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.pageId)),
      before,
    );
    console.log("PASS drag reorder, exported order and undo");
    await page.locator(".page-preview").first().click();
    await page.locator("#preview").waitFor({ state: "visible" });
    const width = await page
      .locator("#preview-stage")
      .evaluate((node) => node.getBoundingClientRect().width);
    await page.locator("#zoom-in").click();
    assert.equal(await page.locator("#zoom-level").textContent(), "125%");
    assert.ok(
      (await page
        .locator("#preview-stage")
        .evaluate((node) => node.getBoundingClientRect().width)) > width,
    );
    await page.locator("#zoom-fit").click();
    assert.equal(await page.locator("#zoom-level").textContent(), "Fit");
    await page.locator("#zoom-fit").focus();
    await page.keyboard.press("PageDown");
    await page.waitForFunction(() =>
      document.querySelector("#editor-label").textContent.startsWith("Page 2"),
    );
    assert.equal(await page.locator(".page-card.active").count(), 1);
    await page.keyboard.press("PageUp");
    await page.waitForFunction(() =>
      document.querySelector("#editor-label").textContent.startsWith("Page 1"),
    );
    console.log(
      "PASS zoom, fit, keyboard page browsing and active page highlight",
    );
    await choose("Compress PDF");
    assert.equal(await page.locator("#tool-caution").isHidden(), true);
    await page.locator("#compression").selectOption("balanced");
    assert.match(
      await page.locator("#tool-caution").textContent(),
      /Image-only/,
    );
    assert.equal(await page.locator("#tool-caution").isVisible(), true);
    await page.locator("#compression").selectOption("lossless");
    assert.equal(await page.locator("#tool-caution").isHidden(), true);
    await page.locator("#compression").selectOption("balanced");
    await page.locator("#preset-name").fill("Image compression");
    await page.locator("#save-preset").click();
    const preset = await page.locator("#presets").inputValue();
    await page.locator("#compression").selectOption("lossless");
    await page.locator("#presets").selectOption(preset);
    assert.equal(await page.locator("#tool-caution").isVisible(), true);
    await choose("Redact PDF");
    assert.match(await page.locator("#tool-caution").textContent(), /removed/);
    assert.equal(
      await page.locator(".tool-details").getAttribute("open"),
      null,
    );
    await page.locator(".tool-details summary").click();
    assert.equal(await page.locator("#tool-description").isVisible(), true);
    console.log("PASS visible critical cautions and expandable full details");
    await page.locator("#clear").click();
    await idle();
    await page.locator("#search").fill("");
    await page.locator("#show-all-tools").click();
    await page.locator(".hero").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(dir, "light.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.locator("#theme").click();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(dir, "dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(dir, "mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".tool-miniature")
        .first()
        .evaluate((node) => getComputedStyle(node).transitionDuration),
      "0s",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS light/dark/mobile layouts and reduced motion. Artifacts:",
      dir,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
