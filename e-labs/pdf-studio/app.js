import * as pdfjs from "../../pdfjs/build/pdf.mjs";
import * as Premium from "./premium.js";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "../../pdfjs/build/pdf.worker.mjs",
  import.meta.url,
).href;
const $ = (id) => document.getElementById(id);
const C = globalThis.PDFStudioCore,
  P = globalThis.PDFLib;
C.setFontLoader(Premium.loadFont);
const X = globalThis.PDFStudioPremium;
const tools = [
  {
    id: "merge",
    name: "Merge PDF",
    icon: "⇉",
    category: "organize",
    short: "Good things belong together.",
    description:
      "Combine PDFs into one document. Reorder files or individual pages before exporting.",
  },
  {
    id: "split",
    name: "Split PDF",
    icon: "⋮",
    category: "organize",
    short: "Keep just the chapters you need.",
    description:
      "Separate selected pages into individual PDFs or groups, delivered in one ZIP.",
  },
  {
    id: "organize",
    name: "Organize pages",
    icon: "▦",
    category: "organize",
    short: "A place for every page.",
    description:
      "Reorder, rotate, duplicate, or remove pages. Only checked pages are included in your export.",
  },
  {
    id: "compress",
    name: "Compress PDF",
    icon: "⇲",
    category: "optimize",
    short: "Less weight. More breathing room.",
    description:
      "Optimize PDF structure or reduce image size. Image compression flattens pages and removes searchable text, forms, and links.",
  },
  {
    id: "edit",
    name: "Edit & annotate",
    icon: "T",
    category: "edit",
    short: "Add your own finishing touches.",
    description:
      "Add text, translucent highlights, or images. Open a page, then click to place a mark. Existing text is not directly editable.",
  },
  {
    id: "sign",
    name: "Sign PDF",
    icon: "〰",
    category: "edit",
    short: "Your signature. Your next step.",
    description:
      "Draw a signature and place it on a page. This is a visual signature, not a certificate-based digital signature.",
  },
  {
    id: "watermark",
    name: "Watermark PDF",
    icon: "◈",
    category: "edit",
    short: "Make your mark, thoughtfully.",
    description: "Add a subtle text watermark to the selected pages.",
  },
  {
    id: "numbers",
    name: "Page numbers",
    icon: "#",
    category: "edit",
    short: "Bring a little order to the story.",
    description:
      "Number the selected pages, with a starting number and optional prefix.",
  },
  {
    id: "images-pdf",
    name: "Images to PDF",
    icon: "▧",
    category: "convert",
    short: "Turn your images into a story.",
    description:
      "Combine JPG, PNG, or WebP images into a PDF. Each image becomes one page.",
  },
  {
    id: "pdf-images",
    name: "PDF to images",
    icon: "↗",
    category: "convert",
    short: "Every page, a fresh perspective.",
    description:
      "Export selected PDF pages as PNG or JPG images, bundled in a ZIP.",
  },
  {
    id: "pdf-word",
    name: "PDF to Word",
    icon: "W",
    category: "convert",
    short: "Give your words a second draft.",
    description:
      "Extract selectable text into an editable DOCX. Images, tables, and original layout are not preserved. Scans require OCR first.",
  },
  {
    id: "word-pdf",
    name: "Word & text to PDF",
    icon: "↳",
    category: "convert",
    short: "A new home for your words.",
    description:
      "Convert the body text of DOCX or UTF-8 TXT files to a clean PDF. Text reflows; images, tables, headers, and source formatting are not preserved.",
  },
  {
    id: "text",
    name: "Extract text",
    icon: "≡",
    category: "convert",
    short: "Get straight to the words.",
    description:
      "Save the selectable text from your selected pages as a UTF-8 text file. Scanned pages without a text layer cannot be read.",
  },
  {
    id: "crop",
    name: "Crop pages",
    icon: "⌗",
    category: "edit",
    short: "Focus on what matters.",
    description:
      "Trim page margins in PDF points (72 points = 1 inch). Cropping hides content; use Redact to permanently remove it.",
  },
  {
    id: "redact",
    name: "Redact PDF",
    icon: "▬",
    category: "edit",
    short: "Keep private things private.",
    description:
      "Mark areas to remove, then export a flattened image PDF. Underlying text and objects are removed from every page; forms, links, and searchable text are lost.",
  },
  {
    id: "forms",
    name: "Fill PDF forms",
    icon: "☑",
    category: "edit",
    short: "Fill in the details. Move forward.",
    description:
      "Fill standard AcroForm text fields, checkboxes, radio buttons, and dropdowns in one PDF, then flatten the result. XFA forms are not supported.",
  },
  {
    id: "metadata",
    name: "Document details",
    icon: "ⓘ",
    category: "optimize",
    short: "The details behind the document.",
    description:
      "Update or clear title, author, subject, and keywords in a single PDF. This does not scrub hidden page content or embedded files.",
  },
  {
    id: "flatten",
    name: "Flatten PDF",
    icon: "▱",
    category: "optimize",
    short: "Set the final version in place.",
    description:
      "Render pages into a fixed image PDF, baking in visible form appearances and annotations. Searchable text, links, layers, and interactive fields are removed.",
  },
  {
    id: "ocr",
    name: "OCR · searchable PDF",
    category: "advanced",
    short: "Make scanned pages searchable.",
    description:
      "Recognize English or Spanish scans locally. Export a searchable image PDF or recognized text. OCR is approximate; review the result. PDF output preserves the rendered appearance, not original interactive objects.",
  },
  {
    id: "compare",
    name: "Compare PDFs",
    category: "advanced",
    short: "See what changed, page by page.",
    description:
      "Compare two original PDFs in file order. A three-column PDF report shows original, revised, and pink visual differences at 72 dpi. Fonts, layout, and scanning noise can affect the result.",
  },
  {
    id: "protect",
    name: "Protect PDF",
    category: "advanced",
    short: "A private document deserves a key.",
    description:
      "Encrypt the selected PDF pages with AES-256 and a password to open the document. Keep the password somewhere safe; the studio cannot recover it.",
  },
  {
    id: "unlock",
    name: "Unlock PDF",
    category: "advanced",
    short: "Open your document for the next step.",
    description:
      "Enter your document password before adding an encrypted PDF. The password is used locally to create an unlocked copy. Password recovery or cracking is not provided.",
  },
  {
    id: "scan",
    name: "Clean up scans",
    category: "optimize",
    short: "Clearer pages. Less visual noise.",
    description:
      "Convert rendered pages to grayscale or crisp black and white with adjustable contrast. The output is image-only; use OCR afterward to add searchable text.",
  },
  {
    id: "resize",
    name: "Resize pages",
    category: "organize",
    short: "One consistent size, beautifully fitted.",
    description:
      "Fit selected pages into A4, Letter, Legal, or A3 sheets without stretching or clipping. Original page rotations and crop areas are respected.",
  },
  {
    id: "nup",
    name: "Multiple pages per sheet",
    category: "organize",
    short: "A smarter use of every sheet.",
    description:
      "Place two or four source pages on each sheet. Perfect for handouts and compact review copies. Page content is preserved as vectors where possible.",
  },
  {
    id: "booklet",
    name: "Booklet maker",
    category: "organize",
    short: "Turn a document into something to keep.",
    description:
      "Reorder and impose pages for a folded booklet, padding with blank pages to a multiple of four. Print the resulting landscape sheets duplex, flip on the short edge, and fold.",
  },
  {
    id: "interleave",
    name: "Alternate & interleave",
    category: "organize",
    short: "Bring two sides of a story together.",
    description:
      "Alternate selected pages from the files in their displayed order. Useful for separately scanned fronts and backs. Reverse the second file when its backs were scanned in reverse order.",
  },
  {
    id: "bates",
    name: "Bates numbering",
    category: "edit",
    short: "A reliable reference on every page.",
    description:
      "Add sequential document identifiers with a prefix, zero padding, and a suffix. Useful for case files, evidence bundles, and document inventories.",
  },
  {
    id: "bookmarks",
    name: "Add bookmarks",
    category: "edit",
    short: "Give a long document a clear path.",
    description:
      "Create a navigable table of bookmarks in your exported PDF. Enter one line per bookmark: exported page number | title. Existing outlines are replaced.",
  },
  {
    id: "blank",
    name: "Remove blank pages",
    category: "optimize",
    short: "Keep the pages that carry the story.",
    description:
      "Detect visually blank rendered pages and leave them out of a new PDF. The adjustable ink threshold may classify faint marks as blank; review the processing report and keep your original.",
  },
  {
    id: "web",
    name: "Optimize for web",
    category: "optimize",
    short: "Ready for a quicker first page.",
    description:
      "Linearize a single original PDF for progressive loading on compatible web servers and viewers. This is not image recompression and may increase file size.",
  },
  {
    id: "repair",
    name: "Recover PDF structure",
    category: "advanced",
    short: "Give a readable file a fresh structure.",
    description:
      "Use QPDF to rebuild structural tables and compress streams in a readable PDF. Recovery is best-effort; missing content and severely damaged files cannot be reconstructed.",
  },
];
const tones = {
  organize: ["#eef0ff", "#6d78cb"],
  edit: ["#edf5f0", "#629d83"],
  convert: ["#fff3e9", "#c69365"],
  optimize: ["#f3edfa", "#a082bb"],
  advanced: ["#edf3fa", "#5689ab"],
};
let tool = tools[0],
  category = "all",
  sources = [],
  pages = [],
  busy = false,
  pageWindow = 0,
  activePage = null,
  previewViewport = null,
  renderVersion = 0,
  previewVersion = 0,
  resultURL = null,
  signatureDirty = false;
const thumbnailCache = new Map();
let pageHistory = [];
const disabledBeforeBusy = new Map();
let taskController = null,
  lastResult = null,
  recipe = null;
const readStored = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
};
const storedFavorites = readStored("pdf-studio-favorites", []);
const favorites = new Set(
  Array.isArray(storedFavorites) ? storedFavorites : [],
);
let presets = readStored("pdf-studio-presets", []);
if (!Array.isArray(presets)) presets = [];
let catalogExpanded = false;
const toolSettings = new Map();
const iconPaths = {
  merge: ["M6 3v5c0 3 6 3 6 6v7", "M18 3v5c0 3-6 3-6 6", "m8 17 4 4 4-4"],
  split: [
    "M12 3v5c0 3-6 3-6 6v7",
    "M12 8c0 3 6 3 6 6v7",
    "m3 18 3 3 3-3",
    "m15 18 3 3 3-3",
  ],
  organize: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M3 14h7v7H3z", "M14 14h7v7h-7z"],
  compress: [
    "M3 8h5V3",
    "M21 8h-5V3",
    "m8 8-6-6",
    "m16 8 6-6",
    "M3 16h5v5",
    "M21 16h-5v5",
    "m8 16-6 6",
    "m16 16 6 6",
  ],
  edit: ["M4 5h16", "M12 5v15", "M8 20h8", "M4 5v3", "M20 5v3"],
  sign: ["m15 4 5 5", "m4 15 12-12 5 5-12 12-6 1z", "M12 21h9"],
  watermark: ["m12 2 9 10-9 10L3 12z", "M8 12h8", "M12 8v8"],
  numbers: ["m10 3-4 18", "m18 3-4 18", "M4 9h17", "M2 15h17"],
  "images-pdf": [
    "M4 3h12l4 4v14H4z",
    "M15 3v5h5",
    "M7 17l3-4 3 3 2-2 3 3",
    "M8 9h.01",
  ],
  "pdf-images": [
    "M3 6h15v15H3z",
    "m6 17 4-5 3 3 2-2",
    "M7 9h.01",
    "M7 2h15v15",
  ],
  "pdf-word": ["M4 3h12l4 4v14H4z", "M15 3v5h5", "m6 11 2 7 3-5 3 5 2-7"],
  "word-pdf": ["M4 3h12l4 4v14H4z", "M15 3v5h5", "M7 13h9", "m13 10 3 3-3 3"],
  text: ["M4 5h16", "M4 10h16", "M4 15h16", "M4 20h10"],
  crop: ["M6 2v16h16", "M2 6h16v16", "m16 2 6 6", "m2 16 6 6"],
  redact: ["M4 3h12l4 4v14H4z", "M15 3v5h5", "M7 12h10v3H7z", "M7 18h6"],
  forms: [
    "M9 5h12",
    "M9 12h12",
    "M9 19h12",
    "m2 4 2 2 3-4",
    "m2 11 2 2 3-4",
    "M2 17h4v4H2z",
  ],
  metadata: [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
    "M12 11v6",
    "M12 7h.01",
  ],
  flatten: ["m12 3 10 5-10 5L2 8z", "m2 12 10 5 10-5", "m2 17 10 5 10-5"],
  ocr: [
    "M3 8V3h5",
    "M16 3h5v5",
    "M21 16v5h-5",
    "M8 21H3v-5",
    "m8 16 4-9 4 9",
    "M10 13h4",
  ],
  compare: [
    "M2 4h8v16H2z",
    "M14 4h8v16h-8z",
    "M6 9h1",
    "M6 13h1",
    "M17 9h2",
    "M17 13h2",
  ],
  protect: ["M5 10h14v11H5z", "M8 10V7a4 4 0 0 1 8 0v3", "M12 14v3"],
  unlock: ["M5 10h14v11H5z", "M8 10V7a4 4 0 0 1 8 0", "M12 14v3"],
  scan: [
    "M3 3h6",
    "M3 3v6",
    "M21 3h-6",
    "M21 3v6",
    "M3 21h6",
    "M3 21v-6",
    "M21 21h-6",
    "M21 21v-6",
    "M7 9h10",
    "M7 13h10",
    "M7 17h6",
  ],
  resize: ["M4 4h16v16H4z", "m8 8 8 8", "M11 8H8v3", "M13 16h3v-3"],
  nup: ["M3 3h18v18H3z", "M12 3v18", "M3 12h18"],
  booklet: ["M2 5h7l3 2 3-2h7v15h-7l-3 2-3-2H2z", "M12 7v15"],
  interleave: [
    "M3 4h5v5H3z",
    "M16 4h5v5h-5z",
    "M9 15h6v6H9z",
    "M6 9v3h6v3",
    "M18 9v3h-6",
  ],
  bates: ["M3 5h18v14H3z", "M7 9v6", "M11 9h3v6h-3z", "M17 9v6"],
  bookmarks: ["M6 3h12v19l-6-4-6 4z"],
  blank: ["M4 3h12l4 4v14H4z", "M15 3v5h5", "M8 14h8"],
  web: [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
    "M2 12h20",
    "M12 2c6 6 6 14 0 20",
    "M12 2c-6 6-6 14 0 20",
  ],
  repair: ["m14 5 5-2-2 5-3 1-8 10-3-3 10-8z"],
};
function toolIcon(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of iconPaths[id]) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
function rememberPages() {
  pageHistory.push({
    pages: pages.map((p) => ({ ...p, marks: p.marks.map((m) => ({ ...m })) })),
    sources: [...sources],
  });
  if (pageHistory.length > 20) pageHistory.shift();
  $("undo-pages").disabled = false;
}
function updateWorkflow(done = false) {
  for (const [id, current, complete] of [
    ["step-add", !pages.length, !!pages.length],
    ["step-refine", !!pages.length && !done, done],
    ["step-save", done, false],
  ]) {
    const node = $(id);
    node.classList.toggle("done", complete);
    if (current) node.setAttribute("aria-current", "step");
    else node.removeAttribute("aria-current");
  }
}
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
function sizes(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function renderTools() {
  const grid = $("tool-grid");
  grid.replaceChildren();
  const filtered = tools.filter(
    (t) =>
      (category === "all" ||
        t.category === category ||
        (category === "favorites" && favorites.has(t.id))) &&
      `${t.name} ${t.short} ${t.description}`
        .toLowerCase()
        .includes($("search").value.toLowerCase()),
  );
  const compact = category === "all" && !$("search").value && !catalogExpanded;
  $("show-all-tools").hidden = category !== "all" || !!$("search").value;
  $("show-all-tools").textContent = catalogExpanded
    ? "Show fewer tools ↑"
    : `Explore all ${tools.length} tools ↓`;
  for (const item of compact ? filtered.slice(0, 12) : filtered) {
    const wrapper = el("div", "tool-tile");
    const button = el(
      "button",
      `tool-card${tool.id === item.id ? " selected" : ""}`,
    );
    button.type = "button";
    button.setAttribute("aria-pressed", tool.id === item.id);
    const icon = el("span", "tool-icon");
    icon.append(toolIcon(item.id));
    const [tint, tone] = tones[item.category];
    icon.style.setProperty("--tint", tint);
    icon.style.setProperty("--tone", tone);
    button.append(
      icon,
      el("span", "tool-arrow", "↗"),
      el("h3", "", item.name),
      el("p", "", item.short),
    );
    button.addEventListener("click", () => {
      if (busy) return;
      chooseTool(item);
      $("workspace").focus({ preventScroll: true });
      $("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const star = el(
      "button",
      "favorite-button",
      favorites.has(item.id) ? "★" : "☆",
    );
    star.setAttribute("aria-label", `Favorite ${item.name}`);
    star.setAttribute("aria-pressed", String(favorites.has(item.id)));
    star.addEventListener("click", () => {
      if (favorites.has(item.id)) favorites.delete(item.id);
      else favorites.add(item.id);
      localStorage.setItem(
        "pdf-studio-favorites",
        JSON.stringify([...favorites]),
      );
      renderTools();
    });
    wrapper.append(button, star);
    grid.append(wrapper);
  }
  $("no-tools").hidden = filtered.length !== 0;
}
function field(label, id, value = "", type = "text", note = "") {
  const wrap = el("label", "field", label),
    input = el("input");
  input.id = id;
  input.type = type;
  input.value = value;
  if (type === "number") {
    input.min = 0;
    input.max = 9999;
    input.step = 1;
  }
  wrap.append(input);
  if (note) wrap.append(el("small", "", note));
  $("options").append(wrap);
  return input;
}
function select(label, id, choices) {
  const wrap = el("label", "field", label),
    input = el("select");
  input.id = id;
  for (const [value, text] of choices) {
    const opt = el("option", "", text);
    opt.value = value;
    input.append(opt);
  }
  wrap.append(input);
  $("options").append(wrap);
  return input;
}
function note(text) {
  $("options").append(el("p", "option-note", text));
}
function updateEditOptions() {
  if (tool.id !== "edit") return;
  const kind = value("mark-kind");
  const visibility = {
    "annotation-text": kind === "text",
    "font-size": kind === "text",
    "mark-color": kind !== "image",
    "mark-width": kind !== "text",
    "mark-height": kind !== "text",
    "annotation-image": kind === "image",
  };
  for (const [id, visible] of Object.entries(visibility))
    $(id).parentElement.hidden = !visible;
}
function number(id, min, max) {
  const value = Number($(id).value);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(
      `Enter a value between ${min} and ${max} for ${$(id).parentElement.firstChild.textContent}.`,
    );
  return value;
}
const value = (id) => $(id).value;
function chooseTool(next) {
  if (tool) toolSettings.set(tool.id, captureSettings());
  tool = next;
  $("workspace-title").textContent = tool.name;
  $("tool-description").textContent = tool.description;
  $("settings-icon").replaceChildren(toolIcon(tool.id));
  $("guide-title").textContent = tool.short;
  $("guide-text").textContent = ["edit", "sign", "redact"].includes(tool.id)
    ? "Add your PDF, click a page thumbnail, then click the large preview to place your mark. Export when it looks right."
    : tool.id === "forms"
      ? "Add one PDF with fillable fields. Complete the fields in the settings panel, then save your finished copy."
      : tool.id === "images-pdf"
        ? "Choose images, arrange their order, select a page size, and export your new document."
        : "Add your files, choose the pages you need, adjust the settings, then export your finished work.";
  $("load-example").hidden =
    ["images-pdf", "word-pdf", "forms"].includes(tool.id) || !!sources.length;
  $("run").replaceChildren(
    document.createTextNode(tool.name),
    el("span", "", "↗"),
  );
  $("options").replaceChildren();
  closePreview();
  const imageMode = tool.id === "images-pdf",
    textMode = tool.id === "word-pdf";
  $("file-input").accept = imageMode
    ? "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
    : textMode
      ? ".docx,.txt"
      : "application/pdf,.pdf";
  $("accept-hint").textContent = imageMode
    ? "JPG, PNG, and WebP images welcome."
    : textMode
      ? "Choose DOCX or UTF-8 TXT files."
      : "Choose PDFs to make them your own.";
  if (tool.id === "split") {
    select("Split mode", "split-mode", [
      ["each", "One PDF per selected page"],
      ["groups", "Groups of pages"],
    ]);
    field("Pages per group", "group-size", "2", "number");
  }
  if (tool.id === "compress")
    select("Compression", "compression", [
      ["lossless", "Optimize structure · keep text"],
      ["balanced", "Balanced · 120 dpi, JPEG 75%"],
      ["small", "Smallest · 72 dpi, JPEG 50%"],
    ]);
  if (tool.id === "compress")
    select("Output mode", "batch-mode", [
      ["combined", "One combined PDF"],
      ["separate", "Each input PDF separately · ZIP"],
    ]);
  if (tool.id === "ocr") {
    select("Recognition language", "ocr-language", [
      ["eng", "English"],
      ["spa", "Spanish"],
      ["eng+spa", "English + Spanish"],
    ]);
    select("Output", "ocr-format", [
      ["pdf", "Searchable PDF"],
      ["text", "Recognized text · TXT"],
    ]);
    note(
      "The local OCR engine and language models load on demand. No pages are uploaded. Review names, numbers, and scan quality in the output.",
    );
  }
  if (tool.id === "compare") {
    field("Pixel tolerance (0–255)", "compare-threshold", "24", "number");
    note(
      "Add the original first and the revision second. All original pages are compared; page edits and partial selections are not accepted.",
    );
  }
  if (tool.id === "protect") {
    field("Password to open", "protect-password", "", "password");
    field("Confirm password", "protect-confirm", "", "password");
    note(
      "At least 8 characters. A separate random owner password is generated locally. Passwords are never saved in presets or workspace files.",
    );
  }
  if (tool.id === "unlock") {
    field(
      "Document password · enter before adding files",
      "unlock-password",
      "",
      "password",
    );
    note(
      "Enter the password first, then add the encrypted PDF. Once opened, export an unlocked copy or switch to any other tool.",
    );
  }
  if (tool.id === "scan") {
    select("Scan style", "scan-mode", [
      ["gray", "Grayscale"],
      ["bw", "Black & white"],
    ]);
    field("Contrast (0–100)", "scan-contrast", "20", "number");
    field("Black & white threshold (0–255)", "scan-threshold", "180", "number");
  }
  if (["resize", "nup", "booklet"].includes(tool.id)) {
    select("Paper size", "paper-size", [
      ["a4", "A4"],
      ["letter", "US Letter"],
      ["legal", "US Legal"],
      ["a3", "A3"],
    ]);
    if (tool.id !== "booklet")
      select("Orientation", "paper-orientation", [
        ["portrait", "Portrait"],
        ["landscape", "Landscape"],
      ]);
    if (tool.id === "nup") $("paper-orientation").value = "landscape";
    if (tool.id === "nup")
      select("Pages per sheet", "pages-per-sheet", [
        ["2", "2 pages"],
        ["4", "4 pages"],
      ]);
    field("Margin (pt)", "sheet-margin", "18", "number");
    if (tool.id !== "resize") field("Gutter (pt)", "sheet-gap", "12", "number");
  }
  if (tool.id === "interleave")
    select("Second file order", "interleave-reverse", [
      ["normal", "Keep current order"],
      ["reverse", "Reverse the second file"],
    ]);
  if (tool.id === "bates") {
    field("Prefix", "bates-prefix", "DOC-");
    field("Starting number", "bates-start", "1", "number");
    field("Number of digits", "bates-digits", "6", "number");
    field("Suffix", "bates-suffix", "");
  }
  if (tool.id === "bookmarks") {
    const label = el("label", "field", "Bookmarks · page | title"),
      input = el("textarea");
    input.id = "bookmark-lines";
    input.rows = 7;
    input.placeholder = "1 | Introduction\n3 | Findings";
    label.append(input);
    $("options").append(label);
    note(
      "Page numbers refer to the final selected page order. Titles support the PDF Unicode bookmark format.",
    );
  }
  if (tool.id === "blank") {
    field(
      "Maximum dark-pixel coverage (%)",
      "blank-coverage",
      "0.05",
      "number",
    ).step = "0.01";
    note(
      "Pages below this threshold are omitted. A report identifies every removed page; this detects visual emptiness, not hidden data.",
    );
  }
  if (tool.id === "edit") {
    select("Add to the page", "mark-kind", [
      ["text", "Text"],
      ["highlight", "Highlight"],
      ["image", "Image"],
    ]);
    field("Text", "annotation-text", "Your text");
    field("Font size (pt)", "font-size", "18", "number");
    field("Color", "mark-color", "#5065c9", "color");
    field("Width (% of page)", "mark-width", "30", "number");
    field("Height (% of page)", "mark-height", "6", "number");
    field("Image", "annotation-image", "", "file").accept =
      "image/png,image/jpeg";
    note(
      "Click a page preview, then click where your text or mark should begin. Use Undo mark to remove the last addition.",
    );
  }
  if (tool.id === "sign") {
    note(
      "Draw your signature below, or type your name. Open a page to place it.",
    );
    const canvas = el("canvas", "signature-pad");
    canvas.id = "signature";
    canvas.width = 660;
    canvas.height = 240;
    canvas.setAttribute(
      "aria-label",
      "Draw your signature here, or use the name field below.",
    );
    $("options").append(canvas);
    const clear = el("button", "text-button", "Clear signature");
    clear.addEventListener("click", () => {
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      $("signature-text").value = "";
      signatureDirty = false;
    });
    $("options").append(clear);
    field("Or type your name", "signature-text", "").addEventListener(
      "input",
      (event) => {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#243047";
        ctx.font = "italic 72px Georgia, serif";
        ctx.fillText(event.target.value, 20, 150, 620);
        signatureDirty = !!event.target.value.trim();
      },
    );
    field("Signature width (% of page)", "signature-width", "28", "number");
    setupSignature(canvas);
  }
  if (tool.id === "watermark") {
    field("Watermark text", "watermark-text", "DRAFT");
    field("Font size (pt)", "watermark-size", "48", "number");
    field("Opacity (%)", "watermark-opacity", "20", "number");
    field("Color", "watermark-color", "#6373c0", "color");
  }
  if (tool.id === "numbers") {
    field("Start at", "number-start", "1", "number");
    field("Prefix", "number-prefix", "");
    select("Position", "number-position", [
      ["bottom", "Bottom center"],
      ["top", "Top center"],
    ]);
  }
  if (tool.id === "images-pdf")
    select("Page size", "image-page", [
      ["fit", "Fit to image"],
      ["a4", "A4 · portrait"],
      ["letter", "US Letter · portrait"],
    ]);
  if (tool.id === "pdf-images") {
    select("Image format", "image-format", [
      ["png", "PNG · lossless"],
      ["jpeg", "JPG · smaller"],
    ]);
    select("Resolution", "image-dpi", [
      ["144", "144 dpi · standard"],
      ["216", "216 dpi · high"],
      ["72", "72 dpi · screen"],
    ]);
  }
  if (tool.id === "crop") {
    for (const edge of ["Top", "Right", "Bottom", "Left"])
      field(`${edge} trim (pt)`, `crop-${edge.toLowerCase()}`, "20", "number");
    note(
      "Margins follow the unrotated PDF coordinate system. Hidden material remains recoverable.",
    );
  }
  if (tool.id === "redact") {
    field("Area width (% of page)", "redact-width", "35", "number");
    field("Area height (% of page)", "redact-height", "5", "number");
    note(
      "Open a page and click the upper-left corner of an area. Black areas are permanently baked into a new image-only PDF at 144 dpi.",
    );
  }
  if (tool.id === "metadata") {
    for (const name of ["Title", "Author", "Subject", "Keywords"])
      field(name, `meta-${name.toLowerCase()}`, "");
    note(
      "Blank fields clear the corresponding value. Works with exactly one PDF; all its pages are kept.",
    );
  }
  if (tool.id === "forms") {
    const fields = el("div");
    fields.id = "form-fields";
    $("options").append(fields);
    renderFormFields();
  }
  if (
    ![
      "images-pdf",
      "word-pdf",
      "forms",
      "metadata",
      "compare",
      "unlock",
      "web",
      "repair",
    ].includes(tool.id)
  )
    field(
      "Select page ranges",
      "page-ranges",
      "",
      "text",
      "Optional: 1, 3-5 refers to the current page order. Apply to replace the checked selection.",
    ).addEventListener("change", applyRange);
  if (["merge", "organize"].includes(tool.id))
    note(
      "Use the arrows under each page to reorder it. Uncheck a page to leave it out, or duplicate it with +.",
    );
  if (tool.id === "flatten")
    note(
      "Exports at 144 dpi. Rasterization can increase file size and removes accessibility tags.",
    );
  if (tool.id === "pdf-word" || tool.id === "word-pdf")
    note(
      "Text-to-PDF uses an embedded Noto Sans font for Latin, Greek, and Cyrillic text. Complex-script shaping and source layout reconstruction are not supported.",
    );
  if (
    sources.length &&
    sources.some((s) => s.kind !== (imageMode ? "image" : "pdf"))
  )
    note(
      "This tool needs a different file type. Clear the workspace to start with new files.",
    );
  restoreSettings(toolSettings.get(tool.id));
  if (tool.id === "edit")
    $("mark-kind").addEventListener("change", updateEditOptions);
  updateEditOptions();
  renderRecipe();
  renderTools();
  updateSummary();
  status("Choose files or use the documents already in your workspace.");
}
function applyRange() {
  try {
    const chosen = new Set(C.parseRanges(value("page-ranges"), pages.length));
    rememberPages();
    pages.forEach((p, i) => (p.selected = chosen.has(i)));
    renderPages();
    updateSummary();
  } catch (error) {
    status(error.message, true);
  }
}
function updateSummary() {
  const count = pages.filter((p) => p.selected).length;
  $("file-summary").textContent =
    `${sources.length} file${sources.length === 1 ? "" : "s"} · ${sizes(sources.reduce((n, s) => n + s.size, 0))}`;
  $("selection-summary").textContent =
    `${count} of ${pages.length} pages selected`;
  $("export-count").textContent = pages.length
    ? `${count} page${count === 1 ? "" : "s"} selected`
    : "Add your first file";
  $("run").disabled = busy || count === 0;
  $("document-area").hidden = !sources.length;
  $("dropzone").hidden = !!sources.length;
  $("load-example").hidden =
    !!sources.length || ["images-pdf", "word-pdf", "forms"].includes(tool.id);
  updateWorkflow();
  $("undo-pages").disabled = busy || !pageHistory.length;
}
function newPage(source, index) {
  return {
    id: crypto.randomUUID(),
    source,
    index,
    rotation: 0,
    selected: true,
    marks: [],
  };
}
async function addFiles(fileList) {
  if (busy || !fileList.length) return;
  setBusy(true);
  status("Opening your files…");
  let errors = [];
  for (const file of fileList) {
    let source;
    try {
      if (file.size > 150 * 1024 * 1024)
        throw new Error(
          "Files over 150 MB may exceed browser memory. Choose a smaller file.",
        );
      if (
        sources.reduce((n, s) => n + s.size, 0) + file.size >
        250 * 1024 * 1024
      )
        throw new Error("Workspace limit is 250 MB. Clear some files first.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      source = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        bytes,
        kind: "pdf",
      };
      if (tool.id === "images-pdf") {
        if (!/\.(jpe?g|png|webp)$/i.test(file.name))
          throw new Error("Choose a JPG, PNG, or WebP image.");
        const bitmap = await createImageBitmap(file);
        if (bitmap.width * bitmap.height > 40e6) {
          bitmap.close();
          throw new Error("Image exceeds 40 megapixels. Resize it first.");
        }
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        bitmap.close();
        source.data = canvas.toDataURL("image/png");
        source.width = canvas.width;
        source.height = canvas.height;
        source.kind = "image";
        if (taskController.signal.aborted)
          throw new DOMException("Processing cancelled.", "AbortError");
        sources.push(source);
        pages.push(newPage(source, 0));
      } else {
        if (tool.id === "word-pdf") {
          if (/\.docx$/i.test(file.name)) {
            // Only inflate document.xml, and reject archives with excessive declared output.
            let declaredSize = 0;
            const entries = fflate.unzipSync(bytes, {
              filter: (entry) => {
                declaredSize += entry.originalSize || 0;
                if (declaredSize > 50 * 1024 * 1024)
                  throw new Error("DOCX expanded size exceeds 50 MB.");
                return entry.name === "word/document.xml";
              },
            });
            if (!entries["word/document.xml"])
              throw new Error("This is not a supported DOCX document.");
            const xml = new DOMParser().parseFromString(
              new TextDecoder().decode(entries["word/document.xml"]),
              "application/xml",
            );
            if (xml.querySelector("parsererror"))
              throw new Error("The DOCX document XML is invalid.");
            const ns =
              "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
            const text = Array.from(xml.getElementsByTagNameNS(ns, "p"))
              .map((p) =>
                Array.from(p.getElementsByTagNameNS(ns, "t"))
                  .map((t) => t.textContent)
                  .join(""),
              )
              .join("\n");
            source.bytes = await (await C.textPdf(text)).save();
          } else if (/\.txt$/i.test(file.name))
            source.bytes = await (
              await C.textPdf(
                new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              )
            ).save();
          else throw new Error("Choose a DOCX or UTF-8 TXT file.");
        } else if (
          !/\.pdf$/i.test(file.name) &&
          file.type !== "application/pdf"
        )
          throw new Error("Choose a PDF document for this tool.");
        if (tool.id === "unlock")
          source.bytes = await Premium.qpdf(
            source.bytes,
            { mode: "unlock", password: value("unlock-password") },
            taskController.signal,
          );
        if (tool.id === "repair")
          source.bytes = await Premium.recover(
            source.bytes,
            taskController.signal,
          );
        source.doc = await P.PDFDocument.load(source.bytes.slice());
        source.viewer = await pdfjs.getDocument({
          data: source.bytes.slice(),
          cMapUrl: "../../pdfjs/web/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "../../pdfjs/web/standard_fonts/",
          wasmUrl: "../../pdfjs/web/wasm/",
          isEvalSupported: false,
        }).promise;
        if (taskController.signal.aborted)
          throw new DOMException("Processing cancelled.", "AbortError");
        sources.push(source);
        for (let i = 0; i < source.doc.getPageCount(); i++)
          pages.push(newPage(source, i));
      }
    } catch (error) {
      if (source?.viewer && !sources.includes(source))
        await source.viewer.destroy();
      errors.push(`${file.name}: ${friendlyError(error)}`);
      if (taskController.signal.aborted) break;
    }
  }
  $("file-input").value = "";
  pageWindow = 0;
  closePreview();
  pageHistory = [];
  $("undo-pages").disabled = true;
  setBusy(false);
  renderFiles();
  renderPages();
  if (tool.id === "forms") renderFormFields();
  if (sources.length && value("output-name") === "studio-document")
    $("output-name").value = C.safeName(
      sources[0].name.replace(/\.[^.]+$/, "") + "-studio",
    );
  status(
    errors.length
      ? errors.join(" ")
      : "Files ready. Choose pages and settings, then export.",
    !!errors.length,
  );
}
function friendlyError(error) {
  if (error.name === "AbortError")
    return "Processing cancelled. Your original files are unchanged.";
  if (
    /EncryptedPDFError|is encrypted|password.protected/i.test(
      `${error.name} ${error.message}`,
    )
  )
    return "This PDF is encrypted. Choose Unlock PDF, enter its password, then add the file again.";
  if (/WinAnsi|encode/i.test(error.message))
    return "This text includes characters the export font cannot represent. Choose supported text or remove those characters.";
  return (
    error.message || "The file could not be processed. Try another document."
  );
}
function setBusy(state) {
  if (state) taskController = new AbortController();
  busy = state;
  $("progress").hidden = !state;
  if (state) $("progress").removeAttribute("value");
  $("processing").hidden = !state;
  $("run").classList.toggle("working", state);
  $("run").replaceChildren(
    document.createTextNode(state ? "Working on it…" : tool.name),
    el("span", "", state ? "" : "↗"),
  );
  if (state) {
    $("processing-label").textContent = sources.length
      ? "Preparing your next good document…"
      : "Opening your documents…";
    const curtain = el("div", "busy-curtain");
    curtain.id = "busy-curtain";
    const inner = el("div");
    inner.append(
      el("span", "spinner"),
      el("strong", "", "A little document magic…"),
      el(
        "small",
        "",
        "Reading your files locally. Larger documents may take a moment.",
      ),
    );
    curtain.append(inner);
    $("dropzone").append(curtain);
  } else $("busy-curtain")?.remove();
  document
    .querySelectorAll(
      "#options input,#options select,#options button,#output-name,#add-files,#clear,#select-all,#select-none,#file-input,#prev-pages,#next-pages,#undo-mark,#undo-pages,#load-example,#close-preview,.file-row button,.page-card button,.page-card input",
    )
    .forEach((input) => {
      if (state) {
        disabledBeforeBusy.set(input, input.disabled);
        input.disabled = true;
      } else input.disabled = disabledBeforeBusy.get(input) || false;
    });
  if (!state) disabledBeforeBusy.clear();
  $("undo-pages").disabled = state || !pageHistory.length;
  document
    .querySelectorAll(
      "#save-project,#open-project,#save-preset,#presets,#delete-preset,#search-pages,#reverse-pages,#odd-pages,#even-pages,#continue-result,#next-recipe",
    )
    .forEach((input) => (input.disabled = state));
  $("cancel-task").hidden = !state;
  $("run").disabled = state || !pages.some((p) => p.selected);
  $("workspace").setAttribute("aria-busy", String(state));
}
function renderFiles() {
  $("file-list").replaceChildren();
  sources.forEach((source, index) => {
    const row = el("div", "file-row"),
      name = el("span", "file-name", source.name);
    name.title = source.name;
    row.append(
      el("span", "", String(index + 1).padStart(2, "0")),
      name,
      el("span", "file-size", sizes(source.size)),
    );
    for (const [label, delta] of [
      ["↑", -1],
      ["↓", 1],
    ]) {
      const button = el("button", "secondary", label);
      button.setAttribute(
        "aria-label",
        `Move ${source.name} ${delta < 0 ? "up" : "down"}`,
      );
      button.disabled = index + delta < 0 || index + delta >= sources.length;
      button.addEventListener("click", () => {
        rememberPages();
        [sources[index], sources[index + delta]] = [
          sources[index + delta],
          sources[index],
        ];
        // Moving a file deliberately regroups its pages in the new file order.
        pages = sources.flatMap((s) => pages.filter((p) => p.source === s));
        closePreview();
        renderFiles();
        renderPages();
        updateSummary();
      });
      row.append(button);
    }
    const remove = el("button", "text-button", "×");
    remove.setAttribute("aria-label", `Remove ${source.name}`);
    remove.addEventListener("click", async () => {
      sources = sources.filter((s) => s !== source);
      pages = pages.filter((p) => p.source !== source);
      pageHistory = [];
      thumbnailCache.clear();
      await source.viewer?.destroy();
      closePreview();
      renderFiles();
      renderPages();
      updateSummary();
      if (tool.id === "forms") renderFormFields();
    });
    row.append(remove);
    $("file-list").append(row);
  });
  updateSummary();
}
async function renderedPage(entry, dpi = 72) {
  const page = await entry.source.viewer.getPage(entry.index + 1);
  let scale = dpi / 72;
  const base = page.getViewport({
    scale: 1,
    rotation: (((page.rotate + entry.rotation) % 360) + 360) % 360,
  });
  if (base.width * base.height * scale * scale > 24e6)
    scale = Math.sqrt(24e6 / (base.width * base.height));
  const viewport = page.getViewport({
    scale,
    rotation: (((page.rotate + entry.rotation) % 360) + 360) % 360,
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
    background: "rgb(255,255,255)",
  }).promise;
  return { canvas, viewport };
}
async function renderPages() {
  const version = ++renderVersion;
  $("pages").replaceChildren();
  pageWindow = Math.min(
    pageWindow,
    Math.max(0, Math.ceil(pages.length / 24) - 1),
  );
  const start = pageWindow * 24,
    end = Math.min(start + 24, pages.length);
  $("page-window").textContent = pages.length
    ? `${start + 1}–${end} of ${pages.length}`
    : "No pages";
  $("prev-pages").disabled = pageWindow === 0;
  $("next-pages").disabled = end >= pages.length;
  const tasks = [];
  for (let index = start; index < end; index++) {
    const entry = pages[index],
      card = el("div", `page-card${entry === activePage ? " active" : ""}`),
      preview = el("button", "page-preview");
    preview.setAttribute(
      "aria-label",
      `Open page ${index + 1} from ${entry.source.name}`,
    );
    preview.addEventListener("click", () => openPreview(entry));
    card.append(preview);
    const label = el("label", "page-label"),
      checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = entry.selected;
    checkbox.setAttribute("aria-label", `Include page ${index + 1}`);
    checkbox.addEventListener("change", () => {
      rememberPages();
      entry.selected = checkbox.checked;
      if ($("page-ranges")) $("page-ranges").value = "";
      updateSummary();
    });
    label.append(
      checkbox,
      el(
        "span",
        "",
        `Page ${index + 1}${entry.marks.length ? " · edited" : ""}`,
      ),
    );
    card.append(label);
    const actions = el("div", "page-actions");
    for (const [symbol, title, action] of [
      [
        "←",
        "Move page left",
        () => {
          if (index > 0)
            [pages[index - 1], pages[index]] = [pages[index], pages[index - 1]];
        },
      ],
      [
        "↻",
        "Rotate page 90 degrees",
        () => {
          entry.rotation = (entry.rotation + 90) % 360;
          if (entry.marks.length) {
            entry.marks = [];
            status(
              "Page rotated. Its annotations were cleared; add them again in the new orientation.",
            );
          }
        },
      ],
      [
        "+",
        "Duplicate page",
        () =>
          pages.splice(index + 1, 0, {
            ...entry,
            id: crypto.randomUUID(),
            marks: entry.marks.map((m) => ({ ...m })),
          }),
      ],
      [
        "→",
        "Move page right",
        () => {
          if (index < pages.length - 1)
            [pages[index + 1], pages[index]] = [pages[index], pages[index + 1]];
        },
      ],
    ]) {
      const button = el("button", "", symbol);
      button.setAttribute("aria-label", `${title} (${index + 1})`);
      button.title = title;
      button.addEventListener("click", () => {
        rememberPages();
        action();
        closePreview();
        renderPages();
        updateSummary();
      });
      actions.append(button);
    }
    card.append(actions);
    $("pages").append(card);
    tasks.push({ entry, preview });
  }
  // Sequential thumbnail rendering bounds memory usage for large documents.
  for (const { entry, preview } of tasks) {
    if (version !== renderVersion) return;
    try {
      if (entry.source.kind === "image") {
        const image = el("img", "image-thumb");
        image.src = entry.source.data;
        image.alt = entry.source.name;
        image.style.transform = `rotate(${entry.rotation}deg)`;
        preview.append(image);
      } else {
        const key = `${entry.source.id}:${entry.index}:${entry.rotation}`;
        let data = thumbnailCache.get(key);
        if (!data) {
          const { canvas } = await renderedPage(entry, 20);
          data = canvas.toDataURL("image/png");
          if (thumbnailCache.size > 96) thumbnailCache.clear();
          thumbnailCache.set(key, data);
          canvas.width = canvas.height = 1;
        }
        if (version !== renderVersion) return;
        const image = el("img", "image-thumb");
        image.src = data;
        image.alt = `Page ${entry.index + 1}`;
        preview.append(image);
      }
    } catch (error) {
      preview.textContent = "Preview unavailable";
      preview.title = friendlyError(error);
    }
  }
}
function closePreview() {
  ++previewVersion;
  activePage = null;
  previewViewport = null;
  $("editor").hidden = true;
  $("marks").replaceChildren();
}
async function openPreview(entry) {
  if (busy || entry.source.kind !== "pdf") return;
  const version = ++previewVersion;
  activePage = entry;
  try {
    const { canvas, viewport } = await renderedPage(entry, 100);
    if (version !== previewVersion) {
      canvas.width = canvas.height = 1;
      return;
    }
    previewViewport = viewport;
    $("preview").width = canvas.width;
    $("preview").height = canvas.height;
    $("preview").getContext("2d").drawImage(canvas, 0, 0);
    canvas.width = canvas.height = 1;
    $("editor").hidden = false;
    $("editor-label").textContent =
      `Page ${pages.indexOf(entry) + 1} · ${entry.source.name}`;
    $("editor-help").textContent = ["edit", "sign", "redact"].includes(tool.id)
      ? "Click to place a mark, or focus the page and use arrow keys + Enter. Export to save your marks."
      : "Preview your page. Switch to Edit, Sign, or Redact to add marks.";
    $("marks").tabIndex = ["edit", "sign", "redact"].includes(tool.id) ? 0 : -1;
    renderMarks();
    $("editor").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    status(friendlyError(error), true);
  }
}
function renderMarks() {
  $("marks").replaceChildren();
  if (!activePage) return;
  const renderedWidth = $("preview-stage").getBoundingClientRect().width;
  for (const mark of activePage.marks) {
    const node = el("span", "mark");
    node.style.left = `${mark.left * 100}%`;
    node.style.top = `${mark.top * 100}%`;
    node.style.width = `${mark.w * 100}%`;
    node.style.height = `${mark.h * 100}%`;
    if (mark.kind === "text") {
      node.textContent = mark.text;
      node.style.color = mark.color;
      node.style.fontSize = `${(mark.size * previewViewport.scale * renderedWidth) / previewViewport.width}px`;
    } else if (mark.kind === "signature" || mark.kind === "image") {
      const image = el("img");
      image.src = mark.data;
      image.alt = "";
      node.append(image);
    } else
      node.style.background =
        mark.kind === "redact" ? "#000" : `${mark.color}4d`;
    $("marks").append(node);
  }
}
async function addMark(event) {
  if (
    busy ||
    !activePage ||
    !previewViewport ||
    !["edit", "sign", "redact"].includes(tool.id)
  )
    return;
  setBusy(true);
  status("Preparing your annotation…");
  try {
    const target = activePage,
      viewport = previewViewport,
      rect = $("marks").getBoundingClientRect(),
      left = (event.clientX - rect.left) / rect.width,
      top = (event.clientY - rect.top) / rect.height;
    const kind =
      tool.id === "sign"
        ? "signature"
        : tool.id === "redact"
          ? "redact"
          : value("mark-kind");
    let w = 0.3,
      h = 0.05,
      data = null,
      text = "",
      fontSize = 18,
      color = "#5065c9";
    if (kind === "signature") {
      if (!signatureDirty) throw new Error("Draw your signature first.");
      data = $("signature").toDataURL("image/png");
      w = number("signature-width", 1, 100) / 100;
      h = w * (240 / 660) * (viewport.width / viewport.height);
    } else if (kind === "redact") {
      w = number("redact-width", 1, 100) / 100;
      h = number("redact-height", 1, 100) / 100;
    } else {
      color = value("mark-color");
      if (kind === "text") fontSize = number("font-size", 1, 200);
      else {
        w = number("mark-width", 1, 100) / 100;
        h = number("mark-height", 1, 100) / 100;
      }
      if (kind === "text") {
        text = value("annotation-text");
        if (!text.trim()) throw new Error("Enter the text to add first.");
        const font = await C.fontFor(target.source.doc);
        C.assertTextSupported(text, font);
        w =
          (font.widthOfTextAtSize(text, fontSize) * viewport.scale) /
          viewport.width;
        h = (fontSize * 1.2 * viewport.scale) / viewport.height;
      }
      if (kind === "image") {
        const file = $("annotation-image").files[0];
        if (!file)
          throw new Error("Choose a PNG or JPG annotation image first.");
        if (file.size > 10 * 1024 * 1024)
          throw new Error("Annotation images must be under 10 MB.");
        data = await readDataURL(file);
      }
    }
    if (taskController.signal.aborted)
      throw new DOMException("Processing cancelled.", "AbortError");
    if (activePage !== target || previewViewport !== viewport) return;
    w = Math.min(w, 1 - left);
    h = Math.min(h, 1 - top);
    if (w <= 0 || h <= 0) return;
    const [x, y] = viewport.convertToPdfPoint(
      left * viewport.width,
      (top + h) * viewport.height,
    );
    const a = viewport.convertToPdfPoint(
        left * viewport.width,
        top * viewport.height,
      ),
      b = viewport.convertToPdfPoint(
        (left + w) * viewport.width,
        (top + h) * viewport.height,
      );
    const mark = {
      kind,
      left,
      top,
      w,
      h,
      x,
      y,
      width: (w * viewport.width) / viewport.scale,
      height: (h * viewport.height) / viewport.scale,
      angle: viewport.rotation,
      size: fontSize,
      color,
      text,
      data,
    };
    if (kind === "highlight") {
      mark.x = Math.min(a[0], b[0]);
      mark.y = Math.min(a[1], b[1]);
      mark.width = Math.abs(a[0] - b[0]);
      mark.height = Math.abs(a[1] - b[1]);
    }
    target.marks.push(mark);
    renderMarks();
    status("Mark added. Export to save it into your document.");
  } catch (error) {
    status(friendlyError(error), true);
  } finally {
    setBusy(false);
  }
}
function readDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}
function setupSignature(canvas) {
  signatureDirty = false;
  let drawing = false;
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#243047";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * canvas.width) / r.width,
      ((e.clientY - r.top) * canvas.height) / r.height,
    ];
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (busy) return;
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...point(e));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing || busy) return;
    ctx.lineTo(...point(e));
    ctx.stroke();
    signatureDirty = true;
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    canvas.addEventListener(name, () => (drawing = false));
}
function renderFormFields() {
  const host = $("form-fields");
  if (!host) return;
  host.replaceChildren();
  if (sources.length !== 1 || sources[0].kind !== "pdf") {
    host.append(
      el(
        "p",
        "option-note",
        "Add exactly one PDF to inspect its fillable fields.",
      ),
    );
    return;
  }
  try {
    const fields = sources[0].doc.getForm().getFields();
    if (!fields.length) {
      host.append(
        el(
          "p",
          "option-note",
          "No standard fillable fields found. Use Edit & annotate to place text on a flat form.",
        ),
      );
      return;
    }
    for (const item of fields) {
      const label = el("label", "field form-field-name", item.getName());
      let input;
      if (item instanceof P.PDFTextField) {
        input = el("input");
        input.value = item.getText() || "";
      } else if (item instanceof P.PDFCheckBox) {
        input = el("input");
        input.type = "checkbox";
        input.checked = item.isChecked();
      } else if (
        item instanceof P.PDFDropdown ||
        item instanceof P.PDFRadioGroup ||
        item instanceof P.PDFOptionList
      ) {
        input = el("select");
        const blank = el("option", "", "(No selection)");
        blank.value = "";
        input.append(blank);
        for (const option of item.getOptions()) {
          const node = el("option", "", option);
          node.value = option;
          input.append(node);
        }
        const selected =
          item instanceof P.PDFRadioGroup
            ? item.getSelected()
            : item.getSelected()[0];
        input.value = selected || "";
      } else continue;
      input.dataset.formName = item.getName();
      label.append(input);
      host.append(label);
    }
    const label = el("label", "field"),
      check = el("input");
    check.type = "checkbox";
    check.id = "flatten-form";
    check.checked = true;
    label.append(check, document.createTextNode("Flatten filled fields"));
    host.append(label);
  } catch (error) {
    host.append(el("p", "option-note", friendlyError(error)));
  }
}
async function extractText(entry) {
  const page = await entry.source.viewer.getPage(entry.index + 1),
    content = await page.getTextContent();
  let text = "",
    previousY = null;
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const y = item.transform[5];
    if (
      previousY !== null &&
      Math.abs(y - previousY) > 3 &&
      !text.endsWith("\n")
    )
      text += "\n";
    text += item.str + (item.hasEOL ? "\n" : " ");
    previousY = y;
  }
  return text.trim();
}
function announceProgress(i, total) {
  if (taskController?.signal.aborted)
    throw new DOMException("Processing cancelled.", "AbortError");
  $("progress").max = total;
  $("progress").value = i;
  status(`Processing page ${i} of ${total}…`);
}
function requireOriginal(count = 1) {
  if (
    sources.length !== count ||
    sources.some((source) => source.kind !== "pdf")
  )
    throw new Error(
      `This tool needs exactly ${count} original PDF${count === 1 ? "" : "s"}.`,
    );
  const original = sources.flatMap((source) =>
    Array.from({ length: source.doc.getPageCount() }, (_, index) => ({
      source,
      index,
    })),
  );
  if (
    pages.length !== original.length ||
    pages.some(
      (page, i) =>
        !page.selected ||
        page.source !== original[i].source ||
        page.index !== original[i].index ||
        page.rotation ||
        page.marks.length,
    )
  )
    throw new Error(
      "This tool works with original PDFs. Clear and re-add your files to reset page edits and selections.",
    );
}
function report(title, rows) {
  const host = $("analysis-panel");
  host.replaceChildren(el("h3", "", title));
  const list = el("ul");
  for (const row of rows) list.append(el("li", "", row));
  host.append(list);
  host.hidden = false;
}
async function withRenderedEntries(entries, action) {
  if (!entries.some((entry) => entry.marks.length)) return action(renderedPage);
  const doc = await C.assemble(entries);
  await C.applyMarks(doc, entries);
  const viewer = await pdfjs.getDocument({
    data: await doc.save(),
    standardFontDataUrl: "../../pdfjs/web/standard_fonts/",
    cMapUrl: "../../pdfjs/web/cmaps/",
    cMapPacked: true,
    wasmUrl: "../../pdfjs/web/wasm/",
  }).promise;
  const indices = new Map(entries.map((entry, index) => [entry.id, index]));
  try {
    return await action((entry, dpi) =>
      renderedPage(
        { source: { viewer }, index: indices.get(entry.id), rotation: 0 },
        dpi,
      ),
    );
  } finally {
    await viewer.destroy();
  }
}
async function runAdvanced(entries) {
  const signal = taskController.signal,
    progress = announceProgress;
  if (tool.id === "ocr")
    return withRenderedEntries(entries, (render) =>
      Premium.ocr(entries, render, {
        language: value("ocr-language"),
        format: value("ocr-format"),
        signal,
        progress: (label, fraction) => {
          if (signal.aborted) return;
          $("progress").max = 1;
          $("progress").value = Number.isFinite(fraction) ? fraction : 0;
          status(label);
        },
      }),
    );
  if (tool.id === "scan")
    return {
      doc: await withRenderedEntries(entries, (render) =>
        Premium.clean(entries, render, {
          mode: value("scan-mode"),
          contrast: number("scan-contrast", 0, 100),
          threshold: number("scan-threshold", 0, 255),
          progress,
          signal,
        }),
      ),
    };
  if (tool.id === "compare") {
    requireOriginal(2);
    const result = await Premium.compare(sources, renderedPage, {
      threshold: number("compare-threshold", 0, 255),
      progress,
      signal,
    });
    report(
      "Comparison results",
      result.rows.map((row) => `Page ${row.page}: ${row.change}`),
    );
    return {
      doc: result.doc,
      message: `Comparison ready. ${result.rows.filter((row) => row.changed).length} of ${result.rows.length} page pairs differ visually. Review the PDF report.`,
    };
  }
  if (["unlock", "web", "repair"].includes(tool.id)) {
    requireOriginal();
    if (tool.id === "unlock") return { bytes: sources[0].bytes };
    return {
      bytes: await Premium.qpdf(sources[0].bytes, { mode: tool.id }, signal),
    };
  }
  if (tool.id === "protect") {
    const password = value("protect-password");
    if (Array.from(password).length < 8)
      throw new Error("Use a password with at least 8 characters.");
    if (password.includes("\0"))
      throw new Error("Passwords cannot contain a null character.");
    if (password !== value("protect-confirm"))
      throw new Error("The passwords do not match.");
    const doc = await C.assemble(entries);
    await C.applyMarks(doc, entries);
    const owner = Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    return {
      bytes: await Premium.qpdf(
        await doc.save(),
        { mode: "protect", password, owner },
        signal,
      ),
      protected: true,
    };
  }
  if (tool.id === "interleave") {
    const groups = sources.map((source) =>
      entries.filter((entry) => entry.source === source),
    );
    if (groups.length < 2)
      throw new Error("Add at least two PDFs to alternate their pages.");
    if (value("interleave-reverse") === "reverse") groups[1].reverse();
    const reordered = X.interleave(groups),
      doc = await C.assemble(reordered);
    await C.applyMarks(doc, reordered);
    return { doc };
  }
  if (tool.id === "blank") {
    const coverage = number("blank-coverage", 0, 5) / 100,
      kept = [],
      removed = [];
    await withRenderedEntries(entries, async (render) => {
      for (let i = 0; i < entries.length; i++) {
        progress(i + 1, entries.length);
        const { canvas } = await render(entries[i], 36),
          data = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let j = 0; j < data.length; j += 4)
          if (Math.min(data[j], data[j + 1], data[j + 2]) < 220) dark++;
        if (dark / (data.length / 4) <= coverage)
          removed.push(
            `Page ${pages.indexOf(entries[i]) + 1} · ${entries[i].source.name}`,
          );
        else kept.push(entries[i]);
        canvas.width = canvas.height = 1;
      }
    });
    report(
      "Blank-page detection",
      removed.length
        ? removed.map((name) => `Removed: ${name}`)
        : ["No blank pages found."],
    );
    if (!kept.length)
      throw new Error(
        "Every selected page was classified as blank. Lower the threshold or choose a different tool.",
      );
    const doc = await C.assemble(kept);
    await C.applyMarks(doc, kept);
    return {
      doc,
      message: `Removed ${removed.length} visually blank pages; kept ${kept.length}. Review the report and keep the original.`,
    };
  }
  if (tool.id === "compress" && value("batch-mode") === "separate") {
    const files = {},
      mode = value("compression");
    let index = 0;
    for (const source of sources) {
      const group = entries.filter((entry) => entry.source === source);
      if (!group.length) continue;
      progress(++index, sources.length);
      let doc =
        mode === "lossless"
          ? await C.assemble(group)
          : await rasterPdf(
              group,
              mode === "small" ? 72 : 120,
              mode === "small" ? 0.5 : 0.75,
            );
      if (mode === "lossless") await C.applyMarks(doc, group);
      let bytes = await doc.save();
      if (
        mode === "lossless" &&
        group.length === source.doc.getPageCount() &&
        group.every(
          (entry, i) =>
            entry.index === i && !entry.rotation && !entry.marks.length,
        ) &&
        bytes.length > source.bytes.length
      )
        bytes = source.bytes;
      files[
        `${String(index).padStart(3, "0")}-${C.safeName(source.name.replace(/\.pdf$/i, ""))}.pdf`
      ] = bytes;
    }
    return {
      bytes: C.zip(files),
      extension: "zip",
      mime: "application/zip",
      message: `Batch ready. ${index} separately compressed PDFs are in your ZIP.`,
    };
  }
  const doc = await C.assemble(entries);
  await C.applyMarks(doc, entries);
  if (["resize", "nup", "booklet"].includes(tool.id)) {
    const dimensions = {
      a4: [595.28, 841.89],
      letter: [612, 792],
      legal: [612, 1008],
      a3: [841.89, 1190.55],
    };
    let [width, height] = dimensions[value("paper-size")];
    if (tool.id === "booklet" || value("paper-orientation") === "landscape")
      [width, height] = [height, width];
    const result = await X.impose(doc, {
      mode: tool.id === "booklet" ? "booklet" : "nup",
      count:
        tool.id === "resize"
          ? 1
          : tool.id === "booklet"
            ? 2
            : Number(value("pages-per-sheet")),
      width,
      height,
      margin: number("sheet-margin", 0, 200),
      gap: tool.id === "resize" ? 0 : number("sheet-gap", 0, 200),
    });
    return { doc: result };
  }
  if (tool.id === "bookmarks") X.addBookmarks(doc, value("bookmark-lines"));
  if (tool.id === "bates") {
    const start = number("bates-start", 0, 999999999),
      digits = number("bates-digits", 1, 12);
    if (!Number.isInteger(start) || !Number.isInteger(digits))
      throw new Error("Starting number and digit count must be whole numbers.");
    const font = await C.fontFor(doc);
    for (let i = 0; i < entries.length; i++) {
      const page = doc.getPage(i),
        original = await entries[i].source.viewer.getPage(entries[i].index + 1),
        viewport = original.getViewport({
          scale: 1,
          rotation: page.getRotation().angle,
        }),
        text =
          value("bates-prefix") +
          String(start + i).padStart(digits, "0") +
          value("bates-suffix"),
        textWidth = font.widthOfTextAtSize(text, 10);
      if (textWidth > viewport.width - 30)
        throw new Error(
          "The Bates identifier is too long for a page. Shorten its prefix or suffix.",
        );
      const [x, y] = viewport.convertToPdfPoint(
        (viewport.width - textWidth) / 2,
        viewport.height - 18,
      );
      page.drawText(text, {
        x,
        y,
        size: 10,
        font,
        rotate: P.degrees(viewport.rotation),
      });
    }
  }
  return { doc };
}
async function rasterPdf(entries, dpi, quality, redact = false) {
  const output = await P.PDFDocument.create();
  // Bake annotations into a temporary PDF so the renderer and export agree.
  const marked = await C.assemble(entries);
  await C.applyMarks(marked, entries);
  const viewer = await pdfjs.getDocument({
    data: await marked.save(),
    standardFontDataUrl: "../../pdfjs/web/standard_fonts/",
    cMapUrl: "../../pdfjs/web/cmaps/",
    cMapPacked: true,
    wasmUrl: "../../pdfjs/web/wasm/",
  }).promise;
  try {
    for (let i = 0; i < entries.length; i++) {
      announceProgress(i + 1, entries.length);
      const page = await viewer.getPage(i + 1),
        base = page.getViewport({ scale: 1 });
      let scale = dpi / 72;
      if (base.width * base.height * scale * scale > 24e6)
        scale = Math.sqrt(24e6 / (base.width * base.height));
      const viewport = page.getViewport({ scale }),
        canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({
        canvasContext: ctx,
        viewport,
        background: "rgb(255,255,255)",
      }).promise;
      if (redact) {
        ctx.fillStyle = "#000";
        for (const mark of entries[i].marks.filter(
          (m) => m.kind === "redact",
        )) {
          const x = Math.floor(mark.left * canvas.width),
            y = Math.floor(mark.top * canvas.height);
          ctx.fillRect(
            x,
            y,
            Math.ceil(mark.w * canvas.width) + 1,
            Math.ceil(mark.h * canvas.height) + 1,
          );
        }
      }
      const image = await output.embedJpg(
          canvas.toDataURL("image/jpeg", quality),
        ),
        target = output.addPage([base.width, base.height]);
      target.drawImage(image, {
        x: 0,
        y: 0,
        width: base.width,
        height: base.height,
      });
      canvas.width = canvas.height = 1;
    }
  } finally {
    await viewer.destroy();
  }
  return output;
}
async function run() {
  if (busy) return;
  let entries = pages.filter((p) => p.selected);
  if (!entries.length) {
    status("Select at least one page.", true);
    return;
  }
  if ($("page-ranges")?.value.trim()) {
    try {
      const requested = C.parseRanges(value("page-ranges"), pages.length);
      entries = requested.map((i) => pages[i]);
    } catch (error) {
      status(error.message, true);
      return;
    }
  }
  setBusy(true);
  status("Preparing your document…");
  try {
    if (
      tool.id !== "images-pdf" &&
      entries.some((e) => e.source.kind !== "pdf")
    )
      throw new Error(
        "This tool needs PDF files. Clear the workspace and choose PDFs.",
      );
    if (
      tool.id !== "redact" &&
      entries.some((e) => e.marks.some((m) => m.kind === "redact"))
    )
      throw new Error(
        "This workspace contains redaction marks. Export with Redact PDF to permanently remove the content, or undo those marks first.",
      );
    let bytes,
      extension = "pdf",
      mime = "application/pdf",
      doc;
    let premiumResult;
    if (
      [
        "ocr",
        "compare",
        "protect",
        "unlock",
        "scan",
        "resize",
        "nup",
        "booklet",
        "interleave",
        "bates",
        "bookmarks",
        "blank",
        "web",
        "repair",
      ].includes(tool.id) ||
      (tool.id === "compress" && value("batch-mode") === "separate")
    ) {
      premiumResult = await runAdvanced(entries);
      ({ bytes, doc } = premiumResult);
      extension = premiumResult.extension || "pdf";
      mime = premiumResult.mime || "application/pdf";
    } else if (tool.id === "images-pdf") {
      if (entries.some((e) => e.source.kind !== "image"))
        throw new Error(
          "Clear the workspace and choose image files for this tool.",
        );
      doc = await P.PDFDocument.create();
      for (const entry of entries) {
        const s = entry.source,
          image = await doc.embedPng(s.data),
          mode = value("image-page");
        let width, height;
        if (mode === "fit") {
          const ratio = Math.min(1, 14400 / Math.max(s.width, s.height));
          width = s.width * ratio * 0.75;
          height = s.height * ratio * 0.75;
        } else [width, height] = mode === "a4" ? [595.28, 841.89] : [612, 792];
        const page = doc.addPage([width, height]),
          margin = mode === "fit" ? 0 : 24,
          ratio = Math.min(
            (width - margin * 2) / s.width,
            (height - margin * 2) / s.height,
          );
        page.drawImage(image, {
          x: (width - s.width * ratio) / 2,
          y: (height - s.height * ratio) / 2,
          width: s.width * ratio,
          height: s.height * ratio,
        });
        page.setRotation(P.degrees(entry.rotation));
      }
    } else if (tool.id === "forms" || tool.id === "metadata") {
      if (sources.length !== 1)
        throw new Error(
          "This tool works with exactly one PDF. Remove the other files first.",
        );
      if (
        pages.length !== sources[0].doc.getPageCount() ||
        entries.length !== pages.length ||
        pages.some((p, i) => p.index !== i || p.rotation || p.marks.length)
      )
        throw new Error(
          "Forms and document details keep the original document. Clear and re-add the PDF to reset page changes first.",
        );
      doc = await P.PDFDocument.load(sources[0].bytes.slice());
      if (tool.id === "metadata") {
        doc.setTitle(value("meta-title"));
        doc.setAuthor(value("meta-author"));
        doc.setSubject(value("meta-subject"));
        doc.setKeywords(
          value("meta-keywords")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        doc.setCreator("");
        doc.setProducer("");
      } else {
        const form = doc.getForm();
        if (form.hasXFA())
          throw new Error(
            "XFA forms are not supported. Use a standard AcroForm PDF.",
          );
        for (const input of document.querySelectorAll("[data-form-name]")) {
          const f = form.getField(input.dataset.formName);
          if (f instanceof P.PDFTextField) f.setText(input.value);
          else if (f instanceof P.PDFCheckBox)
            input.checked ? f.check() : f.uncheck();
          else if (input.value) f.select(input.value);
          else if (f instanceof P.PDFRadioGroup) f.clear();
          else f.clear();
        }
        if ($("flatten-form")?.checked) form.flatten();
      }
    } else if (tool.id === "text" || tool.id === "pdf-word") {
      const text = [];
      for (let i = 0; i < entries.length; i++) {
        announceProgress(i + 1, entries.length);
        text.push(await extractText(entries[i]));
      }
      if (!text.some((t) => t.trim()))
        throw new Error(
          "No selectable text found. Use OCR · searchable PDF first, then continue with the searchable result.",
        );
      if (tool.id === "text") {
        bytes = new TextEncoder().encode(text.join("\n\n\f\n\n"));
        extension = "txt";
        mime = "text/plain;charset=utf-8";
      } else {
        bytes = C.textDocx(text);
        extension = "docx";
        mime =
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      }
    } else if (tool.id === "pdf-images") {
      // Include user annotations in image conversion.
      doc = await C.assemble(entries);
      await C.applyMarks(doc, entries);
      const viewer = await pdfjs.getDocument({
        data: await doc.save(),
        standardFontDataUrl: "../../pdfjs/web/standard_fonts/",
        cMapUrl: "../../pdfjs/web/cmaps/",
        cMapPacked: true,
        wasmUrl: "../../pdfjs/web/wasm/",
      }).promise;
      const files = {};
      try {
        for (let i = 0; i < entries.length; i++) {
          announceProgress(i + 1, entries.length);
          const fake = { source: { viewer }, index: i, rotation: 0 },
            { canvas } = await renderedPage(fake, Number(value("image-dpi"))),
            format = value("image-format");
          const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, `image/${format}`, 0.9),
          );
          if (!blob)
            throw new Error("Image rendering failed. Try a lower resolution.");
          files[
            `page-${String(i + 1).padStart(3, "0")}.${format === "jpeg" ? "jpg" : "png"}`
          ] = new Uint8Array(await blob.arrayBuffer());
          canvas.width = canvas.height = 1;
        }
      } finally {
        await viewer.destroy();
      }
      bytes = C.zip(files);
      extension = "zip";
      mime = "application/zip";
      doc = null;
    } else if (tool.id === "split") {
      const group =
        value("split-mode") === "each"
          ? 1
          : number("group-size", 1, entries.length);
      if (!Number.isInteger(group))
        throw new Error("Pages per group must be a whole number.");
      const files = {};
      for (let i = 0; i < entries.length; i += group) {
        announceProgress(i + 1, entries.length);
        const subset = entries.slice(i, i + group),
          part = await C.assemble(subset);
        await C.applyMarks(part, subset);
        files[
          `pages-${String(i + 1).padStart(3, "0")}-${String(i + subset.length).padStart(3, "0")}.pdf`
        ] = await part.save();
      }
      bytes = C.zip(files);
      extension = "zip";
      mime = "application/zip";
    } else if (
      tool.id === "redact" ||
      tool.id === "flatten" ||
      (tool.id === "compress" && value("compression") !== "lossless")
    ) {
      if (
        tool.id === "redact" &&
        !entries.some((e) => e.marks.some((m) => m.kind === "redact"))
      )
        throw new Error("Mark at least one area to redact before exporting.");
      const small = tool.id === "compress" && value("compression") === "small";
      doc = await rasterPdf(
        entries,
        small ? 72 : tool.id === "compress" ? 120 : 144,
        small ? 0.5 : tool.id === "compress" ? 0.75 : 0.95,
        tool.id === "redact",
      );
    } else {
      doc = await C.assemble(entries);
      await C.applyMarks(doc, entries);
      if (tool.id === "watermark") {
        const text = value("watermark-text");
        if (!text.trim()) throw new Error("Enter watermark text.");
        const size = number("watermark-size", 1, 300),
          opacity = number("watermark-opacity", 1, 100) / 100,
          font = await C.fontFor(doc);
        C.assertTextSupported(text, font);
        for (const page of doc.getPages()) {
          const box = page.getCropBox(),
            width = font.widthOfTextAtSize(text, size);
          if (width > box.width - 16)
            throw new Error(
              "Watermark is too wide. Reduce the font size or shorten the text.",
            );
          page.drawText(text, {
            x: box.x + (box.width - width) / 2,
            y: box.y + box.height / 2,
            size,
            font,
            color: C.hex(value("watermark-color")),
            opacity,
          });
        }
      }
      if (tool.id === "numbers") {
        const start = number("number-start", 0, 99999);
        if (!Number.isInteger(start))
          throw new Error("Starting page number must be a whole number.");
        const font = await C.fontFor(doc);
        doc.getPages().forEach((page, i) => {
          const text = value("number-prefix") + String(start + i),
            width = font.widthOfTextAtSize(text, 10),
            box = page.getCropBox();
          C.assertTextSupported(text, font);
          page.drawText(text, {
            x: box.x + (box.width - width) / 2,
            y:
              box.y +
              (value("number-position") === "top" ? box.height - 25 : 18),
            size: 10,
            font,
            color: P.rgb(0.25, 0.3, 0.4),
          });
        });
      }
      if (tool.id === "crop") {
        const t = number("crop-top", 0, 10000),
          r = number("crop-right", 0, 10000),
          b = number("crop-bottom", 0, 10000),
          l = number("crop-left", 0, 10000);
        for (const page of doc.getPages()) {
          const box = page.getCropBox();
          if (l + r >= box.width || t + b >= box.height)
            throw new Error(
              "These margins would remove an entire page. Choose smaller trim values.",
            );
          page.setCropBox(
            box.x + l,
            box.y + b,
            box.width - l - r,
            box.height - t - b,
          );
        }
      }
    }
    if (doc) bytes = await doc.save({ useObjectStreams: true });
    let originalKept = false;
    if (
      tool.id === "compress" &&
      extension === "pdf" &&
      value("compression") === "lossless" &&
      sources.length === 1 &&
      entries.length === sources[0].doc.getPageCount() &&
      entries.every(
        (e, i) => e.index === i && !e.rotation && !e.marks.length,
      ) &&
      bytes.length >= sources[0].bytes.length
    ) {
      bytes = sources[0].bytes;
      originalKept = true;
    }
    if (taskController.signal.aborted)
      throw new DOMException("Processing cancelled.", "AbortError");
    saveResult(
      bytes,
      `${C.safeName(value("output-name"))}.${extension}`,
      mime,
      { protected: premiumResult?.protected },
    );
    updateWorkflow(true);
    const originalSize = sources.reduce((sum, s) => sum + s.size, 0),
      delta = originalSize
        ? Math.round((1 - bytes.length / originalSize) * 100)
        : 0;
    status(
      premiumResult?.message ||
        `${originalKept ? "Already optimized; the original was kept." : "Done. Your download is ready."} ${sizes(bytes.length)}${tool.id === "compress" ? (delta > 0 ? ` · ${delta}% smaller than the input.` : " · No size reduction. Try image compression for image-heavy PDFs.") : ""}`,
    );
  } catch (error) {
    status(friendlyError(error), true);
  } finally {
    setBusy(false);
  }
}
function saveResult(bytes, name, mime, options = {}) {
  if (resultURL) URL.revokeObjectURL(resultURL);
  resultURL = URL.createObjectURL(new Blob([bytes], { type: mime }));
  lastResult = {
    bytes,
    name,
    mime,
    protected: !!options.protected,
    toolId: tool.id,
  };
  const link = $("download");
  link.href = resultURL;
  link.download = name;
  link.hidden = false;
  $("result-card").hidden = false;
  $("result-details").textContent = `${name} · ${sizes(bytes.length)}`;
  link.click();
  $("continue-result").hidden =
    mime !== "application/pdf" || !!options.protected;
  renderRecipe();
}
async function clearWorkspace() {
  if (busy) return;
  setBusy(true);
  ++renderVersion;
  closePreview();
  for (const source of sources) await source.viewer?.destroy();
  sources = [];
  pages = [];
  pageHistory = [];
  lastResult = null;
  thumbnailCache.clear();
  if (resultURL) URL.revokeObjectURL(resultURL);
  resultURL = null;
  $("download").hidden = true;
  $("result-card").hidden = true;
  $("analysis-panel").hidden = true;
  $("search-results").hidden = true;
  $("search-count").textContent = "";
  $("file-input").value = "";
  $("output-name").value = "studio-document";
  renderFiles();
  renderPages();
  if (tool.id === "forms") renderFormFields();
  status("Workspace cleared. Choose files to start again.");
  setBusy(false);
}
function captureSettings() {
  const settings = {};
  for (const input of document.querySelectorAll(
    "#options input,#options select,#options textarea",
  )) {
    if (
      !input.id ||
      input.id === "page-ranges" ||
      ["file", "password"].includes(input.type) ||
      /^signature|annotation-text/.test(input.id)
    )
      continue;
    settings[input.id] =
      input.type === "checkbox" ? input.checked : input.value;
  }
  return settings;
}
function restoreSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  for (const [id, val] of Object.entries(settings)) {
    const input = $(id);
    if (
      !input ||
      !$("options").contains(input) ||
      ["file", "password"].includes(input.type)
    )
      continue;
    if (input.type === "checkbox") input.checked = !!val;
    else if (
      typeof val === "string" &&
      (input.tagName !== "SELECT" ||
        [...input.options].some((option) => option.value === val))
    )
      input.value = val;
  }
  updateEditOptions();
}
function renderPresets() {
  const select = $("presets");
  select.replaceChildren(el("option", "", "Choose a preset…"));
  for (const preset of presets) {
    const option = el("option", "", preset.name);
    option.value = preset.id;
    select.append(option);
  }
}
function downloadFile(bytes, name, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime })),
    link = el("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function saveProject() {
  if (busy) return;
  if (!sources.length) {
    status("Add documents before saving a workspace.", true);
    return;
  }
  setBusy(true);
  try {
    const files = {},
      manifest = {
        format: "pdf-studio",
        version: 1,
        tool: tool.id,
        settings: captureSettings(),
        output: value("output-name"),
        sources: sources.map((source, index) => {
          const path = `sources/${index}.bin`;
          files[path] = source.bytes;
          return { id: source.id, name: source.name, kind: source.kind, path };
        }),
        pages: pages.map((page) => ({
          id: page.id,
          source: page.source.id,
          index: page.index,
          rotation: page.rotation,
          selected: page.selected,
          marks: page.marks,
        })),
      };
    files["workspace.json"] = new TextEncoder().encode(
      JSON.stringify(manifest),
    );
    downloadFile(
      C.zip(files),
      `${C.safeName(value("output-name"))}.pdfstudio`,
      "application/zip",
    );
    status(
      "Workspace saved to your device. It contains your documents and placed marks, including signatures; passwords are excluded.",
    );
  } catch (error) {
    status(friendlyError(error), true);
  } finally {
    setBusy(false);
  }
}
function validateProject(manifest, files) {
  if (
    manifest?.format !== "pdf-studio" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.sources) ||
    !Array.isArray(manifest.pages) ||
    !manifest.sources.length ||
    !manifest.pages.length ||
    typeof manifest.output !== "string" ||
    typeof manifest.tool !== "string" ||
    manifest.sources.length > 100 ||
    manifest.pages.length > 10000
  )
    throw new Error("Unsupported or oversized PDF Studio workspace.");
  const sourceIds = new Set(),
    pageIds = new Set();
  for (const source of manifest.sources) {
    if (
      typeof source.id !== "string" ||
      sourceIds.has(source.id) ||
      typeof source.name !== "string" ||
      source.name.length > 255 ||
      !["pdf", "image"].includes(source.kind) ||
      !/^sources\/\d+\.bin$/.test(source.path) ||
      !files[source.path] ||
      !files[source.path].length ||
      files[source.path].length > 150 * 1024 * 1024
    )
      throw new Error("Workspace source files are invalid.");
    sourceIds.add(source.id);
  }
  for (const page of manifest.pages) {
    if (
      typeof page.id !== "string" ||
      pageIds.has(page.id) ||
      !sourceIds.has(page.source) ||
      !Number.isInteger(page.index) ||
      page.index < 0 ||
      ![0, 90, 180, 270].includes(page.rotation) ||
      typeof page.selected !== "boolean" ||
      !Array.isArray(page.marks) ||
      page.marks.length > 1000
    )
      throw new Error("Workspace pages are invalid.");
    pageIds.add(page.id);
    for (const mark of page.marks) {
      if (
        !["text", "highlight", "image", "signature", "redact"].includes(
          mark.kind,
        ) ||
        ![
          "left",
          "top",
          "w",
          "h",
          "x",
          "y",
          "width",
          "height",
          "angle",
          "size",
        ].every((key) => Number.isFinite(mark[key])) ||
        !["left", "top", "w", "h"].every(
          (key) => mark[key] >= 0 && mark[key] <= 1,
        ) ||
        mark.left + mark.w > 1.01 ||
        mark.top + mark.h > 1.01 ||
        Math.abs(mark.x) > 1e7 ||
        Math.abs(mark.y) > 1e7 ||
        mark.width < 0 ||
        mark.height < 0 ||
        mark.width > 1e7 ||
        mark.height > 1e7 ||
        !/^#[\da-f]{6}$/i.test(mark.color) ||
        typeof mark.text !== "string" ||
        mark.text.length > 10000
      )
        throw new Error("Workspace annotations are invalid.");
      if (
        ["signature", "image"].includes(mark.kind) &&
        (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(mark.data) ||
          mark.data.length > 15 * 1024 * 1024)
      )
        throw new Error("Workspace image annotations are invalid.");
    }
  }
}
async function openProject(file) {
  if (!file || busy) return;
  setBusy(true);
  const loaded = [];
  try {
    if (file.size > 250 * 1024 * 1024)
      throw new Error("Workspace archive exceeds 250 MB.");
    let expanded = 0;
    const files = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        expanded += entry.originalSize || 0;
        if (expanded > 300 * 1024 * 1024)
          throw new Error("Workspace expands beyond 300 MB.");
        return (
          entry.name === "workspace.json" ||
          /^sources\/\d+\.bin$/.test(entry.name)
        );
      },
    });
    if (
      !files["workspace.json"] ||
      files["workspace.json"].length > 50 * 1024 * 1024
    )
      throw new Error("Workspace manifest is missing or oversized.");
    const manifest = JSON.parse(
      new TextDecoder().decode(files["workspace.json"]),
    );
    validateProject(manifest, files);
    for (const descriptor of manifest.sources) {
      if (taskController.signal.aborted)
        throw new DOMException("Processing cancelled.", "AbortError");
      const source = {
        ...descriptor,
        bytes: files[descriptor.path],
        size: files[descriptor.path].length,
      };
      if (source.kind === "pdf") {
        source.doc = await P.PDFDocument.load(source.bytes.slice());
        source.viewer = await pdfjs.getDocument({
          data: source.bytes.slice(),
          standardFontDataUrl: "../../pdfjs/web/standard_fonts/",
          cMapUrl: "../../pdfjs/web/cmaps/",
          cMapPacked: true,
          wasmUrl: "../../pdfjs/web/wasm/",
        }).promise;
      } else {
        const bitmap = await createImageBitmap(new Blob([source.bytes]));
        if (bitmap.width * bitmap.height > 40e6) {
          bitmap.close();
          throw new Error("A workspace image exceeds 40 megapixels.");
        }
        const canvas = el("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        bitmap.close();
        source.data = canvas.toDataURL("image/png");
        source.width = canvas.width;
        source.height = canvas.height;
        canvas.width = canvas.height = 1;
      }
      loaded.push(source);
    }
    const restored = manifest.pages.map((page) => {
      const source = loaded.find((source) => source.id === page.source);
      if (page.index >= (source.doc?.getPageCount() || 1))
        throw new Error("A workspace page points outside its document.");
      return { ...page, source };
    });
    if (taskController.signal.aborted)
      throw new DOMException("Processing cancelled.", "AbortError");
    ++renderVersion;
    closePreview();
    for (const source of sources) await source.viewer?.destroy();
    sources = loaded;
    pages = restored;
    pageHistory = [];
    thumbnailCache.clear();
    pageWindow = 0;
    lastResult = null;
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = null;
    $("result-card").hidden = true;
    $("analysis-panel").hidden = true;
    $("search-results").hidden = true;
    chooseTool(tools.find((item) => item.id === manifest.tool) || tools[0]);
    restoreSettings(manifest.settings);
    $("output-name").value = C.safeName(manifest.output);
    renderFiles();
    renderPages();
    status(
      "Workspace restored. Your page arrangement and placed marks are ready.",
    );
  } catch (error) {
    for (const source of loaded)
      if (!sources.includes(source)) await source.viewer?.destroy();
    status(friendlyError(error), true);
  } finally {
    setBusy(false);
    $("open-project").value = "";
  }
}
const recipes = {
  review: { name: "Document review", steps: ["compare", "edit", "sign"] },
  scan: { name: "Scanned documents", steps: ["scan", "ocr", "pdf-word"] },
  print: { name: "Print & share", steps: ["booklet", "compress", "protect"] },
};
function renderRecipe() {
  $("recipe-bar").hidden = !recipe;
  if (!recipe) {
    if ($("next-recipe")) $("next-recipe").hidden = true;
    return;
  }
  $("recipe-label").textContent = recipe.name;
  $("recipe-steps").replaceChildren();
  for (const id of recipe.steps) {
    const item = tools.find((t) => t.id === id),
      button = el(
        "button",
        `recipe-step${tool.id === id ? " current" : ""}`,
        item.name,
      );
    button.addEventListener("click", () => {
      if (!busy) chooseTool(item);
    });
    $("recipe-steps").append(button);
  }
  const index = recipe.steps.indexOf(tool.id),
    next = recipe.steps[index + 1];
  if ($("next-recipe")) {
    $("next-recipe").hidden =
      !next ||
      !lastResult ||
      lastResult.toolId !== tool.id ||
      lastResult.mime !== "application/pdf" ||
      lastResult.protected;
    $("next-recipe").textContent = next
      ? `Continue to ${tools.find((t) => t.id === next).name} →`
      : "";
  }
}
async function continueWithResult(nextTool) {
  if (
    busy ||
    !lastResult ||
    lastResult.mime !== "application/pdf" ||
    lastResult.protected
  )
    return;
  const input =
    tool.id === "compare" && recipe === recipes.review
      ? { bytes: sources[1].bytes, name: sources[1].name }
      : lastResult;
  setBusy(true);
  let source;
  try {
    const bytes = input.bytes.slice();
    source = {
      id: crypto.randomUUID(),
      name: input.name.replace(/\.[^.]+$/, ".pdf"),
      bytes,
      size: bytes.length,
      kind: "pdf",
    };
    source.doc = await P.PDFDocument.load(bytes.slice());
    source.viewer = await pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: "../../pdfjs/web/standard_fonts/",
      cMapUrl: "../../pdfjs/web/cmaps/",
      cMapPacked: true,
      wasmUrl: "../../pdfjs/web/wasm/",
    }).promise;
    if (taskController.signal.aborted)
      throw new DOMException("Processing cancelled.", "AbortError");
    ++renderVersion;
    closePreview();
    for (const old of sources) await old.viewer?.destroy();
    sources = [source];
    pages = Array.from({ length: source.doc.getPageCount() }, (_, index) =>
      newPage(source, index),
    );
    pageHistory = [];
    pageWindow = 0;
    thumbnailCache.clear();
    lastResult = null;
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = null;
    $("result-card").hidden = true;
    $("analysis-panel").hidden = true;
    $("search-results").hidden = true;
    $("search-count").textContent = "";
    chooseTool(
      nextTool ||
        tools.find(
          (item) =>
            item.id ===
            (["images-pdf", "word-pdf", "compare", "unlock"].includes(tool.id)
              ? "organize"
              : tool.id),
        ),
    );
    renderFiles();
    renderPages();
    $("workspace").scrollIntoView({ behavior: "smooth" });
    status(
      "Your result is now the active document. Choose the next tool or keep refining it.",
    );
  } catch (error) {
    if (source?.viewer && !sources.includes(source))
      await source.viewer.destroy();
    status(friendlyError(error), true);
  } finally {
    setBusy(false);
  }
}
async function searchPages() {
  if (busy) return;
  const query = value("page-search").trim().toLocaleLowerCase();
  $("search-results").replaceChildren();
  if (!query) {
    $("search-results").hidden = true;
    $("search-count").textContent = "";
    return;
  }
  setBusy(true);
  const matches = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      announceProgress(i + 1, pages.length);
      const entry = pages[i];
      if (entry.source.kind !== "pdf") continue;
      const text = await extractText(entry),
        index = text.toLocaleLowerCase().indexOf(query);
      if (index >= 0) {
        matches.push(i);
        const button = el("button", "search-result"),
          line = el("strong", "", `Page ${i + 1} · ${entry.source.name}`),
          snippet = el(
            "span",
            "",
            text.slice(Math.max(0, index - 45), index + query.length + 75),
          );
        button.append(line, snippet);
        button.addEventListener("click", () => openPreview(entry));
        $("search-results").append(button);
      }
    }
    $("search-count").textContent = `${matches.length} matching pages`;
    $("search-results").hidden = false;
    if (!matches.length)
      $("search-results").append(
        el(
          "p",
          "option-note",
          "No matching text. Scanned pages may need OCR first.",
        ),
      );
    status("Document search complete. Click a result to open its page.");
  } catch (error) {
    status(friendlyError(error), true);
  } finally {
    setBusy(false);
  }
}
$("file-input").addEventListener("change", (event) =>
  addFiles(Array.from(event.target.files)),
);
$("add-files").addEventListener("click", () => $("file-input").click());
$("clear").addEventListener("click", clearWorkspace);
$("run").addEventListener("click", run);
$("search").addEventListener("input", renderTools);
document.querySelectorAll("[data-category]").forEach((button) =>
  button.addEventListener("click", () => {
    category = button.dataset.category;
    document.querySelectorAll("[data-category]").forEach((b) => {
      b.classList.toggle("active", b === button);
      b.setAttribute("aria-pressed", String(b === button));
    });
    renderTools();
  }),
);
$("theme").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme-preference", theme);
});
for (const [id, selected] of [
  ["select-all", true],
  ["select-none", false],
])
  $(id).addEventListener("click", () => {
    rememberPages();
    pages.forEach((p) => (p.selected = selected));
    if ($("page-ranges")) $("page-ranges").value = "";
    renderPages();
    updateSummary();
  });
$("undo-pages").addEventListener("click", () => {
  if (!pageHistory.length || busy) return;
  const previous = pageHistory.pop();
  pages = previous.pages;
  sources = previous.sources;
  closePreview();
  if ($("page-ranges")) $("page-ranges").value = "";
  renderFiles();
  renderPages();
  updateSummary();
  status("Last page arrangement restored.");
});
$("load-example").addEventListener("click", async () => {
  if (busy) return;
  try {
    const doc = await P.PDFDocument.create(),
      font = await doc.embedFont(P.StandardFonts.Helvetica);
    for (let i = 0; i < 3; i++) {
      const page = doc.addPage([595, 842]);
      page.drawRectangle({
        x: 0,
        y: 680,
        width: 595,
        height: 162,
        color: P.rgb(0.92, 0.94, 0.99),
      });
      page.drawText(
        [
          "Room for better ideas.",
          "A fresh perspective.",
          "Ready for what is next.",
        ][i],
        { x: 45, y: 740, size: 27, font, color: P.rgb(0.22, 0.28, 0.43) },
      );
      page.drawText(
        `PDF Studio / Sample page ${i + 1}\n\nThis is a sample document, created in your browser.\nTry rearranging pages, adding a note, or exporting a copy.\n\nYour documents stay on your device.`,
        { x: 45, y: 620, size: 13, font, lineHeight: 23 },
      );
    }
    await addFiles([
      new File([await doc.save()], "studio-example.pdf", {
        type: "application/pdf",
      }),
    ]);
  } catch (error) {
    status(friendlyError(error), true);
  }
});
$("prev-pages").addEventListener("click", () => {
  pageWindow--;
  renderPages();
});
$("next-pages").addEventListener("click", () => {
  pageWindow++;
  renderPages();
});
$("close-preview").addEventListener("click", closePreview);
$("undo-mark").addEventListener("click", () => {
  activePage?.marks.pop();
  renderMarks();
});
$("marks").addEventListener("click", addMark);
let cursorX = 0.2,
  cursorY = 0.2;
$("marks").addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 0.1 : 0.01;
  if (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(
      event.key,
    )
  )
    event.preventDefault();
  if (event.key === "ArrowLeft") cursorX = Math.max(0, cursorX - step);
  if (event.key === "ArrowRight") cursorX = Math.min(0.98, cursorX + step);
  if (event.key === "ArrowUp") cursorY = Math.max(0, cursorY - step);
  if (event.key === "ArrowDown") cursorY = Math.min(0.98, cursorY + step);
  $("marks").style.setProperty("--cursor-x", `${cursorX * 100}%`);
  $("marks").style.setProperty("--cursor-y", `${cursorY * 100}%`);
  if (event.key === "Enter" || event.key === " ") {
    const rect = $("marks").getBoundingClientRect();
    addMark({
      clientX: rect.left + cursorX * rect.width,
      clientY: rect.top + cursorY * rect.height,
    });
  }
});
new ResizeObserver(() => {
  if (activePage) renderMarks();
}).observe($("preview-stage"));
for (const event of ["dragenter", "dragover"])
  $("workspace").addEventListener(event, (e) => {
    e.preventDefault();
    if (!busy) $("dropzone").classList.add("dragging");
  });
$("workspace").addEventListener("dragleave", (e) => {
  if (!$("workspace").contains(e.relatedTarget))
    $("dropzone").classList.remove("dragging");
});
$("workspace").addEventListener("drop", (e) => {
  e.preventDefault();
  $("dropzone").classList.remove("dragging");
  addFiles(Array.from(e.dataTransfer.files));
});
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
  ) {
    e.preventDefault();
    $("search").focus();
  }
  if (e.key === "Escape") closePreview();
  if (
    e.key === "Enter" &&
    (e.ctrlKey || e.metaKey) &&
    !busy &&
    !$("run").disabled
  ) {
    e.preventDefault();
    run();
  }
});
const cancelTask = el("button", "secondary", "Cancel processing");
cancelTask.id = "cancel-task";
cancelTask.hidden = true;
cancelTask.addEventListener("click", () => {
  taskController?.abort();
  status("Cancelling at the next processing boundary…");
});
$("progress").after(cancelTask);
const continueResult = el(
  "button",
  "secondary",
  "Use this PDF in the workspace →",
);
continueResult.id = "continue-result";
continueResult.hidden = true;
continueResult.addEventListener("click", () => continueWithResult());
$("result-card").lastElementChild.append(continueResult);
const nextRecipe = el("button", "secondary");
nextRecipe.id = "next-recipe";
nextRecipe.hidden = true;
nextRecipe.addEventListener("click", () => {
  const next = recipe?.steps[recipe.steps.indexOf(tool.id) + 1];
  if (next) continueWithResult(tools.find((item) => item.id === next));
});
$("result-card").lastElementChild.append(nextRecipe);
$("show-all-tools").addEventListener("click", () => {
  catalogExpanded = !catalogExpanded;
  renderTools();
});
$("save-project").addEventListener("click", saveProject);
$("open-project").addEventListener("change", (event) =>
  openProject(event.target.files[0]),
);
$("save-preset").addEventListener("click", () => {
  const name = value("preset-name").trim() || `${tool.name} preset`;
  const preset = {
    id: crypto.randomUUID(),
    name: name.slice(0, 100),
    tool: tool.id,
    settings: captureSettings(),
  };
  presets = presets.filter((item) => item.name !== preset.name);
  presets.push(preset);
  if (presets.length > 30) presets.shift();
  localStorage.setItem("pdf-studio-presets", JSON.stringify(presets));
  renderPresets();
  $("presets").value = preset.id;
  status(
    `Saved preset: ${preset.name}. Passwords, signatures, files, and page selections were excluded.`,
  );
});
$("presets").addEventListener("change", () => {
  if (busy) return;
  const preset = presets.find((item) => item.id === value("presets"));
  if (!preset) return;
  const next = tools.find((item) => item.id === preset.tool);
  if (!next) return;
  chooseTool(next);
  restoreSettings(preset.settings);
  $("workspace").scrollIntoView({ behavior: "smooth" });
  status(
    `Applied preset: ${preset.name}. Add files or use the current workspace.`,
  );
});
$("delete-preset").addEventListener("click", () => {
  presets = presets.filter((item) => item.id !== value("presets"));
  localStorage.setItem("pdf-studio-presets", JSON.stringify(presets));
  renderPresets();
});
$("search-pages").addEventListener("click", searchPages);
$("page-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchPages();
});
for (const [id, action] of [
  ["reverse-pages", () => pages.reverse()],
  [
    "odd-pages",
    () => pages.forEach((page, index) => (page.selected = index % 2 === 0)),
  ],
  [
    "even-pages",
    () => pages.forEach((page, index) => (page.selected = index % 2 === 1)),
  ],
])
  $(id).addEventListener("click", () => {
    if (busy) return;
    rememberPages();
    action();
    if ($("page-ranges")) $("page-ranges").value = "";
    closePreview();
    renderPages();
    updateSummary();
  });
document.querySelectorAll("[data-recipe]").forEach((button) =>
  button.addEventListener("click", () => {
    if (busy) return;
    recipe = recipes[button.dataset.recipe];
    chooseTool(tools.find((item) => item.id === recipe.steps[0]));
    $("workspace").scrollIntoView({ behavior: "smooth" });
  }),
);
$("close-recipe").addEventListener("click", () => {
  recipe = null;
  renderRecipe();
});
renderPresets();
chooseTool(tools[0]);
clearTimeout(window.pdfStudioBootTimer);
$("boot-screen").classList.add("leaving");
setTimeout(() => $("boot-screen").remove(), 400);
