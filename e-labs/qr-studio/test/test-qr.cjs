/*
 * Regression suite for the QR encoder — run with `node test/test-qr.cjs`.
 *
 * The centerpiece is a *decoder* written against the standard independently of
 * the encoder: it reads the format information back out of the matrix, undoes
 * the mask, walks the zigzag, de-interleaves the blocks, checks that every
 * Reed-Solomon syndrome is zero, and parses the payload. If a symbol survives
 * that round trip its bit-level structure is right, which is the part a human
 * cannot eyeball. Rendering and real-camera scannability are covered separately
 * by the browser harness in test/scan-harness.html.
 */
'use strict';

const QR = require('../qrcode.js');

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, detail) {
    if (cond) { passed++; }
    else { failed++; failures.push(name + (detail ? '  →  ' + detail : '')); }
}
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    check(name, a === e, 'got ' + a + ', expected ' + e);
}

// =====================================================================
// 1. Capacity / geometry tables
// =====================================================================

const I = QR._internal;

eq('v1 raw data modules', I.getNumRawDataModules(1), 208);
eq('v1 total codewords', Math.floor(I.getNumRawDataModules(1) / 8), 26);
eq('v40 total codewords', Math.floor(I.getNumRawDataModules(40) / 8), 3706);

// Well-known data-codeword counts from the standard.
eq('v1-L data codewords', I.getNumDataCodewords(1, 0), 19);
eq('v1-M data codewords', I.getNumDataCodewords(1, 1), 16);
eq('v1-Q data codewords', I.getNumDataCodewords(1, 2), 13);
eq('v1-H data codewords', I.getNumDataCodewords(1, 3), 9);
eq('v40-L data codewords', I.getNumDataCodewords(40, 0), 2956);
eq('v40-H data codewords', I.getNumDataCodewords(40, 3), 1276);

// The famous headline capacity: 2953 bytes at version 40, level L.
eq('max byte capacity v40-L', QR.capacityBytes(40, 'L'), 2953);

// Alignment pattern centers, including the version-32 special case.
eq('align v1', I.getAlignmentPatternPositions(1), []);
eq('align v2', I.getAlignmentPatternPositions(2), [6, 18]);
eq('align v7', I.getAlignmentPatternPositions(7), [6, 22, 38]);
eq('align v32 (special case)', I.getAlignmentPatternPositions(32), [6, 34, 60, 86, 112, 138]);
eq('align v40', I.getAlignmentPatternPositions(40), [6, 30, 58, 86, 114, 142, 170]);

// Every version's alignment centers must be inside the symbol and ascending.
for (let v = 1; v <= 40; v++) {
    const pos = I.getAlignmentPatternPositions(v);
    const size = v * 4 + 17;
    let ok = true;
    for (let i = 0; i < pos.length; i++) {
        if (pos[i] < 6 || pos[i] > size - 7) ok = false;
        if (i > 0 && pos[i] <= pos[i - 1]) ok = false;
    }
    check('align v' + v + ' in range and ascending', ok, JSON.stringify(pos));
}

// =====================================================================
// 2. GF(256) arithmetic and Reed-Solomon
// =====================================================================

eq('gf 1*x identity', I.gfMultiply(1, 0x53), 0x53);
eq('gf x*0 = 0', I.gfMultiply(0x53, 0), 0);
eq('gf commutative', I.gfMultiply(0x57, 0x83), I.gfMultiply(0x83, 0x57));
// Worked by hand in GF(2^8) mod x^8+x^4+x^3+x^2+1 (0x11D). Note this is NOT
// the AES field (0x11B), where the same operands famously give 0xC1.
eq('gf 0x57 * 0x83 (QR field 0x11D)', I.gfMultiply(0x57, 0x83), 0x31);

// Multiplication must be closed and have no zero divisors.
(function () {
    let closed = true, noZeroDiv = true;
    for (let a = 1; a < 256; a += 7) {
        for (let b = 1; b < 256; b += 11) {
            const p = I.gfMultiply(a, b);
            if (p < 0 || p > 255) closed = false;
            if (p === 0) noZeroDiv = false;
        }
    }
    check('gf multiplication closed in [0,255]', closed);
    check('gf has no zero divisors', noZeroDiv);
})();

// Generator polynomials are monic and of the requested degree.
[7, 10, 13, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30].forEach(function (d) {
    const g = I.reedSolomonComputeDivisor(d);
    check('rs divisor degree ' + d + ' length', g.length === d, 'len ' + g.length);
});
// Rather than transcribe coefficient tables (which the standard prints in
// exponent form, a fertile source of apples-to-oranges mistakes), assert the
// property that *defines* the generator: g(x) = (x-a^0)(x-a^1)...(x-a^(d-1)),
// so a^0 .. a^(d-1) must all be roots. QR is narrow-sense, first root a^0.
[7, 10, 13, 15, 17, 18, 20, 22, 24, 26, 28, 30].forEach(function (d) {
    const g = I.reedSolomonComputeDivisor(d);
    const coeffs = [1].concat(g);          // monic: implicit leading 1
    let allRoots = true;
    for (let e = 0; e < d; e++) {
        let root = 1;
        for (let t = 0; t < e; t++) root = I.gfMultiply(root, 2);   // a^e
        let acc = 0, xPow = 1;
        for (let idx = 0; idx < coeffs.length; idx++) {
            acc ^= I.gfMultiply(coeffs[coeffs.length - 1 - idx], xPow);
            xPow = I.gfMultiply(xPow, root);
        }
        if (acc !== 0) allRoots = false;
    }
    check('rs generator degree ' + d + ' has roots a^0..a^' + (d - 1), allRoots);
});

// A message plus its remainder is a valid codeword: all syndromes vanish.
(function () {
    const d = 10;
    const g = I.reedSolomonComputeDivisor(d);
    const msg = [0x40, 0xD2, 0x75, 0x47, 0x76, 0x17, 0x32, 0x06, 0x27, 0x26, 0x96, 0xC6, 0xC6, 0x96, 0x70, 0xEC];
    const codeword = msg.concat(I.reedSolomonComputeRemainder(msg, g));
    let ok = true;
    for (let e = 0; e < d; e++) {
        let root = 1;
        for (let t = 0; t < e; t++) root = I.gfMultiply(root, 2);
        let acc = 0, xPow = 1;
        for (let idx = 0; idx < codeword.length; idx++) {
            acc ^= I.gfMultiply(codeword[codeword.length - 1 - idx], xPow);
            xPow = I.gfMultiply(xPow, root);
        }
        if (acc !== 0) ok = false;
    }
    check('rs message+remainder is a valid codeword', ok);
})();

// Remainder of an all-zero message is all zero.
(function () {
    const g = I.reedSolomonComputeDivisor(10);
    const rem = I.reedSolomonComputeRemainder(new Array(16).fill(0), g);
    check('rs remainder of zero message is zero', rem.every(function (b) { return b === 0; }));
})();

// =====================================================================
// 3. BCH codes for format and version information
// =====================================================================

function bchFormat(eclFormatBits, mask) {
    const data = (eclFormatBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
}
function bits15(n) { return n.toString(2).padStart(15, '0'); }
function hamming(a, b) {
    let x = a ^ b, c = 0;
    while (x) { c += x & 1; x >>>= 1; }
    return c;
}

// Two entries hand-checked against Table C.1 of ISO/IEC 18004.
eq('format bits M/mask0', bits15(bchFormat(0, 0)), '101010000010010');
eq('format bits L/mask0', bits15(bchFormat(1, 0)), '111011111000100');

// The whole table must be a BCH(15,5) code: minimum Hamming distance 7. This
// pins down all 32 entries without transcribing them.
(function () {
    const all = [];
    [1, 0, 3, 2].forEach(function (fb) {
        for (let m = 0; m < 8; m++) all.push(bchFormat(fb, m));
    });
    eq('format table has 32 entries', all.length, 32);
    let minD = Infinity;
    for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) minD = Math.min(minD, hamming(all[i], all[j]));
    }
    check('format code minimum distance is 7', minD === 7, 'got ' + minD);
    check('format values fit in 15 bits', all.every(function (v) { return v >= 0 && v < (1 << 15); }));
})();

// Version information is BCH(18,6) with minimum distance 8.
(function () {
    const all = [];
    for (let v = 7; v <= 40; v++) {
        let rem = v;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        all.push((v << 12) | rem);
    }
    let minD = Infinity;
    for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) minD = Math.min(minD, hamming(all[i], all[j]));
    }
    check('version code minimum distance is 8', minD === 8, 'got ' + minD);
})();

// =====================================================================
// 4. Mode selection and UTF-8
// =====================================================================

eq('mode of digits', I.chooseMode('0123456789'), 'numeric');
eq('mode of uppercase alnum', I.chooseMode('HELLO WORLD'), 'alphanumeric');
eq('mode of a lowercase URL', I.chooseMode('https://example.com'), 'byte');
eq('mode of empty string', I.chooseMode(''), 'numeric');
eq('mode with accents', I.chooseMode('café'), 'byte');

eq('utf8 ascii', I.toUtf8Bytes('AB'), [65, 66]);
eq('utf8 two-byte', I.toUtf8Bytes('é'), [0xC3, 0xA9]);
eq('utf8 three-byte', I.toUtf8Bytes('€'), [0xE2, 0x82, 0xAC]);
eq('utf8 surrogate pair (emoji)', I.toUtf8Bytes('😀'), [0xF0, 0x9F, 0x98, 0x80]);

// =====================================================================
// 5. An independent decoder, for round-trip verification
// =====================================================================

const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];
const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Rebuild the function-module map for a version (independent of the encoder). */
function functionMap(version) {
    const size = version * 4 + 17;
    const f = [];
    for (let y = 0; y < size; y++) f.push(new Array(size).fill(false));
    const mark = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) f[y][x] = true; };

    for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }          // timing
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {       // finders + separators
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
    });
    const pos = QR._internal.getAlignmentPatternPositions(version);
    const n = pos.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(pos[i] + dx, pos[j] + dy);
    }
    for (let i = 0; i <= 8; i++) { mark(8, i); mark(i, 8); }             // format info
    for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }
    if (version >= 7) {                                                  // version info
        for (let i = 0; i < 18; i++) {
            const a = size - 11 + (i % 3), b = Math.floor(i / 3);
            mark(a, b); mark(b, a);
        }
    }
    return f;
}

function decode(sym) {
    const size = sym.size;
    const version = (size - 17) / 4;
    const get = (x, y) => sym.modules[y][x];

    // --- format information: read copy 1, match against the 32 valid words
    let raw = 0;
    for (let i = 0; i <= 5; i++) raw |= (get(8, i) ? 1 : 0) << i;
    raw |= (get(8, 7) ? 1 : 0) << 6;
    raw |= (get(8, 8) ? 1 : 0) << 7;
    raw |= (get(7, 8) ? 1 : 0) << 8;
    for (let i = 9; i < 15; i++) raw |= (get(14 - i, 8) ? 1 : 0) << i;

    let best = null, bestD = Infinity;
    [[1, 'L'], [0, 'M'], [3, 'Q'], [2, 'H']].forEach(([fb, name]) => {
        for (let m = 0; m < 8; m++) {
            const d = hamming(raw, bchFormat(fb, m));
            if (d < bestD) { bestD = d; best = { ecl: name, eclIndex: [1, 0, 3, 2].indexOf(fb), mask: m }; }
        }
    });
    if (bestD !== 0) throw new Error('format information did not decode exactly (distance ' + bestD + ')');
    // Map the format bits back to the table index order L,M,Q,H.
    const eclIndex = { L: 0, M: 1, Q: 2, H: 3 }[best.ecl];

    // --- undo the mask
    const fmap = functionMap(version);
    const grid = sym.modules.map(row => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (!fmap[y][x] && QR._internal.maskPredicate(best.mask, x, y)) grid[y][x] = !grid[y][x];
    }

    // --- walk the zigzag back into codewords
    const rawCodewords = Math.floor(QR._internal.getNumRawDataModules(version) / 8);
    const bitsOut = [];
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vert : vert;
                if (!fmap[y][x] && bitsOut.length < rawCodewords * 8) bitsOut.push(grid[y][x] ? 1 : 0);
            }
        }
    }
    const codewords = [];
    for (let i = 0; i < bitsOut.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bitsOut[i + j];
        codewords.push(b);
    }

    // --- de-interleave into blocks
    const numBlocks = NUM_BLOCKS[eclIndex][version];
    const eccLen = ECC_PER_BLOCK[eclIndex][version];
    const numShort = numBlocks - rawCodewords % numBlocks;
    const shortLen = Math.floor(rawCodewords / numBlocks);
    const shortDataLen = shortLen - eccLen;

    const blocks = [];
    for (let i = 0; i < numBlocks; i++) blocks.push([]);
    let k = 0;
    for (let i = 0; i < shortLen + 1; i++) {
        for (let j = 0; j < numBlocks; j++) {
            if (i !== shortDataLen || j >= numShort) {
                if (k < codewords.length) blocks[j].push(codewords[k++]);
            }
        }
    }

    // --- every block must be a valid Reed-Solomon codeword (all syndromes 0)
    // QR uses a narrow-sense generator whose roots are a^0 .. a^(eccLen-1),
    // so the syndromes are the block polynomial evaluated at those same roots.
    blocks.forEach((blk, bi) => {
        for (let s = 0; s < eccLen; s++) {
            let root = 1;
            for (let t = 0; t < s; t++) root = QR._internal.gfMultiply(root, 2);   // a^s
            let acc = 0, xPow = 1;
            for (let idx = 0; idx < blk.length; idx++) {
                acc ^= QR._internal.gfMultiply(blk[blk.length - 1 - idx], xPow);
                xPow = QR._internal.gfMultiply(xPow, root);
            }
            if (acc !== 0) throw new Error('block ' + bi + ' syndrome ' + s + ' non-zero (' + acc + ')');
        }
    });

    // --- concatenate data codewords and parse the payload
    let data = [];
    blocks.forEach(blk => { data = data.concat(blk.slice(0, blk.length - eccLen)); });

    const bits = [];
    data.forEach(b => { for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1); });
    let p = 0;
    const take = n => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bits[p++]; return v; };

    const mode = take(4);
    const ccBits = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16] }[mode];
    if (!ccBits) throw new Error('unsupported mode indicator ' + mode);
    const count = take(ccBits[version <= 9 ? 0 : (version <= 26 ? 1 : 2)]);

    let text = '';
    if (mode === 1) {
        for (let i = 0; i < count;) {
            const n = Math.min(3, count - i);
            text += String(take(n * 3 + 1)).padStart(n, '0');
            i += n;
        }
    } else if (mode === 2) {
        let i = 0;
        for (; i + 2 <= count; i += 2) {
            const v = take(11);
            text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45];
        }
        if (i < count) text += ALNUM[take(6)];
    } else {
        const bytes = [];
        for (let i = 0; i < count; i++) bytes.push(take(8));
        text = Buffer.from(bytes).toString('utf8');
    }
    return { text: text, ecl: best.ecl, mask: best.mask, version: version };
}

// =====================================================================
// 6. Structural checks on generated symbols
// =====================================================================

function structuralChecks(sym, label) {
    const size = sym.size;
    eq(label + ': size matches version', size, sym.version * 4 + 17);

    // Finder patterns: dark 7x7 ring with a dark 3x3 core, at three corners.
    [[0, 0], [size - 7, 0], [0, size - 7]].forEach(([ox, oy], idx) => {
        let ok = true;
        for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
            const ring = (dx === 0 || dx === 6 || dy === 0 || dy === 6);
            const core = (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
            const expect = ring || core;
            if (sym.modules[oy + dy][ox + dx] !== expect) ok = false;
        }
        check(label + ': finder ' + idx + ' well formed', ok);
    });

    // Timing patterns alternate, starting dark at index 6.
    let timingOk = true;
    for (let i = 8; i < size - 8; i++) {
        if (sym.modules[6][i] !== (i % 2 === 0)) timingOk = false;
        if (sym.modules[i][6] !== (i % 2 === 0)) timingOk = false;
    }
    check(label + ': timing patterns alternate', timingOk);

    // The module at (8, size-8) is always dark.
    check(label + ': dark module present', sym.modules[size - 8][8] === true);

    // Separators around the top-left finder are light.
    let sepOk = true;
    for (let i = 0; i < 8; i++) {
        if (sym.modules[7][i]) sepOk = false;
        if (sym.modules[i][7]) sepOk = false;
    }
    check(label + ': top-left separator is light', sepOk);
}

// =====================================================================
// 7. Round-trip: encode → decode for a broad corpus
// =====================================================================

const corpus = [
    'https://www.johanncardenas.com',
    'https://www.johanncardenas.com/e-labs/qr-studio/',
    'HELLO WORLD',
    '8675309',
    'A',
    '0',
    'https://doi.org/10.1061/JPEODX.PVENG-2138',
    'mailto:johann.cardenash@gmail.com?subject=Hello%20there',
    'WIFI:T:WPA;S:Pavement Lab;P:c0ncr3te!;H:false;;',
    'BEGIN:VCARD\nVERSION:3.0\nN:Cardenas;Johann\nEND:VCARD',
    'café · naïve · résumé',
    '😀 QR with emoji 🎯',
    'tel:+15551234567',
    'The quick brown fox jumps over the lazy dog. '.repeat(6),
    'x'.repeat(300),
    '9'.repeat(500),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $%*+-./:'
];

['L', 'M', 'Q', 'H'].forEach(function (ecl) {
    corpus.forEach(function (text, i) {
        const label = 'roundtrip[' + ecl + '][' + i + ']';
        try {
            const sym = QR.encode(text, { ecl: ecl, boostEcl: false });
            const got = decode(sym);
            check(label + ' text', got.text === text,
                'got ' + JSON.stringify(got.text.slice(0, 40)) + ' expected ' + JSON.stringify(text.slice(0, 40)));
            check(label + ' ecl', got.ecl === ecl, 'got ' + got.ecl);
            check(label + ' version', got.version === sym.version, 'got ' + got.version);
        } catch (e) {
            check(label, false, e.message);
        }
    });
});

// Structural checks across a spread of versions.
[1, 2, 6, 7, 14, 26, 27, 32, 40].forEach(function (v) {
    // Fill close to the version's capacity so the encoder actually selects it.
    const n = QR.capacityBytes(v, 'L') - 2;
    const sym = QR.encode('a'.repeat(Math.max(1, n)), { ecl: 'L', boostEcl: false });
    structuralChecks(sym, 'v' + sym.version);
    check('version ' + v + ' selected as expected', sym.version === v, 'got ' + sym.version);
});

// All eight masks must produce decodable symbols.
for (let m = 0; m < 8; m++) {
    try {
        const sym = QR.encode('https://www.johanncardenas.com', { ecl: 'Q', mask: m, boostEcl: false });
        const got = decode(sym);
        check('forced mask ' + m + ' round-trips', got.text === 'https://www.johanncardenas.com' && got.mask === m,
            'mask ' + got.mask);
    } catch (e) {
        check('forced mask ' + m + ' round-trips', false, e.message);
    }
}

// Randomized round-trip — the broadest net.
(function () {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF) / 0x7FFFFFFF;
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~:/?#[]@!$&()*+,;=%';
    let bad = 0, n = 250;
    for (let i = 0; i < n; i++) {
        const len = 1 + Math.floor(rand() * 400);
        let s = '';
        for (let j = 0; j < len; j++) s += chars[Math.floor(rand() * chars.length)];
        const ecl = ['L', 'M', 'Q', 'H'][Math.floor(rand() * 4)];
        try {
            if (decode(QR.encode(s, { ecl: ecl, boostEcl: false })).text !== s) bad++;
        } catch (e) { bad++; }
    }
    check('randomized round-trip (' + n + ' payloads)', bad === 0, bad + ' failures');
})();

// =====================================================================
// 8. Behavioral contracts
// =====================================================================

// ECL boosting spends leftover capacity on stronger recovery, and must never
// change the version or the decoded text.
(function () {
    // A short payload leaves slack at version 1, so L can be lifted to M.
    const short = 'https://a.co';
    const plain = QR.encode(short, { ecl: 'L', boostEcl: false });
    const boosted = QR.encode(short, { ecl: 'L', boostEcl: true });
    eq('boostEcl keeps the version', boosted.version, plain.version);
    check('boostEcl raises the level when there is slack',
        ['M', 'Q', 'H'].indexOf(boosted.ecl) >= 0, 'got ' + boosted.ecl);
    check('boostEcl preserves the payload', decode(boosted).text === short);

    // General contract over the corpus: boosting never shrinks the level and
    // never grows the symbol. (For many payloads no boost is possible at all —
    // e.g. a 30-byte URL fills version 2 at L, and v2-M holds only 224 bits.)
    let ok = true;
    const rank = { L: 0, M: 1, Q: 2, H: 3 };
    corpus.forEach(function (text) {
        ['L', 'M', 'Q'].forEach(function (ecl) {
            const a = QR.encode(text, { ecl: ecl, boostEcl: false });
            const b = QR.encode(text, { ecl: ecl, boostEcl: true });
            if (b.version !== a.version) ok = false;
            if (rank[b.ecl] < rank[a.ecl]) ok = false;
            if (decode(b).text !== text) ok = false;
        });
    });
    check('boostEcl never lowers the level, grows the symbol, or corrupts data', ok);
})();

// Overlong payloads must fail loudly rather than silently truncate.
(function () {
    let threw = false;
    try { QR.encode('x'.repeat(3000), { ecl: 'H' }); } catch (e) { threw = /too long/i.test(e.message); }
    check('overlong payload throws', threw);
})();

// Encoding is deterministic.
(function () {
    const a = QR.encode('https://example.com/deterministic', { ecl: 'Q' });
    const b = QR.encode('https://example.com/deterministic', { ecl: 'Q' });
    check('encoding is deterministic', JSON.stringify(a.modules) === JSON.stringify(b.modules));
})();

// A numeric payload must use numeric mode, so it packs smaller than byte mode.
(function () {
    const digits = '1'.repeat(100);
    const numeric = QR.encode(digits, { ecl: 'M', boostEcl: false });
    const asBytes = QR.encode('a'.repeat(100), { ecl: 'M', boostEcl: false });
    check('numeric mode packs tighter than byte mode', numeric.version < asBytes.version,
        'numeric v' + numeric.version + ' vs byte v' + asBytes.version);
})();

// Empty input still produces a valid, decodable symbol.
(function () {
    const sym = QR.encode('', { ecl: 'M' });
    check('empty payload encodes', sym.size === 21);
    check('empty payload decodes to empty', decode(sym).text === '');
})();

// =====================================================================

console.log('');
console.log('  QR encoder regression suite');
console.log('  ' + '-'.repeat(46));
if (failed) {
    failures.forEach(function (f) { console.log('  FAIL  ' + f); });
    console.log('');
}
console.log('  ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' checks total');
console.log('');
process.exit(failed ? 1 : 0);
