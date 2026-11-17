// Closed belt (chain) path around oriented circles. Pure, no DOM.
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * circles: [{c:[x,y], r, s}] with s = +1 counter-clockwise, -1 clockwise, visited in travel order
 * (closed). Returns {length, at(d) -> {x, y, ang, on}} where `on` is the circle index the point
 * lies on, or -1 on a straight run (`from` is the circle it left, `f` the fraction along the run).
 */
export function beltPath(circles) {
  const n = circles.length, segs = [], tang = [];
  for (let i = 0; i < n; i++) {
    const A = circles[i], B = circles[(i + 1) % n];
    const Dx = B.c[0] - A.c[0], Dy = B.c[1] - A.c[1], D2 = Dx * Dx + Dy * Dy;
    const k = A.r * A.s - B.r * B.s, L = Math.sqrt(Math.max(D2 - k * k, 1e-9));
    // d solves D = L d + k m, with m = d rotated by -90 degrees.
    const dx = (L * Dx - k * Dy) / D2, dy = (L * Dy + k * Dx) / D2;
    const mx = dy, my = -dx;
    tang.push({ p1: [A.c[0] + A.r * A.s * mx, A.c[1] + A.r * A.s * my], p2: [B.c[0] + B.r * B.s * mx, B.c[1] + B.r * B.s * my], L, dir: Math.atan2(dy, dx) });
  }
  let length = 0;
  for (let i = 0; i < n; i++) {
    // arc on circle i from the end of the incoming tangent to the start of the outgoing one
    const C = circles[i], tin = tang[(i - 1 + n) % n], tout = tang[i];
    const a0 = Math.atan2(tin.p2[1] - C.c[1], tin.p2[0] - C.c[0]);
    const a1 = Math.atan2(tout.p1[1] - C.c[1], tout.p1[0] - C.c[0]);
    let sw = (a1 - a0) * C.s;
    while (sw < 0) sw += Math.PI * 2;
    while (sw >= Math.PI * 2) sw -= Math.PI * 2;
    segs.push({ kind: 'arc', i, a0, sweep: sw, len: sw * C.r, start: length }); length += sw * C.r;
    segs.push({ kind: 'line', i, t: tout, len: tout.L, start: length }); length += tout.L;
  }
  function at(d) {
    d = ((d % length) + length) % length;
    let sg = segs[segs.length - 1];
    for (const q of segs) if (d < q.start + q.len) { sg = q; break; }
    const f = sg.len ? (d - sg.start) / sg.len : 0;
    if (sg.kind === 'arc') {
      const C = circles[sg.i], a = sg.a0 + C.s * sg.sweep * f;
      return { x: C.c[0] + C.r * Math.cos(a), y: C.c[1] + C.r * Math.sin(a), ang: a + C.s * Math.PI / 2, on: sg.i, f };
    }
    return { x: lerp(sg.t.p1[0], sg.t.p2[0], f), y: lerp(sg.t.p1[1], sg.t.p2[1], f), ang: sg.t.dir, on: -1, from: sg.i, f };
  }
  return { length, at, segs, tang };
}
