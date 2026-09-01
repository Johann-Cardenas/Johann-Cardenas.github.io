/* ============================================================
   Stride Lab — value formatting and copy.

   Voice, applied consistently: sentence case, active voice, no
   apology. A button that says "Analyse run" leads to a screen that
   says "Analysing run" and a result that says "Run analysed".
   Errors state what happened and what to do next. Empty states are
   invitations to act.
   ============================================================ */

export const CONFIDENCE_COPY = {
    high: { label: 'High', hint: 'Frame rate, landmark quality and stride count all support this number.' },
    medium: { label: 'Medium', hint: 'Usable, but one of frame rate, landmark quality or stride count is limiting it.' },
    low: { label: 'Low', hint: 'Read the direction, not the digits. Something about this clip limits what can be measured.' },
    unavailable: { label: 'Not measured', hint: 'This one could not be measured from this clip.' }
};

/** Shape as well as colour, so status never depends on colour alone. */
export const STATUS_GLYPH = {
    optimal: '●',        /* filled circle   */
    acceptable: '◐',     /* half circle     */
    outside: '△',        /* open triangle   */
    unscored: '–'        /* dash            */
};

export const STATUS_COPY = {
    optimal: 'Inside the typical range',
    acceptable: 'Near the typical range',
    outside: 'Outside the typical range',
    unscored: 'Not scored'
};

export function fmt(value, decimals = 1) {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toFixed(decimals);
}

/**
 * A value with its interval. The interval is never optional and never a
 * footnote: "231 ms" and "231 +- 33 ms" are different claims, and only one of
 * them is true of a 30 fps clip.
 */
export function fmtWithCi(slot, spec) {
    if (!slot || slot.value == null) return '—';
    const d = spec && spec.decimals != null ? spec.decimals : 1;
    const v = fmt(slot.value, d);
    if (slot.ci95 == null) return v;
    return `${v} ± ${fmt(slot.ci95, d)}`;
}

export function fmtUnit(unit) {
    if (!unit) return '';
    return unit === 'deg' ? '°' : unit;
}

export function fmtDuration(ms) {
    const s = ms / 1000;
    return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'kB', 'MB', 'GB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(ts) {
    return new Date(ts).toLocaleString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

/** Imperial where the user asked for it, metric otherwise. */
export function convert(value, unit, system) {
    if (value == null || system !== 'imperial') return { value, unit };
    switch (unit) {
        case 'm': return { value: value * 3.28084, unit: 'ft' };
        case 'cm': return { value: value / 2.54, unit: 'in' };
        case 'm/s': return { value: value * 2.23694, unit: 'mph' };
        default: return { value, unit };
    }
}

export function heightToCm(feet, inches) {
    return (Number(feet) * 12 + Number(inches)) * 2.54;
}

export function cmToFeetInches(cm) {
    const total = cm / 2.54;
    const ft = Math.floor(total / 12);
    return { feet: ft, inches: Math.round(total - ft * 12) };
}

export function paceFromSpeed(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const secPerKm = 1000 / ms;
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, '0')} /km`;
}

/** Screen-reader text for a metric: value, unit AND confidence, never just the number. */
export function announce(metric, side) {
    const slot = side ? metric.sides[side] : (metric.combined || metric.sides.L);
    if (!slot || slot.value == null) {
        return `${metric.label}${side ? `, ${side === 'L' ? 'left' : 'right'}` : ''}: not measured. ${slot && slot.note ? slot.note : ''}`;
    }
    const unit = metric.unit === 'deg' ? 'degrees' : metric.unit;
    const ci = slot.ci95 != null ? `, plus or minus ${fmt(slot.ci95, metric.decimals)}` : '';
    return `${metric.label}${side ? `, ${side === 'L' ? 'left' : 'right'}` : ''}: `
        + `${fmt(slot.value, metric.decimals)} ${unit}${ci}. Confidence ${CONFIDENCE_COPY[slot.confidence].label.toLowerCase()}.`;
}

/** Errors say what happened and what to do next, and do not apologise. */
export const ERROR_COPY = {
    'fps-too-low': {
        title: 'This clip has too few frames per second',
        body: 'Ground contact lasts about a quarter of a second, so a 24 fps clip has six frames to describe it. Record again at 60 fps or higher — most phones offer 120 or 240 in the camera settings.'
    },
    'no-person': {
        title: 'No runner found',
        body: 'Check that the whole body stays in frame, including the feet, and that the lighting is even.'
    },
    'multiple-people': {
        title: 'More than one person in frame',
        body: 'Tap the runner you want analysed.'
    },
    'no-strides': {
        title: 'No complete stride could be measured',
        body: 'The clip needs at least a few full strides with the feet visible. Try a longer clip, or move the camera so the runner stays nearer the middle of the frame.'
    },
    'no-frames': {
        title: 'The clip could not be read',
        body: 'Try an MP4 or MOV recorded on the device. Some heavily edited or streamed files will not decode in a browser.'
    },
    'no-timebase': {
        title: 'The clip has no usable timestamps',
        body: 'Re-export or re-record it. Without frame timestamps no timing measurement is possible.'
    },
    'model-failed': {
        title: 'The pose model would not load',
        body: 'It downloads once and is then cached. Check the connection and try again; the app will fall back to a smaller model automatically.'
    },
    'decode-failed': {
        title: 'The clip could not be decoded',
        body: 'The codec may not be supported in this browser. An MP4 recorded by a phone camera is the safest input.'
    }
};

export function errorFor(code, fallbackMessage) {
    return ERROR_COPY[code] || { title: 'That did not work', body: fallbackMessage || 'Try a different clip.' };
}
