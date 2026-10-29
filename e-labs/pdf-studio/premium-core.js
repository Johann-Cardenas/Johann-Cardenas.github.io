(function (root) {
  "use strict";
  const P = () => root.PDFLib;
  function bookletOrder(count) {
    const padded = Math.ceil(count / 4) * 4,
      result = [];
    for (let lo = 0, hi = padded - 1; lo < hi; lo += 2, hi -= 2) {
      result.push([hi, lo], [lo + 1, hi - 1]);
    }
    return result.map((pair) =>
      pair.map((index) => (index < count ? index : null)),
    );
  }
  function interleave(groups) {
    const result = [];
    for (
      let i = 0;
      i < Math.max(0, ...groups.map((group) => group.length));
      i++
    ) {
      for (const group of groups) if (group[i]) result.push(group[i]);
    }
    return result;
  }
  async function fittedPage(doc, source, target, box) {
    if (!source.node.Contents()) return;
    const crop = source.getCropBox();
    const embedded = await doc.embedPage(source, {
      left: crop.x,
      bottom: crop.y,
      right: crop.x + crop.width,
      top: crop.y + crop.height,
    });
    const angle = ((source.getRotation().angle % 360) + 360) % 360;
    const rotated = angle === 90 || angle === 270;
    const width = rotated ? embedded.height : embedded.width,
      height = rotated ? embedded.width : embedded.height;
    const scale = Math.min(box.width / width, box.height / height);
    const w = width * scale,
      h = height * scale;
    let x = box.x + (box.width - w) / 2,
      y = box.y + (box.height - h) / 2;
    if (angle === 90) y += h;
    if (angle === 180) {
      x += w;
      y += h;
    }
    if (angle === 270) x += w;
    target.drawPage(embedded, {
      x,
      y,
      width: embedded.width * scale,
      height: embedded.height * scale,
      rotate: P().degrees(-angle),
    });
  }
  async function impose(
    input,
    {
      mode = "nup",
      count = 2,
      width = 841.89,
      height = 595.28,
      margin = 18,
      gap = 12,
    } = {},
  ) {
    if (
      ![1, 2, 4].includes(count) ||
      ![width, height, margin, gap].every(Number.isFinite)
    )
      throw new Error("Choose a supported layout and valid sheet dimensions.");
    if (width <= 2 * margin || height <= 2 * margin || margin < 0 || gap < 0)
      throw new Error("Margins leave no room on the sheet.");
    const output = await P().PDFDocument.create();
    const sourcePages = input.getPages();
    const slots =
      mode === "booklet"
        ? bookletOrder(sourcePages.length)
        : Array.from(
            { length: Math.ceil(sourcePages.length / count) },
            (_, i) =>
              Array.from({ length: count }, (_, j) =>
                i * count + j < sourcePages.length ? i * count + j : null,
              ),
          );
    const columns = count === 1 ? 1 : 2,
      rows = mode === "booklet" || count === 1 ? 1 : Math.ceil(count / columns);
    const cellW = (width - margin * 2 - gap * (columns - 1)) / columns,
      cellH = (height - margin * 2 - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0)
      throw new Error("The gutter leaves no space for pages.");
    for (const sheet of slots) {
      const page = output.addPage([width, height]);
      for (let i = 0; i < sheet.length; i++) {
        if (sheet[i] === null) continue;
        await fittedPage(output, sourcePages[sheet[i]], page, {
          x: margin + (i % columns) * (cellW + gap),
          y:
            height -
            margin -
            (Math.floor(i / columns) + 1) * cellH -
            Math.floor(i / columns) * gap,
          width: cellW,
          height: cellH,
        });
      }
    }
    return output;
  }
  function addBookmarks(doc, input) {
    const rows = input
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s*\|\s*(.+)$/);
        if (
          !match ||
          Number(match[1]) < 1 ||
          Number(match[1]) > doc.getPageCount()
        )
          throw new Error(
            "Use one bookmark per line: page | title. Page numbers refer to the exported document.",
          );
        return { index: Number(match[1]) - 1, title: match[2].trim() };
      });
    if (!rows.length) throw new Error("Add at least one bookmark.");
    const context = doc.context,
      outline = context.obj({ Type: "Outlines" }),
      ref = context.register(outline);
    const items = rows.map((row) =>
      context.obj({
        Title: P().PDFHexString.fromText(row.title),
        Parent: ref,
        Dest: [doc.getPage(row.index).ref, "Fit"],
      }),
    );
    const refs = items.map((item) => context.register(item));
    items.forEach((item, index) => {
      if (index) item.set(P().PDFName.of("Prev"), refs[index - 1]);
      if (index + 1 < refs.length)
        item.set(P().PDFName.of("Next"), refs[index + 1]);
    });
    outline.set(P().PDFName.of("First"), refs[0]);
    outline.set(P().PDFName.of("Last"), refs[refs.length - 1]);
    outline.set(P().PDFName.of("Count"), P().PDFNumber.of(refs.length));
    doc.catalog.set(P().PDFName.of("Outlines"), ref);
    doc.catalog.set(P().PDFName.of("PageMode"), P().PDFName.of("UseOutlines"));
    return doc;
  }
  function pixelDifference(a, b, threshold = 24) {
    if (a.length !== b.length || a.length % 4)
      throw new Error("Comparison images must have the same dimensions.");
    const image = new Uint8ClampedArray(a.length);
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      const delta = Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      );
      if (delta > threshold) {
        image[i] = 216;
        image[i + 1] = 65;
        image[i + 2] = 130;
        changed++;
      } else {
        const gray = Math.round((b[i] + b[i + 1] + b[i + 2]) / 3);
        image[i] = image[i + 1] = image[i + 2] = 200 + Math.round(gray * 0.215);
      }
      image[i + 3] = 255;
    }
    return { image, changed, fraction: changed / (a.length / 4) };
  }
  function cleanScan(data, mode, contrast = 20, threshold = 180) {
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < data.length; i += 4) {
      let gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      gray = Math.min(255, Math.max(0, factor * (gray - 128) + 128));
      if (mode === "bw") gray = gray >= threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    return data;
  }
  root.PDFStudioPremium = {
    bookletOrder,
    interleave,
    fittedPage,
    impose,
    addBookmarks,
    pixelDifference,
    cleanScan,
  };
})(globalThis);
