# E-Labs card banners

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

## One grid, four voices

The cards share a layout — wordmark, rule, claim, a 2×2 stat block, hero — and
that is the family resemblance. Everything else is deliberately per-app, so a
reader who has seen one card can still tell the next one apart at 350 px.

| App | Face (`fonts.mjs`) | Cell | Wordmark | Body | Stat card |
|---|---|---|---|---|---|
| Stride Lab | its own, in its own tool | 5×7 | ×8 | ×2/×3 | rounded, hairline across the top |
| Finite-Elemented | `drafting` | 7×9 | ×5 | ×2 | `bar` — hairline frame, heavy binding edge, a tick ruled under the figure |
| AirCrafter | `avionic` | 5×9 | ×8 | ×2 | `reticle` — no frame, four corner marks, a bar under the figure |
| Asphera | `strata` | 7×7 | ×7 | ×2 | `strata` — the structure's own material colors down the binding edge |

The thing that separates them at card size is **proportion**, not detail:
narrow-and-tall, wide-and-short, wide-and-tall. That also means each face has a
different cell, so the same `scale` reads at a different size in each banner and
the copy has to be written to the column it lands in — the widest face carries
the tersest text. `validateFonts()` checks every glyph is the right height, fits
its width, and exists in all four faces; each generator calls it first.

## Two rules the layout has to keep

- **1310 × 790.** The card is 200 px tall and between 324 and 375 px wide across
  the site's breakpoints, and the image is `object-fit: cover`, so the crop
  ranges from 1.60 to 1.87. Keep anything that must be read inside a 40 px
  margin.
- **Nothing readable above y = 180 on the right.** The card paints its
  Public/Private status badge over roughly `x ≥ 890, y ≤ 180` of the image.
  Colorbars and titles stay clear of it; fields may run under it.
