# E-Labs card banners

**Finite-Elemented and Frontier now use shared Three.js scenes for both live
miniatures and poster fallbacks.** Their current regeneration instructions are
in [the shared labs README](../../e-labs/shared/README.md). The
`finite-elemented.mjs` generator and its descriptions below refer to the
pre-rebuild application; use the browser renderer for the current posters.
AirCrafter and Asphera continue to use the software generators documented here.

Each generator writes one 1310×790 PNG into `images/e-labs/`, the picture the
matching card on `E-Labs.html` shows before you hover it.

```bash
node scripts/banners/finite-elemented.mjs
node scripts/banners/aircrafter.mjs
node scripts/banners/asphera.mjs
```

No dependencies, no image library: `kit.mjs` is a small supersampled software
rasterizer with a PNG encoder, generalized from
`e-labs/stride-lab/tools/make-banner.mjs`, which produced the first banner in
this family and still owns its own.

## What these are for

The card is the only thing most visitors see of an app, so it is drawn from the
app's own answers rather than illustrated:

| Banner | Where the numbers come from |
|---|---|
| Finite-Elemented | `FE.lab`'s Q4 plane-stress solver, transcribed and re-run here — mesh, banded Cholesky, stress recovery. Checked against the app's own five-point convergence study to full double precision, and against the six values it shows on load. |
| AirCrafter | `computeStresses()` transcribed, over one row read out of `e-labs/aircrafter/aircraft.xlsx` by a minimal ZIP + XML reader. Checked against the full 7×10 σz and σx matrices behind the app's own plots, and its equilibrium residual. |
| Asphera | The shipped result files themselves — `data/TK_P1/{structure,contours,profiles}.json` — with the peak values selected the way `renderStats()` selects them. Nothing is modelled. |

**Every generator asserts before it draws, and exits non-zero instead of
writing a wrong picture.** If an app's solver, library or data changes and its
banner is not regenerated, the assertions are what tell you.

## Four cards, four designs

These do NOT share a template. A grid of cards saying different things should
not look like one card printed four times, so each banner is laid out as the
thing its app is:

| App | Layout | Face (`fonts.mjs`) | Cell |
|---|---|---|---|
| Stride Lab | its own, in its own tool | its own | 5×7 |
| Finite-Elemented | **a drawing sheet** — ruled border and register marks, the part dimensioned in the clear with a hatched fixture and an `L = 8` dimension line, the scale laid flat beneath it, the same part refined five times in a filmstrip, numbered notes, and a ruled title block in the bottom right corner where a title block goes | `drafting` | 7×9 |
| AirCrafter | **a selector and an instrument band** — the aircraft library down the left in the app's own order with the chosen aeroplane picked out, the tyre it computed filling the middle, the longitudinal trace on its own line under it, and one horizontal row of read-outs across the foot divided by hairlines | `avionic` | 5×9 |
| Asphera | **a section read by depth** — a core of the real structure at true scale down the left, the section full width beside it, and every peak strain pinned to the depth it was found at with a leader into the field and its step tagged at the point | `strata` | 7×7 |

The faces are told apart by **proportion**, not detail: narrow-and-tall,
wide-and-short, wide-and-tall. That also means each has a different cell, so the
same `scale` reads at a different size in each banner and the copy has to be
written to the column it lands in — the widest face carries the tersest text.
`validateFonts()` checks every glyph is the right height, fits its width, and
exists in all four faces; each generator calls it first.

## Two rules the layout has to keep

- **1310 × 790.** The card is 200 px tall and between 324 and 375 px wide across
  the site's breakpoints, and the image is `object-fit: cover`, so the crop
  ranges from 1.60 to 1.87. Keep anything that must be read inside a 40 px
  margin.
- **Nothing readable above y = 180 on the right.** The card paints its
  Public/Private status badge over roughly `x ≥ 890, y ≤ 180` of the image.
  Colorbars and titles stay clear of it; fields may run under it.
