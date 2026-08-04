/* ============================================================
   Gear3D — footprint export
   ------------------------------------------------------------
   Machine-readable contact patches, for dropping straight into a
   finite-element pre-processor.

   Every file carries a header stating the assumptions. That is not
   politeness: a footprint table with no stated pressure model is
   an invitation to publish a wrong number, and these files will
   outlive the session that produced them.
   ============================================================ */

'use strict';

import { patchCorners, patchTotals } from './patch.js';
import { formatNumber } from '../core/units.js';

/** Bumped whenever a column is added, removed or redefined. */
export const FOOTPRINT_FORMAT_VERSION = '1.0';

/**
 * The assumption block that goes at the top of every export.
 * @param {object} ctx
 * @returns {string[]} lines, WITHOUT comment markers
 */
export function assumptionLines(ctx) {
    // When any patch carries measured dimensions, the blanket statement
    // "pressure equals inflation" stops being true of the whole file and the
    // header has to say so up front rather than leaving it to be inferred
    // from a column.
    const measured = ctx.overriddenCount || 0;
    const override = measured > 0 ? [
        '',
        'MEASURED PATCHES PRESENT',
        `  ${measured} of ${ctx.totalCount} patches carry MEASURED dimensions entered by the`,
        '  user, not dimensions computed from the contact model. For those rows the',
        '  load is held and the contact pressure is a CONSEQUENCE of the measured',
        '  area, so it does not equal the inflation pressure and assumption 1 below',
        '  does not apply to them. The `source` column identifies them individually.'
    ] : [];

    return [...baseAssumptionLines(ctx).flatMap((l) => (l === '@@OVERRIDE@@' ? override : [l]))];
}

/**
 * @param {object} ctx
 * @returns {string[]}
 */
function baseAssumptionLines(ctx) {
    return [
        `Gear3D footprint export — format ${FOOTPRINT_FORMAT_VERSION}`,
        `Unit: ${ctx.unitId}${ctx.unitLabel ? ` (${ctx.unitLabel})` : ''}`,
        `Generated: ${ctx.timestamp}`,
        `Contact model: ${ctx.model}`,
        '',
        'COORDINATE SYSTEM',
        '  x  longitudinal, positive REARWARD, origin at the front-most axle centreline',
        '  y  transverse, positive to the RIGHT of the direction of travel, origin on the',
        '     vehicle centreline',
        '  z  vertical, positive UP, z = 0 at the pavement surface',
        '  Right-handed. All lengths in millimetres, loads in kN, pressures in kPa.',
        '',
        'ASSUMPTIONS — READ BEFORE USE',
        '  1. Contact pressure is taken EQUAL TO INFLATION PRESSURE. This is the standard',
        '     simplification of flexible-pavement analysis, and it is an idealisation.',
        '  2. Pressure is assumed UNIFORM over each patch. Real tire-pavement contact',
        '     stress is markedly non-uniform: vertical stress peaks under the tread ribs',
        '     and falls at the shoulders, and significant transverse and longitudinal',
        '     shear stresses exist that this export does not represent at all.',
        '     A uniform normal pressure is adequate for far-field response. It is NOT',
        '     adequate for near-surface analysis — top-down cracking, rutting in the',
        '     surface layer, or anything driven by the stress state within the top',
        '     50 mm or so. Those require measured contact-stress distributions',
        '     (for example stress-in-motion measurements), not this file.',
        '  3. Patch dimensions follow the selected geometric model. Area is exact for',
        '     the model; the shape is an idealisation of a real footprint.',
        '  4. Loads are static. No dynamic amplification, no load transfer, no',
        '     cornering or braking forces.',
        '  5. Tire dimensions are NOMINAL values from the size designation, not',
        '     manufacturer grown dimensions.',
        '@@OVERRIDE@@',
        '',
        'Every geometric input to this file carries a citation in the source unit',
        'definition. Export unit.json alongside this file to keep them together.'
    ];
}

/**
 * Footprint CSV.
 *
 * @param {import('./patch.js').PatchRecord[]} patches
 * @param {object} ctx  { unitId, unitLabel, model, timestamp }
 * @returns {string}
 */
export function toCSV(patches, ctx) {
    ctx = withCounts(patches, ctx);
    const lines = assumptionLines(ctx).map((l) => (l ? `# ${l}` : '#'));
    lines.push('#');
    lines.push([
        'tire_id', 'axle_id', 'x_center_mm', 'y_center_mm',
        'patch_length_mm', 'patch_width_mm', 'area_mm2',
        'load_kN', 'contact_pressure_kPa', 'inflation_pressure_kPa',
        'equivalent_radius_mm', 'tire_size', 'config', 'source'
    ].join(','));

    for (const p of patches) {
        lines.push([
            p.tireId,
            p.axleId,
            r(p.x, 2), r(p.y, 2),
            r(p.patch.length, 2), r(p.patch.width, 2), r(p.patch.area, 1),
            p.loadKn == null ? '' : r(p.loadKn, 3),
            r(p.patch.pressure, 2),
            r(p.inflationKpa, 2),
            r(p.equivalentRadius, 2),
            p.tire,
            p.config,
            // Which patches are measured and which are modelled. Without this
            // column a hand-entered footprint is indistinguishable from a
            // computed one in the format most people actually open, and the
            // reader has no way to know that a row's contact pressure is a
            // consequence of measured dimensions rather than the stated
            // inflation assumption.
            p.patch.overridden ? 'measured' : `model:${p.patch.model}`
        ].join(','));
    }

    const t = patchTotals(patches);
    lines.push('#');
    lines.push(`# TOTALS: ${t.tires} tires, ${r(t.totalLoadKn, 2)} kN, `
        + `${r(t.totalAreaMm2, 0)} mm2, mean contact pressure ${r(t.meanPressureKpa, 1)} kPa`);
    return lines.join('\n') + '\n';
}

/**
 * Footprint JSON — same content, structured.
 * @param {import('./patch.js').PatchRecord[]} patches
 * @param {object} ctx
 * @returns {string}
 */
export function toJSON(patches, ctx) {
    ctx = withCounts(patches, ctx);
    return JSON.stringify({
        format: 'gear3d-footprint',
        formatVersion: FOOTPRINT_FORMAT_VERSION,
        unit: { id: ctx.unitId, label: ctx.unitLabel },
        generated: ctx.timestamp,
        model: ctx.model,
        units: { length: 'mm', load: 'kN', pressure: 'kPa', area: 'mm2' },
        coordinateSystem: {
            x: 'longitudinal, positive rearward, origin at front-most axle centreline',
            y: 'transverse, positive right of travel, origin on vehicle centreline',
            z: 'vertical, positive up, z = 0 at pavement surface',
            handedness: 'right'
        },
        assumptions: assumptionLines(ctx).slice(assumptionLines(ctx).indexOf('ASSUMPTIONS — READ BEFORE USE') + 1),
        totals: patchTotals(patches),
        patches: patches.map((p) => ({
            tireId: p.tireId,
            axleId: p.axleId,
            positionId: p.positionId,
            center: { x: p.x, y: p.y, z: 0 },
            length: p.patch.length,
            width: p.patch.width,
            area: p.patch.area,
            model: p.patch.model,
            overridden: p.patch.overridden,
            loadKn: p.loadKn,
            contactPressureKpa: p.patch.pressure,
            inflationPressureKpa: p.inflationKpa,
            equivalentRadiusMm: p.equivalentRadius,
            tire: p.tire,
            config: p.config,
            corners: patchCorners(p)
        }))
    }, null, 2);
}

/**
 * Abaqus-friendly variant: patch corner coordinates and a suggested uniform
 * pressure amplitude per patch, with the assumptions restated inline.
 *
 * Deliberately emitted as a commented parameter table rather than as a ready
 * to-run input deck. A generated *DSLOAD block that silently assumed a mesh,
 * a step definition and a surface naming scheme would be far more likely to
 * be wrong than useful. This gives a pre-processor exactly the numbers it
 * needs and leaves the model author in control.
 *
 * @param {import('./patch.js').PatchRecord[]} patches
 * @param {object} ctx
 * @returns {string}
 */
export function toAbaqus(patches, ctx) {
    ctx = withCounts(patches, ctx);
    const lines = [];
    const push = (s = '') => lines.push(s ? `** ${s}` : '**');

    for (const l of assumptionLines(ctx)) push(l);
    push();
    push('ABAQUS NOTES');
    push('  This file is a PARAMETER TABLE, not a runnable input deck. It gives the');
    push('  footprint rectangles and the uniform pressure to apply to each. Build the');
    push('  surfaces and the step in your own model — a generated *DSLOAD block would');
    push('  have to guess your mesh, your surface names and your step structure, and a');
    push('  wrong guess here is expensive to notice.');
    push();
    push('  Patch rows below are axis-aligned rectangles on the z = 0 plane bounding the');
    push('  selected contact shape. If you used the Huang or elliptical model, the');
    push('  bounding rectangle has a LARGER area than the patch, so applying the listed');
    push('  pressure over the full rectangle would over-apply the load. The');
    push('  area_ratio column tells you how much: scale the pressure by area_ratio if');
    push('  you mesh the rectangle rather than the true outline.');
    push();
    push('  Sign convention: pressure is positive into the surface (compressive),');
    push('  which is the Abaqus *DSLOAD P convention.');
    push();
    push('patch_id, x1_mm, y1_mm, x2_mm, y2_mm, pressure_MPa, area_ratio, load_kN');

    for (const p of patches) {
        const c = patchCorners(p);
        const rectArea = (c.x2 - c.x1) * (c.y2 - c.y1);
        const ratio = rectArea > 0 ? p.patch.area / rectArea : 1;
        lines.push([
            p.tireId,
            r(c.x1, 3), r(c.y1, 3), r(c.x2, 3), r(c.y2, 3),
            r(p.patch.pressure / 1000, 6),   // kPa -> MPa, Abaqus mm-N-MPa units
            r(ratio, 6),
            p.loadKn == null ? '' : r(p.loadKn, 4)
        ].join(', '));
    }

    push();
    push('Units above are mm, N, MPa — the conventional Abaqus system for pavement work.');
    push(`Total applied load: ${r(patchTotals(patches).totalLoadKn, 3)} kN`);
    return lines.join('\n') + '\n';
}

/**
 * Attach how many patches are measured rather than modelled, so every writer
 * reports it the same way instead of each counting for itself.
 * @param {import('./patch.js').PatchRecord[]} patches
 * @param {object} ctx
 * @returns {object}
 */
function withCounts(patches, ctx) {
    return {
        ...ctx,
        overriddenCount: patches.filter((p) => p.patch.overridden).length,
        totalCount: patches.length
    };
}

/**
 * @param {number} v
 * @param {number} d
 * @returns {string}
 */
function r(v, d) {
    if (v == null || !Number.isFinite(v)) return '';
    return v.toFixed(d);
}
