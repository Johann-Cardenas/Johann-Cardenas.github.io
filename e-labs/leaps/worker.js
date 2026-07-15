/* LEAPS solver worker — wraps the LEAF-JS engine off the main thread */
'use strict';
importScripts('solver.js');

var SELF_TEST = null;

onmessage = function (e) {
    var msg = e.data || {};
    if (msg.type === 'hello') {
        if (!SELF_TEST) SELF_TEST = LEAPS.selfTest();
        postMessage({ type: 'ready', version: LEAPS.version, selfTest: SELF_TEST });
        return;
    }
    if (msg.type === 'solve') {
        try {
            var res = LEAPS.solve(msg.job, function (p) {
                postMessage({ type: 'progress', id: msg.id, kind: msg.kind, p: p });
            });
            postMessage({ type: 'done', id: msg.id, kind: msg.kind, gen: msg.gen, res: res });
        } catch (err) {
            postMessage({ type: 'error', id: msg.id, kind: msg.kind, gen: msg.gen, message: String(err && err.message || err) });
        }
    }
};
