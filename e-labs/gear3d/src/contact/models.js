/* ============================================================
   Gear3D — contact patch models
   ------------------------------------------------------------
   Pure geometry. No three.js, no DOM — runs under Node for tests.

   Every model starts from the same premise:

        contact area  A = P / p

   where P is the wheel load and p the contact pressure. Gear3D
   follows the usual pavement-engineering simplification of taking
   contact pressure equal to inflation pressure. That is an
   IDEALISATION, and the FEM export says so in its header: real
   contact pressure exceeds inflation pressure near the tread ribs
   and falls below it at the shoulders, and the vertical stress
   distribution over a real patch is markedly non-uniform.

   Three shapes are offered:

   A  rectangular
      Width fixed at a documented fraction of section width
      (default 0.85), length follows from area.

   B  rectangle with semicircular ends  — Huang's idealisation
      Total length L, overall width 0.6 L. The two end semicircles
      have radius 0.3 L, so the central rectangle is 0.4 L long:

          A = (0.4 L)(0.6 L) + pi (0.3 L)^2
            = 0.24 L^2 + 0.2827 L^2
            = 0.5227 L^2      ->   L = sqrt(A / 0.5227)

      This is the standard form used with KENLAYER and reproduced
      throughout the flexible-pavement literature.

   C  elliptical
      Semi-axes a (longitudinal) and b (transverse), A = pi a b,
      with the transverse axis pinned to the tread width.
   ============================================================ */

'use strict';

/**
 * Huang's area coefficient: A = HUANG_K * L^2.
 *
 * Held EXACTLY as 0.24 + 0.09*pi = 0.5227433388..., which is what the
 * shape actually integrates to: a 0.4L x 0.6L rectangle (0.24 L^2) plus
 * two semicircles of radius 0.3L (0.09*pi L^2). The literature quotes
 * this rounded to 0.5227; using the rounded constant would make the
 * reported area disagree with the drawn outline by about 1 part in
 * 12 000, which is small but is exactly the kind of quiet inconsistency
 * a figure caption should never carry.
 */
export const HUANG_K = 0.24 + 0.09 * Math.PI;
/** The rounded coefficient as published, kept for documentation and captions. */
export const HUANG_K_PUBLISHED = 0.5227;
/** Huang's overall patch width as a fraction of total length. */
export const HUANG_WIDTH_RATIO = 0.6;
/**
 * Default patch width as a fraction of tire section width, used by the
 * rectangular and elliptical models. See `data/SOURCES.md`.
 */
export const DEFAULT_PATCH_WIDTH_RATIO = 0.85;

/**
 * @typedef {Object} Patch
 * @property {'rectangular'|'huang'|'elliptical'} model
 * @property {number} length  mm, longitudinal (engineering x)
 * @property {number} width   mm, transverse  (engineering y)
 * @property {number} area    mm^2, true area of the shape
 * @property {number} load    kN
 * @property {number} pressure kPa, the contact pressure used
 * @property {boolean} overridden true when dimensions were set by hand
 */

/**
 * Contact area from load and pressure.
 * @param {number} loadKn wheel load, kN
 * @param {number} pressureKpa contact pressure, kPa
 * @returns {number} area, mm^2
 */
export function contactArea(loadKn, pressureKpa) {
    if (!(loadKn > 0) || !(pressureKpa > 0)) return 0;
    // kN / kPa = m^2; convert to mm^2 (1 m^2 = 1e6 mm^2).
    return (loadKn / pressureKpa) * 1e6;
}

/**
 * Rectangular patch (Model A).
 * @param {number} loadKn
 * @param {number} pressureKpa
 * @param {number} sectionWidthMm
 * @param {{widthRatio?: number}} [opts]
 * @returns {Patch}
 */
export function rectangularPatch(loadKn, pressureKpa, sectionWidthMm, opts = {}) {
    const area = contactArea(loadKn, pressureKpa);
    const width = sectionWidthMm * (opts.widthRatio ?? DEFAULT_PATCH_WIDTH_RATIO);
    const length = width > 0 ? area / width : 0;
    return { model: 'rectangular', length, width, area, load: loadKn, pressure: pressureKpa, overridden: false };
}

/**
 * Huang patch (Model B) — rectangle with semicircular ends.
 * Shape is fully determined by area; section width is not used.
 * @param {number} loadKn
 * @param {number} pressureKpa
 * @returns {Patch}
 */
export function huangPatch(loadKn, pressureKpa) {
    const area = contactArea(loadKn, pressureKpa);
    const length = Math.sqrt(area / HUANG_K);
    return {
        model: 'huang',
        length,
        width: HUANG_WIDTH_RATIO * length,
        area,
        load: loadKn,
        pressure: pressureKpa,
        overridden: false
    };
}

/**
 * Elliptical patch (Model C).
 * @param {number} loadKn
 * @param {number} pressureKpa
 * @param {number} sectionWidthMm
 * @param {{widthRatio?: number}} [opts]
 * @returns {Patch}
 */
export function ellipticalPatch(loadKn, pressureKpa, sectionWidthMm, opts = {}) {
    const area = contactArea(loadKn, pressureKpa);
    const width = sectionWidthMm * (opts.widthRatio ?? DEFAULT_PATCH_WIDTH_RATIO);
    // A = pi * (length/2) * (width/2)  ->  length = 4A / (pi * width)
    const length = width > 0 ? (4 * area) / (Math.PI * width) : 0;
    return { model: 'elliptical', length, width, area, load: loadKn, pressure: pressureKpa, overridden: false };
}

/**
 * Radius of the circle with the same area — the equivalent circular
 * contact radius used by layered-elastic solvers such as KENLAYER,
 * LEAF and FAARFIELD. Reported so a Gear3D figure and a LEAPS run can
 * be stated as consistent.
 * @param {number} areaMm2
 * @returns {number} mm
 */
export function equivalentRadius(areaMm2) {
    return Math.sqrt(areaMm2 / Math.PI);
}

/**
 * Outline of a patch as engineering-frame (x, y) offsets from its centre,
 * in millimetres, counter-clockwise. Used for plan-view rendering and for
 * the FEM corner export.
 *
 * @param {Patch} patch
 * @param {number} [segments=24] arc resolution for curved models
 * @returns {{x:number, y:number}[]}
 */
export function patchOutline(patch, segments = 24) {
    const hl = patch.length / 2;
    const hw = patch.width / 2;
    const pts = [];

    if (patch.model === 'rectangular') {
        return [
            { x: -hl, y: -hw }, { x: hl, y: -hw },
            { x: hl, y: hw }, { x: -hl, y: hw }
        ];
    }

    if (patch.model === 'elliptical') {
        for (let i = 0; i < segments * 2; i++) {
            const t = (i / (segments * 2)) * Math.PI * 2;
            pts.push({ x: hl * Math.cos(t), y: hw * Math.sin(t) });
        }
        return pts;
    }

    // huang: straight flanks of length 0.4L, semicircular ends of radius 0.3L
    const r = hw;                       // 0.3 L
    const straightHalf = hl - r;        // 0.2 L
    for (let i = 0; i <= segments; i++) {
        const t = -Math.PI / 2 + (i / segments) * Math.PI;
        pts.push({ x: straightHalf + r * Math.sin(t), y: -r * Math.cos(t) });
    }
    for (let i = 0; i <= segments; i++) {
        const t = Math.PI / 2 + (i / segments) * Math.PI;
        pts.push({ x: -straightHalf + r * Math.sin(t), y: -r * Math.cos(t) });
    }
    return pts;
}

/**
 * Build a patch with the requested model.
 * @param {'rectangular'|'huang'|'elliptical'} model
 * @param {number} loadKn
 * @param {number} pressureKpa
 * @param {number} sectionWidthMm
 * @param {object} [opts]
 * @returns {Patch}
 */
export function buildPatch(model, loadKn, pressureKpa, sectionWidthMm, opts = {}) {
    switch (model) {
        case 'huang': return huangPatch(loadKn, pressureKpa);
        case 'elliptical': return ellipticalPatch(loadKn, pressureKpa, sectionWidthMm, opts);
        case 'rectangular':
        default: return rectangularPatch(loadKn, pressureKpa, sectionWidthMm, opts);
    }
}

/**
 * Replace a patch's dimensions with hand-entered values, keeping the true
 * area of the resulting shape (so the reported area never contradicts the
 * drawn outline) and back-computing the implied pressure.
 *
 * @param {Patch} patch
 * @param {{length?: number, width?: number}} override
 * @returns {Patch}
 */
export function overridePatch(patch, override) {
    const length = override.length ?? patch.length;
    const width = override.width ?? patch.width;
    let area;
    if (patch.model === 'elliptical') area = (Math.PI / 4) * length * width;
    else if (patch.model === 'huang') {
        const r = width / 2;
        area = Math.max(0, length - 2 * r) * width + Math.PI * r * r;
    } else area = length * width;
    return {
        ...patch,
        length,
        width,
        area,
        pressure: area > 0 ? (patch.load / area) * 1e6 : 0,
        overridden: true
    };
}
