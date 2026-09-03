/* ============================================================
   Gear3D — dimension and annotation engine
   ------------------------------------------------------------
   Dimensions live in ENGINEERING space as
       { from: Point3, to: Point3, axis, offset, label, precision }
   and are projected to screen every frame and drawn as SVG on top
   of the WebGL canvas. Labels are SVG text — never TextGeometry,
   never sprite atlases. That is what keeps them crisp at 600 dpi
   and vector in an SVG or PDF export.

   DRAFTING CONVENTION: ISO 129-1.
     - Continuous dimension line with a filled closed arrowhead at
       each end.
     - Extension (witness) lines start with a small gap from the
       feature and overrun the dimension line slightly.
     - The value sits ABOVE the dimension line, parallel to it, and
       is kept upright: a label that would read upside-down is
       rotated 180 degrees so text never runs right-to-left.
     - No units on every label; the unit is stated once in the
       scale bar. The dual-unit option overrides this when a figure
       needs both.
   Recorded as a [DECISION] in DECISIONS.md.

   DEGENERATE VIEWS: a dimension seen close to end-on projects to
   almost nothing. Below FADE_START degrees it fades, and below
   FADE_END it is not drawn. Drawing it anyway produces a label
   with a two-pixel leader that means nothing.
   ============================================================ */

'use strict';

import { projectEng, projectSegment, foreshorteningDeg, pixelsPerMm, declutter, estimateTextBox, rotatedBox } from './projection.js';
import { formatLength, formatForce, UNIT_SYSTEMS } from '../core/units.js';

/** Below this angle a dimension starts to fade. */
export const FADE_START = 28;
/** Below this angle it is suppressed entirely. */
export const FADE_END = 15;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Dimension sets, each independently toggleable in the UI. */
export const DIMENSION_SETS = Object.freeze({
    longitudinal: { label: 'Longitudinal', hint: 'Axle spacings, group spans, wheelbase, overall length' },
    transverse: { label: 'Transverse', hint: 'Track width, overall width, dual spacing, section width' },
    vertical: { label: 'Vertical', hint: 'Tire diameter, loaded radius, axle center height' },
    aircraft: { label: 'Aircraft gear', hint: 'Nose-to-main wheelbase, main gear track, tandem spacing' },
    custom: { label: 'Custom', hint: 'Dimensions you added by clicking two features' }
});

/**
 * @typedef {{x:number, y:number, z:number}} Vec3
 *
 * @typedef {Object} Dimension
 * @property {string} id
 * @property {keyof typeof DIMENSION_SETS} set
 * @property {Vec3} from   engineering mm
 * @property {Vec3} to     engineering mm
 * @property {'x'|'y'|'z'} axis  the axis the measurement runs along
 * @property {number} offset     mm, how far off the feature the dimension line sits
 * @property {string} [label]    overrides the formatted value
 * @property {number} [precision]
 * @property {number} [priority] higher survives contested label positions
 * @property {Vec3} [away]   unit direction OUT of the unit at this dimension's
 *           own position. `chooseOffsetDirection` cannot work this out for
 *           itself — it sees one dimension, not a vehicle — and without it the
 *           only thing it can rank a candidate by is how well the offset
 *           projects, which says nothing about whether the line ends up beside
 *           the running gear or inside it.
 * @property {string} [note]
 */

/* ============================================================
   Automatic dimension sets
   ============================================================ */

/**
 * Build the automatic dimensions for a layout.
 *
 * @param {import('../core/layout.js').Layout} layout
 * @param {{sets?: string[], selection?: {axleId?: string, groupId?: string}}} [opts]
 * @returns {Dimension[]}
 */
export function autoDimensions(layout, opts = {}) {
    const want = new Set(opts.sets ?? ['longitudinal', 'transverse', 'vertical', 'aircraft']);
    /** @type {Dimension[]} */
    const dims = [];

    const groundZ = 0;
    const maxTireR = Math.max(...layout.wheels.map((w) => w.geometry.freeRadius));
    const minY = layout.extents.minY;
    const maxY = layout.extents.maxY;

    // The center of the running gear, used only to work out which way is OUT
    // of it from any given dimension. y = 0 because a unit is arranged about
    // its own centerline, and z = maxTireR because it stands on the pavement:
    // the vertical center of the thing being dimensioned is a tire radius up,
    // NOT on the ground. Taking the ground as the center is what made "up"
    // look like an escape and stood the tandem spacing at hub height, printed
    // across the tandem it was measuring.
    const xs = layout.axles.map((a) => a.x);
    const hub = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: 0, z: maxTireR };
    /** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
    const outOf = (a, b) => {
        const v = { x: (a.x + b.x) / 2 - hub.x, y: (a.y + b.y) / 2 - hub.y, z: (a.z + b.z) / 2 - hub.z };
        const m = Math.hypot(v.x, v.y, v.z) || 1;
        return { x: v.x / m, y: v.y / m, z: v.z / m };
    };

    /* ---------- longitudinal ---------- */
    //
    // SPACINGS ARE BETWEEN STATIONS, NOT BETWEEN AXLES. On a truck the two are
    // the same thing. On an aircraft they are not: a main gear is a left and a
    // right axle at the SAME longitudinal station, so walking the axle list
    // drew a spacing of zero between them — a dimension with no length, whose
    // label reads "0 mm" and whose arrowheads land on top of each other — and
    // then drew the nose-to-main distance twice, once as a consecutive spacing
    // and once as the outer bridge. Collapsing to distinct stations first is
    // what the truck path was already relying on being true.
    const stations = [];
    for (const a of layout.axles) {
        const at = stations.find((t) => Math.abs(t.x - a.x) < 1);
        if (at) at.ids.push(a.id); else stations.push({ x: a.x, ids: [a.id] });
    }
    stations.sort((p, q) => p.x - q.x);

    if (want.has('longitudinal') && stations.length > 1) {
        // Consecutive station spacings, drawn just outboard of the left tires.
        stations.slice(1).forEach((t, i) => {
            const prev = stations[i];
            dims.push({
                id: `lon:${prev.ids[0]}-${t.ids[0]}`,
                set: 'longitudinal',
                from: { x: prev.x, y: minY, z: groundZ },
                to: { x: t.x, y: minY, z: groundZ },
                axis: 'x',
                offset: -420,
                away: outOf({ x: prev.x, y: minY, z: groundZ }, { x: t.x, y: minY, z: groundZ }),
                priority: 6,
                note: `${prev.ids.join('/')} to ${t.ids.join('/')} centerline spacing`
            });
        });

        // Outer bridge: first to last station. Skipped when there are only two,
        // because it would then be numerically identical to the single spacing
        // already drawn — two labels reading the same value invite the reader
        // to look for a difference that is not there.
        if (stations.length > 2) {
            dims.push({
                id: 'lon:outer-bridge',
                set: 'longitudinal',
                from: { x: stations[0].x, y: minY, z: groundZ },
                to: { x: stations[stations.length - 1].x, y: minY, z: groundZ },
                axis: 'x',
                offset: -1050,
                away: { x: 0, y: -1, z: 0 },
                priority: 9,
                note: 'Outer bridge — first to last axle centerline'
            });
        }
    }

    /* ---------- transverse ---------- */
    if (want.has('transverse')) {
        const seen = new Set();
        for (const a of layout.axles) {
            if (a.wheelPositions < 2) continue;
            // One track-width dimension per distinct track, not per axle:
            // five identical 1829 mm labels stacked on top of each other is
            // noise, not information.
            const key = `track:${a.trackWidth}`;
            if (!seen.has(key)) {
                seen.add(key);
                dims.push({
                    id: `tra:${a.id}-track`,
                    set: 'transverse',
                    from: { x: a.x, y: -a.trackWidth / 2, z: groundZ },
                    to: { x: a.x, y: a.trackWidth / 2, z: groundZ },
                    axis: 'y',
                    offset: -520,
                    away: outOf({ x: a.x, y: 0, z: groundZ }, { x: a.x, y: 0, z: groundZ }),
                    priority: 7,
                    note: `Track width at ${a.id} — center to center of wheel positions`
                });
            }

            if (a.tireConfig === 'DTA' && a.dualSpacing) {
                const dualKey = `dual:${a.dualSpacing}`;
                if (!seen.has(dualKey)) {
                    seen.add(dualKey);
                    const yc = a.trackWidth / 2;
                    // Measured at the axle centerline, but stood off by more
                    // than a tire radius so the dimension line clears the
                    // wheel it belongs to instead of lying across the tread.
                    const standoff = a.geometry.freeRadius * 1.35;
                    dims.push({
                        id: `tra:${a.id}-dual`,
                        set: 'transverse',
                        from: { x: a.x, y: yc - a.dualSpacing / 2, z: a.axleHeight },
                        to: { x: a.x, y: yc + a.dualSpacing / 2, z: a.axleHeight },
                        axis: 'y',
                        offset: standoff,
                        priority: 8,
                        note: `Dual spacing at ${a.id} — center to center of the dual pair`
                    });
                }
            }
        }

        dims.push({
            id: 'tra:overall-width',
            set: 'transverse',
            from: { x: layout.axles[0].x, y: minY, z: groundZ },
            to: { x: layout.axles[0].x, y: maxY, z: groundZ },
            axis: 'y',
            offset: -900,
            away: outOf({ x: layout.axles[0].x, y: 0, z: groundZ }, { x: layout.axles[0].x, y: 0, z: groundZ }),
            priority: 5,
            note: 'Overall outside width across the tires'
        });
    }

    /* ---------- vertical ---------- */
    if (want.has('vertical')) {
        const seen = new Set();
        for (const w of layout.wheels) {
            if (seen.has(w.tire)) continue;
            seen.add(w.tire);
            const g = w.geometry;
            dims.push({
                id: `ver:${w.tire}-od`,
                set: 'vertical',
                from: { x: w.x, y: w.y, z: w.z - g.freeRadius },
                to: { x: w.x, y: w.y, z: w.z + g.freeRadius },
                axis: 'z',
                offset: 340,
                priority: 6,
                note: `${w.tire} overall diameter (nominal)`
            });
            dims.push({
                id: `ver:${w.tire}-slr`,
                set: 'vertical',
                from: { x: w.x, y: w.y, z: 0 },
                to: { x: w.x, y: w.y, z: g.staticLoadedRadius },
                axis: 'z',
                offset: -300,
                priority: 4,
                note: `${w.tire} static loaded radius — also the axle center height`
            });
        }
    }

    /* ---------- aircraft ---------- */
    if (want.has('aircraft') && layout.domain === 'aircraft') {
        const mains = layout.axles.filter((a) => a.role === 'main');
        const noses = layout.axles.filter((a) => a.role === 'nose');
        if (mains.length && noses.length) {
            const mainX = mains.reduce((s, a) => s + a.x, 0) / mains.length;
            // The named quantity wins where the two coincide. On a gear whose
            // mains all sit at one station the wheelbase IS the nose-to-main
            // spacing, and the longitudinal set has already drawn it as an
            // anonymous distance; "Wheelbase" is what the reader wants that
            // number called, so the generic one steps aside rather than
            // printing the same figure on a second line just below it.
            for (let i = dims.length - 1; i >= 0; i--) {
                const d = dims[i];
                if (d.set !== 'longitudinal') continue;
                if (Math.abs(d.from.x - noses[0].x) < 1 && Math.abs(d.to.x - mainX) < 1) {
                    dims.splice(i, 1);
                }
            }
            dims.push({
                id: 'air:wheelbase',
                set: 'aircraft',
                from: { x: noses[0].x, y: minY, z: 0 },
                to: { x: mainX, y: minY, z: 0 },
                axis: 'x',
                offset: -1400,
                away: { x: 0, y: -1, z: 0 },
                priority: 10,
                note: 'Wheelbase — nose gear to main gear centroid'
            });
        }
        if (mains.length >= 2) {
            const ys = mains.map((a) => meanY(layout, a.id));
            const left = Math.min(...ys), right = Math.max(...ys);
            dims.push({
                id: 'air:main-track',
                set: 'aircraft',
                from: { x: mains[0].x, y: left, z: 0 },
                to: { x: mains[0].x, y: right, z: 0 },
                axis: 'y',
                offset: -1100,
                away: outOf({ x: mains[0].x, y: 0, z: 0 }, { x: mains[0].x, y: 0, z: 0 }),
                priority: 10,
                note: 'Main gear track — centerline to centerline of the main gear legs'
            });
        }
        for (const a of layout.axles) {
            const rows = [...new Set(layout.wheels.filter((w) => w.axleId === a.id).map((w) => w.x))].sort((p, q) => p - q);
            if (rows.length > 1) {
                dims.push({
                    id: `air:${a.id}-tandem`,
                    set: 'aircraft',
                    from: { x: rows[0], y: meanY(layout, a.id), z: a.axleHeight },
                    to: { x: rows[1], y: meanY(layout, a.id), z: a.axleHeight },
                    axis: 'x',
                    offset: 420,
                    priority: 8,
                    note: `${a.id} tandem spacing`
                });
                break;
            }
        }
    }

    return dims;
}

/** @param {import('../core/layout.js').Layout} l @param {string} id @returns {number} */
function meanY(l, id) {
    const ws = l.wheels.filter((w) => w.axleId === id);
    return ws.length ? ws.reduce((s, w) => s + w.y, 0) / ws.length : 0;
}

/**
 * Value of a dimension in millimeters.
 * @param {Dimension} d
 * @returns {number}
 */
export function dimensionValue(d) {
    return Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y, d.to.z - d.from.z);
}

/* ============================================================
   SVG rendering
   ============================================================ */

/**
 * @typedef {Object} RenderOptions
 * @property {ArrayLike<number>} vp   view-projection matrix elements
 * @property {{width:number, height:number}} viewport
 * @property {string} unitSystem      'SI' | 'US'
 * @property {number} precision
 * @property {boolean} [dualUnits]
 * @property {number} [fontSize=12]
 * @property {string} [color]  ink; must contrast with the FIGURE background
 * @property {string} [accent]
 * @property {string} [halo]   text halo; the figure background color
 * @property {Set<string>} [highlight] dimension ids to emphasize
 */

/**
 * Draw a set of dimensions into an SVG element, replacing its contents.
 *
 * @param {SVGSVGElement} svg
 * @param {Dimension[]} dims
 * @param {RenderOptions} o
 * @returns {number} how many dimensions were actually drawn
 */
export function renderDimensions(svg, dims, o) {
    const font = o.fontSize ?? 12;
    const color = o.color ?? '#16202b';
    const accent = o.accent ?? '#c8452a';
    const sys = UNIT_SYSTEMS[o.unitSystem] || UNIT_SYSTEMS.SI;

    // Quad view draws this four times, once per pane, into groups the caller
    // has already positioned and clipped. Only the single-view caller — the
    // one that owns the whole <svg> — may clear it.
    const target = o.container || svg;
    if (!o.container) {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        svg.setAttribute('viewBox', `0 0 ${o.viewport.width} ${o.viewport.height}`);
    }

    const layer = el('g', { class: 'g3-dims' });
    target.appendChild(layer);

    /** @type {Array<{d: Dimension, geom: any, box: any}>} */
    const staged = [];

    for (const d of dims) {
        const fore = foreshorteningDeg(d.from, d.to, o.vp, o.viewport);
        if (fore < FADE_END) continue;
        const opacity = fore >= FADE_START ? 1 : (fore - FADE_END) / (FADE_START - FADE_END);

        const geom = dimensionGeometry(d, o);
        if (!geom || geom.lengthPx < 18) continue;

        const text = d.label ?? formatLength(dimensionValue(d), sys.length, {
            precision: o.precision,
            alt: o.dualUnits ? (o.unitSystem === 'SI' ? 'in' : 'mm') : null,
            altPrecision: 1
        });

        const size = estimateTextBox(text, font);
        // The label is drawn rotated to lie along its dimension line, so the
        // footprint the declutter pass must avoid is the ROTATED box. Passing
        // the flat glyph box lets a steeply angled label be treated as a thin
        // horizontal sliver, which is why values used to sit on top of each
        // other and on the tires in any three-quarter view.
        const foot = rotatedBox(size.w, size.h, geom.angle);
        staged.push({
            d,
            geom: { ...geom, opacity, text },
            box: {
                id: d.id, x: geom.labelX, y: geom.labelY,
                w: foot.w, h: foot.h,
                priority: d.priority ?? 0,
                ox: geom.normX, oy: geom.normY
            }
        });
    }

    declutter(staged.map((s) => s.box), { step: font + 4 });

    for (const s of staged) {
        drawDimension(layer, s.d, s.geom, s.box, {
            font, color, accent,
            halo: o.halo ?? '#ffffff',
            highlighted: o.highlight?.has(s.d.id) ?? false
        });
    }

    return staged.length;
}

/**
 * Screen geometry for one dimension: witness lines, dimension line, label
 * anchor and the outward normal the label staggers along.
 *
 * @param {Dimension} d
 * @param {RenderOptions} o
 */
function dimensionGeometry(d, o) {
    const dir = chooseOffsetDirection(d, o);
    const off = scaleVec(dir, d.offset);

    const a2 = addVec(d.from, off);
    const b2 = addVec(d.to, off);

    const seg = projectSegment(a2, b2, o.vp, o.viewport);
    if (seg.a.behind || seg.b.behind) return null;

    const pa = projectEng(d.from, o.vp, o.viewport);
    const pb = projectEng(d.to, o.vp, o.viewport);

    // Outward screen normal, pointing away from the feature.
    let nx = seg.a.x - pa.x;
    let ny = seg.a.y - pa.y;
    const nm = Math.hypot(nx, ny) || 1;
    nx /= nm; ny /= nm;

    return {
        pa, pb,
        da: seg.a, db: seg.b,
        lengthPx: seg.lengthPx,
        angle: seg.angle,
        labelX: (seg.a.x + seg.b.x) / 2,
        labelY: (seg.a.y + seg.b.y) / 2,
        normX: nx, normY: ny
    };
}

/**
 * Pick the offset direction for a dimension.
 *
 * The dimension line must sit clear of the model, and it must not be drawn
 * edge-on. Rather than hard-code "x dimensions offset downward", we try the
 * four candidate directions perpendicular to the measurement axis and keep
 * the one whose projected offset is longest — that is, the one most nearly
 * square to the camera in the current view. This is what lets the same
 * dimension definition read correctly in plan, side, front and 3D without
 * per-view special cases.
 *
 * LONGEST IS NOT ENOUGH, THOUGH: it only asks whether the offset is legible,
 * never whether it lands anywhere sensible. Scored on projected length alone,
 * the axle spacings on a class 9 were pushed 420 mm INBOARD of the left tires
 * — the direction the comment above them says they must avoid — and the value
 * came to rest on top of the tandem it was measuring. The two extra terms
 * below are the two ways an offset can be wrong regardless of how well it
 * projects, and both are questions the engineering frame can answer with no
 * knowledge of the model at all, because the frame is built around it: the
 * unit is arranged about y = 0 and it stands on z = 0.
 *
 *   OUTWARD  the offset must take the dimension line further from the
 *            vehicle's own axis, not across it
 *   ABOVE    and not below the pavement, where nothing can be read and the
 *            line is hidden by the ground shadow in every view but plan
 *
 * They are weights, not vetoes. A view where every candidate is bad still has
 * to draw something, and the least bad one is still the right answer.
 *
 * @param {Dimension} d
 * @param {RenderOptions} o
 * @returns {Vec3} unit vector, engineering frame
 */
export function chooseOffsetDirection(d, o) {
    /** @type {Vec3[]} */
    const candidates = d.axis === 'x'
        ? [{ x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }]
        : d.axis === 'y'
            ? [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }]
            : d.axis === 'z'
                ? [{ x: -1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]
                // 'free': a user-created diagonal. Offsetting along a
                // coordinate axis would skew the dimension line relative to
                // what it measures, so the candidates are built perpendicular
                // to the measurement itself.
                : perpendicularCandidates(d);

    const mid = { x: (d.from.x + d.to.x) / 2, y: (d.from.y + d.to.y) / 2, z: (d.from.z + d.to.z) / 2 };
    const p0 = projectEng(mid, o.vp, o.viewport);
    const probe = Math.abs(d.offset) || 300;

    let best = candidates[0];
    let bestScore = -Infinity;

    // How far this dimension already sits from the vehicle's own axis, in the
    // transverse-vertical plane. `d.offset` carries the sign, so the actual
    // displacement is the candidate scaled by it, not by its magnitude.
    const axisDist = (y, z) => Math.hypot(y, z);
    const here = axisDist(mid.y, mid.z);

    for (const c of candidates) {
        // The probe is the offset the dimension will ACTUALLY be drawn at,
        // sign and all, rather than an unsigned one: the sign is half of what
        // decides whether the result lands in front of the unit or behind it.
        const moved = addVec(mid, scaleVec(c, d.offset || probe));
        const p1 = projectEng(moved, o.vp, o.viewport);
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);

        const outward = d.away
            ? (dot(scaleVec(c, d.offset), d.away) > 0 ? 1 : 0.35)
            : (axisDist(moved.y, moved.z) >= here - 1 ? 1 : 0.4);
        const above = mid.z >= -1 && moved.z < -1 ? 0.2 : 1;
        // NEAR SIDE. The annotation layer is SVG over the canvas and has no
        // depth buffer, so a dimension standing off the FAR side of the unit is
        // drawn on top of the unit rather than behind it — which is how the
        // tandem spacing came to be printed across the tandem it measures even
        // once the line itself was correctly outboard of the tires. Depth is
        // the projected NDC z, which the projector already returns.
        const near = (p1.behind ? 0.05 : 1) * (p1.depth <= p0.depth + 1e-6 ? 1 : 0.5);

        // Prefer directions that also match the sign the author asked for,
        // so an author who wrote a negative offset still gets "below/left".
        const preference = candidates.indexOf(c) === 0 ? 1.15 : 1;
        const score = len * preference * outward * above * near;
        if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
}

/**
 * Four unit directions perpendicular to a dimension's own axis.
 * @param {Dimension} d
 * @returns {Vec3[]}
 */
function perpendicularCandidates(d) {
    const dir = unit({ x: d.to.x - d.from.x, y: d.to.y - d.from.y, z: d.to.z - d.from.z });
    // Cross with whichever world axis the measurement is least aligned to,
    // so the reference is never degenerate.
    const ref = Math.abs(dir.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    const p1 = unit(cross3(dir, ref));
    const p2 = unit(cross3(dir, p1));
    return [p1, p2, scaleVec(p1, -1), scaleVec(p2, -1)];
}

/** @param {Vec3} a @param {Vec3} b @returns {number} */
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
function cross3(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
}

/** @param {Vec3} a @returns {Vec3} */
function unit(a) {
    const m = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / m, y: a.y / m, z: a.z / m };
}

/**
 * @param {SVGElement} parent
 * @param {Dimension} d
 * @param {any} g
 * @param {any} box
 * @param {{font: number, color: string, accent: string, halo: string, highlighted: boolean}} style
 */
function drawDimension(parent, d, g, box, style) {
    const stroke = style.highlighted ? style.accent : style.color;
    const grp = el('g', {
        class: 'g3-dim' + (style.highlighted ? ' is-highlighted' : ''),
        opacity: String(g.opacity),
        'data-dim-id': d.id
    });
    if (d.note) {
        const t = el('title');
        t.textContent = d.note;
        grp.appendChild(t);
    }

    // Extension (witness) lines: small gap at the feature, slight overrun
    // past the dimension line. ISO 129-1.
    const gap = 4, overrun = 6;
    for (const [pf, pd] of [[g.pa, g.da], [g.pb, g.db]]) {
        let vx = pd.x - pf.x, vy = pd.y - pf.y;
        const m = Math.hypot(vx, vy) || 1;
        vx /= m; vy /= m;
        grp.appendChild(el('line', {
            x1: String(pf.x + vx * gap), y1: String(pf.y + vy * gap),
            x2: String(pd.x + vx * overrun), y2: String(pd.y + vy * overrun),
            stroke, 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke'
        }));
    }

    // Dimension line.
    grp.appendChild(el('line', {
        x1: String(g.da.x), y1: String(g.da.y),
        x2: String(g.db.x), y2: String(g.db.y),
        stroke, 'stroke-width': style.highlighted ? '1.6' : '1.1',
        'vector-effect': 'non-scaling-stroke'
    }));

    // Closed filled arrowheads pointing outward at each end.
    const ah = 8;
    grp.appendChild(arrowHead(g.da, g.angle + Math.PI, ah, stroke));
    grp.appendChild(arrowHead(g.db, g.angle, ah, stroke));

    // Label, kept upright and parallel to the dimension line.
    let deg = (g.angle * 180) / Math.PI;
    if (deg > 90 || deg < -90) deg += 180;
    const label = el('text', {
        x: String(box.x), y: String(box.y),
        transform: `rotate(${deg.toFixed(2)} ${box.x.toFixed(1)} ${box.y.toFixed(1)})`,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-size': String(style.font),
        fill: stroke,
        class: 'g3-dim-label'
    });
    label.textContent = g.text;

    // Halo so the value stays legible over a dark tire. The halo color is the
    // FIGURE's background, not the app theme's — exporting on publication
    // white while the app runs in dark mode must not produce a dark halo that
    // swallows the light text inside it.
    const halo = /** @type {SVGTextElement} */ (label.cloneNode(true));
    halo.setAttribute('stroke', style.halo);
    halo.setAttribute('stroke-width', '3.5');
    halo.setAttribute('stroke-linejoin', 'round');
    halo.setAttribute('fill', 'none');
    grp.appendChild(halo);
    grp.appendChild(label);

    // Leader from the dimension line to a staggered label.
    const dx = box.x - g.labelX, dy = box.y - g.labelY;
    if (Math.hypot(dx, dy) > style.font * 0.9) {
        grp.insertBefore(el('line', {
            x1: String(g.labelX), y1: String(g.labelY),
            x2: String(box.x - Math.sign(dx) * 2), y2: String(box.y - Math.sign(dy) * 2),
            stroke, 'stroke-width': '0.7', 'stroke-dasharray': '2 2', opacity: '0.75'
        }), halo);
    }

    parent.appendChild(grp);
}

/**
 * @param {{x:number,y:number}} at
 * @param {number} angle radians, pointing outward
 * @param {number} size
 * @param {string} fill
 * @returns {SVGElement}
 */
function arrowHead(at, angle, size, fill) {
    const w = size * 0.32;
    const p1 = `${at.x},${at.y}`;
    const bx = at.x - Math.cos(angle) * size;
    const by = at.y - Math.sin(angle) * size;
    const px = -Math.sin(angle) * w;
    const py = Math.cos(angle) * w;
    return el('polygon', {
        points: `${p1} ${bx + px},${by + py} ${bx - px},${by - py}`,
        fill
    });
}

/* ============================================================
   Callouts and scale bar
   ============================================================ */

/**
 * Per-axle badges with leader lines, e.g. `A1 steer · 11R22.5 · 53.4 kN`.
 *
 * @param {SVGSVGElement} svg
 * @param {import('../core/layout.js').Layout} layout
 * @param {RenderOptions & {offsets?: Record<string, {dx:number, dy:number}>}} o
 * @returns {void}
 */
export function renderCallouts(svg, layout, o) {
    const sys = UNIT_SYSTEMS[o.unitSystem] || UNIT_SYSTEMS.SI;
    const font = (o.fontSize ?? 12) - 1;
    const layer = el('g', { class: 'g3-callouts' });

    /** @type {any[]} */
    const boxes = [];
    for (const a of layout.axles) {
        const anchor = { x: a.x, y: layout.extents.maxY, z: a.axleHeight };
        const p = projectEng(anchor, o.vp, o.viewport);
        if (p.behind) continue;

        const parts = [a.id, a.role];
        const w = layout.wheels.find((x) => x.axleId === a.id);
        if (w) parts.push(w.tire);
        if (a.loadKn != null) parts.push(formatForce(a.loadKn, sys.force, { precision: 1 }));
        const text = parts.join(' · ');

        const user = o.offsets?.[a.id];
        const size = estimateTextBox(text, font);
        boxes.push({
            id: a.id, text,
            anchorX: p.x, anchorY: p.y,
            x: p.x + (user?.dx ?? 46), y: p.y + (user?.dy ?? -34),
            w: size.w, h: size.h, ox: 1, oy: -1,
            // A hand-placed callout outranks the automatic layout. Without
            // this the declutter pass shoves it straight back off the spot
            // the user just dragged it to, and the label appears to fight
            // the cursor.
            priority: user ? 100 : 0
        });
    }

    // padding, not just step: with padding 2 the pass is satisfied the moment
    // two callouts stop strictly overlapping, which leaves them stacked edge
    // to edge with a hairline between and reads as one crowded block. 6 px of
    // clearance is enough to see them as separate readings.
    declutter(boxes, { step: font + 8, padding: 6 });

    for (const b of boxes) {
        const g = el('g', { class: 'g3-callout', 'data-axle-id': b.id });
        g.appendChild(el('line', {
            x1: String(b.anchorX), y1: String(b.anchorY),
            x2: String(b.x - b.w / 2), y2: String(b.y),
            stroke: 'currentColor', 'stroke-width': '0.9', opacity: '0.7'
        }));
        g.appendChild(el('circle', {
            cx: String(b.anchorX), cy: String(b.anchorY), r: '2.2', fill: 'currentColor'
        }));
        g.appendChild(el('rect', {
            x: String(b.x - b.w / 2), y: String(b.y - b.h / 2),
            width: String(b.w), height: String(b.h), rx: '3',
            fill: o.halo ?? '#ffffff', stroke: 'currentColor',
            'stroke-width': '0.8', opacity: '0.94'
        }));
        const t = el('text', {
            x: String(b.x), y: String(b.y),
            'text-anchor': 'middle', 'dominant-baseline': 'middle',
            'font-size': String(font), fill: 'currentColor'
        });
        t.textContent = b.text;
        g.appendChild(t);
        layer.appendChild(g);
    }
    svg.appendChild(layer);
}

/**
 * Scale bar with a "nice" round length, plus an axis badge.
 *
 * @param {SVGSVGElement} svg
 * @param {RenderOptions & {margin?: number}} o
 */
export function renderScaleBar(svg, o) {
    const ppm = pixelsPerMm(o.vp, o.viewport);
    if (!Number.isFinite(ppm) || ppm <= 0) return;

    const sys = UNIT_SYSTEMS[o.unitSystem] || UNIT_SYSTEMS.SI;
    const targetPx = Math.min(180, o.viewport.width * 0.22);
    const rawMm = targetPx / ppm;
    const mm = niceLength(rawMm, o.unitSystem);
    const px = mm * ppm;
    if (!Number.isFinite(px) || px < 12) return;

    const m = o.margin ?? 18;
    const x0 = m;
    const y0 = o.viewport.height - m;
    const font = o.fontSize ?? 12;

    const g = el('g', { class: 'g3-scalebar' });
    g.appendChild(el('line', {
        x1: String(x0), y1: String(y0), x2: String(x0 + px), y2: String(y0),
        stroke: 'currentColor', 'stroke-width': '1.6'
    }));
    for (const x of [x0, x0 + px / 2, x0 + px]) {
        g.appendChild(el('line', {
            x1: String(x), y1: String(y0 - (x === x0 + px / 2 ? 4 : 7)),
            x2: String(x), y2: String(y0), stroke: 'currentColor', 'stroke-width': '1.6'
        }));
    }
    const t = el('text', {
        x: String(x0 + px / 2), y: String(y0 - 11),
        'text-anchor': 'middle', 'font-size': String(font), fill: 'currentColor'
    });
    t.textContent = formatLength(mm, sys.length, { precision: mm >= 1000 ? 1 : 0 });
    g.appendChild(t);
    svg.appendChild(g);
}

/**
 * Round a length to a 1/2/5 x 10^n value in the display unit.
 * @param {number} mm
 * @param {string} unitSystem
 * @returns {number} millimeters
 */
export function niceLength(mm, unitSystem) {
    const inDisplay = unitSystem === 'US' ? mm / 25.4 : mm;
    const exp = Math.floor(Math.log10(Math.max(1e-6, inDisplay)));
    const base = Math.pow(10, exp);
    const n = inDisplay / base;
    const snapped = n >= 5 ? 5 : n >= 2 ? 2 : 1;
    const out = snapped * base;
    return unitSystem === 'US' ? out * 25.4 : out;
}

/* ---------- tiny SVG helper ---------- */

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @returns {any}
 */
function el(tag, attrs = {}) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
}

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
function addVec(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
/** @param {Vec3} a @param {number} s @returns {Vec3} */
function scaleVec(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
