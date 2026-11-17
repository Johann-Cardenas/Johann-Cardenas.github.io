# Reference photos — Road Bike Project

Drop photos of the bike in `photos/`. They are the input for refining the
parametric model (web viewer and the SolidWorks build), in the same way the
`Reference Images/` folder drives GPR-Mount.

**Privacy.** This website repository is public. `photos/` is gitignored, so
nothing placed there is committed or published. Avoid, or cover, the frame
serial number under the bottom bracket and the 529 Garage shield.

## How to shoot (this matters more than the camera)

- **Stand far back and zoom in** (5 m or more for whole-bike shots). A close,
  wide-angle photo distorts every length; a distant, zoomed one is close to an
  orthographic drawing and can be measured.
- **Camera at the height of the thing photographed**, lens axis square to the
  bike. For side views, aim at the bottom bracket.
- **Put a scale in the plane of the bike**: a tape measure or steel rule taped
  along the top tube or leaned against the wheel. One known length per photo
  is enough. The wheel rim (622 mm bead seat diameter) is a fallback.
- Bike upright, wheels straight, cranks horizontal, on level ground. Plain
  wall behind it if possible. Even light, no hard shadows.
- Full resolution, no filters. HEIC or JPG are both fine.

## Shot list

Name files with the prefix so they sort; any suffix is fine
(`A1_drive_side.jpg`, `C3_downtube_section_2.jpg`).

### A. Whole bike (geometry, M01–M08)
| ID | Shot |
|---|---|
| A1 | Drive side, square-on, whole bike, scale in frame |
| A2 | Non-drive side, square-on, whole bike |
| A3 | Front, square-on, from handlebar height |
| A4 | Rear, square-on, from rear-axle height |
| A5 | Top-down, as high as you can get (stairs or a chair), whole bike |
| A6 | Three-quarter front and three-quarter rear, for overall form |

### B. Frame junctions (the shapes a catalog does not give)
| ID | Shot |
|---|---|
| B1 | Head tube: side, front, and the top/down tube junctions |
| B2 | Bottom bracket shell: drive side, non-drive side, from below (cover the serial) |
| B3 | Seat cluster: seat tube, top tube and seat stays meeting; seatpost clamp |
| B4 | Seat stays: from behind and from the side, full length (the flattened SAVE section) |
| B5 | Chainstays: from above and from the side, full length |
| B6 | Rear dropouts and derailleur hanger, both sides |
| B7 | Fork: side (blade curve), front, crown, dropouts |

### C. Tube sections (M09)
| ID | Shot |
|---|---|
| C1 | Top tube from directly above, and from the side, with a rule alongside |
| C2 | Down tube from directly below/above, and from the side, with a rule alongside |
| C3 | If you have calipers: width and height of top, down and seat tubes every ~50 mm, written on masking tape in the photo or in `measurements.csv` |

### D. Components (identity and dimensions, M10–M14)
| ID | Shot |
|---|---|
| D1 | Crankset: drive side square-on; back of the crank arm (length marking); chainring tooth counts |
| D2 | Cassette from the side and from behind (tooth counts are stamped on the cogs) |
| D3 | Rear derailleur: side, rear, and the model marking on the back |
| D4 | Front derailleur: side and top |
| D5 | Brake calipers, front and rear, square-on; pad holders |
| D6 | Shifters/hoods: side and front |
| D7 | Handlebar and stem: top-down and side; any printed width/length markings; spacer stack |
| D8 | Seatpost markings (diameter, min insertion) and saddle: side, top, underside (model label, rails) |
| D9 | Wheels: rim sidewall labels, hubs both sides, one spoke crossing close-up; valve |
| D10 | Tyres: sidewall markings (brand, size, pressure), and the damaged rear sidewall |
| D11 | Pedals: top and underside (model marking) |
| D12 | Chain: outer plate markings |

### E. Finish and routing (M17, M18, paint)
| ID | Shot |
|---|---|
| E1 | Every decal/logo, square-on: down tube both sides, top tube, seat tube, fork, chainstay |
| E2 | Paint colour breaks (where white meets red/black), in daylight, with a white sheet of paper in frame for colour reference |
| E3 | Cable routing: bars to frame, along the top/down tube, under the bottom bracket, to each derailleur and brake |
| E4 | Bottle cages and bosses; front light and its mount; anything else attached |

### F. Clearances (M15)
| ID | Shot |
|---|---|
| F1 | Tyre-to-frame gaps: fork crown, front brake, seat-stay bridge/rear brake, chainstays (both sides), seat tube. A hex key of known size held in the gap makes these measurable. |

## What the photos unlock

| Photos | Unlocks |
|---|---|
| A1, A2 + scale | Wheelbase, angles, stack/reach check; resolves the two open geometry discrepancies |
| B*, C* | Real tube sections and junction shapes for the SolidWorks frame lofts |
| D* | Component identity (replaces assumed tooth counts, crank length, bar size, seatpost diameter) |
| E* | Paint scheme, decals, cable routing |
| F1 | Tyre-clearance limit, which gates every tyre/wheel upgrade recommendation |
