/* ============================================================
   Stride Lab — synthetic runner.

   A parametric, physically consistent 2D runner whose cadence,
   ground-contact time, duty factor, step length, trunk lean and
   foot-strike angle are KNOWN EXACTLY because they were prescribed.

   It exists for two reasons, and both matter:

     1. It is the oracle for the validation suite. Every metric is
        asserted against a number the generator was told to produce,
        across frame rates, strike patterns and noise levels. Without
        it there is no way to know the math is right.
     2. It is the app's demo mode. A visitor with no running video can
        still drive the entire pipeline end to end and see what the
        engine produces — clearly labeled synthetic, never presented
        as a measurement of a person.
   ============================================================ */

import { CANONICAL, WINTER } from '../engine/types.js';
import { makeSeries } from '../engine/pose/skeleton.js';

/** Deterministic PRNG (mulberry32) so a seed reproduces a clip exactly. */
export function rng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Box-Muller, using a supplied uniform source. */
function gauss(u) {
    const a = Math.max(1e-12, u());
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
}

/**
 * Fraction of stance at which the hip passes over the planted foot.
 *
 * Not one half. The body travels about 0.8 m during a 240 ms contact at
 * 3.4 m/s, so putting the crossover at mid-stance would place the foot 0.41 m
 * ahead at touchdown — roughly a quarter of standing height, which no
 * recreational runner does. Measured foot-ahead distances at contact are
 * nearer 0.2-0.3 m, which puts the crossover about a third of the way through
 * stance: the leg arrives close to underneath and then trails a long way
 * behind as the hip extends. The synthetic runner has to get this right or
 * every overstride and shank-angle assertion in the suite is calibrated
 * against a runner nobody resembles.
 */
export const STANCE_ALIGN_FRACTION = 0.30;

export const DEFAULTS = {
    heightM: 1.75,
    speedMs: 3.0,
    cadenceSpm: 170,
    dutyFactor: 0.32,
    strikeAngleDeg: 10,      /* toe-up positive; 10 = clear rearfoot          */
    trunkLeanDeg: 7,         /* forward positive                              */
    headForwardDeg: 4,       /* head carried ahead of the trunk line, positive */
    vertOscM: 0.085,         /* pelvis peak-to-trough                         */
    asymmetry: 0,            /* fractional L/R difference in duty factor      */
    fps: 240,
    durationS: 6,
    mode: 'treadmill',       /* 'treadmill' | 'overground'                    */
    direction: 1,            /* +1 left-to-right, -1 right-to-left            */
    view: 'sagittal',
    imageW: 1280,
    imageH: 720,
    fillFrac: 0.72,          /* subject height as a fraction of frame height  */
    noiseFrac: 0,            /* keypoint noise, sigma as a fraction of leg len*/
    dropout: 0,              /* probability per keypoint per frame of a gap   */
    seed: 1
};

/**
 * Build a synthetic clip.
 * @returns {{series: import('../engine/types.js').PoseSeries, truth: Object, params: Object}}
 */
export function synthGait(overrides = {}) {
    const p = { ...DEFAULTS, ...overrides };
    const u = rng(p.seed);

    const H = p.heightM;
    const thigh = WINTER.thigh * H;
    const shank = WINTER.shank * H;
    const legLen = thigh + shank;
    const footLen = 0.152 * H;
    const ankleH = 0.039 * H;
    const trunkLen = WINTER.torso * H;
    const upperArm = 0.186 * H;
    const forearm = 0.146 * H;
    const handLen = 0.054 * H;   /* wrist to hand center of mass */

    const stepTime = 60 / p.cadenceSpm;
    const strideTime = 2 * stepTime;
    const stepLength = p.speedMs * stepTime;
    const lean = p.trunkLeanDeg * Math.PI / 180;

    const dutyBySide = {
        L: p.dutyFactor * (1 - p.asymmetry),
        R: p.dutyFactor * (1 + p.asymmetry)
    };

    const nFrames = Math.round(p.durationS * p.fps);
    const K = CANONICAL.length;
    const series = makeSeries(nFrames, p.imageW, p.imageH);

    /* Camera: orthographic, perpendicular to the plane of motion. The ground
       line sits near the bottom of the frame and the subject fills `fillFrac`
       of its height, which is what the capture guidance asks the user for. */
    const pxPerM = (p.fillFrac * p.imageH) / H;
    const groundPy = p.imageH * 0.955;
    const hipHeight = 0.53 * H;

    /* Overground translation is deliberately modest. A fixed camera at this
       scale only holds two or three strides before the runner leaves the
       frame — which is itself the reason the capture guidance pushes people
       toward a treadmill or a longer lens for spatial metrics. */
    const drift = p.mode === 'overground' ? p.speedMs : 0;
    const xCenter = drift * p.durationS / 2;

    const truthStrikes = [];
    const truthToeoffs = [];
    for (let k = -1; k < p.durationS / strideTime + 2; k++) {
        for (const side of ['L', 'R']) {
            const ts = (k + (side === 'L' ? 0 : 0.5)) * strideTime;
            if (ts >= 0 && ts <= p.durationS) {
                truthStrikes.push({ t: ts, side });
                truthToeoffs.push({ t: ts + dutyBySide[side] * strideTime, side });
            }
        }
    }
    truthStrikes.sort((a, b) => a.t - b.t);
    truthToeoffs.sort((a, b) => a.t - b.t);

    /**
     * Pelvis vertical motion, built from the physics rather than from a
     * convenient sinusoid.
     *
     * A cosine at step frequency puts its LOWEST point at foot strike and its
     * most negative VELOCITY a quarter period earlier — both wrong, and wrong
     * in a way that would quietly reward the pelvis-based contact detector for
     * agreeing with an artifact. What actually happens: the body is in free
     * fall through the flight phase, so the pelvis arrives at contact with its
     * most negative vertical velocity; the ground reaction force then arrests
     * and reverses it, so the pelvis reaches its LOWEST point at mid-stance.
     *
     * So: a half-sine dip through contact (spring-like) and a parabola through
     * flight (exact free fall), matched for velocity continuity at the handover.
     * The resulting peak-to-trough is then rescaled to the prescribed
     * `vertOscM` so the amplitude stays a knob while the phase stays honest.
     */
    function pelvisHeight(t) {
        /* find the step containing t: strike -> next contralateral strike */
        let i = 0;
        while (i + 1 < truthStrikes.length && truthStrikes[i + 1].t <= t) i++;
        const s0 = truthStrikes[i];
        const s1 = truthStrikes[i + 1] || { t: s0.t + stepTime };
        const stepDur = s1.t - s0.t;
        const gct = dutyBySide[s0.side] * strideTime;
        const tf = Math.max(1e-4, stepDur - gct);
        /* velocity continuity: contact half-sine of amplitude A leaves stance
           at +A*pi/gct; a free-fall parabola of height Bp rises at 4*Bp/tf */
        const A = 1;
        const Bp = A * Math.PI * tf / (4 * gct);
        const scale = p.vertOscM / (A + Bp);
        const dt = t - s0.t;
        return dt < gct
            ? hipHeight - scale * A * Math.sin(Math.PI * dt / gct)
            : hipHeight + scale * Bp * (1 - Math.pow(2 * (dt - gct) / tf - 1, 2));
    }

    for (let f = 0; f < nFrames; f++) {
        const t = f / p.fps;
        series.t[f] = t;

        /* --- pelvis: rises and falls once per step, lowest at mid-stance --- */
        const hipY = pelvisHeight(t);
        const hipX = p.direction * (drift * t - xCenter);

        const world = {};
        world.hipMid = { x: hipX, y: hipY };
        /* the lean tilts the trunk in the direction of TRAVEL, so it has to
           carry the direction sign or a right-to-left clip would lean back */
        world.shoulderMid = {
            x: hipX + p.direction * trunkLen * Math.sin(lean),
            y: hipY + trunkLen * Math.cos(lean)
        };
        /* Head. The ear midpoint is where Winter puts the head-and-neck center
           of mass, so it is modeled as the primary head landmark and the nose
           hangs off it — the other way round would make the inertial model
           depend on a facial feature. `headForward` is the runner's forward
           head posture, which is what the head-position metrics measure. */
        const headForward = p.headForwardDeg * Math.PI / 180;
        const headRise = 0.115 * H;
        const earMid = {
            x: world.shoulderMid.x + p.direction * headRise * Math.sin(lean * 0.5 + headForward),
            y: world.shoulderMid.y + headRise * Math.cos(lean * 0.5 + headForward)
        };
        const earHalf = ((p.view === 'frontal' ? 0.075 : p.view === 'oblique' ? 0.046 : 0.012) * H) / 2;
        world.earL = { x: earMid.x - earHalf, y: earMid.y };
        world.earR = { x: earMid.x + earHalf, y: earMid.y };
        /* nose ahead of and slightly below the ears */
        world.nose = {
            x: earMid.x + p.direction * 0.055 * H,
            y: earMid.y - 0.012 * H
        };
        const eyeHalf = (p.view === 'frontal' ? 0.035 * H : 0.008 * H) / 2;
        world.eyeL = { x: world.nose.x - eyeHalf - p.direction * 0.012 * H, y: world.nose.y + 0.018 * H };
        world.eyeR = { x: world.nose.x + eyeHalf - p.direction * 0.012 * H, y: world.nose.y + 0.018 * H };

        /* No lateral forefoot landmark: this generator produces what BlazePose
           produces, so the metrics that need a foot PLANE must come back
           unavailable, exactly as they will on a real clip. */
        world.footOuterL = null;
        world.footOuterR = null;

        /* Side-specific hip and shoulder positions, established BEFORE the
           legs are solved so the inverse kinematics uses the same hip joint the
           metrics later read. Solving the knee from the midline and then
           reporting the angle at an offset hip manufactures a left/right
           difference in a runner that was built perfectly symmetric — which is
           exactly the kind of artifact an asymmetry test must not chase. */
        /* A three-quarter view projects part of the shoulder width, which is
           exactly the cue classifyView keys off — so the generator can produce
           the camera angle the app is supposed to refuse to measure. */
        const sepFrac = p.view === 'frontal' ? WINTER.shoulderWidth
            : p.view === 'oblique' ? 0.158
                : 0.012;
        const halfSep = (sepFrac * H) / 2;
        /* Axial rotation appears in a frontal view as a symmetric NARROWING of
           the projected shoulder line. Symmetric matters: an asymmetric wobble
           would move the shoulder midpoint and inject a fake trunk lean into
           the very metric the regression test checks. */
        const rot = 1 - 0.09 * Math.abs(Math.sin(2 * Math.PI * t / strideTime));
        const hipHalf = ((p.view === 'frontal' ? 0.191 : p.view === 'oblique' ? 0.115 : 0.012) * H) / 2;
        world.shoulderL = { x: world.shoulderMid.x - halfSep * rot, y: world.shoulderMid.y };
        world.shoulderR = { x: world.shoulderMid.x + halfSep * rot, y: world.shoulderMid.y };
        world.hipL = { x: hipX - hipHalf, y: hipY };
        world.hipR = { x: hipX + hipHalf, y: hipY };

        /* --- legs ------------------------------------------------------- */
        for (const side of ['L', 'R']) {
            const phaseOffset = side === 'L' ? 0 : 0.5;
            const duty = dutyBySide[side];
            const gct = duty * strideTime;

            /* stride index and phase within the stride, 0 at foot strike */
            const raw = t / strideTime - phaseOffset;
            const k = Math.floor(raw);
            const ph = raw - k;
            const tStrike = (k + phaseOffset) * strideTime;

            /* Foot plant. On a treadmill the belt carries the planted foot
               backward at running speed; overground the plant is fixed in
               the world and the body passes over it. Either way the foot is
               under the hip at mid-stance, which is what makes the resulting
               overstride a consequence of the model rather than a knob. */
            const dir = p.direction;
            const plantMid = dir * (drift * (tStrike + STANCE_ALIGN_FRACTION * gct) - xCenter);

            let ankleX, footPitchDeg, arc;
            if (ph < duty) {
                /* ---- stance ---- */
                const s = ph / duty;                    /* 0 at strike, 1 at toe-off */
                /* On a treadmill the belt carries the planted foot backward at
                   running speed; overground the plant is fixed in the world and
                   the body passes over it. */
                ankleX = plantMid + (p.mode === 'treadmill'
                    ? dir * (-p.speedMs * (ph * strideTime - STANCE_ALIGN_FRACTION * gct))
                    : 0);
                arc = 0;
                /* prescribed toe-up at strike, flat by mid-stance, plantarflexed
                   at toe-off */
                footPitchDeg = s < 0.35
                    ? p.strikeAngleDeg * (1 - smooth(s / 0.35))
                    : -26 * smooth((s - 0.35) / 0.65);
            } else {
                /* ---- swing ---- */
                const s = (ph - duty) / (1 - duty);
                const takeoff = plantMid + (p.mode === 'treadmill'
                    ? dir * (-p.speedMs * (1 - STANCE_ALIGN_FRACTION) * gct) : 0);
                const landing = plantMid + dir * (p.mode === 'treadmill'
                    ? p.speedMs * STANCE_ALIGN_FRACTION * gct
                    : 2 * stepLength);
                ankleX = takeoff + (landing - takeoff) * smooth(s);
                const sw = Math.sin(Math.PI * s);
                arc = (0.30 * legLen) * sw * sw;
                /* plantarflexed off the ground, dorsiflexing back to the
                   prescribed strike angle by the end of swing */
                footPitchDeg = -26 + (p.strikeAngleDeg + 26) * smooth(Math.min(1, s / 0.85));
            }

            /* Foot geometry, and the ankle height that follows from it. The
               ankle is not a free parameter: with the foot pitched at `th`, the
               ankle sits exactly high enough that the lowest of heel and toe
               rests on the ground. A rearfoot strike therefore lifts the toe and
               a plantarflexed toe-off lifts the heel, both as consequences of
               the prescribed pitch rather than as separate knobs. */
            const th = footPitchDeg * Math.PI / 180;
            const fwd = { x: dir * Math.cos(th), y: Math.sin(th) };
            const nrm = { x: -dir * Math.sin(th), y: Math.cos(th) };
            const heelRel = { x: -0.25 * footLen * fwd.x - ankleH * nrm.x, y: -0.25 * footLen * fwd.y - ankleH * nrm.y };
            const toeRel = { x: 0.75 * footLen * fwd.x - ankleH * nrm.x, y: 0.75 * footLen * fwd.y - ankleH * nrm.y };
            const ankleY = arc - Math.min(heelRel.y, toeRel.y);

            const ankle = { x: ankleX, y: ankleY };
            const hip = world['hip' + side];
            const knee = solveKnee(hip, ankle, thigh, shank, dir);

            world['knee' + side] = knee;
            world['ankle' + side] = ankle;
            world['heel' + side] = { x: ankle.x + heelRel.x, y: ankle.y + heelRel.y };
            world['toe' + side] = { x: ankle.x + toeRel.x, y: ankle.y + toeRel.y };
        }

        /* --- arms: counter-phase to the legs ---------------------------- */
        for (const side of ['L', 'R']) {
            const phaseOffset = side === 'L' ? 0.5 : 0;   /* opposite the same-side leg */
            const ang = 2 * Math.PI * (t / strideTime - phaseOffset);
            const shoulderAngle = 0.52 * Math.sin(ang);   /* +-30 deg from vertical */
            const sh = world['shoulder' + side];
            /* Arm swing happens in the plane of travel. Seen from behind, that
               plane is edge-on and almost none of the swing projects into the
               image — modeling it as a left-right swing would manufacture a
               frontal-plane hand crossing out of a perfectly ordinary arm
               action, and the hand-crossing metric would be measuring the
               generator rather than the runner. */
            const swingX = p.view === 'frontal' ? 0.10 : p.view === 'oblique' ? 0.6 : 1;
            const el = {
                x: sh.x + p.direction * upperArm * Math.sin(shoulderAngle) * swingX,
                y: sh.y - upperArm * Math.cos(shoulderAngle)
            };
            const elbowFlex = 1.40 + 0.28 * Math.cos(ang);   /* ~80 deg +- 16 */
            const wristAngle = shoulderAngle + elbowFlex;
            const wr = {
                x: el.x + p.direction * forearm * Math.sin(wristAngle) * swingX,
                y: el.y - forearm * Math.cos(wristAngle)
            };
            world['elbow' + side] = el;
            world['wrist' + side] = wr;
            /* hand centroid, one hand-length beyond the wrist along the forearm */
            const fdx = wr.x - el.x, fdy = wr.y - el.y;
            const flen = Math.hypot(fdx, fdy) || 1;
            world['hand' + side] = {
                x: wr.x + (fdx / flen) * handLen,
                y: wr.y + (fdy / flen) * handLen
            };
        }

        /* Shoulder separation. In a sagittal view the shoulders project almost
           on top of each other; in a frontal view they are a real width apart.
           This is exactly the cue classifyView() keys off, so the generator has
           to produce it honestly. */
        /* --- project to normalized image coordinates, y DOWN ------------- */
        for (let c = 0; c < K; c++) {
            const name = CANONICAL[c];
            const w = world[name];
            if (!w) {
                /* a landmark this backend does not have: absent, not zero */
                series.xy[(f * K + c) * 2] = NaN;
                series.xy[(f * K + c) * 2 + 1] = NaN;
                series.vis[f * K + c] = 0;
                continue;
            }
            let px = p.imageW / 2 + w.x * pxPerM;
            let py = groundPy - w.y * pxPerM;

            if (p.noiseFrac > 0) {
                const s = p.noiseFrac * legLen * pxPerM;
                px += gauss(u) * s;
                py += gauss(u) * s;
            }
            const visible = p.dropout > 0 ? (u() > p.dropout) : true;
            series.xy[(f * K + c) * 2] = px / p.imageW;
            series.xy[(f * K + c) * 2 + 1] = py / p.imageH;
            series.vis[f * K + c] = visible ? 0.95 : 0.1;
        }
    }

    return {
        series,
        params: p,
        truth: {
            cadenceSpm: p.cadenceSpm,
            stepTimeMs: stepTime * 1000,
            strideTimeMs: strideTime * 1000,
            gctMs: { L: dutyBySide.L * strideTime * 1000, R: dutyBySide.R * strideTime * 1000 },
            dutyFactor: dutyBySide,
            flightTimeMs: {
                L: (stepTime - dutyBySide.L * strideTime) * 1000,
                R: (stepTime - dutyBySide.R * strideTime) * 1000
            },
            stepLengthM: stepLength,
            speedMs: p.speedMs,
            trunkLeanDeg: p.trunkLeanDeg,
            headForwardDeg: p.headForwardDeg,
            strikeAngleDeg: p.strikeAngleDeg,
            vertOscM: p.vertOscM,
            /* what the metric measures: peak-to-trough over a full STRIDE,
               which equals the per-step amplitude only when the two steps are
               symmetric */
            vertOscStrideM: (function () {
                let lo = Infinity, hi = -Infinity;
                const t0 = strideTime, steps = 400;
                for (let i = 0; i <= steps; i++) {
                    const y = pelvisHeight(strideTime + t0 * i / steps);
                    if (y < lo) lo = y;
                    if (y > hi) hi = y;
                }
                return hi - lo;
            })(),
            stanceAlignFraction: STANCE_ALIGN_FRACTION,
            overstrideFracHeight: 100 * (p.speedMs * STANCE_ALIGN_FRACTION * p.dutyFactor * strideTime) / p.heightM,
            legLengthM: legLen,
            strikes: truthStrikes,
            toeoffs: truthToeoffs
        }
    };
}

/** Smoothstep, C1 continuous at both ends. */
function smooth(s) {
    const x = Math.min(1, Math.max(0, s));
    return x * x * (3 - 2 * x);
}

/**
 * Two-link inverse kinematics for the knee.
 * Of the two solutions, take the one that puts the knee ANTERIOR — a human
 * knee bends one way, and picking the wrong root produces a runner with
 * backward legs whose joint angles all look almost plausible.
 */
function solveKnee(hip, ankle, thigh, shank, dir) {
    let dx = ankle.x - hip.x, dy = ankle.y - hip.y;
    let d = Math.hypot(dx, dy);
    const dMax = (thigh + shank) * 0.999;
    if (d > dMax) { const k = dMax / d; dx *= k; dy *= k; d = dMax; }
    const dMin = Math.abs(thigh - shank) + 1e-6;
    if (d < dMin) { const k = dMin / d; dx *= k; dy *= k; d = dMin; }

    const a = (thigh * thigh - shank * shank + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, thigh * thigh - a * a));
    const ux = dx / d, uy = dy / d;
    const c = { x: hip.x + a * ux, y: hip.y + a * uy };
    const n1 = { x: -uy, y: ux };
    const s1 = { x: c.x + hh * n1.x, y: c.y + hh * n1.y };
    const s2 = { x: c.x - hh * n1.x, y: c.y - hh * n1.y };
    /* anterior = further along the direction of travel */
    return (dir * s1.x > dir * s2.x) ? s1 : s2;
}
