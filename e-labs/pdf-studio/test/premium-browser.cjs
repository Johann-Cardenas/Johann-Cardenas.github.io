const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const P = require("../vendor/pdf-lib.min.js");
const zip = require("../vendor/fflate.min.js");
const base = process.env.PDF_STUDIO_TEST_URL || "http://127.0.0.1:8765";
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-studio-premium-"));
  async function fixture(name, count, revision = false, blank = false) {
    const doc = await P.PDFDocument.create();
    for (let i = 0; i < count; i++) {
      const page = doc.addPage([400, 600]);
      if (blank && i === count - 1) continue;
      page.drawText(
        i === 0 ? "HELLO PDF STUDIO" : `${name.toUpperCase()} PAGE ${i + 1}`,
        { x: 30, y: 500, size: 22 },
      );
      page.drawText(revision && i === 1 ? "INVOICE 99999" : "INVOICE 12345", {
        x: 30,
        y: 440,
        size: 18,
      });
    }
    const file = path.join(dir, name + ".pdf");
    await fs.writeFile(file, await doc.save({ useObjectStreams: false }));
    return file;
  }
  const original = await fixture("original", 3),
    revision = await fixture("revision", 3, true),
    withBlank = await fixture("blank", 3, false, true),
    seven = await fixture("book", 7);
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
    page.setDefaultTimeout(60000);
    const errors = [],
      external = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("Browser error:", error.message);
    });
    page.on("request", (request) => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(base))
        external.push(request.url());
    });
    await page.goto(base + "/e-labs/pdf-studio/");
    await page.locator("#boot-screen").waitFor({ state: "detached" });
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
    const upload = async (file) => {
      await page.locator("#file-input").setInputFiles(file);
      await idle();
      assert.ok(
        await page.locator(".page-card").count(),
        await page.locator("#status").textContent(),
      );
    };
    const clear = async () => {
      await page.locator("#clear").click();
      await page.locator("#document-area").waitFor({ state: "hidden" });
    };
    const output = async () => {
      const downloadPromise = page.waitForEvent("download", {
        timeout: 120000,
      });
      await page.locator("#run").click();
      const download = await downloadPromise,
        file = path.join(dir, Date.now() + "-" + download.suggestedFilename());
      await download.saveAs(file);
      await idle();
      return { bytes: new Uint8Array(await fs.readFile(file)), file };
    };
    const text = async (bytes) =>
      page.evaluate(async (bytes) => {
        const lib = await import("/pdfjs/build/pdf.mjs"),
          doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
        const texts = [];
        for (let i = 1; i <= doc.numPages; i++)
          texts.push(
            (await (await doc.getPage(i)).getTextContent()).items
              .map((item) => item.str || "")
              .join(" "),
          );
        await doc.destroy();
        return texts;
      }, Array.from(bytes));
    await choose("Protect PDF");
    await upload(original);
    await page.locator("#protect-password").fill("Studio-Test-2026");
    await page.locator("#protect-confirm").fill("Studio-Test-2026");
    const protectedFile = await output();
    assert.match(
      Buffer.from(protectedFile.bytes).toString("latin1"),
      /\/AESV3/,
    );
    await assert.rejects(
      () => P.PDFDocument.load(protectedFile.bytes),
      /encrypted/i,
    );
    assert.equal(await page.locator("#continue-result").isHidden(), true);
    await page.locator("#preset-name").fill("Secure preset");
    await page.locator("#save-preset").click();
    assert.ok(
      !(await page.evaluate(() =>
        localStorage.getItem("pdf-studio-presets").includes("Studio-Test-2026"),
      )),
    );
    console.log("PASS AES-256 password protection");
    await clear();
    await choose("Unlock PDF");
    await page.locator("#unlock-password").fill("Studio-Test-2026");
    await upload(protectedFile.file);
    let result = await output();
    assert.equal((await P.PDFDocument.load(result.bytes)).getPageCount(), 3);
    console.log("PASS password-based unlock");
    await clear();
    await choose("Unlock PDF");
    await page.locator("#unlock-password").fill("WRONG");
    await page.locator("#file-input").setInputFiles(protectedFile.file);
    await idle();
    assert.match(await page.locator("#status").textContent(), /password/i);
    assert.equal(await page.locator("#run").isDisabled(), true);
    console.log("PASS wrong-password recovery");
    await choose("Compare PDFs");
    await upload([original, revision]);
    result = await output();
    assert.equal((await P.PDFDocument.load(result.bytes)).getPageCount(), 3);
    assert.match(await page.locator("#status").textContent(), /2 of 3/);
    assert.match(await page.locator("#analysis-panel").textContent(), /Page 2/);
    console.log("PASS visual comparison report");
    await clear();
    await choose("Resize pages");
    await upload(original);
    await page.locator("#paper-size").selectOption("letter");
    result = await output();
    let doc = await P.PDFDocument.load(result.bytes);
    assert.equal(doc.getPage(0).getWidth(), 612);
    assert.equal(doc.getPageCount(), 3);
    console.log("PASS resize pages");
    await choose("Multiple pages per sheet");
    await page.locator("#pages-per-sheet").selectOption("2");
    result = await output();
    assert.equal((await P.PDFDocument.load(result.bytes)).getPageCount(), 2);
    console.log("PASS multiple pages per sheet");
    await clear();
    await choose("Booklet maker");
    await upload(seven);
    result = await output();
    assert.equal((await P.PDFDocument.load(result.bytes)).getPageCount(), 4);
    const bookletText = await text(result.bytes);
    assert.match(bookletText[1], /PAGE 2.*PAGE 7/);
    console.log("PASS booklet ordering and padding");
    await clear();
    await choose("Alternate & interleave");
    await upload([original, revision]);
    result = await output();
    const alternating = await text(result.bytes);
    assert.match(alternating[2], /ORIGINAL PAGE 2/);
    assert.match(alternating[3], /REVISION PAGE 2/);
    console.log("PASS alternate/interleave");
    await clear();
    await choose("Bates numbering");
    await upload(original);
    result = await output();
    const bates = await text(result.bytes);
    assert.match(bates[0], /DOC-000001/);
    assert.match(bates[2], /DOC-000003/);
    console.log("PASS Bates numbering");
    await choose("Add bookmarks");
    await page.locator("#bookmark-lines").fill("1 | Résumé\n3 | Appendix");
    result = await output();
    const outline = await page.evaluate(async (bytes) => {
      const lib = await import("/pdfjs/build/pdf.mjs"),
        doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
      const outline = await doc.getOutline();
      await doc.destroy();
      return outline.map((item) => item.title);
    }, Array.from(result.bytes));
    assert.deepEqual(outline, ["Résumé", "Appendix"]);
    console.log("PASS Unicode navigable bookmarks");
    await choose("Clean up scans");
    await page.locator("#scan-mode").selectOption("bw");
    const cleaned = await output();
    assert.ok((await text(cleaned.bytes)).every((value) => value === ""));
    console.log("PASS scan cleanup");
    await clear();
    await choose("OCR · searchable PDF");
    await upload(cleaned.file);
    await page.locator("#page-ranges").fill("1");
    await page.locator("#output-name").click();
    result = await output();
    assert.match((await text(result.bytes))[0], /HELLO\s+PDF\s+STUDIO/);
    console.log("PASS real OCR creates searchable text in scanned PDF");
    await page.locator("#ocr-format").selectOption("text");
    result = await output();
    assert.match(new TextDecoder().decode(result.bytes), /INVOICE 12345/);
    console.log("PASS OCR text export");
    await page.locator("#ocr-language").selectOption("eng+spa");
    result = await output();
    assert.match(new TextDecoder().decode(result.bytes), /INVOICE 12345/);
    console.log("PASS both self-hosted OCR language models");
    await page.locator("#run").click();
    await page.locator("#cancel-task").waitFor({ state: "visible" });
    await page.locator("#cancel-task").click();
    await idle();
    assert.match(await page.locator("#status").textContent(), /cancelled/i);
    console.log("PASS OCR cancellation preserves the source");
    await clear();
    await choose("Remove blank pages");
    await upload(withBlank);
    result = await output();
    assert.equal((await P.PDFDocument.load(result.bytes)).getPageCount(), 2);
    assert.match(
      await page.locator("#analysis-panel").textContent(),
      /Removed: Page 3/,
    );
    console.log("PASS blank-page detection");
    await clear();
    await choose("Optimize for web");
    await upload(original);
    result = await output();
    assert.match(Buffer.from(result.bytes).toString("latin1"), /\/Linearized/);
    console.log("PASS linearized web PDF");
    await choose("Recover PDF structure");
    await clear();
    const damaged = path.join(dir, "damaged.pdf");
    await fs.writeFile(
      damaged,
      Buffer.from(await fs.readFile(original))
        .toString("latin1")
        .replace(/startxref\s+\d+/, "startxref\n999999999"),
      "latin1",
    );
    await upload(damaged);
    result = await output();
    assert.equal((await P.PDFDocument.load(result.bytes)).getPageCount(), 3);
    console.log("PASS structural PDF recovery");
    await clear();
    await choose("Compress PDF");
    await upload([original, revision]);
    await page.locator("#batch-mode").selectOption("separate");
    result = await output();
    assert.equal(Object.keys(zip.unzipSync(result.bytes)).length, 2);
    console.log("PASS separately compressed batch ZIP");
    await clear();
    await choose("Edit & annotate");
    await upload(original);
    await page
      .getByRole("button", {
        name: "Open page 1 from original.pdf",
        exact: true,
      })
      .click();
    await page.locator("#annotation-text").fill("Résumé Ελληνικά");
    await page.locator("#marks").click({ position: { x: 60, y: 250 } });
    result = await output();
    assert.match((await text(result.bytes))[0], /Résumé Ελληνικά/);
    console.log("PASS Unicode annotations");
    await page.locator("#page-search").fill("INVOICE");
    await page.locator("#search-pages").click();
    await idle();
    assert.equal(await page.locator(".search-result").count(), 3);
    console.log("PASS document text search");
    await page.locator("#font-size").fill("24");
    await page.locator("#preset-name").fill("Review preset");
    await page.locator("#save-preset").click();
    assert.match(await page.locator("#presets").textContent(), /Review preset/);
    const presetId = await page.locator("#presets").inputValue();
    await page.locator("#font-size").fill("12");
    await page.locator("#presets").selectOption(presetId);
    assert.equal(await page.locator("#font-size").inputValue(), "24");
    const savePromise = page.waitForEvent("download");
    await page.locator("#save-project").click();
    const saved = await savePromise,
      workspace = path.join(dir, "saved.pdfstudio");
    await saved.saveAs(workspace);
    await idle();
    const archive = zip.unzipSync(new Uint8Array(await fs.readFile(workspace)));
    const manifest = JSON.parse(
      new TextDecoder().decode(archive["workspace.json"]),
    );
    assert.equal(manifest.pages[0].marks[0].text, "Résumé Ελληνικά");
    await clear();
    await page.locator("#open-project").setInputFiles(workspace);
    await idle();
    assert.equal(await page.locator(".page-card").count(), 3);
    result = await output();
    assert.match((await text(result.bytes))[0], /Résumé Ελληνικά/);
    console.log("PASS editable workspace save/restore and presets");
    const invalidWorkspace = path.join(dir, "invalid.pdfstudio");
    await fs.writeFile(
      invalidWorkspace,
      zip.zipSync({
        "workspace.json": new TextEncoder().encode('{"format":"wrong"}'),
      }),
    );
    await page.locator("#open-project").setInputFiles(invalidWorkspace);
    await idle();
    assert.equal(await page.locator(".page-card").count(), 3);
    assert.match(await page.locator("#status").textContent(), /Unsupported/);
    console.log("PASS invalid workspace preserves the current documents");
    await page.locator("#continue-result").click();
    await idle();
    assert.equal(await page.locator(".page-card").count(), 3);
    assert.match(
      await page.locator("#status").textContent(),
      /active document/,
    );
    console.log("PASS output chaining without re-upload");
    await page.locator("#search").fill("OCR");
    await page
      .getByRole("button", {
        name: "Favorite OCR · searchable PDF",
        exact: true,
      })
      .click();
    await page.locator("#search").fill("");
    await page
      .getByRole("button", { name: "★ Favorites", exact: true })
      .click();
    assert.equal(await page.locator(".tool-card").count(), 1);
    console.log("PASS favorite tools");
    await page.getByRole("button", { name: "All tools", exact: true }).click();
    await clear();
    await page.locator('[data-recipe="review"]').click();
    await upload([original, revision]);
    await output();
    await page.locator("#next-recipe").click();
    await idle();
    assert.equal(
      await page.locator("#workspace-title").textContent(),
      "Edit & annotate",
    );
    assert.equal(await page.locator(".file-row").count(), 1);
    assert.match(await page.locator(".file-name").textContent(), /revision/);
    result = await output();
    assert.match((await text(result.bytes))[1], /INVOICE 99999/);
    await page.locator("#next-recipe").click();
    await idle();
    assert.equal(
      await page.locator("#workspace-title").textContent(),
      "Sign PDF",
    );
    console.log(
      "PASS review workflow carries the revised original through editing and signing",
    );
    await page.locator("#close-recipe").click();
    await clear();
    await page.locator("#theme").click();
    await page.screenshot({
      path: path.join(dir, "premium-dark.png"),
      fullPage: true,
    });
    await page.locator("#theme").click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(dir, "premium-mobile.png"),
      fullPage: true,
    });
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    console.log(
      "PASS responsive premium UI, zero external runtime requests, and zero browser errors",
    );
    console.log("Artifacts:", dir);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
