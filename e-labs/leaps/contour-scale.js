/* Shared with the CEE 406 port of LEAPS, where this file is an ES module
 * (src/components/react/leaps/contour-scale.js). Identical logic, wrapped as a UMD so the
 * standalone app can load it with a plain <script> tag. */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LeapsContourScale = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    // Numerical extrema are over the already computed critical responses, not
    // the currently visible section. No percentile clipping or history of slices.
    function finiteRange(values) {
        let min = Infinity, max = -Infinity;
        for (const value of values) {
            if (!Number.isFinite(value)) continue;
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
        return min === Infinity ? null : { min, max };
    }

    function rangeKey(job, resolution) {
        // Points include the moving section, so deliberately exclude them.
        return JSON.stringify([job.layers, job.interfaces, job.loads, job.options, resolution]);
    }

    function criticalRanges(points, fields) {
        const reference = points.filter(p => p.tag?.t === 'kp' || p.tag?.t === 'pf');
        const ranges = Object.fromEntries(fields.map(f => [f.id, finiteRange(reference.map(f.get))]));
        // On a single load's symmetry axis, xz shear is zero at every critical
        // station although it is nonzero off-axis. The already computed maximum
        // shear supplies a fixed reference instead of a meaningless 0-to-0 scale.
        if (ranges.sxz && ranges.tmax?.max > 0 &&
            Math.max(Math.abs(ranges.sxz.min), Math.abs(ranges.sxz.max)) < ranges.tmax.max * 1e-8) {
            ranges.sxz = { min: -ranges.tmax.max, max: ranges.tmax.max };
        }
        return ranges;
    }

    function colorPosition(value, range, diverging) {
        const { min, max } = range;
        if (min === max) return 0.5;
        // Preserve zero as neutral and give equal magnitudes equal color strength.
        // Crop the diverging ramp to the actual (possibly asymmetric) data limits.
        if (diverging) {
            const magnitude = Math.max(Math.abs(min), Math.abs(max));
            const bounded = Math.max(min, Math.min(max, value));
            return magnitude ? 0.5 + 0.5 * bounded / magnitude : 0.5;
        }
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }

    // Interpolate the physical field before mapping it to color, keeping missing
    // cells transparent. This adds pixels, never solver points or new extrema.
    function smoothField(values, nx, nz, factor = 3) {
        const width = (nx - 1) * factor + 1, height = (nz - 1) * factor + 1;
        const out = new Float64Array(width * height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const ix = Math.min(nx - 2, Math.floor(x / factor));
            const iz = Math.min(nz - 2, Math.floor(y / factor));
            const tx = x / factor - ix, tz = y / factor - iz;
            const a = values[iz * nx + ix], b = values[iz * nx + ix + 1];
            const c = values[(iz + 1) * nx + ix], d = values[(iz + 1) * nx + ix + 1];
            out[y * width + x] = Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d)
                ? (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz : NaN;
        }
        return { values: out, width, height };
    }

    return { finiteRange, rangeKey, criticalRanges, colorPosition, smoothField };
});
