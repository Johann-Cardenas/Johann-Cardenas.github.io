/* ============================================================
   Stride Lab — the reference list.

   Every normative band and every rule cites an entry here. Entries
   are either a real, checkable publication, or the explicitly
   labeled placeholder below.

   READ THIS BEFORE ADDING A BAND.

   `indicative-unsourced` exists because the build specification
   supplied a table of "literature-typical" ranges and then said, in
   the same breath, that they must not ship as-is without a citation.
   Rather than attach a plausible-looking paper to a number that did
   not come from it, bands taken from that table cite this entry,
   which says in the UI exactly what it is: a range in common use
   that has not been traced to a primary source here. That is
   uncomfortable to display, and it is the honest thing to display.
   Replacing these with real citations is the single highest-value
   improvement available to this app.
   ============================================================ */

/**
 * @typedef {Object} Reference
 * @property {string} id
 * @property {string} authors
 * @property {number|null} year
 * @property {string} title
 * @property {string} venue
 * @property {string} [doi]
 * @property {string} [url]
 * @property {string} used   what this app takes from it
 */

/** @type {Reference[]} */
export const REFERENCES = [
    {
        id: 'milner-paquette-2015',
        authors: 'Milner CE, Paquette MR',
        year: 2015,
        title: 'A kinematic method to detect foot contact during running for all foot strike patterns',
        venue: 'Journal of Biomechanics 48(12):3502-3505',
        doi: '10.1016/j.jbiomech.2015.07.036',
        used: 'The strike-pattern-independent contact detector (method M5): pelvis vertical velocity, rather than the heel, marks contact, so the detector does not carry a rearfoot-versus-forefoot bias.'
    },
    {
        id: 'fellin-2010',
        authors: 'Fellin RE, Rose WC, Royer TD, Davis IS',
        year: 2010,
        title: 'Comparison of methods for kinematic identification of footstrike and toe-off during overground and treadmill running',
        venue: 'Journal of Science and Medicine in Sport 13(6):646-650',
        doi: '10.1016/j.jsams.2010.03.006',
        used: 'The error magnitudes this app treats as its floor: roughly 22-25 ms for foot strike and about 5 ms for toe-off, against force-plate ground truth and using marker data.'
    },
    {
        id: 'footnet-2021',
        authors: 'Alcantara RS, Day EM, Hahn ME, Grabowski AM (FootNet authors)',
        year: 2021,
        title: 'Development and validation of FootNet; a new kinematic algorithm to improve foot-strike and toe-off detection in treadmill running',
        venue: 'PLOS ONE 16(8):e0248608',
        doi: '10.1371/journal.pone.0248608',
        used: 'The architecture template for the optional stage-2 gait-phase model, and the evidence that a learned detector removes the strike-pattern dependency of geometric ones.'
    },
    {
        id: 'stenum-2021',
        authors: 'Stenum J, Rossi C, Roemmich RT',
        year: 2021,
        title: 'Two-dimensional video-based analysis of human gait using pose estimation',
        venue: 'PLOS Computational Biology 17(4):e1008935',
        doi: '10.1371/journal.pcbi.1008935',
        used: 'The expected accuracy of pose-estimation-based gait metrics against a marker-based reference. This is the paper behind the limitations section, and behind the refusal to claim lab-grade accuracy.'
    },
    {
        id: 'pagnon-2024',
        authors: 'Pagnon D, Kim HM',
        year: 2024,
        title: 'Sports2D: Compute 2D human pose and angles from a video or a webcam',
        venue: 'Journal of Open Source Software 9(101):6849',
        doi: '10.21105/joss.06849',
        used: 'The reference open-source implementation for 2D joint and segment angle definitions, and for the plane-of-motion assumptions this engine also makes.'
    },
    {
        id: 'moore-2016',
        authors: 'Moore IS',
        year: 2016,
        title: 'Is There an Economical Running Technique? A Review of Modifiable Biomechanical Factors Affecting Running Economy',
        venue: 'Sports Medicine 46(6):793-807',
        doi: '10.1007/s40279-016-0474-4',
        used: 'The evidence base for treating duty factor and vertical oscillation as running-economy correlates, and for the caution that most technique-economy links are associations rather than interventions.'
    },
    {
        id: 'folland-2017',
        authors: 'Folland JP, Allen SJ, Black MI, Handsaker JC, Forrester SE',
        year: 2017,
        title: 'Running Technique is an Important Component of Running Economy and Performance',
        venue: 'Medicine & Science in Sports & Exercise 49(7):1412-1423',
        doi: '10.1249/MSS.0000000000001245',
        used: 'Support for pelvis vertical oscillation, braking and trunk position as technique variables associated with economy.'
    },
    {
        id: 'lussiana-2019',
        authors: 'Lussiana T, Patoz A, Gindre C, Mourot L, Hebert-Losier K',
        year: 2019,
        title: 'The implications of time on the ground on running economy: less is not always better',
        venue: 'Journal of Experimental Biology 222(6):jeb192047',
        doi: '10.1242/jeb.192047',
        used: 'The reason this app does not frame a low duty factor as unambiguously good. Shorter ground contact is not universally more economical, and the report says so where duty factor is shown.'
    },
    {
        id: 'altman-davis-2012',
        authors: 'Altman AR, Davis IS',
        year: 2012,
        title: 'A kinematic method for footstrike pattern detection in barefoot and shod runners',
        venue: 'Gait & Posture 35(2):298-300',
        doi: '10.1016/j.gaitpost.2011.09.104',
        used: 'The foot-strike-angle thresholds used to classify rearfoot, midfoot and forefoot landings.'
    },
    {
        id: 'winter-biomechanics',
        authors: 'Winter DA',
        year: 2009,
        title: 'Biomechanics and Motor Control of Human Movement (4th edition)',
        venue: 'John Wiley & Sons',
        used: 'Segment lengths as fractions of standing height, which drive the pixel-to-meter scaling and every leg-length normalization, and the filtering conventions behind the zero-phase Butterworth.'
    },
    {
        id: 'vanhooren-2024',
        authors: 'Van Hooren B, Jukic I, Cox M, Frenken KG, Bautista I, Moore IS',
        year: 2024,
        title: 'The Relationship Between Running Biomechanics and Running Economy: A Systematic Review and Meta-Analysis of Observational Studies',
        venue: 'Sports Medicine 54(5):1269-1316',
        doi: '10.1007/s40279-024-01997-3',
        used: 'The evidence base for which technique variables are actually associated with running economy, and which are not. Significant: vertical oscillation (r = 0.35, moderate, less is better), vertical stiffness (r = -0.31) and leg stiffness (r = -0.28, moderate, more is better), and cadence (r = -0.20, small, more is better). NOT significant: ground contact time (r = -0.02), duty factor (r = -0.06), stride length, foot-strike pattern, knee flexion, trunk lean, shank angle at contact and braking. The review also reports that these variables explain only 4-12% of the between-individual variation in running economy when taken in isolation — which is the single most important sentence on this page.'
    },
    {
        id: 'morin-2005',
        authors: 'Morin JB, Dalleau G, Kyrolainen H, Jeannin T, Belli A',
        year: 2005,
        title: 'A simple method for measuring stiffness during running',
        venue: 'Journal of Applied Biomechanics 21(2):167-180',
        doi: '10.1123/jab.21.2.167',
        used: 'The spring-mass model used to estimate vertical and leg stiffness from contact time, flight time, body mass, running speed and leg length, with no force plate. Its peak-force term is a model output and is never reported here as a measurement.'
    },
    {
        id: 'indicative-unsourced',
        authors: 'No primary source traced',
        year: null,
        title: 'Indicative range in common use, not traced to a primary source in this build',
        venue: 'Stride Lab build specification, Appendix B',
        used: 'Bands citing this entry are ranges widely quoted for recreational-to-trained adults. They have NOT been traced to a study here, they are not conditioned on your speed, sex or training level beyond what is stated, and they are scored at the lowest evidence weight. Treat them as orientation, not as a target.'
    }
];

/** @type {Record<string, Reference>} */
export const REFERENCE_BY_ID = Object.fromEntries(REFERENCES.map(r => [r.id, r]));
