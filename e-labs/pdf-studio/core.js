/* PDF Studio document operations. PDF-LIB and fflate are vendored, MIT licensed. */
(function (root) {
  "use strict";
  const lib = () => root.PDFLib;
  let fontLoader = null;
  function setFontLoader(loader) {
    fontLoader = loader;
  }
  async function fontFor(doc) {
    if (!fontLoader) return doc.embedFont(lib().StandardFonts.Helvetica);
    const { bytes, kit } = await fontLoader();
    doc.registerFontkit(kit);
    return doc.embedFont(bytes, { subset: true });
  }
  function assertTextSupported(text, font) {
    const supported = new Set(font.getCharacterSet());
    const missing = [
      ...new Set(
        Array.from(text).filter(
          (char) =>
            !/[\r\n\t]/.test(char) && !supported.has(char.codePointAt(0)),
        ),
      ),
    ];
    if (missing.length)
      throw new Error(
        `The export font does not support: ${missing.slice(0, 8).join(" ")}. Choose supported text to avoid missing glyphs.`,
      );
  }
  function parseRanges(value, count) {
    if (!value.trim()) return Array.from({ length: count }, (_, i) => i);
    const result = [];
    for (const part of value.split(",")) {
      const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match)
        throw new Error("Use page numbers and ranges, for example 1, 3-5.");
      const a = Number(match[1]),
        b = Number(match[2] || a);
      if (a < 1 || b > count || a > b)
        throw new Error(
          `Page ranges must be between 1 and ${count}, in ascending order.`,
        );
      for (let i = a - 1; i < b; i++) if (!result.includes(i)) result.push(i);
    }
    return result;
  }
  function hex(value) {
    const m = /^#([\da-f]{6})$/i.exec(value);
    if (!m) throw new Error("Choose a valid color.");
    const n = parseInt(m[1], 16);
    return lib().rgb(
      ((n >> 16) & 255) / 255,
      ((n >> 8) & 255) / 255,
      (n & 255) / 255,
    );
  }
  function safeName(value) {
    return (
      (value || "studio-document")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
        .replace(/[. ]+$/g, "")
        .slice(0, 100) || "studio-document"
    );
  }
  async function assemble(entries) {
    if (!entries.length) throw new Error("Select at least one page.");
    const doc = await lib().PDFDocument.create();
    for (const entry of entries) {
      const [page] = await doc.copyPages(entry.source.doc, [entry.index]);
      page.setRotation(
        lib().degrees(
          (((page.getRotation().angle + entry.rotation) % 360) + 360) % 360,
        ),
      );
      doc.addPage(page);
    }
    return doc;
  }
  async function applyMarks(doc, entries) {
    if (!entries.some((entry) => entry.marks?.length)) return;
    const font = entries.some((entry) =>
      entry.marks?.some((mark) => mark.kind === "text"),
    )
      ? await fontFor(doc)
      : null;
    for (let i = 0; i < entries.length; i++) {
      const page = doc.getPage(i);
      for (const mark of entries[i].marks || []) {
        const { x, y, width, height } = mark;
        if (mark.kind === "text") {
          assertTextSupported(mark.text, font);
          page.drawText(mark.text, {
            x,
            y,
            size: mark.size,
            color: hex(mark.color),
            font,
            rotate: lib().degrees(mark.angle),
          });
        } else if (mark.kind === "signature" || mark.kind === "image") {
          const image = mark.data.startsWith("data:image/png")
            ? await doc.embedPng(mark.data)
            : await doc.embedJpg(mark.data);
          page.drawImage(image, {
            x,
            y,
            width,
            height,
            rotate: lib().degrees(mark.angle),
          });
        } else if (mark.kind === "highlight")
          page.drawRectangle({
            x,
            y,
            width,
            height,
            color: hex(mark.color),
            opacity: 0.3,
          });
        else if (mark.kind !== "redact")
          throw new Error("Unknown annotation type.");
      }
    }
  }
  function wrapText(text, font, size, maxWidth) {
    const lines = [];
    for (const paragraph of text.replace(/\r/g, "").split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (
          line &&
          font.widthOfTextAtSize(`${line} ${word}`, size) > maxWidth
        ) {
          lines.push(line);
          line = "";
        }
        // Break long tokens so a URL cannot run outside the page.
        let chunk = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
            if (line) lines.push(line);
            lines.push(chunk);
            line = "";
            chunk = "";
          }
          chunk += char;
        }
        line += (line && chunk ? " " : "") + chunk;
      }
      lines.push(line);
    }
    return lines;
  }
  async function textPdf(text) {
    if (!text.trim()) throw new Error("The file has no readable text.");
    const doc = await lib().PDFDocument.create(),
      font = await fontFor(doc);
    assertTextSupported(text, font);
    let page, y;
    for (const line of wrapText(text, font, 11, 499)) {
      if (!page || y < 50) {
        page = doc.addPage([595, 842]);
        y = 791;
      }
      page.drawText(line, { x: 48, y, size: 11, font });
      y -= 16;
    }
    return doc;
  }
  const xml = (value) =>
    value.replace(
      /[<>&"']/g,
      (c) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
  function textDocx(pages) {
    const paragraphs = pages
      .map(
        (text, i) =>
          `${i ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}${text
            .split("\n")
            .map(
              (line) =>
                `<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`,
            )
            .join("")}`,
      )
      .join("");
    const files = {
      "[Content_Types].xml":
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels":
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
    };
    return zip(
      Object.fromEntries(
        Object.entries(files).map(([name, data]) => [
          name,
          new TextEncoder().encode(data),
        ]),
      ),
    );
  }
  function zip(files) {
    return root.fflate.zipSync(files, { level: 6 });
  }
  root.PDFStudioCore = {
    parseRanges,
    hex,
    safeName,
    assemble,
    applyMarks,
    wrapText,
    textPdf,
    textDocx,
    zip,
    fontFor,
    setFontLoader,
    assertTextSupported,
  };
})(globalThis);
