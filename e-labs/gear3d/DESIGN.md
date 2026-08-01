# Gear3D — Design

The spec asked for a compact token system, a self-critique against the
"would I produce this for any app?" test, a revision, and then the build.
This document is that, in order.

---

## 1. Where the identity comes from

Not "3D tool". The subject is **measurement**: the app exists so that someone
can state, in a caption, that a dual spacing is 330 mm and be believed.

Three reference bodies, all from the subject matter:

- **Aircraft characteristics manuals** (Boeing ACAP, Airbus AC) — landing gear
  footprint plates: hairline rules, ticked datums, dense tabular figures, no
  colour beyond black and one register mark.
- **Drafting film** — not paper white. A very slightly cool, slightly grey
  ground, because a true white ground makes hairlines vibrate.
- **Gauge faces** — a dark instrument field, restrained type, and exactly one
  saturated colour, always meaning "this is the reading".

---

## 2. Tokens

Six values carry the identity. Everything else is derived.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--g3-ink` | `#16202b` | `#e8edf2` | The drawn line. Deep slate, never pure black. |
| `--g3-paper` | `#ffffff` | `#0f151c` | The ground. |
| `--g3-graphite` | `#5c6b7a` | `#9fb0be` | Secondary text, inactive rules. |
| `--g3-rule` | `#ccd5dd` | `#2b3846` | Hairline separators. |
| `--g3-datum` | `#18a9a8` | `#22d3d1` | Structure: active panels, focus, primary action. |
| `--g3-signal` | `#c8452a` | `#e46a4a` | **The needle.** The live measurement and the current selection. Nothing decorative is ever this colour. |

`--g3-datum` is the site teal, deliberately. Gear3D is the sixth app in E-Labs
and should read as a sibling of Cross-Section Studio and LEAPS, not as a
visitor. The instrument red is what is new, and it earns its place by carrying
a single unambiguous meaning.

**The signal-colour rule is the discipline that makes this work.** Because
nothing decorative is ever instrument red, red always means *this one*. A
selected axle, a modified-from-reference badge, a contact patch, a highlighted
dimension. If red ever appears on a button that is merely available rather than
active, the system is broken.

---

## 3. Type

- **Body / UI:** system sans stack. No webfont.
- **Numerics:** monospaced stack with `font-variant-numeric: tabular-nums`.

Tabular figures are a **functional** requirement here, not a style choice.
Numbers appear in the tree, the properties panel, the status strip, the unit
metadata, the patch summary and every dimension label. Proportional digits make
a column of axle positions shimmer as values change, and shimmer in a column of
measurements reads as instability in the measurements.

No webfont is loaded, for two reasons: the app must work offline once cached,
and a font that fails to load would reflow every numeric column at the worst
possible moment. A system stack with tabular figures is available everywhere
and never arrives late.

---

## 4. Signature element: the datum tick

Every panel heading carries a hairline rule terminating in a short
perpendicular tick:

```
├─ UNIT
├─ ISOLATION
├─ DIMENSIONS
```

It is the same mark the dimension engine draws in the viewport — an extension
line terminating on the feature it measures. The tick is graphite when the
section is collapsed and teal when it is open, so the rail reads as a column of
datums with the active ones registered.

It is one CSS rule (`summary::before` / `summary::after`), it costs nothing,
and it means the panel furniture and the figure share a vocabulary. A user who
learns what a tick means in the viewport already knows what it means in the
rail.

---

## 5. Self-critique — "would I produce this for any app?"

Honest answers, first pass:

1. **"Teal + slate dark UI" is the house style of every developer tool of the
   last decade.** Guilty as charged, and I am not going to pretend otherwise.
   *Resolution:* keep the teal, because sibling consistency inside E-Labs is a
   real requirement that outranks novelty, but stop the teal from doing the
   expressive work. The teal is structural — it marks where things are. The
   instrument red is the only colour that carries *meaning*, and it is the part
   of the palette that is specific to this app.

2. **Rounded corners, soft shadows, pill badges — the generic SaaS card look.**
   Fair. *Resolution:* radii cut to 3–5 px throughout, badges made rectangular
   with a 3 px radius rather than `999px` pills, panel elevation carried by a
   1 px rule instead of a drop shadow. Instrument panels have edges, not
   cushions. Shadow is now used in exactly one place — toasts — where a thing
   genuinely floats above the page.

3. **The "datum tick" could be decoration cosplaying as meaning.** The sharpest
   criticism of the three, and the test is whether it survives contact with the
   viewport. *Resolution:* it does, because it is literally the same mark, and
   it changes state (graphite → teal) to mean something. If it were static it
   would be a doodle and should be deleted.

4. **Icon-led panel headings are a habit, not a decision.** *Resolution:* kept,
   but demoted — icons are datum-teal at 0.82 rem beside 0.74 rem uppercase
   letterspaced labels, so the label leads and the icon is a locator. The
   heading is type, not a badge.

Anti-patterns explicitly avoided, as the spec required: cream + serif +
terracotta; near-black + acid green; broadsheet hairline editorial layout.

---

## 6. Where the design does real work

- **Annotation contrast follows the figure background, not the UI theme.**
  Working in dark mode and exporting on publication white must not produce pale
  annotations that vanish on the page. Ink, halo and accent are chosen from the
  background's relative luminance (`figureInk()` in `main.js`). This was a real
  bug caught in review: the first export had a near-invisible scale bar.
- **Label halos** are stroked in the figure background colour so a value stays
  readable where it crosses a black tire.
- **Degenerate dimensions fade rather than draw.** Below 15° from edge-on a
  dimension is suppressed; between 15° and 28° it fades. A two-pixel leader
  with a number on it is worse than nothing.
- **Overlapping labels stagger, never hide.** A hidden dimension is
  indistinguishable from a dimension that was never measured.

---

## 7. Accessibility

- Visible focus rings on every control (`:focus-visible`, 2 px datum outline).
- Every slider has a paired numeric input — both keyboard-operable, and the
  numeric field is what makes a view reproducible in a caption.
- `prefers-reduced-motion` collapses all transitions to ~0.
- Icon-only controls (undo, redo, isolate) carry `title` text; the tree exposes
  `role="tree"` / `role="treeitem"` and responds to Enter and Space.
- Body and secondary text meet WCAG AA against their backgrounds in both
  themes; `--g3-muted` is used only for supporting notes at 0.7 rem and above.

**Not yet done:** a full audit with a screen reader, and live-region
announcements when isolation changes. Listed here rather than quietly omitted.

---

## 8. Responsive

Three-column studio down to 1280 px, narrowed rails to 980 px, then a single
column with the viewport between the collapsed rails. Below tablet width the
rails become scrollable 320 px panels rather than disappearing — a user on a
small screen still needs the structure tree to isolate an axle.
