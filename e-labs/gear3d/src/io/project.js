/* ============================================================
   Gear3D — project files
   ------------------------------------------------------------
   A .gear3d file is the whole reproducible state of a figure:
   the unit (including every customization), the seed, the camera
   state for all four view modes, lighting, background, dimension
   toggles, annotation positions and display units.

   It carries a schema version and refuses to silently load a
   newer one. A figure that reopens subtly different from how it
   was saved is worse than one that refuses to open.
   ============================================================ */

'use strict';

import { SCHEMA_VERSION } from '../core/schema.js';
import { APP_NAME, APP_VERSION } from '../core/version.js';

export const PROJECT_FORMAT = 'gear3d-project';
export const PROJECT_VERSION = '1.0';

/**
 * @param {object} state
 * @returns {string}
 */
export function serializeProject(state) {
    return JSON.stringify({
        format: PROJECT_FORMAT,
        formatVersion: PROJECT_VERSION,
        unitSchemaVersion: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        app: { name: APP_NAME, version: APP_VERSION },

        meta: state.meta || {},
        seed: state.seed,
        unit: state.unit,
        modifiedFrom: state.modifiedFrom || null,

        // The whole view block, not a re-listed subset.
        //
        // This used to enumerate the fields again, duplicating the list the
        // caller had already assembled. Every view flag added after that was
        // written in one place and dropped in the other — `annotations`,
        // `showGrid` and the material overrides were all silently lost on
        // save, so switching the grid off and reopening quietly switched it
        // back on. Two whitelists for one object is a bug generator; the
        // caller is the single authority on what the view state is.
        view: { ...state.view },

        contact: state.contact || {},
        customDimensions: state.customDimensions || [],
        calloutOffsets: state.calloutOffsets || {}
    }, null, 2);
}

/**
 * @param {string} text
 * @returns {object}
 * @throws {Error} on a wrong or newer format
 */
export function parseProject(text) {
    /** @type {any} */
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error('That file is not valid JSON, so it is not a Gear3D project.');
    }
    if (json.format !== PROJECT_FORMAT) {
        throw new Error(
            `That file is not a Gear3D project (found format "${json.format ?? 'none'}").`
        );
    }
    const major = (v) => parseInt(String(v).split('.')[0], 10);
    if (major(json.formatVersion) > major(PROJECT_VERSION)) {
        throw new Error(
            `This project was saved by a newer version of Gear3D (format ${json.formatVersion}, `
            + `this build reads ${PROJECT_VERSION}). Update the app rather than risk loading it `
            + 'partially.'
        );
    }
    if (!json.unit) throw new Error('The project file contains no unit definition.');
    return json;
}

/**
 * Export the current unit on its own, so a customized configuration can be
 * shared or checked into a repository next to the figure it produced.
 * @param {object} unit
 * @returns {string}
 */
export function serializeUnit(unit) {
    return JSON.stringify(unit, null, 2);
}

/* ---------------- browser file helpers ---------------- */

/**
 * @param {Blob|string} data
 * @param {string} filename
 * @param {string} [mime]
 */
export function download(data, filename, mime = 'application/octet-stream') {
    const blob = typeof data === 'string' ? new Blob([data], { type: mime + ';charset=utf-8' }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick; revoking synchronously can cancel the download
    // in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileText(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        r.readAsText(file);
    });
}

/**
 * Build a filename stem from a unit, safe on every filesystem.
 * @param {object} unit
 * @param {string} [suffix]
 * @returns {string}
 */
export function filenameFor(unit, suffix = '') {
    const base = (unit?.id || 'gear3d')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return suffix ? `${base}-${suffix}` : base;
}

/* ---------------- autosave ---------------- */

const AUTOSAVE_KEY = 'gear3d-autosave';

/** @param {object} state */
export function autosave(state) {
    try {
        localStorage.setItem(AUTOSAVE_KEY, serializeProject(state));
    } catch {
        // Quota or private mode. Autosave is a convenience, never a
        // correctness requirement, so a failure here is not worth an alert.
    }
}

/** @returns {object|null} */
export function loadAutosave() {
    try {
        const t = localStorage.getItem(AUTOSAVE_KEY);
        return t ? parseProject(t) : null;
    } catch {
        return null;
    }
}

export function clearAutosave() {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
}
