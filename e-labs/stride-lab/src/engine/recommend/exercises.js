/* ============================================================
   Stride Lab — exercise library, as data.

   Text is original. There is deliberately NO media: demonstration
   video and photography has to be shot or licensed, and scraping it
   from somewhere else is not an option. Each entry therefore carries
   the cues in words, which is what actually determines whether the
   movement is done well, and the app says plainly that media is not
   included rather than shipping a broken <video> tag.

   Every entry carries a contraindication line. An exercise plan
   generated from a video is a general-fitness suggestion, not a
   prescription, and the wording here never implies otherwise.
   ============================================================ */

/**
 * @typedef {Object} Exercise
 * @property {string} id
 * @property {string} name
 * @property {string[]} targets
 * @property {'strength'|'mobility'|'drill'|'plyometric'} category
 * @property {string} equipment
 * @property {1|2|3} difficulty
 * @property {string} dosage
 * @property {string[]} progression
 * @property {string} setup
 * @property {string[]} cues
 * @property {string[]} commonErrors
 * @property {string} contraindications
 */

/** @type {Exercise[]} */
export const EXERCISES = [
    {
        id: 'single-leg-glute-bridge',
        name: 'Single-leg glute bridge',
        targets: ['pelvic-drop', 'hip-extension'],
        category: 'strength', equipment: 'none', difficulty: 2,
        dosage: '3 x 8-12 each side, 3 times a week',
        progression: ['glute-bridge', 'single-leg-glute-bridge', 'sl-bridge-foot-elevated'],
        setup: 'Lie on your back, one foot flat on the floor with the knee bent to about 90 degrees, the other leg lifted so the thighs stay level.',
        cues: [
            'Drive through the heel of the planted foot and lift the hips until the body makes a straight line from shoulder to knee.',
            'Keep the pelvis level throughout — the lifted side must not drop.',
            'Lower under control over about three seconds.'
        ],
        commonErrors: [
            'Arching the lower back instead of extending the hip.',
            'Letting the free-side hip sag, which trains the pattern you came here to change.'
        ],
        contraindications: 'Stop if you feel pain at the front of the hip or in the lower back.'
    },
    {
        id: 'side-plank-hip-abduction',
        name: 'Side plank with top-leg lift',
        targets: ['pelvic-drop', 'frontal-plane-control'],
        category: 'strength', equipment: 'none', difficulty: 2,
        dosage: '3 x 20-30 s each side, 3 times a week',
        progression: ['side-plank-knees', 'side-plank-hip-abduction', 'side-plank-dynamic'],
        setup: 'Side plank from the forearm and the lower foot, body in one line.',
        cues: [
            'Lift the hips until the trunk is straight, then raise the top leg a hand-width.',
            'Keep the top hip stacked over the bottom hip — do not roll backward.',
            'Breathe normally; if you are holding your breath the hold is too long.'
        ],
        commonErrors: ['Hips sinking toward the floor.', 'Rolling open so the movement becomes a hip flexor exercise.'],
        contraindications: 'Stop if you feel pinching at the side of the hip or pain in the shoulder you are leaning on.'
    },
    {
        id: 'step-down',
        name: 'Controlled step-down',
        targets: ['knee-control', 'frontal-plane-control', 'eccentric-strength'],
        category: 'strength', equipment: 'a step or low box', difficulty: 2,
        dosage: '3 x 8-10 each side, 2-3 times a week',
        progression: ['step-down-low', 'step-down', 'step-down-slow-tempo'],
        setup: 'Stand on one leg on a step about 15-20 cm high, the other foot hanging free.',
        cues: [
            'Lower the free heel toward the floor over three seconds, touch lightly, and return.',
            'Watch the knee: it should track over the middle of the foot, not fall inwards.',
            'Keep the pelvis level — use a mirror or a phone camera to check.'
        ],
        commonErrors: ['Dropping quickly and bouncing off the floor.', 'Leaning the trunk sideways to avoid loading the hip.'],
        contraindications: 'Stop if you feel pain around or behind the kneecap.'
    },
    {
        id: 'high-cadence-strides',
        name: 'High-cadence strides',
        targets: ['cadence', 'overstride'],
        category: 'drill', equipment: 'a metronome or a music track at the target tempo', difficulty: 1,
        dosage: '4-6 x 20 s within an easy run, 2 times a week',
        progression: ['cadence-cue-walk', 'high-cadence-strides', 'cadence-hold-tempo'],
        setup: 'During an easy run, set a metronome about 5% above your measured cadence.',
        cues: [
            'Match the beat with quicker, lighter steps at the SAME speed — this is not an acceleration.',
            'Let the steps shorten. That is the mechanism: a faster turnover at the same speed brings the foot down closer to your body.',
            'Return to your normal cadence between repetitions so the change stays a deliberate one.'
        ],
        commonErrors: ['Speeding up instead of increasing turnover.', 'Chasing a large jump at once; 5% is enough to feel and small enough to hold.'],
        contraindications: 'Back off if any niggle sharpens. A cadence change redistributes load rather than removing it.'
    },
    {
        id: 'wall-drill-posture',
        name: 'Wall lean posture drill',
        targets: ['trunk-lean', 'overstride'],
        category: 'drill', equipment: 'a wall', difficulty: 1,
        dosage: '3 x 30 s, before an easy run',
        progression: ['wall-drill-posture', 'wall-drill-marching', 'falling-start'],
        setup: 'Stand an arm-length from a wall, hands on it, body in one straight line from ankle to head.',
        cues: [
            'Lean from the ANKLES, not from the waist. The hips travel forward with the chest.',
            'Hold a light forward lean and feel where the weight sits over the front of the foot.',
            'Carry the same feeling into the first minute of the run.'
        ],
        commonErrors: ['Bending at the hips, which is a different position and not the one associated with easier running.'],
        contraindications: 'Stop if you feel calf or Achilles strain.'
    },
    {
        id: 'ankling',
        name: 'Ankling',
        targets: ['foot-contact', 'cadence'],
        category: 'drill', equipment: 'none', difficulty: 1,
        dosage: '3 x 20 m, before a run',
        progression: ['ankling', 'ankling-moving', 'a-skip'],
        setup: 'Travel forward slowly using only the ankles, rolling from mid-foot to toe with a nearly straight knee.',
        cues: [
            'Very short, quick contacts, foot landing under the hip.',
            'Keep the movement quiet — noise is a proxy for a heavy landing.',
            'Stay tall; this drill is about the foot, not about the stride.'
        ],
        commonErrors: ['Turning it into a bounding drill.', 'Reaching the foot forward.'],
        contraindications: 'Stop if the calf or Achilles becomes sore. Build volume slowly.'
    },
    {
        id: 'calf-raise-eccentric',
        name: 'Slow eccentric calf raise',
        targets: ['ankle-stiffness', 'contact-time'],
        category: 'strength', equipment: 'a step', difficulty: 2,
        dosage: '3 x 10-15 each side, every other day',
        progression: ['double-calf-raise', 'calf-raise-eccentric', 'weighted-calf-raise'],
        setup: 'Stand with the balls of the feet on a step, heels hanging free.',
        cues: [
            'Rise on both legs, shift onto one, then lower over four seconds.',
            'Go through the full range: heel well below the step, then all the way up.',
            'Do a second set with the knee bent to load the soleus.'
        ],
        commonErrors: ['Dropping quickly, which skips the part that builds capacity.', 'Cutting the range short.'],
        contraindications: 'Stop if the Achilles hurts during or the morning after. Soreness in the muscle belly is expected.'
    },
    {
        id: 'hip-flexor-stretch',
        name: 'Half-kneeling hip flexor stretch',
        targets: ['hip-extension'],
        category: 'mobility', equipment: 'a mat', difficulty: 1,
        dosage: '2 x 45 s each side, daily',
        progression: ['hip-flexor-stretch', 'hip-flexor-stretch-reach', 'couch-stretch'],
        setup: 'Half-kneeling, back knee down, front foot flat.',
        cues: [
            'Tuck the pelvis under FIRST, then move forward a few centimeters. The tuck is what makes it a hip flexor stretch.',
            'Squeeze the glute on the kneeling side.',
            'Stop at a stretch, not at a strain.'
        ],
        commonErrors: ['Arching the lower back and feeling nothing at the hip.'],
        contraindications: 'Stop if you feel pinching at the front of the hip.'
    },
    {
        id: 'a-skip',
        name: 'A-skip',
        targets: ['heel-recovery', 'cadence', 'foot-contact'],
        category: 'drill', equipment: 'none', difficulty: 2,
        dosage: '3 x 20 m, before a quality session',
        progression: ['ankling', 'a-march', 'a-skip'],
        setup: 'Skip forward, driving one knee to hip height with the opposite arm swinging.',
        cues: [
            'Snap the foot down under the hip rather than reaching it forward.',
            'Stay tall through the trunk.',
            'Let the heel come up under the hip on the recovery — do not lift it deliberately.'
        ],
        commonErrors: ['Reaching the foot out in front.', 'Collapsing at the hip on the stance side.'],
        contraindications: 'Stop if you feel hamstring tightness sharpen.'
    },
    {
        id: 'lateral-band-walk',
        name: 'Lateral band walk',
        targets: ['frontal-plane-control', 'step-width'],
        category: 'strength', equipment: 'a resistance band', difficulty: 1,
        dosage: '3 x 12 steps each direction, 3 times a week',
        progression: ['lateral-band-walk', 'monster-walk', 'band-walk-quarter-squat'],
        setup: 'Band around the shins or ankles, knees slightly bent, feet hip-width.',
        cues: [
            'Step sideways keeping the feet parallel and the band under tension the whole time.',
            'Keep the trunk still — if the shoulders sway, the band is too heavy.',
            'Move slowly. This is not a cardio exercise.'
        ],
        commonErrors: ['Letting the trailing foot snap in.', 'Leaning away from the direction of travel.'],
        contraindications: 'Stop if you feel pain at the side of the hip.'
    },
    {
        id: 'arm-swing-drill',
        name: 'Seated arm swing drill',
        targets: ['arm-swing'],
        category: 'drill', equipment: 'none', difficulty: 1,
        dosage: '3 x 30 s, 2-3 times a week',
        progression: ['arm-swing-drill', 'arm-swing-standing', 'arm-swing-running'],
        setup: 'Sit tall on the floor with the legs straight in front.',
        cues: [
            'Swing from the shoulder, elbows staying at roughly a right angle.',
            'Hands travel from hip to chest height, close to the body, not across the midline.',
            'Keep the shoulders down and the hands loose.'
        ],
        commonErrors: ['Crossing the hands over the chest, which drives trunk rotation.', 'Shrugging.'],
        contraindications: 'Stop if the neck or shoulder becomes uncomfortable.'
    },
    {
        id: 'single-leg-balance',
        name: 'Single-leg balance with reach',
        targets: ['frontal-plane-control', 'knee-control'],
        category: 'strength', equipment: 'none', difficulty: 1,
        dosage: '3 x 30 s each side, most days',
        progression: ['single-leg-balance', 'single-leg-balance-reach', 'single-leg-balance-eyes-closed'],
        setup: 'Stand on one leg, knee softly bent.',
        cues: [
            'Keep the pelvis level and the knee tracking over the middle of the foot.',
            'Reach the free foot slowly forward, then diagonally back, without touching down.',
            'Grip the floor lightly with the toes rather than clawing.'
        ],
        commonErrors: ['Letting the arch collapse.', 'Hitching the free hip upward.'],
        contraindications: 'Hold a wall if balance is a problem; the point is control, not difficulty.'
    }
];

/** @type {Record<string, Exercise>} */
export const EXERCISE_BY_ID = Object.fromEntries(EXERCISES.map(e => [e.id, e]));
