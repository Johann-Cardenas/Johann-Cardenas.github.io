/** One cancellable clock per player. Presented frames are preferred; an
 * independent animation clock recovers when a browser stops delivering them.
 * Missed frames are skipped, never queued for catch-up. */
export function createPlaybackClock(video, options) {
    const { start, end, onFrame, onEnd = () => {}, onError = () => {} } = options;
    const request = options.requestAnimationFrame || globalThis.requestAnimationFrame.bind(globalThis);
    const cancel = options.cancelAnimationFrame || globalThis.cancelAnimationFrame.bind(globalThis);
    const now = options.now || (() => performance.now());
    let active = true, raf = null, rvfc = null, lastTime = NaN, lastMedia = NaN, lastPresented = -Infinity;
    let pendingTime = NaN, retryAt = 0, failures = 0;
    const errors = error => { try { onError(error); } catch { /* recovery must not kill the clock */ } };
    const paint = (time, force = false) => {
        if (!active || !Number.isFinite(time)) return;
        time = Math.max(start, Math.min(end, time));
        if (!force && !Number.isFinite(pendingTime) && Math.abs(time - lastTime) < 1e-7) return;
        if (!force && video.paused && Number.isFinite(pendingTime) && now() < retryAt) return;
        try {
            onFrame(time, { force });
            lastTime = time;
            pendingTime = NaN;
            failures = 0;
        } catch (error) {
            pendingTime = time;
            retryAt = now() + Math.min(1000, 16 * 2 ** Math.min(failures++, 6));
            errors(error);
        }
    };
    const finish = () => {
        if (!active) return;
        video.pause();
        if (Math.abs(video.currentTime - end) > 0.001) video.currentTime = end;
        paint(end);
        try { onEnd(); } catch (error) { errors(error); }
    };
    const armPresented = () => {
        if (!active || typeof video.requestVideoFrameCallback !== 'function') return;
        try { rvfc = video.requestVideoFrameCallback(presented); }
        catch (error) { rvfc = null; errors(error); }
    };
    const presented = (_wallTime, meta) => {
        if (!active) return;
        rvfc = null;
        armPresented(); // arm before drawing: a rendering exception cannot stop delivery
        if (video.seeking) return;
        if (!Number.isFinite(meta?.mediaTime) || Math.abs(meta.mediaTime - video.currentTime) > 0.2
            || meta.mediaTime === lastMedia) return;
        lastMedia = meta.mediaTime;
        lastPresented = now();
        if (meta.mediaTime >= end) finish();
        else paint(meta.mediaTime);
    };
    const tick = () => {
        if (!active) return;
        raf = request(tick);
        if (video.readyState < 2 || video.seeking) return;
        if (video.currentTime > end + 0.001 || (!video.paused && video.currentTime >= end)) { finish(); return; }
        if (video.paused) {
            // The audio/media clock can stop between source frames. Preserve
            // the last presented pose until an explicit seek or new frame.
            const target = Number.isFinite(pendingTime) ? pendingTime
                : Number.isFinite(lastTime) ? lastTime : video.currentTime;
            paint(target);
        } else if (now() - lastPresented > 120) paint(video.currentTime);
    };
    const resetPresented = () => { lastPresented = -Infinity; lastMedia = NaN; };
    const seeked = () => { resetPresented(); paint(video.currentTime, true); };
    const playing = resetPresented;
    video.addEventListener('seeked', seeked);
    video.addEventListener('playing', playing);
    video.addEventListener('ended', finish);
    armPresented();
    raf = request(tick);
    return {
        requestRedraw(time = video.currentTime) {
            if (!active || !Number.isFinite(time)) return;
            pendingTime = time;
            lastTime = NaN;
            lastPresented = -Infinity;
            retryAt = 0;
        },
        dispose() {
            if (!active) return;
            active = false;
            try { if (raf != null) cancel(raf); } catch { /* owner guard still prevents stale work */ }
            try { if (rvfc != null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(rvfc); } catch { /* already retired */ }
            video.removeEventListener('seeked', seeked);
            video.removeEventListener('playing', playing);
            video.removeEventListener('ended', finish);
        }
    };
}
