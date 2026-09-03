/* ============================================================
   Gear3D — measurement snap targets
   ------------------------------------------------------------
   A dimension is only worth drawing if its endpoints sit exactly
   on real features. Free-hand endpoints produce numbers that look
   authoritative and are quietly wrong by a few millimeters, which
   is worse than no measurement at all — so a user-added dimension
   can ONLY be anchored to a snap point generated here.

   Pure: no three.js, no DOM. Screen projection is injected, which
   keeps the whole nearest-target search testable under Node.

   The candidate set is deliberately small and semantic. Every
   point is somewhere an engineer would actually measure to:
   tire centers and edges, contact patch centers, axle
   centerlines. Offering arbitrary surface points would let a
   user anchor to a spot on a sidewall with no defined meaning.
   ============================================================ */

'use strict';

/**
 * @typedef {{x:number, y:number, z:number}} Vec3
 *
 * @typedef {Object} SnapPoint
 * @property {string} id
 * @property {SnapKind} kind
 * @property {string} label     shown while hovering
 * @property {Vec3} point       engineering millimeters
 * @property {string} ownerId   the wheel or axle this belongs to
 * @property {number} priority  breaks ties when targets overlap on screen
 */

/**
 * @typedef {'tire-center'|'tire-edge'|'tire-top'|'contact'|'axle-centerline'|'axle-end'|'ground'} SnapKind
 */

/**
 * Tie-break order when several targets land within the pick radius.
 * Centers beat edges because a measurement between centers is almost always
 * what was meant; ground points come last because they are the least
 * specific thing under the cursor.
 */
export const SNAP_PRIORITY = Object.freeze({
    'tire-center': 6,
    'contact': 5,
    'axle-centerline': 5,
    'tire-edge': 4,
    'tire-top': 3,
    'axle-end': 2,
    'ground': 1
});

/** Human labels, used in the hover readout. */
export const SNAP_LABEL = Object.freeze({
    'tire-center': 'tire center',
    'tire-edge': 'tire edge',
    'tire-top': 'tire crown',
    'contact': 'contact patch center',
    'axle-centerline': 'axle centerline',
    'axle-end': 'axle end',
    'ground': 'ground'
});

/**
 * Build every snap target for a layout.
 *
 * @param {import('../core/layout.js').Layout} layout
 * @param {{kinds?: SnapKind[], visible?: (w: import('../core/layout.js').Wheel) => boolean}} [opts]
 * @returns {SnapPoint[]}
 */
export function buildSnapPoints(layout, opts = {}) {
    const want = new Set(opts.kinds ?? Object.keys(SNAP_PRIORITY));
    const visible = opts.visible ?? (() => true);

    /** @type {SnapPoint[]} */
    const out = [];
    const add = (kind, id, ownerId, point, extra = '') => {
        if (!want.has(kind)) return;
        out.push({
            id, kind, ownerId, point,
            label: `${ownerId}${extra ? ' ' + extra : ''} · ${SNAP_LABEL[kind]}`,
            priority: SNAP_PRIORITY[kind]
        });
    };

    for (const w of layout.wheels) {
        if (!visible(w)) continue;
        const g = w.geometry;
        add('tire-center', `${w.id}:c`, w.id, { x: w.x, y: w.y, z: w.z });
        add('tire-top', `${w.id}:t`, w.id, { x: w.x, y: w.y, z: w.z + g.freeRadius });
        add('contact', `${w.id}:p`, w.id, { x: w.x, y: w.y, z: 0 });
        // The two sidewall faces, at hub height — the points a caliper would
        // touch when measuring a tire's section width in situ.
        add('tire-edge', `${w.id}:ei`, w.id, { x: w.x, y: w.y - g.sectionWidth / 2, z: w.z }, 'inner');
        add('tire-edge', `${w.id}:eo`, w.id, { x: w.x, y: w.y + g.sectionWidth / 2, z: w.z }, 'outer');
    }

    const shownAxles = new Set(layout.wheels.filter(visible).map((w) => w.axleId));
    for (const a of layout.axles) {
        if (!shownAxles.has(a.id)) continue;
        add('axle-centerline', `${a.id}:c`, a.id, { x: a.x, y: 0, z: a.axleHeight });
        add('ground', `${a.id}:g`, a.id, { x: a.x, y: 0, z: 0 });
        if (a.trackWidth > 0) {
            add('axle-end', `${a.id}:l`, a.id, { x: a.x, y: -a.trackWidth / 2, z: a.axleHeight }, 'left');
            add('axle-end', `${a.id}:r`, a.id, { x: a.x, y: a.trackWidth / 2, z: a.axleHeight }, 'right');
        }
    }

    return dedupe(out);
}

/**
 * Drop targets that coincide in space, keeping the highest-priority one.
 *
 * Coincidences are real: a single-wheel motorcycle axle has zero track, so
 * its ends sit exactly on its centerline. Two stacked targets one pixel
 * apart make a picker feel broken because which one you get looks random.
 *
 * @param {SnapPoint[]} points
 * @returns {SnapPoint[]}
 */
function dedupe(points) {
    /** @type {Map<string, SnapPoint>} */
    const byPos = new Map();
    for (const p of points) {
        const key = `${Math.round(p.point.x)}|${Math.round(p.point.y)}|${Math.round(p.point.z)}`;
        const prev = byPos.get(key);
        if (!prev || p.priority > prev.priority) byPos.set(key, p);
    }
    return Array.from(byPos.values());
}

/**
 * Nearest snap target to a screen position.
 *
 * @param {SnapPoint[]} points
 * @param {(p: Vec3) => {x:number, y:number, behind?:boolean}} project
 * @param {number} sx screen x, pixels
 * @param {number} sy screen y, pixels
 * @param {number} [maxPx=26] pick radius
 * @returns {{snap: SnapPoint, screen: {x:number, y:number}, distance: number}|null}
 */
export function nearestSnapPoint(points, project, sx, sy, maxPx = 26) {
    let best = null;
    for (const p of points) {
        const s = project(p.point);
        if (!s || s.behind) continue;
        const d = Math.hypot(s.x - sx, s.y - sy);
        if (d > maxPx) continue;
        // Nearer wins; on a near-tie (within 6 px) the more meaningful
        // target wins, so centers are not stolen by the edges beside them.
        if (!best
            || d < best.distance - 6
            || (Math.abs(d - best.distance) <= 6 && p.priority > best.snap.priority)) {
            best = { snap: p, screen: { x: s.x, y: s.y }, distance: d };
        }
    }
    return best;
}

/**
 * Choose the drafting axis for a user-created dimension.
 *
 * When two points differ along essentially one axis, label the dimension with
 * that axis so it behaves exactly like an automatic one. Otherwise mark it
 * `free`, and the renderer will place the dimension line perpendicular to the
 * measurement itself rather than to a coordinate axis.
 *
 * The tolerance is deliberately tight. A measurement 99 % aligned to x still
 * has a perpendicular component — over 17 m of truck that is two meters — and
 * offsetting it as though it were purely longitudinal skews the dimension
 * line against the thing it measures. Genuinely axis-aligned picks (two tire
 * centers on one axle, a contact patch to its own hub) differ on exactly one
 * axis and land at 1.0, so nothing that should be axis-labeled misses out.
 *
 * @param {Vec3} from
 * @param {Vec3} to
 * @param {number} [tolerance=0.999] fraction of length that must lie on one axis
 * @returns {'x'|'y'|'z'|'free'}
 */
export function inferAxis(from, to, tolerance = 0.999) {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1e-9) return 'free';
    for (const axis of /** @type {const} */ (['x', 'y', 'z'])) {
        if (Math.abs(d[axis]) / len >= tolerance) return axis;
    }
    return 'free';
}

/**
 * Build a dimension record from two snap points.
 *
 * @param {SnapPoint} a
 * @param {SnapPoint} b
 * @param {{id?: string, offset?: number}} [opts]
 * @returns {import('./dimensions.js').Dimension}
 */
export function dimensionFromSnaps(a, b, opts = {}) {
    const axis = inferAxis(a.point, b.point);
    const length = Math.hypot(
        b.point.x - a.point.x, b.point.y - a.point.y, b.point.z - a.point.z
    );
    return {
        id: opts.id ?? `custom:${a.id}->${b.id}`,
        set: 'custom',
        from: { ...a.point },
        to: { ...b.point },
        axis,
        // Stand the dimension line off by a fraction of its own length, so a
        // short measurement is not pushed absurdly far from what it measures
        // and a long one still clears the model.
        offset: opts.offset ?? -Math.max(180, Math.min(900, length * 0.22)),
        priority: 12,
        note: `${a.label} → ${b.label}`
    };
}
