// Independent release checks: no imports from the production gait engine.
const values = a => Array.isArray(a) || ArrayBuffer.isView(a) ? Array.from(a) : Object.values(a || {});
const inside = (p, box) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];

export function auditTreadmill(record, review) {
    const require = (ok, message) => { if (!ok) throw new Error(`Treadmill audit: ${message}`); };
    const k = record.keypoints, n = k?.n, names = k?.names || [], K = names.length;
    require(Number.isInteger(n) && n >= 350 && n <= 365, 'decoded frame coverage');
    require(new Set(names).size === K, 'duplicate landmark names');
    const required = ['nose', 'shoulderL', 'shoulderR', 'hipL', 'hipR', 'ankleL', 'ankleR'];
    require(required.every(name => names.includes(name)), 'missing essential landmarks');
    const t = values(k.t), xy = values(k.xy), vis = values(k.vis);
    require(t.length === n && xy.length === n * K * 2 && vis.length === n * K, 'buffer dimensions');
    require(record.capture.sourceFrameCount === n && record.engine.processing.frames === n, 'frame provenance');
    require(Math.abs(t[0] - 0.5) < 0.05 && Math.abs(t[n - 1] - 12.5) < 0.05, 'source window');
    const index = Object.fromEntries(required.map(name => [name, names.indexOf(name)]));
    const point = (f, name) => xy.slice((f * K + index[name]) * 2, (f * K + index[name]) * 2 + 2);
    const visible = (f, name) => vis[f * K + index[name]] >= 0.5;
    const core = ['nose', 'shoulderL', 'shoulderR', 'hipL', 'hipR'];
    let hold = 0, maxHold = 0;
    for (let f = 0; f < n; f++) {
        require(Number.isFinite(t[f]) && (!f || Math.abs(t[f] - t[f - 1] - 1 / 30) < 0.001), 'nonuniform or invalid timestamps');
        for (let j = 0; j < K; j++) {
            const confidence = vis[f * K + j];
            require(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1, 'invalid visibility');
            if (confidence >= 0.5) require(Number.isFinite(xy[(f * K + j) * 2]) && Number.isFinite(xy[(f * K + j) * 2 + 1]), 'nonfinite visible landmark');
        }
        for (const name of core) if (visible(f, name)) {
            const p = point(f, name);
            require(inside(p, [0, 0, 1, 1]), 'core landmark outside image');
            if (f && visible(f - 1, name)) {
                const prev = point(f - 1, name);
                require(Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 0.15, 'core tracking discontinuity');
            }
        }
        const still = f && required.every(name => {
            const p = point(f, name), prev = point(f - 1, name);
            return Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 1e-5;
        });
        hold = still ? hold + t[f] - t[f - 1] : 0;
        maxHold = Math.max(maxHold, hold);
    }
    require(maxHold < 0.2, 'frozen pose');
    const windows = [];
    for (let second = 0; second < 12; second++) {
        const frames = t.map((time, f) => time >= 0.5 + second && time < 1.5 + second ? f : -1).filter(f => f >= 0);
        require(frames.length >= 28, 'missing one-second window');
        require(core.every(name => frames.filter(f => visible(f, name)).length >= frames.length * 0.9), 'torso tracking dropout');
        const ankle = frames.filter(f => visible(f, 'ankleL')).map(f => point(f, 'ankleL')[0]);
        require(ankle.length >= frames.length * 0.7, 'visible-leg tracking dropout');
        const excursion = Math.max(...ankle) - Math.min(...ankle);
        require(excursion > 0.15, 'leg motion disappeared');
        windows.push({ second, frames: frames.length, ankleCoverage: ankle.length / frames.length, excursion });
    }
    const anchors = review.samples.map(sample => {
        let f = 0;
        for (let j = 1; j < n; j++) if (Math.abs(t[j] - sample.time) < Math.abs(t[f] - sample.time)) f = j;
        const left = point(f, 'hipL'), right = point(f, 'hipR');
        return { time: sample.time, frame: f, head: inside(point(f, 'nose'), sample.head),
            torso: inside([(left[0] + right[0]) / 2, (left[1] + right[1]) / 2], sample.torso) };
    });
    require(anchors.filter(a => a.head && a.torso).length >= review.samples.length - 1, 'video-reviewed location mismatch');
    // Scan raw, visible ankle displacement relative to the pelvis. This is a
    // direct sinusoidal projection, independent of filtering/event detection.
    const motion = t.map((time, f) => {
        const l = point(f, 'hipL'), r = point(f, 'hipR');
        return { time, y: point(f, 'ankleL')[0] - (l[0] + r[0]) / 2, valid: visible(f, 'ankleL') };
    }).filter(s => s.valid);
    const mean = motion.reduce((sum, s) => sum + s.y, 0) / motion.length;
    let peak = -1, cadence = NaN;
    for (let bin = 0; bin <= 240; bin++) {
        const hz = 1 + bin * 0.005;
        let re = 0, im = 0;
        for (const s of motion) { const a = 2 * Math.PI * hz * s.time; re += (s.y - mean) * Math.cos(a); im += (s.y - mean) * Math.sin(a); }
        const power = re * re + im * im;
        if (power > peak) { peak = power; cadence = hz * 120; }
    }
    require(cadence >= 170 && cadence <= 200, 'raw motion cadence');
    require(Math.abs(record.metrics.cadence.combined.value - cadence) < 10, 'cadence disagrees with raw motion');
    require(record.model.available && record.model.dof === 14 && record.model.coverage >= 0.95 && record.model.coverage <= 1, 'kinematic fit coverage');
    require(Number.isFinite(record.model.residualPct) && record.model.residualPct >= 0 && record.model.residualPct < 12
        && Number.isFinite(record.model.residualP90Pct) && record.model.residualP90Pct >= record.model.residualPct
        && record.model.residualP90Pct < 20, 'kinematic fit residual');
    return { frames: n, maxHold, rawCadence: cadence, anchors, windows, modelResidualPct: record.model.residualPct };
}
