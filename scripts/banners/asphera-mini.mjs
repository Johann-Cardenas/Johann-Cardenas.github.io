// Extracts the data the Asphera card miniature draws: the real longitudinal
// strain (E11, microstrain) of the Arterial Section's 13 animation frames,
// read from the app's own result file and resampled onto a small grid.
//
//   node scripts/banners/asphera-mini.mjs
//
// Writes e-labs/asphera/data/TK_P1/mini.json. Nothing is modelled: every value
// is a bilinear sample of e-labs/asphera/data/TK_P1/contours.json, and the
// script exits non-zero if the source is not the shape it expects.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'e-labs', 'asphera', 'data', 'TK_P1');
const contours = JSON.parse(readFileSync(join(DIR, 'contours.json'), 'utf8'));
const structure = JSON.parse(readFileSync(join(DIR, 'structure.json'), 'utf8'));

const anim = contours.animation.longitudinal;
const fail = (m) => { console.error('asphera-mini: ' + m); process.exit(1); };
if (!anim || anim.frames.length !== 13) fail('expected 13 animation frames');

const NX = 40, NZ = 30;
const DEPTH = 700;                       // mm drawn: HMA, base and the top of the subgrade
const X0 = anim.axis1[0], X1 = anim.axis1.at(-1);
const xs = anim.axis1, zs = anim.depths;

function locate(axis, v) {
    let i = 0;
    while (i < axis.length - 2 && axis[i + 1] < v) i++;
    const f = Math.min(1, Math.max(0, (v - axis[i]) / (axis[i + 1] - axis[i])));
    return [i, f];
}
function sample(values, x, z) {
    const [i, fx] = locate(xs, x), [j, fz] = locate(zs, z);
    const a = values[j][i], b = values[j][i + 1], c = values[j + 1][i], d = values[j + 1][i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

let min = Infinity, max = -Infinity;
const frames = anim.frames.map((fr) => {
    const v = fr.fields.E11.values;
    if (v.length !== zs.length || v[0].length !== xs.length) fail('frame grid does not match its axes');
    const out = [];
    for (let j = 0; j < NZ; j++) {
        const z = (j / (NZ - 1)) * DEPTH;
        for (let i = 0; i < NX; i++) {
            const x = X0 + (i / (NX - 1)) * (X1 - X0);
            const e = sample(v, x, z);
            if (!Number.isFinite(e)) fail('non-finite sample');
            min = Math.min(min, e); max = Math.max(max, e);
            out.push(Math.round(e));
        }
    }
    // The tire sits where the surface is most compressed.
    let wx = X0, lo = Infinity;
    for (let i = 0; i < xs.length; i++) if (v[0][i] < lo) { lo = v[0][i]; wx = xs[i]; }
    return { step: fr.timestep, wheelX: wx, e11: out };
});

const layers = structure.layers.map((l) => ({ label: l.label, top: l.depthTop, bottom: Math.min(l.depthBottom, DEPTH), color: l.color }));
writeFileSync(join(DIR, 'mini.json'), JSON.stringify({
    source: 'e-labs/asphera/data/TK_P1/contours.json (animation.longitudinal, E11), resampled by scripts/banners/asphera-mini.mjs',
    section: structure.name, unit: 'µε', nx: NX, nz: NZ, x: [X0, X1], depth: DEPTH,
    range: [Math.round(min * 10) / 10, Math.round(max * 10) / 10], layers, frames,
}));
console.log(`mini.json: ${frames.length} frames, ${NX}x${NZ}, E11 ${min.toFixed(1)}..${max.toFixed(1)} µε, wheel ${frames.map(f => f.wheelX).join(' ')}`);
