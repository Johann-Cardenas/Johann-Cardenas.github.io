/* ============================================================
   Gear3D — contact patches for a whole unit
   ------------------------------------------------------------
   Applies a contact model to every tire in a resolved layout and
   places the resulting patch on the pavement plane in engineering
   coordinates.

   Pure: no three.js, no DOM. The renderer draws what this returns;
   the FEM export writes what this returns. They cannot disagree.
   ============================================================ */

'use strict';

import { buildPatch, overridePatch, patchOutline, equivalentRadius } from './models.js';
import { canonical } from '../core/units.js';

/**
 * Default inflation pressure when neither the unit nor the axle states one.
 * 120 psi is the AASHTOWare Pavement ME Design default tire pressure, so a
 * Gear3D footprint lines up with a default Pavement ME run unless the user
 * changes it. Verified against the published AASHTOWare help manual.
 */
export const DEFAULT_INFLATION_KPA = 827.371;

/**
 * @typedef {Object} PatchRecord
 * @property {string} tireId
 * @property {string} axleId
 * @property {string} positionId
 * @property {number} x        mm, patch centre, engineering longitudinal
 * @property {number} y        mm, patch centre, engineering transverse
 * @property {import('./models.js').Patch} patch
 * @property {number} inflationKpa
 * @property {number|null} loadKn
 * @property {string} tire
 * @property {string} config
 * @property {number} equivalentRadius mm
 */

/**
 * @param {import('../core/layout.js').Layout} layout
 * @param {object} unit the source unit, for stated tire pressures
 * @param {{model?: 'rectangular'|'huang'|'elliptical',
 *          inflationKpa?: number,
 *          widthRatio?: number,
 *          overrides?: Record<string, {length?: number, width?: number}>}} [opts]
 * @returns {PatchRecord[]}
 */
export function computePatches(layout, unit, opts = {}) {
    const model = opts.model ?? 'rectangular';
    const unitPressure = canonical(unit?.tirePressure, 'pressure');

    return layout.wheels.map((w) => {
        const inflation = opts.inflationKpa ?? unitPressure ?? DEFAULT_INFLATION_KPA;
        let patch = buildPatch(
            model,
            w.loadKn ?? 0,
            inflation,
            w.geometry.sectionWidth,
            { widthRatio: opts.widthRatio }
        );
        const ov = opts.overrides?.[w.id];
        if (ov) patch = overridePatch(patch, ov);

        return {
            tireId: w.id,
            axleId: w.axleId,
            positionId: w.positionId,
            x: w.x,
            y: w.y,
            patch,
            inflationKpa: inflation,
            loadKn: w.loadKn,
            tire: w.tire,
            config: w.config,
            equivalentRadius: equivalentRadius(patch.area)
        };
    });
}

/**
 * Outline of a patch in absolute engineering coordinates, on z = 0.
 * @param {PatchRecord} rec
 * @param {number} [segments=24]
 * @returns {Array<{x:number, y:number, z:number}>}
 */
export function patchOutlineAbsolute(rec, segments = 24) {
    return patchOutline(rec.patch, segments).map((p) => ({
        x: rec.x + p.x,
        y: rec.y + p.y,
        z: 0
    }));
}

/**
 * Axis-aligned corner coordinates of a patch's bounding rectangle.
 * Used by the FEM export, where a rectangular pressure footprint is what a
 * pre-processor actually wants.
 * @param {PatchRecord} rec
 * @returns {{x1:number, y1:number, x2:number, y2:number}}
 */
export function patchCorners(rec) {
    return {
        x1: rec.x - rec.patch.length / 2,
        y1: rec.y - rec.patch.width / 2,
        x2: rec.x + rec.patch.length / 2,
        y2: rec.y + rec.patch.width / 2
    };
}

/**
 * Totals for the whole unit, and a cross-check against the stated gross
 * weight so a user can see immediately whether the load model adds up.
 *
 * @param {PatchRecord[]} patches
 * @returns {{totalLoadKn: number, totalAreaMm2: number, meanPressureKpa: number, tires: number}}
 */
export function patchTotals(patches) {
    const totalLoadKn = patches.reduce((s, p) => s + (p.loadKn ?? 0), 0);
    const totalAreaMm2 = patches.reduce((s, p) => s + p.patch.area, 0);
    return {
        totalLoadKn,
        totalAreaMm2,
        meanPressureKpa: totalAreaMm2 > 0 ? (totalLoadKn / totalAreaMm2) * 1e6 : 0,
        tires: patches.length
    };
}

/**
 * Compare two patch sets — the wide-base swap comparison.
 * @param {PatchRecord[]} before
 * @param {PatchRecord[]} after
 * @returns {object}
 */
export function comparePatches(before, after) {
    const b = patchTotals(before);
    const a = patchTotals(after);
    return {
        before: b,
        after: a,
        areaChangeMm2: a.totalAreaMm2 - b.totalAreaMm2,
        areaChangePct: b.totalAreaMm2 > 0 ? (a.totalAreaMm2 / b.totalAreaMm2 - 1) * 100 : null,
        tireCountChange: a.tires - b.tires,
        note: 'Total contact area is load divided by contact pressure. If the load and the '
            + 'inflation pressure are unchanged, the total area is unchanged too — what a '
            + 'wide-base swap changes is how that area is DISTRIBUTED, not how much there is.'
    };
}
