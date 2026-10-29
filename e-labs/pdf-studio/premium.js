const P = globalThis.PDFLib,
  C = globalThis.PDFStudioCore,
  X = globalThis.PDFStudioPremium;
const scripts = new Map();
export function loadScript(path) {
  if (!scripts.has(path))
    scripts.set(
      path,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL(path, import.meta.url).href;
        script.onload = resolve;
        script.onerror = () => {
          scripts.delete(path);
          script.remove();
          reject(
            new Error(
              "A local processing component could not load. Reload and try again.",
            ),
          );
        };
        document.head.append(script);
      }),
    );
  return scripts.get(path);
}
let fontPromise;
export function loadFont() {
  if (!fontPromise)
    fontPromise = (async () => {
      await loadScript("vendor/fonts/fontkit.min.js");
      const response = await fetch(
        new URL("vendor/fonts/NotoSans-Regular.ttf", import.meta.url),
      );
      if (!response.ok) throw new Error("The document font could not load.");
      return {
        kit: globalThis.fontkit,
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    })().catch((error) => {
      fontPromise = null;
      throw error;
    });
  return fontPromise;
}
export function qpdf(bytes, options, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("qpdf-worker.js", import.meta.url));
    let timer;
    const finish = (error, value) => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener("abort", cancel);
      error ? reject(error) : resolve(value);
    };
    const cancel = () =>
      finish(new DOMException("Processing cancelled.", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    timer = setTimeout(
      () => finish(new Error("Processing took too long. Try a smaller PDF.")),
      120000,
    );
    worker.onmessage = ({ data }) =>
      finish(data.error ? new Error(data.error) : null, data.bytes);
    worker.onerror = () =>
      finish(
        new Error("The PDF engine could not start. Reload and try again."),
      );
    worker.postMessage({ bytes: bytes.slice(), ...options });
  });
}
function check(signal) {
  if (signal?.aborted)
    throw new DOMException("Processing cancelled.", "AbortError");
}
export async function recover(bytes, signal) {
  try {
    return await qpdf(bytes, { mode: "repair" }, signal);
  } catch (error) {
    check(signal);
    // PDF-LIB parses readable objects independently of cross-reference offsets.
    // Re-serialize those objects before asking QPDF to normalize the structure.
    const doc = await P.PDFDocument.load(bytes.slice());
    if (!doc.getPageCount())
      throw new Error("No readable pages could be recovered.");
    check(signal);
    return qpdf(
      await doc.save({ useObjectStreams: true }),
      { mode: "repair" },
      signal,
    );
  }
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Processing cancelled.", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    promise
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener("abort", abort));
  });
}
export async function ocr(
  entries,
  render,
  { language, format, progress, signal },
) {
  await loadScript("vendor/ocr/tesseract.min.js");
  check(signal);
  let worker;
  const abort = () => worker?.terminate();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const creation = Tesseract.createWorker(language, 1, {
      workerPath: new URL("vendor/ocr/worker.min.js", import.meta.url).href,
      corePath: new URL("vendor/ocr/", import.meta.url).href,
      langPath: new URL("vendor/ocr/", import.meta.url).href,
      workerBlobURL: false,
      cacheMethod: "none",
      gzip: true,
      logger: (message) => progress(message.status, message.progress),
    });
    creation.then(
      (created) => {
        if (signal?.aborted) created.terminate();
      },
      () => {},
    );
    worker = await abortable(creation, signal);
    check(signal);
    const doc = format === "pdf" ? await P.PDFDocument.create() : null;
    const font = doc ? await C.fontFor(doc) : null;
    let text = "",
      recognized = 0;
    for (let i = 0; i < entries.length; i++) {
      check(signal);
      progress(`Reading page ${i + 1} of ${entries.length}`, 0);
      const { canvas, viewport } = await render(entries[i], 180);
      try {
        const { data } = await abortable(
          worker.recognize(canvas, {}, { text: true, blocks: true }),
          signal,
        );
        check(signal);
        text += (i ? "\n\n\f\n\n" : "") + data.text;
        recognized += data.text.trim().length;
        if (doc) {
          const width = viewport.width / viewport.scale,
            height = viewport.height / viewport.scale;
          const page = doc.addPage([width, height]),
            image = await doc.embedPng(canvas.toDataURL("image/png"));
          page.drawImage(image, { x: 0, y: 0, width, height });
          const words = (data.blocks || [])
            .flatMap((block) => block.paragraphs || [])
            .flatMap((paragraph) => paragraph.lines || [])
            .flatMap((line) => line.words || []);
          for (const word of words) {
            if (!word.text?.trim()) continue;
            const { x0, y0, x1, y1 } = word.bbox,
              size = Math.max(1, ((y1 - y0) / viewport.scale) * 0.85);
            const encoded = font.encodeText(word.text); // Fail visibly on unsupported glyphs.
            void encoded;
            const measured = font.widthOfTextAtSize(word.text, size),
              target = (x1 - x0) / viewport.scale;
            page.pushOperators(P.pushGraphicsState(), P.setCharacterSpacing(0));
            // Scale the invisible text to each recognized word's actual bounding box.
            page.drawText(word.text, {
              x: x0 / viewport.scale,
              y: height - y1 / viewport.scale,
              size: measured > target ? (size * target) / measured : size,
              font,
              opacity: 0,
            });
            page.pushOperators(P.popGraphicsState());
          }
        }
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
    if (!recognized)
      throw new Error(
        "No text was recognized. Try a clearer scan or the other language.",
      );
    return {
      bytes: doc ? await doc.save() : new TextEncoder().encode(text),
      extension: doc ? "pdf" : "txt",
      mime: doc ? "application/pdf" : "text/plain;charset=utf-8",
      message: `OCR complete. ${entries.length} pages processed. Review recognized text before relying on it.`,
    };
  } finally {
    signal?.removeEventListener("abort", abort);
    await worker?.terminate();
  }
}
export async function clean(
  entries,
  render,
  { mode, contrast, threshold, progress, signal },
) {
  const doc = await P.PDFDocument.create();
  for (let i = 0; i < entries.length; i++) {
    check(signal);
    progress(i + 1, entries.length);
    const { canvas, viewport } = await render(entries[i], 144),
      ctx = canvas.getContext("2d");
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    X.cleanScan(pixels.data, mode, contrast, threshold);
    ctx.putImageData(pixels, 0, 0);
    const page = doc.addPage([
        viewport.width / viewport.scale,
        viewport.height / viewport.scale,
      ]),
      image = await doc.embedPng(canvas.toDataURL("image/png"));
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
    });
    canvas.width = canvas.height = 1;
  }
  return doc;
}
export async function compare(
  sources,
  render,
  { threshold, progress, signal },
) {
  const doc = await P.PDFDocument.create(),
    font = await C.fontFor(doc),
    rows = [];
  const count = Math.max(...sources.map((s) => s.viewer.numPages));
  for (let i = 0; i < count; i++) {
    check(signal);
    progress(i + 1, count);
    const images = [];
    for (const source of sources)
      images.push(
        i < source.viewer.numPages
          ? await render({ source, index: i, rotation: 0 }, 72)
          : null,
      );
    const maxWidth = Math.max(
        ...images.map((image) => image?.canvas.width || 0),
      ),
      maxHeight = Math.max(...images.map((image) => image?.canvas.height || 0));
    const downsample = Math.min(1, Math.sqrt(4e6 / (maxWidth * maxHeight)));
    const width = Math.max(1, Math.ceil(maxWidth * downsample)),
      height = Math.max(1, Math.ceil(maxHeight * downsample));
    const canvases = images.map((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      if (image)
        ctx.drawImage(
          image.canvas,
          0,
          0,
          image.canvas.width * downsample,
          image.canvas.height * downsample,
        );
      return canvas;
    });
    const a = canvases[0].getContext("2d").getImageData(0, 0, width, height),
      b = canvases[1].getContext("2d").getImageData(0, 0, width, height),
      diff = X.pixelDifference(a.data, b.data, threshold);
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = width;
    diffCanvas.height = height;
    diffCanvas
      .getContext("2d")
      .putImageData(new ImageData(diff.image, width, height), 0, 0);
    const page = doc.addPage([1190, 842]);
    const change = !images[0]
      ? "Added page"
      : !images[1]
        ? "Removed page"
        : `${(diff.fraction * 100).toFixed(2)}% of rendered pixels differ`;
    page.drawText(`Page ${i + 1} / ${change}`, {
      x: 30,
      y: 808,
      size: 16,
      font,
    });
    page.drawText(
      "Comparison at 72 dpi. Pink highlights visual changes; this is not a semantic or legal review.",
      { x: 30, y: 786, size: 10, font },
    );
    for (let j = 0; j < 3; j++) {
      const label =
        j === 2
          ? "Visual difference"
          : (j === 0 ? "Original: " : "Revised: ") + sources[j].name;
      page.drawText(label.slice(0, 55), {
        x: 30 + j * 380,
        y: 755,
        size: 11,
        font,
      });
      const image = await doc.embedPng(
          (j === 2 ? diffCanvas : canvases[j]).toDataURL("image/png"),
        ),
        scale = Math.min(360 / width, 690 / height);
      page.drawImage(image, {
        x: 30 + j * 380,
        y: 40 + (690 - height * scale) / 2,
        width: width * scale,
        height: height * scale,
      });
    }
    rows.push({
      page: i + 1,
      change,
      changed: diff.changed > 0 || !images[0] || !images[1],
    });
    [
      ...canvases,
      diffCanvas,
      ...images.map((image) => image?.canvas).filter(Boolean),
    ].forEach((canvas) => {
      canvas.width = canvas.height = 1;
    });
  }
  return { doc, rows };
}
