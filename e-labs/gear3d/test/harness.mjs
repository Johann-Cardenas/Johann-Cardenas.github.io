/* ============================================================
   Gear3D — minimal test harness
   ------------------------------------------------------------
   No dependencies, matching the LEAPS test suite's approach:
   the whole point of a validation suite for a static app is that
   it runs with nothing but Node installed.
   ============================================================ */

'use strict';

let passed = 0;
let failed = 0;
/** @type {string[]} */
const failures = [];
let currentGroup = '';

/** @param {string} name */
export function group(name) {
    currentGroup = name;
    console.log(`\n[1m${name}[0m`);
}

/**
 * @param {string} name
 * @param {() => void} fn
 */
export function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  [32mPASS[0m  ${name}`);
    } catch (err) {
        failed++;
        const msg = `${currentGroup} :: ${name}\n        ${/** @type {Error} */(err).message}`;
        failures.push(msg);
        console.log(`  [31mFAIL[0m  ${name}`);
        console.log(`        [31m${/** @type {Error} */(err).message}[0m`);
    }
}

/**
 * @param {boolean} cond
 * @param {string} msg
 */
export function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} tol
 * @param {string} [msg]
 */
export function assertClose(actual, expected, tol, msg = '') {
    if (!Number.isFinite(actual)) throw new Error(`${msg} expected ${expected}, got non-finite ${actual}`);
    const d = Math.abs(actual - expected);
    if (d > tol) {
        throw new Error(`${msg} expected ${expected} +/- ${tol}, got ${actual} (delta ${d.toPrecision(4)})`);
    }
}

/**
 * @param {*} actual
 * @param {*} expected
 * @param {string} [msg]
 */
export function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * @param {() => void} fn
 * @param {string} [msg]
 */
export function assertThrows(fn, msg = '') {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw) throw new Error(`${msg} expected a throw, got none`);
}

/** @returns {number} process exit code */
export function summary() {
    const total = passed + failed;
    console.log(`\n${'-'.repeat(58)}`);
    if (failed === 0) {
        console.log(`[32m${passed}/${total} checks passed.[0m`);
    } else {
        console.log(`[31m${failed} of ${total} checks FAILED:[0m`);
        for (const f of failures) console.log(`  - ${f}`);
    }
    console.log('');
    return failed === 0 ? 0 : 1;
}
