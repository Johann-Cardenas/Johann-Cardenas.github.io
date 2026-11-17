/* Shared with the CEE 406 port of LEAPS, where this file is an ES module
 * (src/components/react/leaps/tire-tread.js). Identical logic, wrapped as a UMD so the
 * standalone app can load it with a plain <script> tag. */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LeapsTireTread = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    // A periodic tread fixed to the tire, independent of camera angle and zoom.
    // Cache unit geometry; scale it to each wheel only when projecting the scene.
    const cache = new Map();
    const TAU = Math.PI * 2;
    const grooveCenters = [-0.48, 0, 0.48];

    const point = (u, angle) => [u, Math.sin(angle), Math.cos(angle)];
    const quad = (u0, u1, t0, t1) => [point(u0, t0), point(u1, t0), point(u1, t1), point(u0, t1)];

    function treadSectors(draft = false) {
        const count = draft ? 24 : 48;
        if (cache.has(count)) return cache.get(count);
        const sectors = Array.from({ length: count }, (_, i) => {
            const t0 = i * TAU / count, t1 = (i + 1) * TAU / count, dt = t1 - t0;
            const sipes = [];
            // Four tread ribs; the outer cuts continue over both shoulders.
            const ribs = [[-1, -0.52], [-0.44, -0.04], [0.04, 0.44], [0.52, 1]];
            for (const [rib, [u0, u1]] of ribs.entries()) {
                const phase = rib % 2 ? 0.54 : 0.22;
                const a = t0 + dt * phase, b = a + dt * 0.22;
                const strip = [point(u0, a)];
                if (u0 < -0.8) strip.push(point(-0.8, a + (b - a) * (-0.8 - u0) / (u1 - u0)));
                if (u1 > 0.8) strip.push(point(0.8, a + (b - a) * (0.8 - u0) / (u1 - u0)));
                strip.push(point(u1, b));
                sipes.push(strip);
            }
            return {
                sin: Math.sin((t0 + t1) / 2), cos: Math.cos((t0 + t1) / 2),
                center: quad(-0.8, 0.8, t0, t1),
                shoulders: [quad(-1, -0.8, t0, t1), quad(0.8, 1, t0, t1)],
                grooves: grooveCenters.map(u => quad(u - 0.027, u + 0.027, t0, t1)),
                sipes
            };
        });
        cache.set(count, sectors);
        return sectors;
    }

    function tireSurfacePoint(shape, p) {
        const [u, sin, cos] = p;
        const shoulder = Math.max(0, (Math.abs(u) - 0.8) / 0.2);
        const radius = shape.R * (1 - 0.06 * shoulder);
        return [u * shape.w, radius * sin, Math.min(0, -shape.h + radius * cos)];
    }

    function treadNormal(shape, sector, side = 0) {
        if (!side) return [0, sector.sin, sector.cos];
        const dx = shape.w * 0.2, dr = shape.R * 0.06;
        const length = Math.hypot(dx, dr);
        return [side * dr / length, sector.sin * dx / length, sector.cos * dx / length];
    }

    // The Section view is the 3-D camera at azimuth 0 and elevation 0: screen x is
    // world x and screen down is world z, so the 2-D tire is this same surface seen
    // head-on along +y. Only the near half faces that camera. Its tread is returned
    // as gradient stops (one per sector boundary, so shading is smooth where the 3-D
    // strips are flat) plus the grooves, the visible sipes and the silhouette, all in
    // (x, z) relative to the contact point.
    function tireElevation(shape, draft = false) {
        const sectors = treadSectors(draft);
        const view = [0, 1, 0];
        const faces = n => n[0] * view[0] + n[1] * view[1] + n[2] * view[2] < -1e-7;
        const xz = p => { const v = tireSurfacePoint(shape, p); return [v[0], v[2]]; };
        const front = sectors.filter(s => faces(treadNormal(shape, s)));
        const stops = [], sipes = [];
        for (const s of front) {
            // The true surface normal at the boundary angle, so the gradient
            // interpolates the shade the 3-D strips carry either side of it.
            const t = Math.atan2(s.center[0][1], s.center[0][2]);
            const edge = { sin: Math.sin(t), cos: Math.cos(t) };
            stops.push({
                z: xz([0, edge.sin, edge.cos])[1],
                zShoulder: xz([1, edge.sin, edge.cos])[1],
                center: treadNormal(shape, edge),
                left: treadNormal(shape, edge, -1),
                right: treadNormal(shape, edge, 1)
            });
            for (const sipe of s.sipes) {
                for (let j = 1; j < sipe.length; j++) sipes.push([xz(sipe[j - 1]), xz(sipe[j])]);
            }
        }
        const last = front.at(-1).center[3];
        const tEnd = Math.atan2(last[1], last[2]);
        const end = { sin: Math.sin(tEnd), cos: Math.cos(tEnd) };
        stops.push({
            z: xz([0, end.sin, end.cos])[1], zShoulder: xz([1, end.sin, end.cos])[1],
            center: treadNormal(shape, end), left: treadNormal(shape, end, -1), right: treadNormal(shape, end, 1)
        });
        stops.sort((a, b) => a.z - b.z);
        const top = stops[0].z, topShoulder = stops[0].zShoulder;
        const outline = [
            [-shape.w, 0], [-shape.w, topShoulder], [-0.8 * shape.w, top],
            [0.8 * shape.w, top], [shape.w, topShoulder], [shape.w, 0]
        ];
        const grooves = sectors[0].grooves.map(g => [g[0][0] * shape.w, g[1][0] * shape.w]);
        return { top, outline, stops, grooves, sipes };
    }

    // Clip the optional cutaway exactly, including sectors that cross the plane.
    // Midpoint rejection alone leaves missing wedges at the boundary.
    function clipTirePolygon(points, cutY, keep) {
        if (cutY == null || !points.length) return points;
        const out = [];
        let a = points[points.length - 1], insideA = keep * (a[1] - cutY) >= 0;
        for (const b of points) {
            const insideB = keep * (b[1] - cutY) >= 0;
            if (insideA !== insideB) {
                const t = (cutY - a[1]) / (b[1] - a[1]);
                out.push([a[0] + t * (b[0] - a[0]), cutY, a[2] + t * (b[2] - a[2])]);
            }
            if (insideB) out.push(b);
            a = b; insideA = insideB;
        }
        return out;
    }

    return { treadSectors, tireSurfacePoint, treadNormal, tireElevation, clipTirePolygon };
});
