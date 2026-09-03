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
- **FAA Order 5300.7**, Standard Naming Convention for Aircraft Landing Gear
  Configurations (6 October 2005) — §6's grammar, Table 1's tire pressure
  codes, Table 3's eighteen rows and Figures 2-20. Read in full during the v1.9
  build; the test suite reproduces every published wheel count from the names
  alone. See §5.7.
- **FAARFIELD 2.1.1 aircraft library** (`aircraft.xml`) — per-wheel
  coordinates, gross weights and tire pressures. Read directly during the v1.9
  build for the gear configurations (§5.7) and to retire three tandem-spacing
  assumptions (§5.6). Used as an independent cross-check before that (§5.3).

**What was NOT verified during this build:**

- **Tire size and wheelbase on the sixteen gear configurations.** Both are
  nominal on every one of them, declared in `assumedFields`, and flagged in the
  app. See §5.7 — and note that the six pure Figure 2 patterns are nominal
  throughout.
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
- **Used for:** the classic dual-wheel idealization — dual tires at 13.5 in
  centers with the dual sets 72 in (1829 mm) apart — which is the basis for the
  drive/trailer track width throughout the library; and Huang's contact-area
  idealization.
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
  idealization above; it is the standard figure of the literature, but it is a
  modeling convention, not a manufacturer specification.
- Dual tire spacing 330 mm (13 in). **Sources genuinely disagree here** and the
  disagreement is recorded rather than hidden:
  - AASHTOWare Pavement ME default: **12 in (304.8 mm)** — verified.
  - Yoder & Witczak / Huang dual-wheel idealization: **13.5 in (343 mm)**.
  - Library default: **330 mm (13 in)**, mid-range and representative of
    current US class 8 practice.
  A user comparing Gear3D output against a default Pavement ME run should set
  this to 305 mm; against the classic textbook idealization, 343 mm.
- Overall lengths, bus and vocational wheelbases.

**Low confidence — representative only:**

- Classes 1–3 (motorcycle, passenger car, pickup) in full. Their loads are
  order-of-magnitude estimates from representative curb masses. They exist so
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

The aircraft library shipped in v1.2 with **four Boeing aircraft** spanning
gear codes **D, 2D and 3D**: 737-800, 757-200, 767-400ER and 777-300ER. **v1.6
adds the three wing-plus-body aircraft** — 747-400, 747-8 (both 2D/2D2) and
A380-800 (2D/3D2) — which had been deferred since the first build. Seven
aircraft, six gear codes.

Those three are sourced by a **different and better method** than the original
four, described in 5.5. Read that section before comparing numbers between
them: on the original four the outer width is an input and the track is
derived; on the three new ones the track is published and the outer width is
a cross-check.

An earlier attempt was abandoned because the sources could not be reached
(the FAA database returned 403 to the fetch tool, and the ACAP PDFs exceeded
its size limit). Both were tooling limits, not access limits: the FAA site
serves the spreadsheet normally to a browser user-agent, and the PDFs download
fine with `curl`. Every number below was retrieved and read directly.

### 5.1 Authoritative — taken verbatim

**This table describes the original four aircraft.** The three wing-plus-body
aircraft take their geometry from the manufacturer footprint figures instead —
see 5.5.

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

The FAA field is **not** the centerline tread. Its own data dictionary defines
`Main_Gear_Width_ft` as *"Distance between outer tires in the main landing
gear."* Treating it as the track would push every main wheel outboard by half
a dual spacing plus half a tire — for a 777 that is nearly a meter per side,
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
| 737-800 | 5727 mm | 5715 mm (18 ft 9 in) | +12 mm |
| 757-200 | 7302 mm | 7315 mm (24 ft 0 in) | −13 mm |
| 767-400ER | 9302 mm | 9296 mm (30 ft 6 in) | +6 mm |
| 777-300ER | 10 963 mm | 10 973 mm (36 ft 0 in) | −10 mm |

All four agree to within about 13 mm, on quantities of 6 to 11 meters — which
is roughly what quoting a tread to the nearest inch can account for, and no
more. `test/run.mjs` asserts both the derivation and this cross-check, at a
**15 mm** tolerance.

#### The 767-400ER was wrong until v1.6.1, and this table is how it showed

The 767 row previously read **9322 mm, 26 mm** — twice any other residual, and
the only one this rounding argument could not explain. It was recorded as
"agreeing to within a few centimeters" and left alone.

It was not rounding. Its dual spacing was **1143 mm**, taken as a round 45 in
because no consulted document stated it. FAARFIELD 2.1.1 stores the 767-400 ER
main gear wheel coordinates explicitly as X ±22.900 in, i.e. **45.800 in
(1163 mm)**. Because the track is *derived* from the dual spacing, that error
propagated straight into the geometry. Correcting it drops the residual from
26 mm to 6 mm and removes the outlier.

What actually moved is worth stating precisely, because it shows the
derivation behaving as designed: the **outboard tire of each dual pair did not
move at all**. The FAA outer width is the authoritative datum and is held, so a
corrected dual spacing is absorbed *inside* it — the inboard tire moves 20 mm
inboard and the strut centerline 10 mm, while the outer tire edge stays put.
This is the same property 5.4 relies on when it says the outer width is
preserved whatever dual spacing you enter.

Two things are worth taking from this beyond the number:

- **A cross-check is only as good as its tolerance.** The test that existed to
  catch this allowed 40 mm, so a 26 mm error passed for four releases. A bound
  looser than the error it guards against is decoration. It is now 15 mm.
- **The largest residual was visible the whole time and was rationalized.**
  The table above published the 26 mm figure in every release since v1.2; what
  was missing was treating an outlier as a defect rather than as noise.

### 5.4 Assumed — declared, and shown in the app

**On the original four aircraft**, two quantities are **not** constrained by
any source consulted:

- **Nose gear dual spacing.** Nothing published pins it down. FAARFIELD does
  not help here: it stores main gear only, because that is what its pavement
  analysis needs.
- **Tandem spacing** on 2D and 3D gears. The wheelbase is measured to the main
  gear *centroid*, so the spread within a bogie does not move it, and no other
  figure constrains it.

Every aircraft unit lists these in `assumedFields`, the schema **fails
validation** if that array is missing, and the app shows an amber notice naming
them whenever an aircraft is loaded. Set them from FAARFIELD before using the
output for pavement work — and note that changing a dual spacing re-derives the
track, so the authoritative outer width is preserved whatever you enter.

Neither assumption applies to the 747-8 or the A380-800: their footprint
figures publish every spacing, and both declare `assumedFields: []`. The
747-400 declares exactly one, `NLG.tire.rimDiameter`, because Boeing states
its nose tire as `49X17` — a two-part Type VII designation that omits the rim.
The overall diameter and section width come from the two published numbers and
do not depend on that assumption.

### 5.5 Wing-plus-body gear — the aircraft that were deferred (v1.6)

The **747-400**, **747-8** and **A380-800** were left out of v1.2 through v1.5
with this reason recorded: their wing-plus-body layouts need the longitudinal
and transverse offsets of the body gear relative to the wing gear, *"a single
outer width closes a two-strut layout; it cannot close a four-bogie one."*

That was correct, and it was a **data** problem rather than a modeling one.
The offsets are not in the FAA database, and they are not in FAARFIELD either
— FAARFIELD analyzes one gear at a time and stores the wing gear and the body
gear as separate entries (`B747-400` and `B747-400 Belly`), so it carries the
bogie geometry but not the distance between the two.

They are stated plainly in the manufacturers' own airport planning documents,
which is where they came from:

| Aircraft | Document | Figure |
|---|---|---|
| 747-400 | Boeing ACAP **D6-58326-1 Rev E** (Sep 2023) | §7.2.1 landing gear footprint |
| 747-8 | Boeing ACAP **D6-58326-3 Rev C** (Aug 2023) | §7.2 landing gear footprint |
| A380-800 | Airbus **AC A380**, issue **Nov 01/24** | §7-2-0 footprint, sheets 1 and 2 |

**The sourcing is inverted relative to 5.2.** These figures publish the track,
both gear positions and every spacing directly, so nothing is derived from an
outer width. The outer width instead becomes an independent check:

| Aircraft | track + dual + section | Published outer width | Difference |
|---|---|---|---|
| 747-400 | 10 998 + 1118 + 482.6 = **12 598.6 mm** | 41 ft 4 in = 12 598.4 mm (Boeing) | **0.2 mm** |
| 747-8 | 10 998 + 1189 + 533.4 = **12 720.4 mm** | 41 ft 9 in = 12 725.4 mm (Boeing) | 5 mm |
| A380-800 | 12 456 + 1350 + 530 = **14 336 mm** | 47.05 ft = 14 341 mm (FAA) | 5 mm |

The residuals are the figures' own rounding — Boeing draws to the nearest inch,
the FAA tabulates to 0.01 ft.

**Independent corroboration from FAARFIELD.** The FAA's FAARFIELD 2.1.1
aircraft library stores explicit per-wheel coordinates. It agrees with the
manufacturer figures on every bogie dimension:

| Aircraft | FAARFIELD wheel coordinates | Manufacturer figure |
|---|---|---|
| 747-400 | X ±22 in, Y 58 in | 44 in dual, 58 in tandem |
| 747-8 | X ±23.4 in, Y 56.5 in | 46.8 in dual, 56.5 in tandem |
| A380 wing | X ±674.37 mm, Y 1699.26 mm | 1350 mm dual, 1700 mm tandem |
| A380 body | X ±764.54 / ±774.70 mm, Y 0 / 1699.26 / 3398.52 mm | 1530 / **1550** / 1530 mm dual, 1700 mm tandem |

Two wholly independent sources agreeing to the millimeter, including the
A380 body bogie's **20 mm wider middle axle** — which is why `dualSpacingByRow`
exists rather than the spacing being averaged. FAARFIELD's per-strut
`MgPercent` also reproduces the load split from the other direction: 0.2375 × 4
struts = 95 % for both 747s, and 0.19 × 2 wing + 0.285 × 2 body = 95 % for the
A380, with both giving an equal 4.75 % per tire.

#### Two disagreements worth knowing about

**The FAA's tabulated wheelbase is not defined consistently for these
aircraft.** For the 747-8 it equals the centroid of the four bogies (97.3 ft
against a computed 29 655 mm, agreeing to 2 mm). For the A380 it equals the
nose-to-**body**-gear dimension (104.6 ft = 31 881 mm exactly). For the 747-400
it matches neither, nor their midpoint — it gives 87.9 ft where Boeing's figure
gives 84.0 ft, the commonly published 747-400 wheelbase. **This library uses
the manufacturer figures** and treats the FAA field as a cross-check only.

**The FAA's MTOW for the 747-400 is the -400ER figure** (910 000 lb), which
exceeds the maximum taxi weight in Boeing's own table for the -400. The
manufacturer table is used instead: MTOW 875 000 lb, MDTW 877 000 lb, from the
same column of ACAP §2.1.1.

#### What is still not included

Nothing from the original build spec. Additional weight variants (the A380
alone has fifteen) are not separate entries because the geometry is identical
across them — only the weights differ, so a variant changes tire loads and
nothing else. `A380-800 WV000` is the one carried, and its variant is stated on
every weight.

### 5.6 Tandem spacings, retired as assumptions (v1.9)

The 757-200, 767-400ER and 777-300ER shipped from v1.2 with
`MLG.tandemSpacing` declared in `assumedFields`: no consulted source
constrained it, so a plausible round number in inches was chosen and said to be
chosen. The **FAARFIELD 2.1.1 aircraft library** does constrain it.

| Aircraft | Assumed | FAARFIELD | Error |
|---|---|---|---|
| 757-200 | 1143 mm (45 in) | 1143 mm (Y ±571.5) | none |
| 767-400ER | 1422 mm (56 in) | **1371.6 mm** (Y ±685.8) | 50.4 mm too long |
| 777-300ER | 1448 mm (57 in) | **1463.04 mm** (Y −1463.04 / 0 / +1463.04) | 15.0 mm too short |

All three are now sourced and out of `assumedFields`. Only `NLG.dualSpacing`
remains assumed on the two-strut aircraft; FAARFIELD models the main gear only,
because the nose gear carries too little load to matter to thickness design.

**Why a wrong value survived seven releases.** A tandem spread is symmetric
about the bogie center, so changing it moves both axle lines equally and leaves
the wheelbase (a centroid), the track and the outer width completely untouched.
Every derivation check in the suite passed with the wrong number in place. This
is the argument for declaring assumptions in the data rather than trusting
tests to find them: the tests could not have.

### 5.7 FAA Order 5300.7 gear configurations (v1.9)

Sixteen configurations in `aircraft/faa-5300-7.json`. **Every one is
schematic** — `kind: "schematic"`, flagged in the app — and the split between
what is measured and what is nominal is not the same as it is for the real
aircraft above.

**Verified, and cited per gear.** The wheel geometry — track, dual spacing,
tandem spacing, uneven bogie offsets, wing-to-body offset — of the ten
configurations whose representative aircraft appears in the FAARFIELD 2.1.1
library: `S` (F-15C), `2S` (C-130), `2T` (C-17A), `2D/D1` (DC10-30/40),
`2D/2D1` (A340-600 WV000), `5D` (An-124), `7D` (An-225), `C5` (C-5),
`D2` (B-52), `Q2` (IL-76T). Gross weights and tire pressures come from the same
entries. This is the library already used in §5.3 to corroborate the 747 and
A380, read directly during this build.

**Nominal, and declared in `assumedFields` on every unit:**

- **The tire.** FAARFIELD carries a contact patch and an inflation pressure,
  not a Tire and Rim Association designation, and no other consulted source
  gives one for these aircraft. The tire is a stand-in chosen to fit the real
  spacings. It sets how large the rendered wheel is and moves no wheel center.
- **The wheelbase.** FAARFIELD models the main gear only. The nose gear's
  *type* is real — Order 5300.7 Table 3 tabulates it in its own column — but
  its distance forward is not.

**No outer width is stated on any of them.** On the real aircraft the FAA's
published outer width is the datum and the track derives from it (§5.2). Here
the track is measured and the outer width would depend on the nominal tire, so
stating one would present a placeholder as a datum. `mainGearOuterWidth` is
null throughout and a test asserts it.

**Low — the six pure patterns.** `T`, `Q`, `2Q`, `3S`, `3T`, `3Q` have no
aircraft behind them, or none whose geometry any consulted source publishes
(`Q`'s representative, the HS-121 Trident, left service in 1985). They are
drawn to one nominal scale — 49x19.0-22 tires, 1400 mm lateral pitch, 1450 mm
longitudinal, strut centers 1800 mm outboard of the bogie half-width, wheelbase
20 000 mm — so that Figure 2's twelve cells stay comparable, which is the
point of that figure. **Not one of those numbers describes an aircraft.**

**Two idealizations, both declared in the data.** The C-17's real bogie has its
two rows offset laterally from each other by 38.1 mm, and one wheel in each row
sits 292.1 mm out of line with the other two; both are squared up here and both
are in the FAARFIELD coordinates if needed. Loads on all sixteen use the equal
per-tire split that 95 % on the main gear implies, which is *not* how FAARFIELD
apportions the wing/body aircraft (DC-10 78/17, A340-600 72/23); the geometry
is sourced, the per-tire loads are nominal, and the unit notes say so.

**Order 5300.7 itself** — the naming convention, Table 1's pressure codes,
Table 3's eighteen rows with their wheel counts, nose gear types, typical
aircraft and the historic FAA/USAF/Navy concordance, and Figures 2–20 — was
read in full during this build and is transcribed in `src/core/gearcode.js`.
The test suite reproduces all eighteen published wheel counts from the names
alone.

---

## 6. How to check any number in this app

Every axle carries a `source` string and every load a `basis` string, both
shown in the properties panel when you select an axle. Export `unit.json`
alongside any figure and the citations travel with it.

The test suite (`npm test`, 175 checks as of v1.9) fails the build if any axle, gear, load,
GVW, MTOW, tire pressure or multi-axle group spacing lacks provenance, and
includes a negative control that confirms the validator actually rejects a
missing source rather than passing vacuously.
