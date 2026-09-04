/* ============================================================
   Gear3D — chassis silhouettes
   ------------------------------------------------------------
   The "Full unit" isolation level shows the running gear inside
   the vehicle envelope it belongs to. Bare axles floating in
   space tell you nothing about where the load comes from; a
   silhouette gives the gear its context.

   THE HONESTY PROBLEM, AND HOW IT IS SOLVED

   Gear3D has no sourced body dimensions. It knows axle positions,
   track widths and overall length — all cited — and nothing about
   cab shape, trailer height or frame depth. Modeling a detailed
   truck body would therefore mean inventing dimensions, which is
   the one thing this app exists not to do.

   So the silhouette is not a model of a vehicle. It is the
   REGULATORY ENVELOPE the vehicle must fit inside, drawn from
   limits that are themselves citable:

     overall length   the unit's own cited `overallLength`
     overall width    min(actual outer width, 2591 mm)
                      23 CFR 658.15, the 102 in federal limit
     overall height   4115 mm (13 ft 6 in), the height limit
                      applied by the large majority of US states
     axle positions   cited, straight from the unit

   Only the internal subdivision — where the cab ends, how deep
   the frame sits — is representative, and it is drawn as a
   translucent schematic with visible edges so that nobody can
   mistake it for a measured body. Every box carries a `sourced`
   flag saying which of the two it is.

   The envelope function below is pure: no three.js, no DOM. The
   test suite checks the box arithmetic without a browser.
   ============================================================ */

'use strict';

/** US federal vehicle width limit, 102 in (23 CFR 658.15). */
export const WIDTH_LIMIT_MM = 2591;
/** Height limit applied by most US states, 13 ft 6 in. */
export const HEIGHT_LIMIT_MM = 4115;

/**
 * @typedef {Object} ChassisBox
 * @property {string} id
 * @property {'frame'|'cab'|'body'|'deck'} kind
 * @property {number} x0 @property {number} x1   longitudinal, mm
 * @property {number} y0 @property {number} y1   transverse, mm
 * @property {number} z0 @property {number} z1   vertical, mm
 * @property {boolean} sourced  true when every bound comes from cited data
 */

/**
 * @typedef {Object} ChassisEnvelope
 * @property {ChassisBox[]} boxes
 * @property {string} profile      which body profile was applied
 * @property {string[]} representative  human list of what was NOT sourced
 * @property {{length:number, width:number, height:number}} extent
 */

/**
 * Representative body profiles, selected from the unit's `bodyType`.
 *
 * Everything here is a proportion or a clearance, never a measurement of a
 * specific vehicle. `bodyTop` is capped at the legal height limit for the
 * heavy classes so the silhouette shows the envelope rather than a guess.
 */
const PROFILES = Object.freeze({
    motorcycle: null,          // a silhouette around a motorcycle is meaningless
    car: {
        frontOverhang: 900, cabFrac: 0.42, bodyTop: 1470,
        frameRatio: 0.55, rails: false, singleBody: true
    },
    pickup: {
        frontOverhang: 950, cabFrac: 0.52, bodyTop: 1950,
        frameRatio: 0.85, rails: false, singleBody: false
    },
    bus: {
        frontOverhang: 2400, cabFrac: 0, bodyTop: 3200,
        frameRatio: 0.75, rails: false, singleBody: true
    },
    truck: {
        frontOverhang: 1400, cabFrac: 0, bodyTop: HEIGHT_LIMIT_MM,
        frameRatio: 1.95, rails: true, singleBody: false, cabBehindSteer: 1200
    }
});

/**
 * Pick a profile from the unit's body type.
 * @param {string} bodyType
 * @returns {{key: string, profile: object|null}}
 */
export function profileFor(bodyType) {
    const b = String(bodyType || '').toLowerCase();
    if (b.includes('motorcycle')) return { key: 'motorcycle', profile: PROFILES.motorcycle };
    if (b.includes('passenger car')) return { key: 'car', profile: PROFILES.car };
    if (b.includes('pickup')) return { key: 'pickup', profile: PROFILES.pickup };
    if (b.includes('bus')) return { key: 'bus', profile: PROFILES.bus };
    return { key: 'truck', profile: PROFILES.truck };
}

/**
 * Build the chassis envelope in engineering millimeters.
 *
 * @param {import('../core/layout.js').Layout} layout
 * @param {object} unit
 * @returns {ChassisEnvelope|null} null when the unit has no meaningful silhouette
 */
export function chassisEnvelope(layout, unit) {
    // Aircraft have no chassis here, and deliberately so: nothing in the
    // sourced data constrains a fuselage, and sketching one would be exactly
    // the invention this module avoids.
    if (!unit || unit.domain !== 'truck') return null;

    const { key, profile } = profileFor(unit.bodyType);
    if (!profile) return null;

    const axles = layout.axles;
    if (!axles.length) return null;

    const xFirst = axles[0].x;
    const xLast = axles[axles.length - 1].x;
    const outerBridge = xLast - xFirst;

    // Overall length is cited. Split the part of it that is not between the
    // outer axles into front and rear overhang.
    const overall = unit.overallLength ?? (outerBridge * 1.3);
    const spare = Math.max(0, overall - outerBridge);
    const frontOverhang = Math.min(profile.frontOverhang, spare * 0.6);
    const xFront = xFirst - frontOverhang;
    const xRear = xFront + overall;

    // Width: the vehicle's real outer width over its tires, capped at the
    // federal limit. Both bounds are cited.
    const actualWidth = layout.extents.maxY - layout.extents.minY;
    const halfWidth = Math.min(actualWidth, WIDTH_LIMIT_MM) / 2;

    // Frame height scales off the largest tire, so it stays plausible from a
    // motorcycle to a turnpike double. Representative, not measured.
    const maxTireR = Math.max(...layout.wheels.map((w) => w.geometry.freeRadius));
    const frameTop = maxTireR * profile.frameRatio;

    /** @type {ChassisBox[]} */
    const boxes = [];
    const push = (id, kind, x0, x1, y0, y1, z0, z1, sourced) => {
        boxes.push({ id, kind, x0, x1, y0, y1, z0, z1, sourced });
    };

    if (profile.singleBody) {
        // Bus or car: one continuous body over the whole length.
        push('body', 'body', xFront, xRear, -halfWidth, halfWidth,
            frameTop * 0.35, profile.bodyTop, false);
    } else {
        // Cab at the front, body behind it.
        const steerX = axles[0].x;
        const cabEnd = profile.cabBehindSteer != null
            ? steerX + profile.cabBehindSteer
            : xFront + (xRear - xFront) * profile.cabFrac;

        push('cab', 'cab', xFront, cabEnd, -halfWidth, halfWidth,
            frameTop, Math.min(profile.bodyTop, frameTop + 2200), false);

        if (cabEnd < xRear) {
            // Deck: the load-carrying floor, sitting on the frame.
            push('deck', 'deck', cabEnd, xRear, -halfWidth, halfWidth,
                frameTop, frameTop + 120, false);
            push('body', 'body', cabEnd, xRear, -halfWidth, halfWidth,
                frameTop + 120, profile.bodyTop, false);
        }
    }

    if (profile.rails) {
        // Frame rails at the US truck standard 34 in (864 mm) centers.
        const railHalf = 864 / 2;
        const railW = 90;
        const railDepth = 260;
        for (const [id, sign] of [['frame-rail-l', -1], ['frame-rail-r', 1]]) {
            const c = sign * railHalf;
            push(id, 'frame', xFront + 60, xRear, c - railW / 2, c + railW / 2,
                frameTop - railDepth, frameTop, false);
        }
    }

    return {
        boxes,
        profile: key,
        representative: [
            'frame height and depth',
            'cab length',
            'front and rear overhang split',
            profile.rails ? 'frame rail spacing (US 34 in standard)' : null
        ].filter(Boolean),
        extent: {
            length: overall,
            width: halfWidth * 2,
            height: profile.bodyTop
        }
    };
}
