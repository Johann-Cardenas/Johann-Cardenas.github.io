/* ============================================================
   Gear3D — quad view layout
   ------------------------------------------------------------
   Four panes in one frame: the arrangement an engineer actually
   wants when CHECKING a configuration rather than composing a
   single hero figure, and the one that exports as a complete
   check sheet.

   Pane order follows first-angle drafting convention as closely
   as a 2x2 grid allows:

        +-----------+-----------+
        |   PLAN    |    3D     |
        +-----------+-----------+
        |   SIDE    |   FRONT   |
        +-----------+-----------+

   Plan sits above Side because a plan and the side elevation
   below it share their longitudinal axis, so the eye can carry a
   dimension straight down between them. Front sits beside Side
   because they share the vertical axis. 3D takes the remaining
   corner, where it reads as the reference rather than the
   subject.

   Pure geometry: no three.js, no DOM. Every pane has the SAME
   aspect ratio as the frame that contains it, which is what
   makes the camera fitting reusable without a second code path.
   ============================================================ */

'use strict';

/** @typedef {'3d'|'plan'|'side'|'front'} ViewMode */

/**
 * @typedef {Object} Pane
 * @property {ViewMode} mode
 * @property {string} label
 * @property {number} x  left, CSS pixels from the frame's left edge
 * @property {number} y  top,  CSS pixels from the frame's TOP edge
 * @property {number} w
 * @property {number} h
 * @property {number} glY bottom, in GL pixels from the frame's BOTTOM edge
 */

/** Grid order, row-major from the top-left. */
export const QUAD_ORDER = Object.freeze(['plan', '3d', 'side', 'front']);

/** @type {Record<string, string>} */
export const PANE_LABEL = Object.freeze({
    plan: 'Plan', '3d': '3D', side: 'Side', front: 'Front'
});

/**
 * Lay out four panes inside a frame.
 *
 * @param {number} width   frame width, CSS pixels
 * @param {number} height  frame height, CSS pixels
 * @param {number} [gap=1] hairline between panes
 * @returns {Pane[]}
 */
export function quadLayout(width, height, gap = 1) {
    const w = Math.max(1, Math.floor((width - gap) / 2));
    const h = Math.max(1, Math.floor((height - gap) / 2));

    return QUAD_ORDER.map((mode, i) => {
        const col = i % 2;
        const row = i >> 1;
        const x = col === 0 ? 0 : width - w;
        const y = row === 0 ? 0 : height - h;
        return {
            mode: /** @type {ViewMode} */ (mode),
            label: PANE_LABEL[mode],
            x, y, w, h,
            // WebGL's viewport origin is the BOTTOM-left of the drawing
            // buffer while CSS measures from the top, so every pane carries
            // both. Deriving one from the other at each call site is exactly
            // how a vertically mirrored quad view happens.
            glY: height - y - h
        };
    });
}

/**
 * The pane containing a point, or null.
 *
 * @param {Pane[]} panes
 * @param {number} px CSS pixels from the frame's left
 * @param {number} py CSS pixels from the frame's top
 * @returns {Pane|null}
 */
export function paneAt(panes, px, py) {
    for (const p of panes) {
        if (px >= p.x && px < p.x + p.w && py >= p.y && py < p.y + p.h) return p;
    }
    return null;
}

/**
 * Convert a frame-relative point into a point relative to its pane.
 * @param {Pane} pane
 * @param {number} px
 * @param {number} py
 * @returns {{x: number, y: number}}
 */
export function toPaneLocal(pane, px, py) {
    return { x: px - pane.x, y: py - pane.y };
}
