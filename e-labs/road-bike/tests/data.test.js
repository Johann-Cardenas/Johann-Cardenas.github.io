import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const D = new URL('../data/', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, D), 'utf8'));
const bin = (p) => readFileSync(new URL(p, D));

test('CAD pack: every part slice lies inside parts.bin and the SolidWorks check covers every part', () => {
  const doc = json('cad/parts.json'), b = bin('cad/parts.bin');
  assert.equal(b.length, doc.bytes);
  for (const p of doc.parts) {
    assert.ok(p.pos[0] % 2 === 0 && p.pos[0] + p.pos[1] * 6 <= b.length, p.name);
    assert.ok(p.idx[0] % 4 === 0 && p.idx[0] + p.idx[1] * 4 <= b.length, p.name);
    const idx = new Uint32Array(b.buffer, b.byteOffset + p.idx[0], p.idx[1]);
    assert.ok(idx.every((i) => i < p.pos[1]), `${p.name}: index out of range`);
    assert.ok(p.volume_cm3 > 0, p.name);
  }
  const sw = json('cad/solidworks.json');
  assert.deepEqual(new Set(sw.parts.map((r) => r.name)), new Set(doc.parts.map((p) => p.name)));
  for (const r of sw.parts) assert.ok(Math.abs(r.volume_rel) < 0.05 && r.centroid_dmm < 0.5 && r.bodies === 1, r.name);
});

test('FE pack: slices inside frame.bin, equilibrium-scale results, modes in ascending order', () => {
  const doc = json('fe/frame.json'), b = bin('fe/frame.bin');
  assert.equal(b.length, doc.bytes);
  const n = doc.n_nodes;
  assert.ok(doc.positions + n * 6 <= b.length && doc.triangles + doc.n_tris * 12 <= b.length);
  const tris = new Uint32Array(b.buffer, b.byteOffset + doc.triangles, doc.n_tris * 3);
  assert.ok(tris.every((i) => i < n));
  for (const c of doc.cases) {
    assert.ok(c.U + n * 6 <= b.length && c.mises + n * 2 <= b.length, c.name);
    assert.ok(c.p99_mises > 0 && c.p99_mises <= c.peak_mises && c.max_disp > 0, c.name);
    for (const k of Object.keys(Object.fromEntries(c.loads))) assert.ok(doc.rp[k], `${c.name}: load at unknown point ${k}`);
  }
  const hz = doc.modes.map((m) => m.hz);
  assert.ok(hz.length >= 4 && hz.every((h, i) => h > 0 && (i === 0 || h >= hz[i - 1])));
});

test('CFD packs (when present): slices, streamlines and surface fields inside their bins', () => {
  const dir = new URL('cfd/', D);
  const cases = existsSync(dir) ? readdirSync(dir).filter((f) => /^yaw\d+_dx[\d.]+\.json$/.test(f)) : [];
  for (const f of cases) {
    const doc = json('cfd/' + f), b = bin('cfd/' + f.replace('.json', '.bin'));
    assert.equal(b.length, doc.bytes, f);
    for (const s of doc.slices) for (const k of ['speed', 'cp', 'solid']) assert.ok(s[k] + s.w * s.h <= b.length, `${f} ${s.name}.${k}`);
    for (const l of doc.streamlines) assert.ok(l.pts + l.n * 6 <= b.length && l.speed + l.n <= b.length, f);
    const s = doc.summary;
    const sum = Object.values(s.drag_by_group_N).reduce((a, v) => a + v, 0);
    assert.ok(Math.abs(sum - s.drag_N) < 1e-6 * Math.max(1, s.drag_N), `${f}: groups add up to the total`);
    assert.ok(Math.abs(s.CdA_m2 - 2 * s.drag_N / (1.204 * (40 / 3.6) ** 2)) < 1e-9, `${f}: CdA consistent with drag`);
  }
});
