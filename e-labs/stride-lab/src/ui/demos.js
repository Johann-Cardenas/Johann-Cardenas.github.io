/* ============================================================
   Stride Lab — the demo catalog.

   Two demos, and they answer different questions.

   The SYNTHETIC one answers "is the engine right?". Its runner was
   generated from a physical model, so the true cadence, contact time,
   trunk lean and foot-strike angle are known exactly and the report can
   be checked against them. Nothing else in the app can do that: for a
   filmed runner there is no ground truth to compare with, only another
   measurement.

   The FILMED one answers "what does this do with my video?". It is an
   ordinary phone recording — portrait, 30 fps, handheld, shot from the
   side of a treadmill at an angle — and the honest answer is that a
   large part of the report is withheld. That is the demo. An app that
   only ever demonstrates itself on the capture it was designed for
   teaches nothing about the capture people actually have.

   Everything in `stated` below was SUPPLIED by the person filmed and is
   not measurable from the video. Height sets the pixels-to-meters
   scale, so a wrong value would silently rescale every distance in the
   report; belt speed cannot be measured at all on a treadmill, because
   the runner does not move relative to the frame. They are recorded
   here, in one place, so that what the app was told is separable from
   what the app worked out.
   ============================================================ */

export const DEMOS = [
    {
        id: 'synthetic',
        kind: 'synthetic',
        label: 'Synthetic runner',
        menuLabel: 'Demo — synthetic runner',
        summary: 'A runner generated from a physical model, so the true answers are known and the engine can be marked against them.',
        /* generated at 240 fps: the demo should not also be demonstrating
           the frame-rate limit, which the filmed clip covers */
        fps: 240,
        durationS: 6
    },
    {
        id: 'treadmill',
        kind: 'video',
        label: 'Filmed on a treadmill',
        menuLabel: 'Demo — filmed on a treadmill',
        summary: 'A real phone clip: portrait, 30 fps, shot at an angle from the side of a treadmill. Much of the report is withheld, and the app says why.',
        src: './demo/treadmill-30fps.mp4',
        filename: 'treadmill-30fps.mp4',
        bytes: 4310714,

        /* What the recording IS. Read back from the container by the app's own
           demuxer (`node tmp/probe.mjs` at the time this was added): coded
           848x480 with a 90 degree turn in the track-header matrix, so it
           displays 480x848, 685 samples at a 600-tick timescale of 20 ticks
           each — 30.0 fps, 22.83 s. */
        coded: { width: 848, height: 480 },
        display: { width: 480, height: 848 },
        rotationDeg: 90,
        fps: 30,
        durationS: 22.83,

        /* What the app is TOLD, by the person filmed. Not measurable here. */
        stated: {
            heightM: 1.68,
            massKg: 75,
            surface: 'treadmill',
            speedMs: 3.33,      /* 12 km/h on the console */
            view: 'auto'        /* deliberately not overridden: the automatic
                                   view classifier should be seen doing its job */
        },

        /* The window analyzed. Fixed rather than proposed, so the demo gives
           the same answer twice — a demo that moves is not a demo.

           Twelve seconds, not the six the app proposes for a clip you bring
           yourself. That default is a latency choice, and this is the evidence
           for what it costs: measured over eight candidate windows of this
           clip, six seconds yields three or four usable strides and three
           measurements at medium confidence, and no rule fires. Twelve yields
           nine usable strides, eight at medium, and one finding with advice
           attached. Doubling the footage roughly doubled what survived, for
           about four extra seconds of compute. */
        window: { startS: 0.5, endS: 12.5 }
    }
];

export const DEMO_BY_ID = Object.fromEntries(DEMOS.map(d => [d.id, d]));
