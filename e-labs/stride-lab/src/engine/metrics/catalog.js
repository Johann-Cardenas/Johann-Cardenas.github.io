/* ============================================================
   Stride Lab — the metric catalogue.

   One entry per reported quantity: what it is, in what unit, from
   which view, how it is defined, and which dimension score it
   feeds. The UI reads its labels and definitions from here, the
   scoring layer reads `dimension` from here, and the science page
   is generated from here — so a metric cannot exist in the report
   without also existing, defined, in the documentation.
   ============================================================ */

/**
 * @typedef {Object} MetricSpec
 * @property {string} id
 * @property {string} label
 * @property {string} unit
 * @property {'sagittal'|'frontal'} view
 * @property {boolean} sided        reported separately for left and right
 * @property {'timing'|'posture'|'contact'|'symmetry'|'spatial'} dimension
 * @property {string} definition    plain-language, shown in the metric sheet
 * @property {string} formula       how it is actually computed
 * @property {string[]} drivers     what limits its confidence
 * @property {boolean} [timingGated] suppressed below 60 fps
 * @property {boolean} [scaleDependent] error scales with the pixel-to-metre scale
 * @property {number} [decimals]
 */

/** @type {MetricSpec[]} */
export const METRICS = [
    /* ---------------- Sagittal ---------------- */
    {
        id: 'cadence', label: 'Cadence', unit: 'steps/min', view: 'sagittal', sided: false,
        dimension: 'timing', decimals: 0,
        definition: 'How many steps you take per minute.',
        formula: '60 / median step time, cross-checked against the dominant frequency of pelvis vertical motion.',
        drivers: ['frame rate', 'event spread']
    },
    {
        id: 'stepTime', label: 'Step time', unit: 'ms', view: 'sagittal', sided: true,
        dimension: 'timing', decimals: 0,
        definition: 'Time from one foot striking the ground to the other foot striking.',
        formula: 'Interval between consecutive contralateral foot strikes.',
        drivers: ['frame rate']
    },
    {
        id: 'strideTime', label: 'Stride time', unit: 'ms', view: 'sagittal', sided: true,
        dimension: 'timing', decimals: 0,
        definition: 'Time for one complete cycle of the same foot.',
        formula: 'Interval between consecutive strikes of the same foot.',
        drivers: ['frame rate']
    },
    {
        id: 'gct', label: 'Ground contact time', unit: 'ms', view: 'sagittal', sided: true,
        dimension: 'timing', decimals: 0, timingGated: true,
        definition: 'How long each foot stays on the ground.',
        formula: 'toe-off minus foot strike, per foot.',
        drivers: ['frame rate (dominant)', 'event spread']
    },
    {
        id: 'flightTime', label: 'Flight time', unit: 'ms', view: 'sagittal', sided: true,
        dimension: 'timing', decimals: 0, timingGated: true,
        definition: 'How long you are airborne between one foot leaving and the other landing.',
        formula: 'next contralateral foot strike minus toe-off.',
        drivers: ['frame rate']
    },
    {
        id: 'dutyFactor', label: 'Duty factor', unit: '', view: 'sagittal', sided: true,
        dimension: 'timing', decimals: 3, timingGated: true,
        definition: 'The share of each stride spent on the ground. Lower means more aerial.',
        formula: 'ground contact time divided by stride time.',
        drivers: ['frame rate']
    },
    {
        id: 'verticalOscillation', label: 'Vertical oscillation', unit: 'cm', view: 'sagittal', sided: false,
        dimension: 'spatial', decimals: 1, scaleDependent: true,
        definition: 'How far your hips rise and fall within a stride. This is the pelvis landmark, not your centre of mass — see "Centre-of-mass oscillation" for the quantity the research is actually about.',
        formula: 'Peak-to-trough excursion of the hip centre, converted with the per-frame scale.',
        drivers: ['scaling', 'camera stability']
    },
    {
        id: 'verticalRatio', label: 'Vertical ratio', unit: '%', view: 'sagittal', sided: false,
        dimension: 'spatial', decimals: 1, scaleDependent: true,
        definition: 'Vertical oscillation as a percentage of step length. Normalises bounce for stride size.',
        formula: '100 x vertical oscillation / step length.',
        drivers: ['scaling']
    },
    {
        id: 'stepLength', label: 'Step length', unit: 'm', view: 'sagittal', sided: true,
        dimension: 'spatial', decimals: 2, scaleDependent: true,
        definition: 'Distance travelled between one foot strike and the next.',
        formula: 'Overground: horizontal ankle displacement between contralateral strikes. Treadmill: speed x step time.',
        drivers: ['scaling', 'surface']
    },
    {
        id: 'strideLength', label: 'Stride length', unit: 'm', view: 'sagittal', sided: true,
        dimension: 'spatial', decimals: 2, scaleDependent: true,
        definition: 'Distance covered in one full cycle of the same foot.',
        formula: 'Ipsilateral strike-to-strike displacement, or twice the step length.',
        drivers: ['scaling', 'surface']
    },
    {
        id: 'speed', label: 'Speed', unit: 'm/s', view: 'sagittal', sided: false,
        dimension: 'spatial', decimals: 2, scaleDependent: true,
        definition: 'How fast you were running.',
        formula: 'Treadmill: as entered. Overground: stride length / stride time.',
        drivers: ['scaling']
    },
    {
        id: 'trunkLean', label: 'Trunk lean', unit: 'deg', view: 'sagittal', sided: false,
        dimension: 'posture', decimals: 1,
        definition: 'Forward tilt of the trunk SEGMENT relative to vertical, at mid-stance. Positive is forward. This is not whole-body lean measured from the ankle, which is a different and larger number.',
        formula: 'Angle between vertical and the hip-centre-to-shoulder-centre vector.',
        drivers: ['view classification'], planeSensitive: true
    },
    {
        id: 'footStrikeAngle', label: 'Foot-strike angle', unit: 'deg', view: 'sagittal', sided: true,
        dimension: 'contact', decimals: 1,
        definition: 'How the foot is tilted when it lands. Positive means toe-up, i.e. a rearfoot landing.',
        formula: 'Angle between horizontal and the heel-to-toe vector at foot strike.',
        drivers: ['foot landmark quality', 'frame rate'], planeSensitive: true
    },
    {
        id: 'strikePattern', label: 'Strike pattern', unit: 'class', view: 'sagittal', sided: true,
        dimension: 'contact', decimals: 0,
        definition: 'Rearfoot, midfoot or forefoot, from the foot-strike angle.',
        formula: 'Threshold on foot-strike angle: rearfoot above 8 deg, forefoot below -2 deg (Altman & Davis 2012).',
        drivers: ['foot landmark quality', 'frame rate'], planeSensitive: true
    },
    {
        id: 'shankAngleContact', label: 'Shank angle at contact', unit: 'deg', view: 'sagittal', sided: true,
        dimension: 'contact', decimals: 1,
        definition: 'Tilt of the lower leg from vertical at landing. Near vertical means the foot lands under the body.',
        formula: 'Angle of the ankle-to-knee vector from vertical; positive means the knee is behind the ankle.',
        drivers: ['knee and ankle landmark quality'], planeSensitive: true
    },
    {
        id: 'overstride', label: 'Overstride', unit: '% height', view: 'sagittal', sided: true,
        dimension: 'contact', decimals: 1, scaleDependent: true,
        definition: 'How far ahead of your hips the foot lands, as a percentage of your standing height.',
        formula: 'Horizontal ankle-minus-hip-centre distance at foot strike, divided by standing height.',
        drivers: ['scaling'], planeSensitive: true
    },
    {
        id: 'kneeFlexionContact', label: 'Knee flexion at contact', unit: 'deg', view: 'sagittal', sided: true,
        dimension: 'contact', decimals: 1,
        definition: 'How bent the knee is when the foot lands. 0 would be a straight leg.',
        formula: '180 minus the interior hip-knee-ankle angle at foot strike.',
        drivers: [], planeSensitive: true
    },
    {
        id: 'peakKneeFlexionStance', label: 'Peak knee flexion in stance', unit: 'deg', view: 'sagittal', sided: true,
        dimension: 'contact', decimals: 1,
        definition: 'The most the knee bends while the foot is on the ground.',
        formula: 'Maximum knee flexion between foot strike and toe-off.',
        drivers: [], planeSensitive: true
    },
    {
        id: 'kneeFlexionToeoff', label: 'Knee flexion at toe-off', unit: 'deg', view: 'sagittal', sided: true,
        dimension: 'posture', decimals: 1,
        definition: 'How bent the knee still is as the foot leaves the ground.',
        formula: 'Knee flexion at toe-off.',
        drivers: [], planeSensitive: true
    },
    {
        id: 'hipExtensionToeoff', label: 'Hip extension at toe-off', unit: 'deg', view: 'sagittal', sided: true,
        dimension: 'posture', decimals: 1,
        definition: 'How far the thigh has swung behind the trunk as the foot leaves the ground.',
        formula: 'Angle between the trunk axis and the hip-to-knee vector at toe-off; positive is behind.',
        drivers: [], planeSensitive: true
    },
    {
        id: 'ankleDorsiflexionContact', label: 'Ankle dorsiflexion at contact', unit: 'deg', view: 'sagittal', sided: true,
        dimension: 'contact', decimals: 1,
        definition: 'Toes-up angle of the ankle at landing, relative to an assumed neutral.',
        formula: 'Interior knee-ankle-toe angle at foot strike, subtracted from an assumed neutral of 100 deg. The neutral is a modelling assumption, not a measurement, so this metric never reports above medium confidence.',
        drivers: ['foot landmark quality', 'assumed neutral'], planeSensitive: true
    },
    {
        id: 'heelRecovery', label: 'Heel-to-hip gap at peak recovery', unit: '% leg length', view: 'sagittal', sided: true,
        dimension: 'posture', decimals: 1,
        definition: 'How close the heel comes to the hip during swing. Smaller means a higher heel recovery.',
        formula: 'Minimum vertical hip-to-heel distance during swing, divided by leg length.',
        drivers: [], planeSensitive: true
    },
    {
        id: 'elbowAngle', label: 'Elbow angle', unit: 'deg', view: 'sagittal', sided: true,
        dimension: 'posture', decimals: 1,
        definition: 'Average bend at the elbow through the stride. 180 would be a straight arm.',
        formula: 'Mean interior shoulder-elbow-wrist angle over the stride.',
        drivers: ['occlusion'], planeSensitive: true
    },
    {
        id: 'armSwingAmplitude', label: 'Arm swing amplitude', unit: 'deg', view: 'sagittal', sided: true,
        dimension: 'posture', decimals: 1,
        definition: 'How far the upper arm swings through a stride.',
        formula: 'Range of the shoulder-to-elbow angle from vertical over the stride.',
        drivers: ['occlusion'], planeSensitive: true
    },
    {
        id: 'headAngle', label: 'Head angle', unit: 'deg', view: 'sagittal', sided: false,
        dimension: 'posture', decimals: 1,
        definition: 'Head position relative to the trunk. Positive is forward of the trunk line.',
        formula: 'Angle between the trunk axis and the shoulder-centre-to-nose vector.',
        drivers: [], planeSensitive: true
    },

    /* ---------------- Frontal ---------------- */
    {
        id: 'pelvicDrop', label: 'Contralateral pelvic drop', unit: 'deg', view: 'frontal', sided: true,
        dimension: 'posture', decimals: 1,
        definition: 'How far the opposite hip drops while this leg supports you. Reported for each stance side.',
        formula: 'Angle of the hip line from horizontal at mid-stance, signed so a drop on the swing side is positive.',
        drivers: [], planeSensitive: true
    },
    {
        id: 'fppa', label: 'Frontal-plane knee projection angle', unit: 'deg', view: 'frontal', sided: true,
        dimension: 'posture', decimals: 1,
        definition: 'How far the knee appears to fall inside the line from hip to ankle, in the camera image. This is a PROJECTION angle. It is not true knee valgus and cannot be measured as such from one camera.',
        formula: 'Departure from a colinear hip-knee-ankle in the image, at peak knee flexion; positive is medial.',
        drivers: ['view classification'], planeSensitive: true
    },
    {
        id: 'stepWidth', label: 'Step width', unit: '% leg length', view: 'frontal', sided: true,
        dimension: 'posture', decimals: 1, scaleDependent: true,
        definition: 'Side-to-side distance between successive foot placements. Negative means the feet cross the midline.',
        formula: 'Mediolateral distance between consecutive contralateral contact positions, divided by leg length.',
        drivers: ['scaling'], planeSensitive: true
    },
    {
        id: 'trunkLateralLean', label: 'Trunk lateral lean', unit: 'deg', view: 'frontal', sided: true,
        dimension: 'posture', decimals: 1,
        definition: 'Sideways tilt of the trunk at mid-stance. Positive is leaning towards the supporting leg.',
        formula: 'Angle between vertical and the hip-centre-to-shoulder-centre vector in the frontal plane.',
        drivers: [], planeSensitive: true
    },
    {
        id: 'rearfootProxy', label: 'Rearfoot alignment (proxy)', unit: 'deg', view: 'frontal', sided: true,
        dimension: 'contact', decimals: 1,
        definition: 'Alignment of the heel under the knee at mid-stance. This is a rough PROXY. Rearfoot eversion — what people mean by pronation — needs markers on the shoe and shank; a single rear-view camera cannot resolve it, and this number should not be read as one.',
        formula: 'Angle between vertical and the heel-to-knee vector at mid-stance.',
        drivers: ['no shoe markers', 'view classification'], planeSensitive: true
    },

    /* ---------------- Whole-body model ---------------- */
    {
        id: 'comVerticalOscillation', label: 'Centre-of-mass oscillation', unit: 'cm', view: 'sagittal', sided: false,
        dimension: 'spatial', decimals: 1, scaleDependent: true,
        definition: 'How far your whole-body centre of mass rises and falls within a stride. Of everything measured here, this is the variable with the strongest evidenced link to running economy — less is associated with better economy.',
        formula: 'Peak-to-trough excursion of a fourteen-segment inertial model built from the tracked landmarks, weighted by Winter\'s segment masses. This is not the pelvis: the swinging limbs move opposite to the trunk and partly cancel it, which is exactly what a single landmark cannot see.',
        drivers: ['scaling', 'landmark coverage', 'camera stability']
    },
    {
        id: 'verticalStiffness', label: 'Vertical stiffness', unit: 'kN/m', view: 'sagittal', sided: false,
        dimension: 'timing', decimals: 1,
        definition: 'How stiffly your body behaves as a spring in the vertical direction. Higher is associated with better running economy.',
        formula: 'The spring-mass estimate of Morin et al. (2005), from contact time, flight time, body mass, speed and leg length. It is a MODEL, not a force measurement — video cannot measure force, and the sine-wave force trace it assumes is an approximation that happens to predict stiffness well.',
        drivers: ['body mass', 'speed', 'frame rate'], timingGated: true
    },
    {
        id: 'legStiffness', label: 'Leg stiffness', unit: 'kN/m', view: 'sagittal', sided: false,
        dimension: 'timing', decimals: 1,
        definition: 'How much your leg compresses under load, expressed as a spring. Higher is associated with better running economy.',
        formula: 'Morin et al. (2005), from the same inputs as vertical stiffness plus the horizontal distance travelled during contact. A model output, not a measurement.',
        drivers: ['body mass', 'speed', 'frame rate'], timingGated: true
    },
    {
        id: 'brakingLoss', label: 'Braking', unit: 'm/s', view: 'sagittal', sided: true,
        dimension: 'contact', decimals: 2, scaleDependent: true,
        definition: 'How much forward speed your centre of mass loses between landing and the slowest moment of stance. Mechanically informative; NOT an economy variable — the meta-analysis found braking measures unrelated to running economy.',
        formula: 'Horizontal centre-of-mass velocity at foot strike minus its minimum during stance.',
        drivers: ['scaling', 'landmark coverage']
    },
    {
        id: 'headOscillation', label: 'Head oscillation', unit: 'cm', view: 'sagittal', sided: false,
        dimension: 'posture', decimals: 1, scaleDependent: true,
        definition: 'How far your head rises and falls within a stride. A head that moves less than the pelvis is the mechanical signature of what people describe as running smoothly.',
        formula: 'Peak-to-trough excursion of the ear midpoint, converted with the per-frame scale.',
        drivers: ['scaling', 'ear landmark quality']
    },
    {
        id: 'forwardHeadPosture', label: 'Forward head position', unit: '% height', view: 'sagittal', sided: false,
        dimension: 'posture', decimals: 1, scaleDependent: true,
        definition: 'How far in front of your shoulders you carry your head, as a percentage of your standing height.',
        formula: 'Horizontal distance from the shoulder centre to the ear midpoint, averaged over the stride, divided by standing height.',
        drivers: ['ear landmark quality', 'view classification'], planeSensitive: true
    },
    {
        id: 'handCrossing', label: 'Hand crossing', unit: '% shoulder width', view: 'frontal', sided: true,
        dimension: 'posture', decimals: 1,
        definition: 'How far each hand travels across the midline of your body. Negative means the hand crosses to the other side.',
        formula: 'Most medial hand position over the stride, relative to the body midline, divided by shoulder width. The hand is the centroid of the finger landmarks, not the wrist, so a rotated forearm is not mistaken for a crossing hand.',
        drivers: ['hand landmark quality', 'view classification'], planeSensitive: true
    },
    {
        id: 'footProgressionAngle', label: 'Foot progression angle', unit: 'deg', view: 'frontal', sided: true,
        dimension: 'contact', decimals: 1,
        definition: 'How far your foot points outward or inward relative to the direction you are travelling, at mid-stance. Positive is toes-out.',
        formula: 'Angle of the line across the forefoot, from the big toe to the lateral forefoot, in the frontal projection. This needs the foot to be a PLANE rather than a line, so it requires a keypoint set with a lateral forefoot landmark — the default backend does not have one and reports this unavailable.',
        drivers: ['needs a lateral forefoot landmark', 'view classification'], planeSensitive: true
    },
    {
        id: 'shoulderRotation', label: 'Shoulder rotation', unit: 'deg', view: 'frontal', sided: false,
        dimension: 'posture', decimals: 1,
        definition: 'How much the shoulder line rotates about the body axis over a stride.',
        formula: 'Range of the apparent axial rotation recovered from the projected shoulder width.',
        drivers: ['view classification'], planeSensitive: true
    },
    {
        id: 'pelvisRotation', label: 'Pelvis rotation', unit: 'deg', view: 'frontal', sided: false,
        dimension: 'posture', decimals: 1,
        definition: 'How much the hip line rotates about the body axis over a stride.',
        formula: 'Range of the apparent axial rotation recovered from the projected hip width.',
        drivers: ['view classification'], planeSensitive: true
    }
];

/** @type {Record<string, MetricSpec>} */
export const METRIC_BY_ID = Object.fromEntries(METRICS.map(m => [m.id, m]));

export const DIMENSIONS = [
    {
        id: 'timing', label: 'Timing and rhythm',
        blurb: 'How the stride is organised in time: cadence, contact, flight and the balance between them.'
    },
    {
        id: 'posture', label: 'Posture and alignment',
        blurb: 'How the trunk, pelvis, arms and swinging limb are carried.'
    },
    {
        id: 'contact', label: 'Impact and foot contact',
        blurb: 'What happens at the moment of landing and through stance.'
    },
    {
        id: 'symmetry', label: 'Symmetry',
        blurb: 'How closely the two sides match. Built from the asymmetry indices, not from a separate measurement.'
    }
];

/** Metrics whose left/right asymmetry feeds the symmetry dimension. */
export const SYMMETRY_SOURCES = ['gct', 'stepLength', 'peakKneeFlexionStance', 'pelvicDrop', 'footStrikeAngle'];
