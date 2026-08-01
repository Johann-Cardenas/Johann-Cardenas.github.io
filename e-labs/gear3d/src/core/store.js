/* ============================================================
   Gear3D — observable document store
   ------------------------------------------------------------
   The application state is a single document tree plus a handful
   of view flags. That does not need a framework; it needs an
   object you can subscribe to and a history stack.

   Two separate concerns live here on purpose:

     doc    the unit being examined, its customizations, seed,
            annotations. Changes to `doc` are UNDOABLE and are
            what gets written to a .gear3d file.

     view   camera state, view mode, isolation, dimension toggles,
            lighting, background, display units. NOT undoable —
            undoing a camera nudge is never what a user wants —
            but still persisted in the project file so a figure
            reopens exactly as it was saved.
   ============================================================ */

'use strict';

/** Maximum undo depth. */
const HISTORY_LIMIT = 60;

/**
 * @template T
 * @typedef {(state: T, meta: {path?: string, reason?: string}) => void} Listener
 */

export class Store {
    /**
     * @param {object} initialDoc
     * @param {object} initialView
     */
    constructor(initialDoc, initialView) {
        /** @type {object} */
        this.doc = initialDoc;
        /** @type {object} */
        this.view = initialView;
        /** @type {object[]} */
        this._undo = [];
        /** @type {object[]} */
        this._redo = [];
        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();
        this._batching = false;
        this._batchDirty = new Set();
    }

    /* ---------------- subscription ---------------- */

    /**
     * Subscribe to a channel. Channels are coarse on purpose:
     * 'doc', 'view', 'selection', 'any'.
     * @param {string} channel
     * @param {Function} fn
     * @returns {() => void} unsubscribe
     */
    on(channel, fn) {
        if (!this._listeners.has(channel)) this._listeners.set(channel, new Set());
        this._listeners.get(channel).add(fn);
        return () => this._listeners.get(channel).delete(fn);
    }

    /**
     * @param {string} channel
     * @param {object} [meta]
     */
    emit(channel, meta = {}) {
        if (this._batching) { this._batchDirty.add(channel); return; }
        const set = this._listeners.get(channel);
        if (set) for (const fn of set) fn(this, meta);
        const any = this._listeners.get('any');
        if (any && channel !== 'any') for (const fn of any) fn(this, { ...meta, channel });
    }

    /**
     * Coalesce a burst of changes into one notification per channel.
     * @param {() => void} fn
     */
    batch(fn) {
        const wasBatching = this._batching;
        this._batching = true;
        try { fn(); } finally {
            if (!wasBatching) {
                this._batching = false;
                const dirty = Array.from(this._batchDirty);
                this._batchDirty.clear();
                for (const ch of dirty) this.emit(ch);
            }
        }
    }

    /* ---------------- document mutation ---------------- */

    /**
     * Apply an undoable change to the document.
     * @param {(doc: object) => void} mutator
     * @param {string} reason short label shown in the status strip
     */
    update(mutator, reason = 'change') {
        this._undo.push(structuredClone(this.doc));
        if (this._undo.length > HISTORY_LIMIT) this._undo.shift();
        this._redo.length = 0;
        mutator(this.doc);
        this.emit('doc', { reason });
    }

    /**
     * Replace the whole document (open a project, load a unit, reset).
     * @param {object} doc
     * @param {string} reason
     */
    replaceDoc(doc, reason = 'load') {
        this._undo.push(structuredClone(this.doc));
        this._redo.length = 0;
        this.doc = doc;
        this.emit('doc', { reason });
    }

    /**
     * Change view state. Not undoable.
     * @param {(view: object) => void} mutator
     * @param {string} [reason]
     */
    updateView(mutator, reason = 'view') {
        mutator(this.view);
        this.emit('view', { reason });
    }

    /** @returns {boolean} whether anything was undone */
    undo() {
        if (this._undo.length === 0) return false;
        this._redo.push(structuredClone(this.doc));
        this.doc = this._undo.pop();
        this.emit('doc', { reason: 'undo' });
        return true;
    }

    /** @returns {boolean} whether anything was redone */
    redo() {
        if (this._redo.length === 0) return false;
        this._undo.push(structuredClone(this.doc));
        this.doc = this._redo.pop();
        this.emit('doc', { reason: 'redo' });
        return true;
    }

    /** @returns {boolean} */
    canUndo() { return this._undo.length > 0; }
    /** @returns {boolean} */
    canRedo() { return this._redo.length > 0; }

    /** Discard history without touching the document. */
    clearHistory() { this._undo.length = 0; this._redo.length = 0; }
}

/**
 * Read a dotted path from an object.
 * @param {object} obj
 * @param {string} path e.g. 'axles.2.trackWidth'
 * @returns {*}
 */
export function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/**
 * Write a dotted path into an object, creating intermediate objects.
 * @param {object} obj
 * @param {string} path
 * @param {*} value
 */
export function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let cur = obj;
    for (const k of keys) {
        if (cur[k] == null) cur[k] = {};
        cur = cur[k];
    }
    cur[last] = value;
}
