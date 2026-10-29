const NS = "http://www.w3.org/2000/svg";
function shape(tag, attributes, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, value);
  parent?.append(node);
  return node;
}
const paths = {
  left: "m14 5-7 7 7 7M7 12h14",
  right: "m10 5 7 7-7 7M3 12h14",
  up: "m5 14 7-7 7 7M12 7v14",
  down: "m5 10 7 7 7-7M12 3v14",
  rotate: "M20 7v5h-5M20 12a8 8 0 1 0-2 6",
  copy: "M9 9h12v12H9zM15 9V3H3v12h6",
  close: "m6 6 12 12M6 18 18 6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 5 5",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  theme: "M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z",
  grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  fit: "M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5",
  file: "M5 2h9l5 5v15H5zM14 2v6h5M9 12h6M9 16h6",
  check: "m5 12 4 4L19 6",
};
export function uiIcon(id) {
  const svg = shape("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.7,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    class: "ui-icon",
  });
  shape("path", { d: paths[id] || paths.file }, svg);
  return svg;
}
export function toolMiniature(id) {
  const svg = shape("svg", {
    viewBox: "0 0 240 112",
    class: "tool-miniature",
    "aria-hidden": "true",
    focusable: "false",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.7,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  const rect = (x, y, w, h, extra = {}) =>
    shape("rect", { x, y, width: w, height: h, rx: 4, ...extra }, svg);
  const path = (d, extra = {}) => shape("path", { d, ...extra }, svg);
  const circle = (cx, cy, r, extra = {}) =>
    shape("circle", { cx, cy, r, ...extra }, svg);
  const page = (x, y, w = 45, h = 64, lines = true) => {
    rect(x + 3, y + 4, w, h, {
      fill: "currentColor",
      opacity: 0.05,
      stroke: "none",
    });
    rect(x, y, w, h, { fill: "var(--mini-paper, #fff)" });
    path(`M${x + w - 13} ${y}v13h13`, { opacity: 0.4 });
    if (lines)
      for (let i = 0; i < 3; i++)
        path(`M${x + 9} ${y + 25 + i * 8}h${w - 18 - (i === 2 ? 9 : 0)}`, {
          opacity: 0.25,
        });
  };
  const arrow = (x, y) => path(`M${x} ${y}h24m-6-6 6 6-6 6`);
  const picture = (x, y) => {
    rect(x, y, 40, 32, { fill: "var(--mini-paper,#fff)" });
    path(`m${x + 5} ${y + 26} 10-12 8 8 6-6 7 10`);
    circle(x + 29, y + 8, 2);
  };
  circle(205, 4, 66, { fill: "currentColor", stroke: "none", opacity: 0.035 });
  if (id === "merge") {
    page(48, 25, 37, 53);
    page(74, 34, 37, 53);
    arrow(120, 55);
    page(155, 25, 42, 62);
  } else if (id === "split") {
    page(97, 23, 45, 66);
    path("M83 55h74", { "stroke-dasharray": "3 5" });
    path("m72 31-8-8m8 56-8 8m104-56 8-8m-8 56 8 8", { opacity: 0.5 });
  } else if (id === "organize") {
    for (let i = 0; i < 4; i++) {
      page(35 + i * 44, 34, 31, 46, false);
      path(`M${44 + i * 44} 58h13`, { opacity: 0.3 });
    }
    path("m52 23 5-5 5 5m80 66 5 5 5-5", { opacity: 0.7 });
  } else if (id === "compress") {
    page(48, 20, 50, 74);
    arrow(110, 57);
    page(153, 34, 32, 46);
    path("m37 36 7 0m-7 42h7m151-31h7m-7 23h7", { opacity: 0.5 });
  } else if (id === "images-pdf") {
    picture(44, 41);
    arrow(102, 56);
    page(154, 25);
  } else if (id === "pdf-images") {
    page(43, 25);
    arrow(104, 56);
    picture(155, 40);
  } else if (id === "pdf-word" || id === "word-pdf") {
    page(45, 25);
    page(154, 25);
    arrow(106, 56);
    shape(
      "text",
      {
        x: id === "pdf-word" ? 164 : 55,
        y: 74,
        stroke: "none",
        fill: "currentColor",
        "font-size": 18,
        "font-family": "sans-serif",
        "font-weight": 650,
      },
      svg,
    ).textContent = "W";
  } else if (id === "text") {
    page(53, 25);
    for (let i = 0; i < 4; i++)
      path(`M130 ${39 + i * 12}h${i === 3 ? 36 : 62}`, {
        opacity: i === 3 ? 0.4 : 0.7,
      });
  } else if (id === "compare") {
    page(51, 24);
    page(145, 24);
    rect(59, 62, 29, 8, {
      fill: "currentColor",
      opacity: 0.18,
      stroke: "none",
    });
    rect(153, 42, 29, 8, { fill: "#dd859f", opacity: 0.7, stroke: "none" });
    path("M119 30v56", { "stroke-dasharray": "2 5", opacity: 0.25 });
  } else if (id === "nup") {
    rect(82, 12, 76, 89, { fill: "var(--mini-paper,#fff)" });
    for (let i = 0; i < 4; i++)
      rect(92 + (i % 2) * 29, 25 + Math.floor(i / 2) * 31, 22, 25, {
        fill: "currentColor",
        "fill-opacity": 0.07,
        opacity: 0.7,
      });
  } else if (id === "booklet") {
    path(
      "M120 33c-20-11-40-14-62-8v58c22-6 42-3 62 8 20-11 40-14 62-8V25c-22-6-42-3-62 8Z",
      { fill: "var(--mini-paper,#fff)" },
    );
    path(
      "M120 33v58M73 41l30 6m-30 7 30 6m-30 7 24 5m40-25 30-6m-30 19 30-6m-30 19 24-5",
      { opacity: 0.4 },
    );
  } else if (id === "interleave") {
    for (let i = 0; i < 2; i++) {
      page(39 + i * 7, 24 + i * 9, 28, 40, false);
      page(167 + i * 7, 24 + i * 9, 28, 40, false);
    }
    for (let i = 0; i < 4; i++)
      rect(103 + i * 4, 24 + i * 13, 30, 32, {
        fill: i % 2 ? "var(--mini-paper,#fff)" : "currentColor",
        "fill-opacity": i % 2 ? 1 : 0.1,
      });
  } else if (id === "blank") {
    page(40, 30, 36, 52);
    page(102, 30, 36, 52, false);
    page(164, 30, 36, 52);
    path("m112 48 16 16m-16 0 16-16", { opacity: 0.55 });
  } else if (id === "resize") {
    rect(83, 12, 75, 88, { "stroke-dasharray": "3 5", opacity: 0.35 });
    page(98, 27, 45, 59);
    path("m66 41-8 15 8 15m108-30 8 15-8 15", { opacity: 0.7 });
  } else if (id === "scan") {
    page(52, 25);
    for (let i = 0; i < 18; i++)
      circle(59 + ((i * 11) % 31), 35 + ((i * 13) % 43), 0.7, {
        fill: "currentColor",
        stroke: "none",
        opacity: 0.3,
      });
    arrow(106, 56);
    page(155, 25);
  } else {
    page(96, 21, 48, 71, !["forms", "ocr", "redact"].includes(id));
    if (id === "edit") {
      path("m129 76 28-28 7 7-28 28-10 3 3-10Z", {
        fill: "var(--mini-paper,#fff)",
      });
      path("m153 52 7 7");
    }
    if (id === "sign") {
      path(
        "M107 76c8-21 18-25 9-6-8 15-3 13 7 2-2 9 2 9 10 2 3 8 10 4 18 0M108 87h47",
        { "stroke-width": 2 },
      );
    }
    if (id === "watermark") {
      path("m102 76 34-34m-28 39 34-34", { "stroke-width": 5, opacity: 0.18 });
    }
    if (id === "numbers" || id === "bates") {
      for (let i = 0; i < (id === "bates" ? 6 : 3); i++)
        rect(
          103 + i * (id === "bates" ? 5 : 10),
          78,
          id === "bates" ? 3 : 6,
          5,
          { rx: 1, fill: "currentColor", opacity: 0.6, stroke: "none" },
        );
    }
    if (id === "crop") {
      path("M89 42V14h27m35 56v28h-27", { "stroke-width": 2.5 });
    }
    if (id === "redact") {
      rect(104, 45, 32, 7, { rx: 1, fill: "currentColor", stroke: "none" });
      rect(104, 61, 25, 7, { rx: 1, fill: "currentColor", stroke: "none" });
    }
    if (id === "forms") {
      for (let i = 0; i < 3; i++) {
        rect(104, 44 + i * 12, 6, 6, { rx: 1 });
        path(`M116 ${47 + i * 12}h18`, { opacity: 0.4 });
      }
      path("m104 47 2 2 5-6");
    }
    if (id === "metadata") {
      circle(151, 74, 15, { fill: "var(--mini-paper,#fff)" });
      path("M151 73v8M151 67h.01", { "stroke-width": 2 });
    }
    if (id === "flatten") {
      path("M83 36v52h46M76 44v52h45", { opacity: 0.35 });
      path("m155 41 6 9 6-9m-6 9V27");
    }
    if (id === "ocr") {
      path("M85 39v-9h9m52 0h9v9m0 39v9h-9m-52 0h-9v-9");
      path("M104 44h32m-32 12h32m-32 12h22", { opacity: 0.4 });
      path("M82 57h76", { "stroke-width": 2, opacity: 0.8 });
    }
    if (id === "protect" || id === "unlock") {
      rect(128, 67, 33, 25, { fill: "var(--mini-paper,#fff)" });
      path(
        id === "protect"
          ? "M135 67v-8a10 10 0 0 1 19 0v8"
          : "M135 67v-8a10 10 0 0 1 19-3",
      );
      path("M144 78v5");
    }
    if (id === "bookmarks") {
      path("M124 21h12v26l-6-5-6 5Z", {
        fill: "currentColor",
        "fill-opacity": 0.15,
      });
    }
    if (id === "web") {
      circle(151, 75, 17, { fill: "var(--mini-paper,#fff)" });
      path("M134 75h34M151 58c-10 11-10 23 0 34 10-11 10-23 0-34");
    }
    if (id === "repair") {
      path("m130 78 20-20 2-10 10-4-3 9-8 3-19 21Z", {
        fill: "var(--mini-paper,#fff)",
      });
    }
  }
  return svg;
}
