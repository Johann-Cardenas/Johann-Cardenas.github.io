/* ============================================================
   Gear3D — Federal Bridge Formula
   ------------------------------------------------------------
   23 CFR 658.17. The weight carried on any group of two or more
   consecutive axles may not exceed

        W = 500 [ L*N/(N-1) + 12N + 36 ]

   with L the distance in FEET between the first and last axle of
   the group, N the number of axles, and W in POUNDS. W is further
   capped by the 80 000 lb federal gross limit.

   Gear3D uses this for two things:

   1. As the stated engineering basis for where the trailer axle
      groups sit in the truck library. The layouts are not drawn
      by eye; they are the smallest realistic spreads that clear
      this rule at the vehicles' legal loads.
   2. As a live check in the UI, so a user who drags an axle is
      told immediately when the configuration stops being legal.

   The check is over EVERY consecutive-axle subset, not just the
   outer bridge — an interior subset is usually what binds.
   ============================================================ */

'use strict';

import { MM_PER_FT, KG_PER_LB, G0 } from './units.js';

/** Federal gross vehicle weight limit, pounds. */
export const FEDERAL_GVW_LB = 80000;
/** Federal single-axle limit, pounds. */
export const FEDERAL_SINGLE_AXLE_LB = 20000;
/** Federal tandem-axle limit, pounds. */
export const FEDERAL_TANDEM_AXLE_LB = 34000;

/**
 * @param {number} kN
 * @returns {number} pounds-force
 */
export function knToLb(kN) {
    return (kN * 1000) / G0 / KG_PER_LB;
}

/**
 * Bridge formula allowance for a group.
 * @param {number} lengthFt distance between first and last axle, feet
 * @param {number} n number of axles in the group (>= 2)
 * @returns {number} allowable group weight, pounds (uncapped by the gross limit)
 */
export function bridgeAllowanceLb(lengthFt, n) {
    if (n < 2) return Infinity;
    return 500 * ((lengthFt * n) / (n - 1) + 12 * n + 36);
}

/**
 * @typedef {Object} BridgeViolation
 * @property {string} from  first axle id of the offending group
 * @property {string} to    last axle id
 * @property {number} axles N
 * @property {number} lengthFt
 * @property {number} loadLb
 * @property {number} allowedLb
 * @property {number} overLb
 */

/**
 * Check a truck unit against the bridge formula.
 *
 * @param {{axles: Array<{id:string, x:number, load?:{value:number, unit:string}}>}} unit
 * @param {{toleranceLb?: number, grossLimitLb?: number}} [opts]
 * @returns {{ok: boolean, violations: BridgeViolation[], grossLb: number, grossOverLb: number}}
 */
export function checkBridgeFormula(unit, opts = {}) {
    const tol = opts.toleranceLb ?? 1;
    const grossLimit = opts.grossLimitLb ?? FEDERAL_GVW_LB;
    const axles = unit.axles || [];
    /** @type {BridgeViolation[]} */
    const violations = [];

    const loadsLb = axles.map((a) => (a.load && Number.isFinite(a.load.value) ? knToLb(a.load.value) : 0));
    const grossLb = loadsLb.reduce((s, v) => s + v, 0);

    for (let i = 0; i < axles.length; i++) {
        let sum = loadsLb[i];
        for (let j = i + 1; j < axles.length; j++) {
            sum += loadsLb[j];
            const n = j - i + 1;
            const lengthFt = (axles[j].x - axles[i].x) / MM_PER_FT;
            const allowed = Math.min(bridgeAllowanceLb(lengthFt, n), grossLimit);
            if (sum > allowed + tol) {
                violations.push({
                    from: axles[i].id,
                    to: axles[j].id,
                    axles: n,
                    lengthFt,
                    loadLb: sum,
                    allowedLb: allowed,
                    overLb: sum - allowed
                });
            }
        }
    }

    return {
        ok: violations.length === 0 && grossLb <= grossLimit + tol,
        violations,
        grossLb,
        grossOverLb: Math.max(0, grossLb - grossLimit)
    };
}

/**
 * Minimum spread, in millimetres, at which a given group weight becomes legal.
 * Used by the UI to say "move this axle back by N mm to comply".
 * @param {number} weightLb
 * @param {number} n
 * @returns {number} millimetres (0 when already legal at zero spread)
 */
export function minimumSpreadMm(weightLb, n) {
    if (n < 2) return 0;
    // weightLb = 500[L n/(n-1) + 12n + 36]  ->  solve for L
    const lengthFt = ((weightLb / 500) - 12 * n - 36) * ((n - 1) / n);
    return Math.max(0, lengthFt * MM_PER_FT);
}
