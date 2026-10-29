const assert = require("node:assert/strict");
const fs = require("node:fs");
globalThis.PDFLib = require("../vendor/pdf-lib.min.js");
globalThis.fflate = require("../vendor/fflate.min.js");
require("../core.js");
require("../premium-core.js");
const P = PDFLib,
  C = PDFStudioCore,
  X = PDFStudioPremium;
(async () => {
  assert.deepEqual(X.bookletOrder(8), [
    [7, 0],
    [1, 6],
    [5, 2],
    [3, 4],
  ]);
  assert.deepEqual(X.bookletOrder(5), [
    [null, 0],
    [1, null],
    [null, 2],
    [3, 4],
  ]);
  assert.deepEqual(
    X.interleave([
      [1, 2],
      [3, 4, 5],
    ]),
    [1, 3, 2, 4, 5],
  );
  const input = await P.PDFDocument.create();
  for (let i = 0; i < 5; i++) {
    const page = input.addPage([300, 400]);
    if (i !== 4) page.drawText("Page " + (i + 1));
    if (i === 1) page.setRotation(P.degrees(90));
  }
  const resized = await X.impose(input, { count: 1, width: 612, height: 792 });
  assert.equal(resized.getPageCount(), 5);
  assert.equal(resized.getPage(0).getWidth(), 612);
  const nup = await X.impose(input, { count: 4 });
  assert.equal(nup.getPageCount(), 2);
  const booklet = await X.impose(input, { mode: "booklet", count: 2 });
  assert.equal(booklet.getPageCount(), 4);
  await assert.rejects(() => X.impose(input, { margin: 500 }), /Margins/);
  X.addBookmarks(input, "1 | Résumé\n3 | Findings");
  const restored = await P.PDFDocument.load(await input.save());
  assert.ok(restored.catalog.get(P.PDFName.of("Outlines")));
  assert.throws(() => X.addBookmarks(input, "9 | Missing"), /bookmark/);
  assert.throws(() => X.addBookmarks(input, "bad row"), /bookmark/);
  const a = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
    b = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
  assert.equal(X.pixelDifference(a, b).changed, 1);
  assert.equal(X.pixelDifference(a, b).fraction, 0.5);
  assert.equal(X.pixelDifference(a, a).changed, 0);
  const pixels = new Uint8ClampedArray([50, 50, 50, 255, 230, 240, 250, 255]);
  X.cleanScan(pixels, "bw", 20, 180);
  assert.deepEqual([...pixels], [0, 0, 0, 255, 255, 255, 255, 255]);
  C.setFontLoader(async () => ({
    kit: require("../vendor/fonts/fontkit.min.js"),
    bytes: fs.readFileSync(
      require("node:path").join(
        __dirname,
        "../vendor/fonts/NotoSans-Regular.ttf",
      ),
    ),
  }));
  const unicode = await C.textPdf("Résumé · Ελληνικά · Кириллица");
  assert.ok((await unicode.save()).length > 2000);
  await assert.rejects(() => C.textPdf("漢字"), /does not support/);
  console.log(
    "PASS booklet ordering/padding, interleaving, rotated and blank-page imposition, paper sizes, Unicode bookmarks, difference detection, scan filters, and Unicode font embedding.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
