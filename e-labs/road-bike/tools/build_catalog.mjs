// Catalog source. Run `node tools/build_catalog.mjs` to regenerate data/components.json.
// A test regenerates it in memory and fails if the committed file has drifted.
//
// Evidence classes (confidence):  C confirmed by owner   L listing / seller
//                                 S stock or published reference, unverified on this bike
//                                 M must be measured or read off the part
// null means unknown. It is never treated as zero.
// Prices are approximate US street prices gathered 2026-11 and are for planning only.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEC = 'Project build specification v1.0 (2026-11-16)';
const SRC = {
  brr_gp5000: 'https://www.bicyclerollingresistance.com/road-bike-reviews/compare/continental-grand-prix-5000-2018-vs-vittoria-zaffiro-pro-g2-2020',
  brr_next: 'https://bicyclerollingresistance.com/road-bike-reviews/compare/continental-grand-prix-5000-s-tr-vs-pirelli-p-zero-velo-race-tlr-vs-vittoria-corsa-next-tlr',
  bikeradar_rim: 'https://www.bikeradar.com/advice/buyers-guides/best-rim-brake-bike-wheelsets',
  zonda: 'https://www.bike-components.de/en/Campagnolo/Zonda-C17-Wheelset-2017-Model-p49927/',
  rd5701: 'https://www.bike-components.de/en/Shimano/105-RD-5701-10-speed-Rear-Derailleur-p32530/',
  rd_forum: 'https://forum.bikeradar.com/discussion/13036544/5700-v-5701-rear-mech',
  tiagra4700: 'https://www.retrograde.bike/compatibility/shimano-tiagra-4700grx-rx400-10-speed',
  shimano_compat_2011: 'https://productinfo.shimano.com/pdfs/product/archive/2011_Compatibility_en.pdf',
  br_r7000: 'https://bike.shimano.com/en-EU/product/component/shimano105-r7000/BR-R7000.html',
  br5800_forum: 'https://www.bikeforums.net/bicycle-mechanics/1005896-shimano-105-compatibility-brake-sti-levers.html',
  hg500_32: 'https://www.decathlon.co.uk/p/mp/shimano/shimano-tiagra-4700-cs-hg500-10-speed-11-32t/_/R-p-b616a4bf-56c9-4be3-94bc-3c9fa4638e85',
  hg500_34: 'https://www.canyon.com/en-be/gear/bike-parts/spare-and-wear-parts/spare-wear-parts/shimano-cs-hg500-10-speed-cassette-11-34/10009559.html',
  gossamer: 'https://www.competitivecyclist.com/fsa-gossamer-pro-bb30-compact-crankset',
  synapse2012: 'https://www.bikeroar.com/products/cannondale/synapse-carbon-women-s-5-105-2012/specs',
  brr_rubino: 'https://www.bicyclerollingresistance.com/road-bike-reviews/compare/vittoria-rubino-pro-g2-vs-vittoria-rubino-pro-g-2016-vs-vittoria-rubino-pro-iii-2014',
  racing5: 'https://www.bike-components.de/en/Fulcrum/Racing-5-C17-Wheelset-p66668/',
};

export const slots = [
  ['frameset', 'Frameset', false, 'Frame'],
  ['wheels', 'Wheelset', false, 'Rolling'],
  ['tires', 'Tyres', false, 'Rolling'],
  ['tubes', 'Inner tubes', false, 'Rolling'],
  ['crankset', 'Crankset', false, 'Drivetrain'],
  ['bottom_bracket', 'Bottom bracket', false, 'Drivetrain'],
  ['cassette', 'Cassette', false, 'Drivetrain'],
  ['rear_derailleur', 'Rear derailleur', false, 'Drivetrain'],
  ['front_derailleur', 'Front derailleur', false, 'Drivetrain'],
  ['chain', 'Chain', false, 'Drivetrain'],
  ['shifters', 'Shift/brake levers', false, 'Controls'],
  ['cables', 'Cables & housing', false, 'Controls'],
  ['brakes', 'Brake calipers', false, 'Braking'],
  ['brake_pads', 'Brake pads', false, 'Braking'],
  ['stem', 'Stem', false, 'Cockpit'],
  ['handlebar', 'Handlebar', false, 'Cockpit'],
  ['tape', 'Bar tape', false, 'Cockpit'],
  ['aerobar', 'Clip-on aerobar', true, 'Cockpit'],
  ['seatpost', 'Seatpost', false, 'Saddle'],
  ['saddle', 'Saddle', false, 'Saddle'],
  ['pedals', 'Pedals', false, 'Contact'],
  ['cages', 'Bottle cages', true, 'Accessories'],
  ['light', 'Front light', true, 'Accessories'],
  ['rear_light', 'Rear light', true, 'Accessories'],
  ['computer', 'Computer', true, 'Accessories'],
].map(([id, label, optional, group]) => ({ id, label, optional, group }));

const req = (key, op, value, extra = {}) => ({ key, op, value, ...extra });
const RIM = [req('brake_type', 'eq', 'rim'), req('front_axle', 'eq', 'QR100'), req('rear_axle', 'eq', 'QR130')];
const HG10 = [req('freehub', 'in', ['HG-8/9/10', 'HG-11']), req('shifter_speeds', 'eq', 10)];
const CASS_NOTE = 'On an 11-speed (HG-11) freehub a 10-speed cassette needs the 1.85 mm spacer.';

/** [slot, id, name, status, confidence, fields] */
const defs = [
  // ---------------------------------------------------------------- frameset
  ['frameset', 'frameset_synapse_carbon_51_red', 'Cannondale Synapse Carbon 51 · white/red', 'installed', 'C', {
    provides: { brake_type: 'rim', front_axle: 'QR100', rear_axle: 'QR130', bb_standard: 'BB30-68', fd_mount: 'braze-on', steerer_mm: 28.6, seatpost_d_mm: null, tire_max_mm: null, brake_reach_mm: null },
    notes: 'Model year provisional: seller 2011; likely MY2012. Interfaces inferred from generation pending measurement. A 2012 listing names a "SAVE PLUS Multiflex" seatpost system, so read the post diameter off the part before buying one.',
    url: SRC.synapse2012,
  }],

  // ---------------------------------------------------------------- wheels
  ['wheels', 'wheels_fulcrum_racing_15c', 'Fulcrum Racing · 622 × 15C alloy', 'installed', 'L', {
    mass_g: 1650, mass_source: 'Racing 5 claim (later C17 generation); the installed 15C rim is older, so approximate',
    provides: { freehub: 'HG-8/9/10', rim_internal_mm: 15, brake_track: 'alloy' }, requires: RIM, url: SRC.racing5,
    visual: { depth: 24.5, depthRear: 27.5, width: 20.5, spokes: [18, 20], cross: [0, 2], rim: 'alloy_black', hub: 'black', decal: 'RACING', decalColor: '#f4f4f2', decalAccent: '#d0202a', bladed: true },
    perf: { cda_delta_m2: 0 },
    notes: 'Identified from photos: black rim with a white RACING band, ETRTO 622×15C aluminium. Read the model number on the rim (Racing 5 or 7).',
  }],
  ['wheels', 'wheels_zonda_c17', 'Campagnolo Zonda C17 · alloy, HG freehub', 'candidate', 'S', {
    mass_g: 1596, mass_source: 'Manufacturer claim, pair (one retailer lists 1,540 g)', price_usd: 520, url: SRC.zonda,
    provides: { freehub: 'HG-11', rim_internal_mm: 17, brake_track: 'alloy' }, requires: RIM,
    visual: { depth: 26, depthRear: 30, width: 22.5, spokes: [16, 21], cross: [0, 'g3'], rim: 'alloy_black', hub: 'black', decal: 'ZONDA', decalColor: '#f2f2f2', bladed: true },
    perf: { cda_delta_m2: null },
    upgrade: { tier: 2, why: 'About 50 g lighter than the installed Racing with a stiffer rear wheel and a 17 mm internal rim that supports a 25 mm tyre properly. The long-standing benchmark alloy rim-brake wheel.' },
    notes: 'Order the Shimano HG freehub version. ' + CASS_NOTE,
  }],
  ['wheels', 'wheels_fulcrum_racing3', 'Fulcrum Racing 3 C17 · alloy', 'candidate', 'S', {
    mass_g: 1560, mass_source: 'Manufacturer claim, pair; verify', price_usd: 600,
    provides: { freehub: 'HG-11', rim_internal_mm: 17, brake_track: 'alloy' }, requires: RIM,
    visual: { depth: 27, depthRear: 30, width: 22.5, spokes: [16, 21], cross: [0, 'g3'], rim: 'alloy_black', hub: 'black', decal: 'RACING 3', decalColor: '#e03a2f', bladed: true },
    perf: { cda_delta_m2: null },
    upgrade: { tier: 2, why: 'Sister wheel to the Zonda from the same factory, marketed for Shimano drivetrains. Choose on price and availability.' },
    notes: CASS_NOTE,
  }],
  ['wheels', 'wheels_dt_p1800', 'DT Swiss P 1800 Spline · alloy, tubeless-ready', 'candidate', 'S', {
    mass_g: 1630, mass_source: 'BikeRadar tested weight, pair', price_usd: 483, price_source: 'BikeRadar as-tested price', url: SRC.bikeradar_rim,
    provides: { freehub: 'HG-11', rim_internal_mm: 17.5, brake_track: 'alloy' }, requires: RIM,
    visual: { depth: 23, width: 22, spokes: [20, 24], cross: [0, 2], rim: 'alloy_black', hub: 'black', decal: 'DT SWISS', decalColor: '#ffffff', bladed: true },
    perf: { cda_delta_m2: null },
    upgrade: { tier: 2, why: 'Serviceable DT hub internals and a tubeless-ready rim. The durable, low-drama choice.' },
    notes: CASS_NOTE,
  }],
  ['wheels', 'wheels_hunt_4season_aero', 'Hunt 4 Season Aero · alloy, 19 mm internal', 'candidate', 'S', {
    mass_g: 1627, mass_source: 'BikeRadar tested weight, pair', price_usd: 499, price_source: 'BikeRadar as-tested price', url: SRC.bikeradar_rim,
    provides: { freehub: 'HG-11', rim_internal_mm: 19, brake_track: 'alloy' }, requires: RIM,
    visual: { depth: 31, width: 24, spokes: [24, 28], cross: [0, 2], rim: 'alloy_black', hub: 'black', decal: 'HUNT', decalColor: '#ffffff', bladed: true },
    perf: { cda_delta_m2: null },
    upgrade: { tier: 2, why: 'Wide rim, extra spokes and sealed bearings for year-round riding. The 19 mm internal width makes a 25 mm tyre measure close to 27 mm, so check frame clearance first.' },
    notes: CASS_NOTE,
  }],
  ['wheels', 'wheels_superteam_alloy_track', 'Superteam carbon · alloy brake track', 'candidate', 'M', {
    provides: { freehub: 'HG-8/9/10', rim_internal_mm: null, brake_track: 'alloy' }, requires: RIM,
    visual: { depth: 50, width: 23, spokes: [20, 24], cross: [0, 2], rim: 'carbon', track: 'alloy', hub: 'black', decal: 'SUPERTEAM', decalColor: '#ffffff', bladed: true },
    perf: { cda_delta_m2: null },
    upgrade: { tier: 4, why: 'Deep section at a low price while keeping the alloy brake track, so the existing pads and wet-weather braking are unchanged.' },
    notes: 'Candidate concept; exact model, dimensions and interfaces require verification.',
  }],
  ['wheels', 'wheels_hunt_50_carbon', 'Hunt 50 Carbon Wide Aero · carbon brake track', 'candidate', 'S', {
    mass_g: 1537, mass_source: 'Cycling Weekly listing, pair (2018 test)', price_usd: null,
    provides: { freehub: 'HG-11', rim_internal_mm: 19, brake_track: 'carbon' }, requires: RIM,
    visual: { depth: 50, width: 27, spokes: [18, 24], cross: [0, 2], rim: 'carbon', track: 'carbon', hub: 'black', decal: 'HUNT', decalColor: '#ffffff', bladed: true },
    perf: { cda_delta_m2: null },
    upgrade: { tier: 4, why: 'A true aero wheel. It needs carbon-specific pads, brakes worse in the wet, and its 27 mm outer width must clear the calipers and stays.' },
    notes: 'Carbon brake track: change to carbon-specific pads at the same time. ' + CASS_NOTE,
  }],

  // ---------------------------------------------------------------- tyres
  ['tires', 'tires_rubino_pro_23', 'Vittoria Rubino Pro · 700 × 23', 'installed', 'C', {
    provides: { tire_width_mm: 23 }, requires: [req('tire_max_mm', 'gte', 23)], url: SRC.brr_rubino,
    visual: { label: 'Vittoria   RUBINO PRO   23-622', sidewall: 'black' },
    perf: { crr: 0.0048, crr_basis: 'Rubino Pro III, 25 mm, 80 psi drum test (0.0048). Later G+ versions tested 0.0055–0.0057.', crr_source: SRC.brr_rubino },
    notes: 'Read from the sidewall: Rubino Pro 23-622. Inspect the rear sidewall damage noted in October.',
  }],
  ['tires', 'tires_gp5000_25', 'Continental Grand Prix 5000 · 700 × 25', 'candidate', 'S', {
    mass_g: 442, mass_source: 'Bicycle Rolling Resistance measured 221 g each', price_usd: 140, url: SRC.brr_gp5000,
    provides: { tire_width_mm: 25 }, requires: [req('tire_max_mm', 'gte', 26, { msg: 'Measured 26 mm wide on an 18 mm rim. Measure tyre clearance at the fork crown, calipers and chainstays (M15).' })],
    visual: { label: 'Continental  GRAND PRIX 5000', sidewall: 'black' },
    perf: { crr: 0.00363, crr_basis: 'Measured at 80 psi on a drum, 25 mm, butyl tube', crr_source: SRC.brr_gp5000 },
    upgrade: { tier: 1, why: 'The largest gain per dollar on this bike. Rolling resistance drops by a third against a training tyre, grip improves, and it replaces a rear tyre with a damaged sidewall.' },
  }],
  ['tires', 'tires_gp5000_as_tr_25', 'Continental GP5000 AS TR · 700 × 25', 'candidate', 'S', {
    price_usd: 170, provides: { tire_width_mm: 25 },
    requires: [req('tire_max_mm', 'gte', 25, { msg: 'Measure safe tyre clearance at crown, calipers and chainstays (M15).' })],
    visual: { label: 'Continental  GP5000 AS TR', sidewall: 'black' }, perf: { crr: null },
    upgrade: { tier: 1, why: 'All-season version with more puncture protection and wet grip. The better pick if most riding is commuting or shoulder-season.' },
  }],
  ['tires', 'tires_power_cup_25', 'Michelin Power Cup · 700 × 25', 'candidate', 'S', {
    mass_g: 430, mass_source: 'Manufacturer claim 215 g each; verify', price_usd: 130, provides: { tire_width_mm: 25 },
    requires: [req('tire_max_mm', 'gte', 25, { msg: 'Measure safe tyre clearance (M15).' })],
    visual: { label: 'MICHELIN  POWER CUP', sidewall: 'tan' }, perf: { crr: null },
    upgrade: { tier: 1, why: 'Fast clincher available with a classic tan sidewall.' },
  }],
  ['tires', 'tires_corsa_next_26', 'Vittoria Corsa N.EXT TLR · 700 × 26', 'candidate', 'S', {
    mass_g: 570, mass_source: 'Specified 285 g each (Bicycle Rolling Resistance)', price_usd: 140, url: SRC.brr_next, provides: { tire_width_mm: 26 },
    requires: [req('tire_max_mm', 'gte', 26, { msg: 'Measure safe tyre clearance (M15).' })],
    visual: { label: 'Vittoria  CORSA N.EXT', sidewall: 'black' }, perf: { crr: null },
    upgrade: { tier: 1, why: 'Nylon-casing race tyre that tolerates rough roads. Tubeless-ready, usable with tubes on the current rims.' },
  }],
  ['tires', 'tires_gp5000_28', 'Continental Grand Prix 5000 · 700 × 28', 'candidate', 'S', {
    mass_g: 470, mass_source: 'Manufacturer claim 235 g each; verify', price_usd: 140, provides: { tire_width_mm: 28 },
    requires: [req('tire_max_mm', 'gte', 29, { msg: 'A 28 mm tyre is at or beyond what rim-brake frames of this generation usually clear. Do not buy before measuring (M15).' }),
      req('caliper_tire_max_mm', 'gte', 28, { level: 'warn', msg: 'The selected calipers are not rated for a 28 mm tyre.' })],
    visual: { label: 'Continental  GRAND PRIX 5000', sidewall: 'black' }, perf: { crr: null },
    upgrade: { tier: 3, why: 'More comfort and grip at lower pressure, if and only if the frame, fork and calipers clear it.' },
  }],

  // ---------------------------------------------------------------- tubes
  ['tubes', 'tubes_installed_butyl', 'Installed inner tubes · assumed butyl', 'installed', 'M', {
    notes: 'Material and size unverified.', visual: {}, perf: { crr_factor: 1 },
  }],
  ['tubes', 'tubes_tpu', 'TPU inner tubes (Tubolito / RideNow class)', 'candidate', 'S', {
    mass_g: 80, mass_source: 'Typical 36–40 g each; weigh', price_usd: 40,
    notes: 'Use only models the maker rates for rim brakes: heat from long descents softens TPU. Pack one as the spare regardless.',
    perf: { crr_factor: null },
    upgrade: { tier: 1, why: 'Saves roughly 130 g of rotating mass for the pair and rolls slightly faster than butyl. Also the smallest spare you can carry.' },
  }],
  ['tubes', 'tubes_latex', 'Latex inner tubes', 'candidate', 'S', {
    mass_g: 160, mass_source: 'Typical 75–85 g each; weigh', price_usd: 36,
    notes: 'Lose pressure overnight, so pump before every ride. Not for carbon brake tracks.',
    perf: { crr_factor: null },
    upgrade: { tier: 3, why: 'The lowest rolling resistance of any tube and a noticeably smoother ride, in exchange for daily inflation.' },
  }],

  // ---------------------------------------------------------------- crankset / BB
  ['crankset', 'crank_fsa_gossamer_bb30_50_34', 'FSA Gossamer BB30 · 50/34 N10, 110 BCD', 'installed', 'C', {
    provides: { ring_big: 50, ring_small: 34, crank_spindle: 'BB30' }, requires: [req('bb_spindle', 'eq', 'BB30')], url: SRC.gossamer,
    visual: { style: 'gossamer', arm: '#17181a', ring: '#1b1c1f', accent: '#d9d9d6', label: 'FSA' },
    notes: 'Crank length to read (M10). Listings disagree on mass (751 g and 808 g), so no reference mass is used.',
  }],
  ['crankset', 'crank_hollowgram_si_50_34', 'Cannondale HollowGram Si BB30 · 50/34', 'candidate', 'S', {
    price_usd: 250, provides: { ring_big: 50, ring_small: 34, crank_spindle: 'BB30' }, requires: [req('bb_spindle', 'eq', 'BB30')],
    visual: { style: 'hollowgram', arm: '#1a1b1d', ring: '#101113', accent: '#e8e8e8', label: 'HOLLOWGRAM' },
    notes: 'Cannondale’s own BB30 crank; fits the existing bearings. Used-market price shown.',
    upgrade: { tier: 4, why: 'Native BB30, hollow-forged arms, lighter and stiffer than the Gossamer, and it keeps the frame’s original bearing standard.' },
  }],
  ['crankset', 'crank_105_r7000_50_34', 'Shimano 105 FC-R7000 · 50/34 (24 mm spindle)', 'candidate', 'S', {
    price_usd: 150, provides: { ring_big: 50, ring_small: 34, crank_spindle: 'HT2-24' },
    requires: [req('bb_spindle', 'eq', 'HT2-24', { msg: 'A 24 mm Hollowtech II crank needs the BB30-to-24 mm bottom bracket.' })],
    visual: { style: 'r7000', arm: '#141517', ring: '#1b1c1f', accent: '#9a9da2', label: '105' },
    notes: '11-speed rings; they shift a 10-speed chain acceptably but this is outside Shimano’s chart.',
    upgrade: { tier: 4, why: 'Shimano’s rings give the best front shifting available, and the conversion bottom bracket ends BB30 creak.' },
  }],
  ['bottom_bracket', 'bb_fsa_bb30', 'BB30 press-in bearings (6806)', 'installed', 'S', {
    provides: { bb_spindle: 'BB30' }, requires: [req('bb_standard', 'eq', 'BB30-68')], visual: { style: 'bb30' },
    notes: 'Bearing brand and condition unverified. Check for play and creak.',
  }],
  ['bottom_bracket', 'bb_bb30_angular', 'BB30 angular-contact bearings (Wheels Mfg / Enduro)', 'candidate', 'S', {
    price_usd: 60, provides: { bb_spindle: 'BB30' }, requires: [req('bb_standard', 'eq', 'BB30-68')], visual: { style: 'bb30' },
    upgrade: { tier: 3, why: 'Angular-contact bearings carry pedalling side load better than the stock radial 6806 and usually cure BB30 creak.' },
  }],
  ['bottom_bracket', 'bb_bb30_to_shimano', 'BB30 → Shimano 24 mm bottom bracket (Wheels Mfg)', 'candidate', 'S', {
    price_usd: 95, provides: { bb_spindle: 'HT2-24' }, requires: [req('bb_standard', 'eq', 'BB30-68')], visual: { style: 'outboard' },
    notes: 'Threads together inside the shell, so the cups cannot walk.',
    upgrade: { tier: 4, why: 'Lets the frame take any Shimano Hollowtech II crank.' },
  }],

  // ---------------------------------------------------------------- cassette
  ['cassette', 'cassette_cs5700_11_28', 'Shimano CS-5700 · assumed 11–28', 'installed', 'M', {
    provides: { cog_min: 11, cog_max: 28, cassette_speeds: 10 }, requires: HG10, visual: { cogs: [11, 12, 13, 14, 15, 17, 19, 21, 24, 28] },
    notes: 'Installed range requires tooth count (M11). ' + CASS_NOTE,
  }],
  ['cassette', 'cassette_cs6700_12_30', 'Shimano Ultegra CS-6700 · 12–30', 'candidate', 'S', {
    mass_g: 269, mass_source: 'Manufacturer claim; verify', price_usd: 75, provides: { cog_min: 12, cog_max: 30, cassette_speeds: 10 }, requires: HG10,
    visual: { cogs: [12, 13, 14, 15, 17, 19, 21, 24, 27, 30] },
    notes: 'Needs a 30T-rated rear derailleur (RD-5701-SS). ' + CASS_NOTE,
    upgrade: { tier: 3, why: 'One easier climbing gear with tighter steps than an 11–32. Gives up the 11T, which a 50T ring rarely needs below 50 km/h.' },
  }],
  ['cassette', 'cassette_hg500_11_32', 'Shimano CS-HG500-10 · 11–32', 'candidate', 'S', {
    mass_g: 390, mass_source: 'Retailer listing', price_usd: 45, url: SRC.hg500_32, provides: { cog_min: 11, cog_max: 32, cassette_speeds: 10 }, requires: HG10,
    visual: { cogs: [11, 12, 14, 16, 18, 20, 22, 25, 28, 32] },
    notes: 'Needs the medium-cage RD-5701-GS. ' + CASS_NOTE,
    upgrade: { tier: 3, why: 'A 34 × 32 low gear is 12 % easier than 34 × 28. The usual answer for long or steep climbs.' },
  }],
  ['cassette', 'cassette_hg500_11_34', 'Shimano CS-HG500-10 · 11–34', 'candidate', 'S', {
    mass_g: 386, mass_source: 'Retailer listing', price_usd: 50, url: SRC.hg500_34, provides: { cog_min: 11, cog_max: 34, cassette_speeds: 10 }, requires: HG10,
    visual: { cogs: [11, 13, 15, 17, 19, 21, 23, 26, 30, 34] },
    notes: 'Beyond every 10-speed road derailleur that this shifter can index. ' + CASS_NOTE,
    upgrade: { tier: 5, why: 'A 1:1 low gear. Only reachable with a 9-speed mountain derailleur, which is outside Shimano’s chart.' },
  }],

  // ---------------------------------------------------------------- derailleurs
  ['rear_derailleur', 'rd_5700_ss', 'Shimano 105 RD-5700-SS', 'installed', 'C', {
    mass_g: 214, mass_source: 'BikeRadar measured reference', provides: { rd_max_cog: 28, rd_capacity: 33 }, url: SRC.rd_forum,
    requires: [req('cog_max', 'lte', 28, { level: 'warn', msg: 'Largest cog exceeds conservative RD-5700-SS 28T rating.' }),
      req('capacity_needed', 'lte', 33, { level: 'warn', msg: 'Required chain-wrap capacity exceeds 33T.' }),
      req('shifter_speeds', 'eq', 10), req('shifter_pull', 'eq', 'shimano-road-10')],
    visual: { cage: 60, style: '105', color: '#1a1b1e' },
  }],
  ['rear_derailleur', 'rd_5701_ss', 'Shimano 105 RD-5701-SS', 'candidate', 'S', {
    price_usd: 55, provides: { rd_max_cog: 30, rd_capacity: 33 }, url: SRC.rd5701,
    requires: [req('cog_max', 'lte', 30, { level: 'warn', msg: 'Largest cog exceeds the RD-5701-SS 30T rating.' }),
      req('capacity_needed', 'lte', 33, { level: 'warn', msg: 'Required chain-wrap capacity exceeds 33T (one listing says 34T).' }),
      req('shifter_speeds', 'eq', 10), req('shifter_pull', 'eq', 'shimano-road-10')],
    visual: { cage: 60, style: '105', color: '#1a1b1e' },
    notes: 'Same shifter pull as the installed derailleur; rated to 30T.',
    upgrade: { tier: 3, why: 'The minimal change that makes a 12–30 cassette officially supported.' },
  }],
  ['rear_derailleur', 'rd_5701_gs', 'Shimano 105 RD-5701-GS (medium cage)', 'candidate', 'S', {
    price_usd: 60, provides: { rd_max_cog: 32, rd_capacity: 39 }, url: SRC.rd5701,
    requires: [req('cog_max', 'lte', 32, { level: 'warn', msg: 'Largest cog exceeds the RD-5701-GS 32T rating.' }),
      req('capacity_needed', 'lte', 39, { level: 'warn', msg: 'Required chain-wrap capacity exceeds 39T (listings say 39T or 40T).' }),
      req('shifter_speeds', 'eq', 10), req('shifter_pull', 'eq', 'shimano-road-10')],
    visual: { cage: 76, style: '105', color: '#1a1b1e' },
    notes: 'Fit a new, longer chain with it.',
    upgrade: { tier: 3, why: 'Opens up the 11–32 cassette with the existing shifters.' },
  }],
  ['rear_derailleur', 'rd_m592_sgs', 'Shimano Deore RD-M592 SGS (9-speed MTB)', 'candidate', 'S', {
    price_usd: 45, provides: { rd_max_cog: 34, rd_capacity: 45 },
    requires: [req('cog_max', 'lte', 34, { level: 'warn', msg: 'Largest cog exceeds 34T.' }), req('capacity_needed', 'lte', 45, { level: 'warn', msg: 'Capacity exceeds 45T.' }),
      req('shifter_speeds', 'eq', 10), req('shifter_pull', 'eq', 'shimano-road-10')],
    visual: { cage: 92, style: 'mtb', color: '#2a2c30' },
    notes: 'Unofficial. 9-speed Shimano mountain derailleurs share the pre-4700 road cable-pull ratio, which is why this indexes; Shimano does not list the combination.',
    upgrade: { tier: 5, why: 'The known workaround for an 11–34 cassette on 10-speed road shifters.' },
  }],
  ['rear_derailleur', 'rd_4700_gs', 'Shimano Tiagra RD-4700-GS', 'candidate', 'S', {
    price_usd: 45, provides: { rd_max_cog: 34, rd_capacity: 41 }, url: SRC.tiagra4700,
    requires: [req('shifter_pull', 'eq', 'shimano-road-11', { msg: 'Tiagra 4700 uses the 11-speed road cable-pull ratio. ST-5700 levers cannot index it.' })],
    visual: { cage: 76, style: '105', color: '#2c2e33' },
    notes: 'Listed because it looks like the obvious cheap 10-speed upgrade and is not.',
  }],
  ['front_derailleur', 'fd_5700', 'Shimano 105 FD-5700 · braze-on', 'installed', 'S', {
    mass_g: 97, mass_source: 'Manufacturer reference', requires: [req('fd_mount', 'eq', 'braze-on')], visual: { style: '105' },
  }],

  // ---------------------------------------------------------------- chain
  ['chain', 'chain_installed_10s', 'Installed 10-speed chain', 'installed', 'M', {
    provides: { chain_speeds: 10 }, requires: [req('cassette_speeds', 'eq', 10)], visual: { plate: '#8f9398', inner: '#7c8085' },
    notes: 'Read plate markings and measure wear M11; no assumed mass.',
  }],
  ['chain', 'chain_cn6701', 'Shimano Ultegra CN-6701 · 10-speed', 'candidate', 'S', {
    mass_g: 267, mass_source: 'Manufacturer claim; verify', price_usd: 35, provides: { chain_speeds: 10 }, requires: [req('cassette_speeds', 'eq', 10)],
    visual: { plate: '#b9bcc0', inner: '#8f9398' },
    notes: 'Directional: logos face outward.',
    upgrade: { tier: 1, why: 'A worn chain wears the cassette and rings. Replace at 0.5 % elongation; this is the matching chain for 5700/6700.' },
  }],
  ['chain', 'chain_kmc_x10sl', 'KMC X10SL · 10-speed', 'candidate', 'S', {
    mass_g: 240, mass_source: 'Manufacturer claim; verify', price_usd: 55, provides: { chain_speeds: 10 }, requires: [req('cassette_speeds', 'eq', 10)],
    visual: { plate: '#d9c27a', inner: '#b9bcc0' },
    upgrade: { tier: 3, why: 'Hollow pins and slotted plates, with a reusable quick link that makes hot-waxing practical.' },
  }],

  // ---------------------------------------------------------------- controls
  ['shifters', 'levers_st5700', 'Shimano 105 ST-5700 · 2 × 10', 'installed', 'S', {
    mass_g: 484, mass_source: 'Manufacturer reference, pair', provides: { shifter_speeds: 10, brake_pull: 'road-caliper', shifter_pull: 'shimano-road-10' },
    visual: { hood: '#17181a', lever: '#22242a' }, url: SRC.shimano_compat_2011,
  }],
  ['cables', 'cables_installed', 'Installed cables and housing', 'installed', 'M', {
    notes: 'Age and type unverified. ST-5700 routes both shift cables under the tape, which adds friction as they age.', visual: { color: '#151517' },
  }],
  ['cables', 'cables_polymer', 'Shimano polymer-coated cable set (OT-SP41 / OT-RS900)', 'candidate', 'S', {
    price_usd: 45, visual: { color: '#151517' },
    upgrade: { tier: 1, why: 'Under-tape shift routing is the weak point of 5700. Fresh low-friction cables and housing restore light, accurate shifting for the price of a tyre.' },
  }],

  // ---------------------------------------------------------------- braking
  ['brakes', 'brakes_br5700', 'Shimano 105 calipers · pair', 'installed', 'C', {
    mass_g: 376, mass_source: 'Manufacturer reference, pair', provides: { caliper_tire_max_mm: null },
    requires: [req('brake_type', 'eq', 'rim'), req('brake_pull', 'eq', 'road-caliper')], visual: { style: '5700', color: '#1b1c1f' },
    notes: 'Shimano 105 confirmed in photos; the hollow “105” logo matches the BR-5800 generation, so read the model code. Mass is the BR-5700 reference.',
  }],
  ['brakes', 'brakes_br_r7000', 'Shimano 105 BR-R7000 · pair', 'candidate', 'S', {
    mass_g: 379, mass_source: 'Shimano listed average, pair', price_usd: 110, url: SRC.br_r7000, provides: { caliper_tire_max_mm: 28 },
    requires: [req('brake_type', 'eq', 'rim'), req('brake_pull', 'eq', 'road-caliper')], visual: { style: 'r7000', color: '#15161a' },
    notes: 'Riders report these work with 5700 levers; Shimano’s chart does not list the pairing, so treat lever feel as unverified.',
    upgrade: { tier: 3, why: 'Stiffer symmetric arms and rated clearance for a 28 mm tyre.' },
  }],
  ['brakes', 'brakes_br_r8000', 'Shimano Ultegra BR-R8000 · pair', 'candidate', 'S', {
    mass_g: 360, mass_source: 'Shimano listed average, pair; verify', price_usd: 160, provides: { caliper_tire_max_mm: 28 },
    requires: [req('brake_type', 'eq', 'rim'), req('brake_pull', 'eq', 'road-caliper')], visual: { style: 'r7000', color: '#2a2c31' },
    notes: 'Same lever-pairing caveat as BR-R7000.',
    upgrade: { tier: 4, why: 'The stiffest cable rim caliper Shimano made short of Dura-Ace.' },
  }],
  ['brake_pads', 'pads_installed', 'Installed brake pads', 'installed', 'M', {
    provides: { pad_compound: 'alloy' }, requires: [req('brake_track', 'eq', 'alloy', { msg: 'These pads are for alloy rims. Carbon brake tracks need carbon-specific pads.' })],
    visual: { color: '#1c1c1c' }, notes: 'Compound and wear unverified.',
  }],
  ['brake_pads', 'pads_swissstop_bxp', 'SwissStop FlashPro BXP (alloy rims)', 'candidate', 'S', {
    price_usd: 40, provides: { pad_compound: 'alloy' }, requires: [req('brake_track', 'eq', 'alloy', { msg: 'BXP is an alloy-rim compound.' })], visual: { color: '#2b59c3' },
    upgrade: { tier: 1, why: 'Much stronger wet braking than stock pads and gentler on the rim. The cheapest safety upgrade here.' },
  }],
  ['brake_pads', 'pads_koolstop_salmon', 'Kool-Stop Salmon inserts (alloy rims)', 'candidate', 'S', {
    price_usd: 22, provides: { pad_compound: 'alloy' }, requires: [req('brake_track', 'eq', 'alloy', { msg: 'Salmon is an alloy-rim compound.' })], visual: { color: '#e9836b' },
    upgrade: { tier: 1, why: 'The classic wet-weather compound; fits the existing cartridge holders.' },
  }],
  ['brake_pads', 'pads_black_prince', 'SwissStop Black Prince (carbon rims)', 'candidate', 'S', {
    price_usd: 60, provides: { pad_compound: 'carbon' }, requires: [req('brake_track', 'eq', 'carbon', { msg: 'Black Prince is a carbon-rim compound.' })], visual: { color: '#111111' },
    notes: 'Required with carbon brake tracks.',
  }],

  // ---------------------------------------------------------------- cockpit
  ['stem', 'stem_installed', 'Installed alloy stem · 31.8 mm', 'installed', 'M', {
    provides: { stem_bar_clamp_mm: 31.8 }, requires: [req('steerer_mm', 'eq', 28.6)], visual: { color: '#17181a', label: 'C2' },
    notes: 'M12: length, angle, orientation and spacers. The stock part was a Cannondale C2, 6°.',
  }],
  ['handlebar', 'bar_installed', 'Installed compact drop bar', 'installed', 'M', {
    requires: [req('stem_bar_clamp_mm', 'eq', 31.8)], visual: { color: '#17181a' }, notes: 'M12: width, reach, drop and clamp space.',
  }],
  ['handlebar', 'bar_carbon_compact', 'Carbon compact bar (e.g. FSA K-Force Compact)', 'candidate', 'S', {
    price_usd: 280, requires: [req('stem_bar_clamp_mm', 'eq', 31.8)], visual: { color: '#101113', carbon: true },
    notes: 'Most carbon bars are not rated for clip-on aerobars.',
    upgrade: { tier: 5, why: 'Damps road buzz and saves roughly 60–80 g. A comfort purchase, not a speed one.' },
  }],
  ['tape', 'tape_installed', 'Installed bar tape', 'installed', 'M', { visual: {} }],
  ['tape', 'tape_lizard_dsp', 'Lizard Skins DSP 2.5 mm', 'candidate', 'S', {
    price_usd: 42, mass_g: 56, mass_source: 'Manufacturer claim', visual: { thick: 2.5 },
    upgrade: { tier: 2, why: 'Grippy when wet and replaces tape that has to come off anyway when the cables are changed.' },
  }],
  ['aerobar', 'aerobar_redshift_qr', 'Redshift Quick-Release aerobar', 'candidate', 'S', {
    price_usd: 180, requires: [req('stem_bar_clamp_mm', 'eq', 31.8)], visual: {},
    perf: { cda_position: 'aero' },
    notes: 'Verify uncluttered clamp space beside stem and light mount.',
    upgrade: { tier: 4, why: 'Position is most of the drag. Clip-ons are worth more on a flat solo ride than any wheelset.' },
  }],

  // ---------------------------------------------------------------- saddle / post
  ['seatpost', 'seatpost_installed', 'Installed seatpost · diameter unverified', 'installed', 'M', {
    visual: { style: 'alloy', color: '#17181a' }, notes: 'M13: read marking; 27.2 mm expected, not confirmed.',
  }],
  ['seatpost', 'seatpost_ergon_cf3', 'Ergon CF3 Pro Carbon (leaf-spring) · 27.2', 'candidate', 'S', {
    mass_g: 220, mass_source: 'Manufacturer claim', price_usd: 250, requires: [req('seatpost_d_mm', 'eq', 27.2)], visual: { style: 'leaf', color: '#101113' },
    upgrade: { tier: 4, why: 'Two carbon leaves flex fore-aft to take the edge off rough roads; the same idea as the frame’s SAVE stays.' },
  }],
  ['seatpost', 'seatpost_thomson_elite', 'Thomson Elite · 27.2', 'candidate', 'S', {
    mass_g: 228, mass_source: 'Manufacturer claim, 330 mm; verify', price_usd: 100, requires: [req('seatpost_d_mm', 'eq', 27.2)], visual: { style: 'thomson', color: '#1a1b1e' },
    upgrade: { tier: 5, why: 'A clamp that holds its angle and never creaks.' },
  }],
  ['saddle', 'saddle_serfas_155', 'Serfas · 155 mm, centre channel', 'installed', 'C', { visual: { width: 155, length: 262, style: 'channel' }, notes: 'Photo: Serfas 155 with a moulded centre relief channel. Model and rail material unverified.' }],
  ['saddle', 'saddle_power_comp_155', 'Specialized Power Comp · 155 mm', 'candidate', 'S', {
    mass_g: 241, mass_source: 'Manufacturer claim; verify', price_usd: 140, visual: { width: 155, length: 240, style: 'short' },
    upgrade: { tier: 4, why: 'Short-nose shape with a full cut-out, in the same 155 mm width. Saddles are personal: test before buying.' },
  }],

  // ---------------------------------------------------------------- contact / accessories
  ['pedals', 'pedals_spdsl', 'Shimano SPD-SL pedals', 'installed', 'L', { provides: { cleat: 'SPD-SL' }, visual: { style: 'spdsl' }, notes: 'Listing; read model marking.' }],
  ['pedals', 'pedals_r8000', 'Shimano Ultegra PD-R8000', 'candidate', 'S', {
    mass_g: 248, mass_source: 'Manufacturer claim, pair', price_usd: 150, provides: { cleat: 'SPD-SL' }, visual: { style: 'spdsl', carbon: true },
    upgrade: { tier: 5, why: 'Carbon body and wider platform; keeps the same cleats.' },
  }],
  ['pedals', 'pedals_assioma_duo', 'Favero Assioma DUO power-meter pedals', 'candidate', 'S', {
    mass_g: 303, mass_source: 'Manufacturer claim, pair', price_usd: 590, provides: { cleat: 'Look Keo' }, visual: { style: 'assioma' },
    notes: 'Changes the cleat system to Look Kéo.',
    upgrade: { tier: 4, why: 'Dual-sided power moves with the rider to any bike and is independent of the BB30 crank. Makes training and every estimate in this app measurable.' },
  }],
  ['cages', 'cages_installed', 'Two bottle cages', 'installed', 'C', { visual: { color: '#17181a' } }],
  ['cages', 'cages_elite_custom_race', 'Elite Custom Race Plus · pair', 'candidate', 'S', {
    mass_g: 80, mass_source: 'Manufacturer claim 40 g each', price_usd: 36, visual: { color: '#c41230' },
    upgrade: { tier: 5, why: 'Holds bottles on rough roads; available in the frame’s red.' },
  }],
  ['light', 'light_evo1300', 'Magicshine EVO 1300 + mount', 'installed', 'C', { visual: {} }],
  ['rear_light', 'rear_light_varia', 'Garmin Varia RTL515 radar tail light', 'candidate', 'S', {
    mass_g: 71, mass_source: 'Manufacturer claim', price_usd: 200, visual: {},
    upgrade: { tier: 2, why: 'Rear-approach radar with a daylight-visible light. For solo road riding it is a safety upgrade ahead of any speed part.' },
  }],
  ['computer', 'computer_edge540', 'Garmin Edge 540 on the out-front mount', 'candidate', 'S', {
    mass_g: 80, mass_source: 'Manufacturer claim', price_usd: 350, visual: {},
    upgrade: { tier: 4, why: 'Shares the out-front mount with the EVO 1300 and displays the radar and power meter.' },
  }],
];

export const default_config = {
  frameset: 'frameset_synapse_carbon_51_red', wheels: 'wheels_fulcrum_racing_15c', tires: 'tires_rubino_pro_23', tubes: 'tubes_installed_butyl',
  crankset: 'crank_fsa_gossamer_bb30_50_34', bottom_bracket: 'bb_fsa_bb30', cassette: 'cassette_cs5700_11_28', rear_derailleur: 'rd_5700_ss',
  front_derailleur: 'fd_5700', chain: 'chain_installed_10s', shifters: 'levers_st5700', cables: 'cables_installed', brakes: 'brakes_br5700',
  brake_pads: 'pads_installed', stem: 'stem_installed', handlebar: 'bar_installed', tape: 'tape_installed', seatpost: 'seatpost_installed',
  saddle: 'saddle_serfas_155', pedals: 'pedals_spdsl', cages: 'cages_installed', light: 'light_evo1300',
};

/** Staged upgrade plans. Each is applied on top of the installed build. */
export const bundles = [
  { id: 'stage1', title: 'Stage 1 · Rubber, stopping and shifting', summary: 'Wear items that are due anyway. The fastest and safest money on the bike.',
    set: { tires: 'tires_gp5000_25', tubes: 'tubes_tpu', brake_pads: 'pads_swissstop_bxp', chain: 'chain_cn6701', cables: 'cables_polymer', tape: 'tape_lizard_dsp' } },
  { id: 'stage2', title: 'Stage 2 · Wheels and visibility', summary: 'Lighter, stiffer alloy wheels with a wider rim, plus rear radar.',
    set: { tires: 'tires_gp5000_25', tubes: 'tubes_tpu', brake_pads: 'pads_swissstop_bxp', chain: 'chain_cn6701', cables: 'cables_polymer', tape: 'tape_lizard_dsp', wheels: 'wheels_zonda_c17', rear_light: 'rear_light_varia' } },
  { id: 'climb', title: 'Climbing gears', summary: 'An 11–32 cassette with the medium-cage derailleur that supports it.',
    set: { cassette: 'cassette_hg500_11_32', rear_derailleur: 'rd_5701_gs', chain: 'chain_cn6701' } },
  { id: 'data', title: 'Power and data', summary: 'Measure the engine. Turns the estimates in this app into numbers.',
    set: { pedals: 'pedals_assioma_duo', computer: 'computer_edge540' } },
  { id: 'aero', title: 'Flat-road speed', summary: 'Position first, then wheels.',
    set: { aerobar: 'aerobar_redshift_qr', tires: 'tires_gp5000_25', tubes: 'tubes_tpu', wheels: 'wheels_superteam_alloy_track' } },
];

export function buildCatalog() {
  const components = defs.map(([slot, id, name, status, confidence, f]) => ({
    id, slot, name, status, confidence, model: null, representation: 'procedural',
    mass_g: f.mass_g ?? null, mass_source: f.mass_source ?? null,
    price_usd: f.price_usd ?? null, price_source: f.price_usd == null ? null : (f.price_source ?? 'Approximate US street price, 2026-11; verify'),
    provides: f.provides ?? {}, requires: f.requires ?? [], notes: f.notes ?? '',
    source: status === 'installed' ? SPEC : 'Upgrade research 2026-11-16', url: f.url ?? null,
    visual: f.visual ?? {}, perf: f.perf ?? {}, upgrade: f.upgrade ?? null, mounts: { root: 'BB_CENTER' },
  }));
  return { schema: 'synapse-components/2', slots, default_config, bundles, components };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL('../data/components.json', import.meta.url);
  const cat = buildCatalog();
  writeFileSync(out, JSON.stringify(cat, null, 1) + '\n');
  console.log(`Wrote ${cat.components.length} components in ${cat.slots.length} slots.`);
}
