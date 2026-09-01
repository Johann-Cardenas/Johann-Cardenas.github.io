/* ============================================================
   Stride Lab — minimal test harness.

   No dependencies, matching the LEAPS and Gear3D suites: the whole
   point of a validation suite for a static app is that it runs with
   nothing but Node installed.
   ============================================================ */

'use strict';

let passed = 0;
let failed = 0;
/** @type {string[]} */
const failures = [];
let currentGroup = '';

const BOLD = '[1m', RESET = '[0m';
const GREEN = '[32m', RED = '[31m', DIM = '[2m';

export function group(name) {
    currentGroup = name;
    console.log(`\n${BOLD}${name}${RESET}`);
}

export function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ${GREEN}PASS${RESET}  ${name}`);
    } catch (err) {
        failed++;
        failures.push(`${currentGroup} :: ${name}\n        ${err.message}`);
        console.log(`  ${RED}FAIL${RESET}  ${name}`);
        console.log(`        ${RED}${err.message}${RESET}`);
    }
}

/** A note printed alongside a passing test, for numbers worth seeing. */
export function note(text) {
    console.log(`        ${DIM}${text}${RESET}`);
}

export function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

export function assertClose(actual, expected, tol, msg = '') {
    if (!Number.isFinite(actual)) throw new Error(`${msg} expected ${expected}, got non-finite ${actual}`);
    const d = Math.abs(actual - expected);
    if (d > tol) {
        throw new Error(`${msg} expected ${expected} +/- ${tol}, got ${actual} (delta ${d.toPrecision(4)})`);
    }
}

export function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) {
        throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

export function assertBetween(actual, lo, hi, msg = '') {
    if (!Number.isFinite(actual)) throw new Error(`${msg} expected ${lo}..${hi}, got non-finite ${actual}`);
    if (actual < lo || actual > hi) throw new Error(`${msg} expected ${lo}..${hi}, got ${actual}`);
}

export function assertThrows(fn, msg = '') {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw) throw new Error(`${msg} expected a throw, got none`);
}

export function summary() {
    console.log(`\n${BOLD}${passed + failed} checks — ${passed} passed, ${failed} failed${RESET}`);
    if (failed) {
        console.log(`\n${RED}${BOLD}Failures${RESET}`);
        for (const f of failures) console.log(`  - ${f}`);
        process.exitCode = 1;
    }
    return { passed, failed };
}
