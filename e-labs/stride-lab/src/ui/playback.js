/** One cancellable clock per player. Presented frames are preferred; an
 * independent animation clock recovers when a browser stops delivering them.
 * Missed frames are skipped, never queued for catch-up. */
export function createPlaybackClock(video, options) {
    const { start, end, onFrame, onEnd = () => {}, onError = () => {} } = options;
    const request = options.requestAnimationFrame || globalThis.requestAnimationFrame.bind(globalThis);
    const cancel = options.cancelAnimationFrame || globalThis.cancelAnimationFrame.bind(globalThis);
    const now = options.now || (() => performance.now());
    let active = true, raf = null, rvfc = null, lastTime = NaN, lastMedia = NaN, lastPresented = -Infinity;
    const errors = error => { try { onError(error); } catch { /* recovery must not kill the clock */ } };
    const paint = (time, force = false) => {
        if (!active || !Number.isFinite(time)) return;
        time = Math.max(start, Math.min(end, time));
        if (!force && Math.abs(time - lastTime) < 1e-7) return;
        lastTime = time;
        try { onFrame(time, { force }); } catch (error) { errors(error); }
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
        if (video.paused || now() - lastPresented > 120) paint(video.currentTime);
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
