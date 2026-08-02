# Gear3D — Sources

Every number in this app's library traces to something. This document says
*what*, and — just as importantly — **how strongly each number was verified
during the build.**

Read §1 before using any of these values in a publication.

---

## 1. Verification status — read this first

Three levels are used throughout the data files:

| Level | Meaning |
|---|---|
| **verified** | Retrieved from the cited source during this build and checked figure-for-figure. |
| **medium** | Well-established published engineering practice, reproduced from the standard literature, **but not opened against a primary document during this build.** Check before publication use. |
| **low** | Representative of the vehicle type; not a specific model, not a cited figure. Adequate for illustrating a configuration, not for quoting. |

**What was verified during this build:**

- AASHTOWare Pavement ME Design default traffic inputs — tandem 51.6 in,
  tridem 49.2 in, quad 49.2 in, dual tire spacing 12 in, tire pressure 120 psi,
  average axle width 8.5 ft, wheelbase classes 12/15/18 ft with a 17/22/61 %
  split. Retrieved from the published help manual.
- FHWA Scheme F class definitions and axle topology for all 13 classes.
- Huang's contact-area coefficient (0.5227) and the shape it derives from.
- 23 CFR 658 statutory limits (20 000 lb single, 34 000 lb tandem, 80 000 lb
  gross, 102 in width) and the Federal Bridge Formula — these are statutory
  text and are additionally re-derived arithmetically by the test suite.

**What was NOT verified during this build:**

- **All aircraft gear geometry.** See §5. No aircraft library ships in v1.0
  precisely because of this.
- Inch-nominal truck tire overall diameters other than 11R22.5. See §4.
- Track widths and wheelbases of individual truck classes. See §3.

---

## 2. Primary sources

### FHWA Traffic Monitoring Guide — Scheme F vehicle classification
- **Publisher:** U.S. Federal Highway Administration
- **URL:** <https://www.fhwa.dot.gov/policyinformation/tmguide/>
- **Used for:** the 13-class definitions, axle counts, unit counts, and the
  four/six-tire criterion separating classes 3 and 5.
- **Status:** verified.

### AASHTOWare Pavement ME Design — default traffic inputs
- **Publisher:** AASHTO
- **URL:** <https://aashtowarepavementme.org/MEDesign/help/traffic.html>
- **Used for:** every intra-group axle spacing in the library, the tractor
  wheelbase classes, and the default inflation pressure of the contact-patch
  module (120 psi = 827.371 kPa).
- **Status:** verified — values quoted exactly as published.

### 23 CFR 658 — Truck size and weight, route designations
- **Publisher:** U.S. Government
- **Used for:** 20 000 lb single-axle limit; 34 000 lb tandem-axle limit;
  80 000 lb gross limit; 102 in (2591 mm) width limit; the Federal Bridge
  Formula `W = 500[LN/(N−1) + 12N + 36]`.
- **Status:** verified. The bridge formula is additionally re-derived in
  `test/run.mjs`, which independently confirms that a two-axle group at 4.0 ft
  is allowed exactly 34 000 lb — the arithmetic origin of the statutory tandem
  limit.

### Yoder & Witczak, *Principles of Pavement Design*; Huang, *Pavement Analysis and Design*
- **Used for:** the classic dual-wheel idealisation — dual tires at 13.5 in
  centres with the dual sets 72 in (1829 mm) apart — which is the basis for the
  drive/trailer track width throughout the library; and Huang's contact-area
  idealisation.
- **Status:** the 0.5227 coefficient is verified. The 72 in track is standard
  in this literature and is used as the library's stated basis.

### Tire and Rim Association Yearbook
- **Used for:** the three-part aircraft tire designation convention
  (overall diameter × section width − rim diameter), which lets
  `src/core/tires.js` compute aircraft tire dimensions arithmetically; and the
  inch-nominal truck tire dimension table.
- **Status:** **not consulted directly during this build.** The designation
  convention is implemented from well-established practice. The size table
  entries are marked individually — see §4.

---

## 3. Truck geometry — what is derived and what is typical

**Derived, and therefore reproducible:**

- All intra-group axle spacings — AASHTOWare defaults, verified.
- All tractor wheelbases — AASHTOWare wheelbase classes, verified.
- All axle loads — statutory limits or an explicitly stated division of them.
- **All trailer-group longitudinal positions** — set to the smallest realistic
  spread satisfying the Federal Bridge Formula over every consecutive-axle
  subset at the stated loads. This is a real derivation, not an estimate, and
  the test suite re-derives it. See `DECISIONS.md` §D7.

**Typical practice, confidence medium — check before quoting:**

- Steer axle track 2032 mm (80 in) on classes 5–13.
- Drive/trailer track 1829 mm (72 in) — from the classic dual-wheel
  idealisation above; it is the standard figure of the literature, but it is a
  modelling convention, not a manufacturer specification.
- Dual tire spacing 330 mm (13 in). **Sources genuinely disagree here** and the
  disagreement is recorded rather than hidden:
  - AASHTOWare Pavement ME default: **12 in (304.8 mm)** — verified.
  - Yoder & Witczak / Huang dual-wheel idealisation: **13.5 in (343 mm)**.
  - Library default: **330 mm (13 in)**, mid-range and representative of
    current US class 8 practice.
  A user comparing Gear3D output against a default Pavement ME run should set
  this to 305 mm; against the classic textbook idealisation, 343 mm.
- Overall lengths, bus and vocational wheelbases.

**Low confidence — representative only:**

- Classes 1–3 (motorcycle, passenger car, pickup) in full. Their loads are
  order-of-magnitude estimates from representative kerb masses. They exist so
  the FHWA classification is complete; they are not pavement-design inputs.
- The class 13 turnpike double's overall layout, which is representative of
  permitted turnpike practice rather than a specific carrier's configuration.

---

## 4. Tire dimensions

**Computed exactly from the designation — no table, no uncertainty:**

- Metric truck and passenger sizes (`445/50R22.5`, `295/75R22.5`,
  `LT245/75R16`, …). Overall diameter follows arithmetically:
  `OD = rim + 2 × section × aspect`.
- **All aircraft sizes** (`H44.5x16.5-21`, `52x21.0R22`, `1400x530R23`, …).
  The three-part designation encodes all three dimensions directly.

**Table lookup, in `src/data/tires.json`:**

| Size | Confidence | Note |
|---|---|---|
| `11R22.5` | **high** | 279 mm section / 1054 mm OD. The reference truck tire of the flexible-pavement literature; dimensions agree across the major medium-truck data books. |
| `11R24.5`, `12R22.5`, `10.00R20`, `11.00R20`, `9.00R20` | **medium** | Reproduced from the standard truck-tire literature. **Not checked against a TRA yearbook during this build.** |

A size that is not in the table is reported by the app as **unknown** and
refuses to produce geometry. It is never guessed. Adding one requires a
`source` and a `confidence` field, and the test suite fails without them.

**Static loaded radius.** Two models are implemented and the choice is exposed:
- `radiusRatio` (default): SLR = ratio × free radius, 0.97 truck / 0.965
  aircraft. These defaults come from the build specification and are
  user-adjustable. **Confidence: medium** — they are reasonable engineering
  values, not a cited standard.
- `sectionDeflection`: SLR = free radius − deflection × section height, with
  0.32 for aircraft, following the Tire and Rim Association convention that
  aircraft tires are rated at a nominal 32 % deflection.

---

## 5. Aircraft — what is sourced, derived and assumed

The aircraft library ships in v1.2 with **four Boeing aircraft** spanning gear
codes **D, 2D and 3D**: 737-800, 757-200, 767-400ER and 777-300ER.

An earlier attempt was abandoned because the sources could not be reached
(the FAA database returned 403 to the fetch tool, and the ACAP PDFs exceeded
its size limit). Both were tooling limits, not access limits: the FAA site
serves the spreadsheet normally to a browser user-agent, and the PDFs download
fine with `curl`. Every number below was retrieved and read directly.

### 5.1 Authoritative — taken verbatim

| Quantity | Source |
|---|---|
| Gear designation (`Main_Gear_Config`) | FAA Aircraft Characteristics Database |
| Wheelbase, nose to main gear | FAA Aircraft Characteristics Database |
| Main gear **outer** width | FAA Aircraft Characteristics Database |
| MTOW | FAA Aircraft Characteristics Database |
| Maximum design taxi weight | Manufacturer ACAP, section 7.2 |
| Tire size and tire pressure, nose and main | Manufacturer ACAP, section 7.2 |
| Percent gross weight on the whole main gear (95 %) | FAA AC 150/5320-6G, G.1.3 |

ACAP editions used: 737 **D6-58325-7 Rev C** (Oct 2025), 757 **D6-58327 Rev H**
(Dec 2024), 767 **D6-58328 Rev K** (Dec 2024), 777 **D6-58329-2 Rev G**
(Dec 2024).

### 5.2 The outer-width trap

The FAA field is **not** the centreline tread. Its own data dictionary defines
`Main_Gear_Width_ft` as *"Distance between outer tires in the main landing
gear."* Treating it as the track would push every main wheel outboard by half
a dual spacing plus half a tire — for a 777 that is nearly a metre per side,
and the figure would look entirely reasonable while being wrong.

So the track is **derived**, never assumed:

```
track = outerWidth − (wheelsAcross − 1) × dualSpacing − sectionWidth
```

Section width comes exactly from the three-part tire designation.

### 5.3 The cross-check that makes this trustworthy

Nothing in that derivation uses the manufacturers' separately published tread
figures, so agreement between them is real corroboration rather than
circularity. With the dual spacings recorded in the data files:

| Aircraft | Derived track | Manufacturer published tread | Difference |
|---|---|---|---|
| 737-800 | 5727 mm | 5715 mm (18 ft 9 in) | 12 mm |
| 757-200 | 7302 mm | 7315 mm (24 ft 0 in) | 13 mm |
| 767-400ER | 9322 mm | 9296 mm (30 ft 6 in) | 26 mm |
| 777-300ER | 10 963 mm | 10 973 mm (36 ft 0 in) | 10 mm |

All four agree to within a few centimetres, on quantities of 6 to 11 metres.
`test/run.mjs` asserts both the derivation and this cross-check.

### 5.4 Assumed — declared, and shown in the app

Two quantities are **not** constrained by any source consulted:

- **Nose gear dual spacing.** Nothing published pins it down.
- **Tandem spacing** on 2D and 3D gears. The wheelbase is measured to the main
  gear *centroid*, so the spread within a bogie does not move it, and no other
  figure constrains it.

Every aircraft unit lists these in `assumedFields`, the schema **fails
validation** if that array is missing, and the app shows an amber notice naming
them whenever an aircraft is loaded. Set them from FAARFIELD before using the
output for pavement work — and note that changing a dual spacing re-derives the
track, so the authoritative outer width is preserved whatever you enter.

### 5.5 Not included, and why

The **747 (2D/2D2)** and **A380 (2D/3D2)** are omitted. Their wing-plus-body
gear layouts need the longitudinal and transverse offsets of the body gear
relative to the wing gear. A single outer width closes a two-strut layout; it
cannot close a four-bogie one. Including them would mean inventing geometry
rather than deriving it, which is the one thing this library exists not to do.

---

## 6. How to check any number in this app

Every axle carries a `source` string and every load a `basis` string, both
shown in the properties panel when you select an axle. Export `unit.json`
alongside any figure and the citations travel with it.

The test suite (`npm test`, 74 checks) fails the build if any axle, gear, load,
GVW, MTOW, tire pressure or multi-axle group spacing lacks provenance, and
includes a negative control that confirms the validator actually rejects a
missing source rather than passing vacuously.
