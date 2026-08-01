/* ============================================================
   Gear3D — isolation
   ------------------------------------------------------------
   A hierarchy, not a set of checkboxes. Clicking an axle in the
   viewport isolates it; Escape steps back up exactly one level.
   That is the interaction the reference figures come from:

     Running gear only -> Axle group -> {single|tandem} x {STA|DTA}

   Hidden elements can optionally draw as a faint ghost so context
   is not lost. Default OFF, because a ghost is a lie in a
   published figure unless the caption explains it.
   ============================================================ */

'use strict';

/** @typedef {'unit'|'running-gear'|'group'|'axle'|'position'} IsolationLevel */

/** Ordered widest-to-narrowest; Escape moves one step toward `unit`. */
export const ISOLATION_LEVELS = Object.freeze(['unit', 'running-gear', 'group', 'axle', 'position']);

/** @type {Record<IsolationLevel, {label: string, hint: string}>} */
export const ISOLATION_META = Object.freeze({
    unit: { label: 'Full unit', hint: 'Chassis silhouette and all axles' },
    'running-gear': { label: 'Running gear only', hint: 'All axles and tires, chassis hidden' },
    group: { label: 'Axle group', hint: 'One group, e.g. the tandem drive' },
    axle: { label: 'Single axle', hint: 'One axle only' },
    position: { label: 'Wheel position', hint: 'One tire or one dual pair' }
});

/**
 * @typedef {Object} IsolationState
 * @property {IsolationLevel} level
 * @property {string|null} targetId  group id, axle id or wheel-position id
 * @property {boolean} ghost         draw hidden elements faintly
 */

/** @returns {IsolationState} */
export function defaultIsolation() {
    return { level: 'running-gear', targetId: null, ghost: false };
}

/**
 * Predicate deciding whether a wheel is part of the current isolation.
 *
 * @param {IsolationState} iso
 * @returns {(w: import('../core/layout.js').Wheel) => boolean}
 */
export function wheelPredicate(iso) {
    switch (iso.level) {
        case 'group':
            return (w) => !iso.targetId || w.groupId === iso.targetId;
        case 'axle':
            return (w) => !iso.targetId || w.axleId === iso.targetId;
        case 'position':
            return (w) => !iso.targetId || w.positionId === iso.targetId;
        case 'unit':
        case 'running-gear':
        default:
            return () => true;
    }
}

/**
 * Predicate for axle beams / struts.
 * @param {IsolationState} iso
 * @returns {(a: import('../core/layout.js').ResolvedAxle) => boolean}
 */
export function axlePredicate(iso) {
    switch (iso.level) {
        case 'group':
            return (a) => !iso.targetId || a.groupId === iso.targetId;
        case 'axle':
        case 'position':
            return (a) => !iso.targetId || a.id === iso.targetId
                || (iso.level === 'position' && iso.targetId.startsWith(a.id + '-'));
        default:
            return () => true;
    }
}

/**
 * Whether the chassis silhouette should be drawn.
 * @param {IsolationState} iso
 * @returns {boolean}
 */
export function showChassis(iso) {
    return iso.level === 'unit';
}

/**
 * Step down into whatever the user clicked.
 *
 * @param {IsolationState} iso
 * @param {{groupId?: string, axleId?: string, positionId?: string}} hit
 * @returns {IsolationState} a new state
 */
export function drillInto(iso, hit) {
    // Each click narrows by one level, following the hierarchy rather than
    // jumping straight to the tire — a user who wants the tire clicks twice,
    // and a user who wanted the group is not overshot.
    switch (iso.level) {
        case 'unit':
            return { ...iso, level: 'running-gear', targetId: null };
        case 'running-gear':
            return hit.groupId
                ? { ...iso, level: 'group', targetId: hit.groupId }
                : hit.axleId
                    ? { ...iso, level: 'axle', targetId: hit.axleId }
                    : iso;
        case 'group':
            return hit.axleId ? { ...iso, level: 'axle', targetId: hit.axleId } : iso;
        case 'axle':
            return hit.positionId ? { ...iso, level: 'position', targetId: hit.positionId } : iso;
        default:
            return iso;
    }
}

/**
 * Step back up one level. Escape.
 * @param {IsolationState} iso
 * @param {import('../core/layout.js').Layout} layout
 * @returns {IsolationState}
 */
export function stepOut(iso, layout) {
    switch (iso.level) {
        case 'position': {
            const w = layout.wheels.find((x) => x.positionId === iso.targetId);
            return { ...iso, level: 'axle', targetId: w ? w.axleId : null };
        }
        case 'axle': {
            const a = layout.axles.find((x) => x.id === iso.targetId);
            return a && a.groupId
                ? { ...iso, level: 'group', targetId: a.groupId }
                : { ...iso, level: 'running-gear', targetId: null };
        }
        case 'group':
            return { ...iso, level: 'running-gear', targetId: null };
        case 'running-gear':
            return { ...iso, level: 'unit', targetId: null };
        default:
            return iso;
    }
}

/**
 * Human description of the current isolation, for the status strip.
 * @param {IsolationState} iso
 * @param {import('../core/layout.js').Layout} layout
 * @returns {string}
 */
export function describeIsolation(iso, layout) {
    const meta = ISOLATION_META[iso.level];
    if (!iso.targetId) return meta.label;
    if (iso.level === 'group') {
        const g = layout.groups.find((x) => x.id === iso.targetId);
        return g ? `${meta.label}: ${g.id} (${g.type})` : meta.label;
    }
    if (iso.level === 'axle') {
        const a = layout.axles.find((x) => x.id === iso.targetId);
        return a ? `${meta.label}: ${a.id} (${a.role})` : meta.label;
    }
    return `${meta.label}: ${iso.targetId}`;
}

/**
 * Bounding box, in engineering millimetres, of whatever is currently
 * isolated — so the camera can auto-frame it.
 *
 * @param {IsolationState} iso
 * @param {import('../core/layout.js').Layout} layout
 * @returns {{minX:number, maxX:number, minY:number, maxY:number, minZ:number, maxZ:number}|null}
 */
export function isolationBounds(iso, layout) {
    const pred = wheelPredicate(iso);
    const ws = layout.wheels.filter(pred);
    if (!ws.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const w of ws) {
        const g = w.geometry;
        minX = Math.min(minX, w.x - g.sectionWidth * 0.6);
        maxX = Math.max(maxX, w.x + g.sectionWidth * 0.6);
        minY = Math.min(minY, w.y - g.sectionWidth / 2);
        maxY = Math.max(maxY, w.y + g.sectionWidth / 2);
        maxZ = Math.max(maxZ, w.z + g.freeRadius);
    }
    return { minX, maxX, minY, maxY, minZ: 0, maxZ };
}
