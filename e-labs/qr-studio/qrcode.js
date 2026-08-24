/*!
 * qrcode.js — QR Code encoder (ISO/IEC 18004)
 *
 * A dependency-free implementation of the QR symbol pipeline: segment encoding,
 * Reed-Solomon error correction over GF(256), block interleaving, function
 * pattern placement, data masking with penalty scoring, and BCH-protected
 * format/version information.
 *
 * The module is UMD so the very same code runs three ways:
 *   - in the browser as `window.QRCodeEngine`
 *   - inside a Web Worker
 *   - under Node for the regression suite in test/test-qr.cjs
 *
 * Coordinate convention: modules[y][x], origin top-left, x to the right and
 * y downward. `true` means a dark module.
 *
 * The block-geometry tables follow Project Nayuki's formulation: rather than
 * transcribing ~500 magic numbers of the standard's block table, only the two
 * short tables below are stored and the short/long block split is derived.
 * Fewer hand-entered numbers means fewer places to be silently wrong.
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.QRCodeEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---------------------------------------------------------------- tables

    // Error correction levels, in the order used to index the tables below.
    // NOTE: the numeric values are the *format* bits, which are deliberately
    // not in L,M,Q,H order — that is a property of the standard, not a typo.
    var ECL = {
        L: { index: 0, formatBits: 1, name: 'L', recovery: 0.07 },
        M: { index: 1, formatBits: 0, name: 'M', recovery: 0.15 },
        Q: { index: 2, formatBits: 3, name: 'Q', recovery: 0.25 },
        H: { index: 3, formatBits: 2, name: 'H', recovery: 0.30 }
    };

    var MIN_VERSION = 1;
    var MAX_VERSION = 40;

    // ECC codewords per block, indexed [eclIndex][version]. Index 0 is unused.
    var ECC_CODEWORDS_PER_BLOCK = [
        [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
        [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
    ];

    // Number of error correction blocks, indexed [eclIndex][version].
    var NUM_ERROR_CORRECTION_BLOCKS = [
        [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
        [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
        [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
        [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
    ];

    var ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

    var PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

    // ------------------------------------------------------------- utilities

    function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

    function assert(cond, msg) { if (!cond) throw new Error('qrcode: ' + msg); }

    /**
     * Total number of data+ECC modules for a version, i.e. every module that is
     * not part of a function pattern or format/version information.
     */
    function getNumRawDataModules(ver) {
        assert(ver >= MIN_VERSION && ver <= MAX_VERSION, 'version out of range');
        var result = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            var numAlign = Math.floor(ver / 7) + 2;
            result -= (25 * numAlign - 10) * numAlign - 55;
            if (ver >= 7) result -= 36;
        }
        return result;
    }

    /** Number of 8-bit data codewords (excluding ECC) available at ver/ecl. */
    function getNumDataCodewords(ver, eclIndex) {
        return Math.floor(getNumRawDataModules(ver) / 8)
            - ECC_CODEWORDS_PER_BLOCK[eclIndex][ver]
            * NUM_ERROR_CORRECTION_BLOCKS[eclIndex][ver];
    }

    /** Centre coordinates of the alignment patterns for a version. */
    function getAlignmentPatternPositions(ver) {
        if (ver === 1) return [];
        var numAlign = Math.floor(ver / 7) + 2;
        // v32 is the one version where the general formula does not hold.
        var step = (ver === 32) ? 26
            : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
        var result = [6];
        for (var pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
        return result;
    }

    // ------------------------------------------------------- GF(256) / Reed-Solomon

    // Multiplication in GF(2^8) with the QR primitive polynomial x^8+x^4+x^3+x^2+1.
    function gfMultiply(x, y) {
        var z = 0;
        for (var i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11D);
            z ^= ((y >>> i) & 1) * x;
        }
        return z & 0xFF;
    }

    /** Coefficients of the divisor polynomial (x-a^0)(x-a^1)...(x-a^(n-1)). */
    function reedSolomonComputeDivisor(degree) {
        assert(degree >= 1 && degree <= 255, 'degree out of range');
        var result = [];
        for (var i = 0; i < degree - 1; i++) result.push(0);
        result.push(1);
        var root = 1;
        for (var i = 0; i < degree; i++) {
            for (var j = 0; j < result.length; j++) {
                result[j] = gfMultiply(result[j], root);
                if (j + 1 < result.length) result[j] ^= result[j + 1];
            }
            root = gfMultiply(root, 0x02);
        }
        return result;
    }

    /** Remainder of data polynomial divided by the divisor — the ECC bytes. */
    function reedSolomonComputeRemainder(data, divisor) {
        var result = divisor.map(function () { return 0; });
        for (var i = 0; i < data.length; i++) {
            var factor = (data[i] ^ result.shift()) & 0xFF;
            result.push(0);
            for (var j = 0; j < divisor.length; j++) result[j] ^= gfMultiply(divisor[j], factor);
        }
        return result;
    }

    // ------------------------------------------------------------ bit buffer

    function BitBuffer() { this.bits = []; }
    BitBuffer.prototype.appendBits = function (val, len) {
        assert(len >= 0 && len <= 31 && val >>> len === 0, 'value out of range for ' + len + ' bits');
        for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
    };
    BitBuffer.prototype.length = function () { return this.bits.length; };

    // -------------------------------------------------------------- segments

    function isNumeric(str) { return /^[0-9]*$/.test(str); }
    function isAlphanumeric(str) { return /^[A-Z0-9 $%*+\-./:]*$/.test(str); }

    /** UTF-8 encode a JS string to an array of byte values. */
    function toUtf8Bytes(str) {
        var out = [];
        // encodeURIComponent gives us well-defined UTF-8 including surrogate pairs.
        var esc = encodeURIComponent(str);
        for (var i = 0; i < esc.length; i++) {
            if (esc.charAt(i) !== '%') {
                out.push(esc.charCodeAt(i));
            } else {
                out.push(parseInt(esc.substring(i + 1, i + 3), 16));
                i += 2;
            }
        }
        return out;
    }

    /**
     * Choose the single most compact mode able to represent the whole string.
     *
     * Mixed-mode segmentation could occasionally save a few bits, but a single
     * segment is what virtually every reader is exercised against, and for URLs
     * (the dominant case here) byte mode is chosen anyway because the scheme is
     * lowercase. Note we never upper-case a URL to reach alphanumeric mode:
     * paths are case-sensitive and that would corrupt the payload.
     */
    function chooseMode(text) {
        if (isNumeric(text)) return 'numeric';
        if (isAlphanumeric(text)) return 'alphanumeric';
        return 'byte';
    }

    var MODE_INDICATOR = { numeric: 1, alphanumeric: 2, byte: 4 };
    var MODE_CHAR_COUNT_BITS = {
        numeric: [10, 12, 14],
        alphanumeric: [9, 11, 13],
        byte: [8, 16, 16]
    };

    function charCountBits(mode, ver) {
        var i = ver <= 9 ? 0 : (ver <= 26 ? 1 : 2);
        return MODE_CHAR_COUNT_BITS[mode][i];
    }

    /** Number of data bits (excluding the char-count indicator) for a payload. */
    function dataBitLength(mode, text, bytes) {
        if (mode === 'numeric') {
            var n = text.length;
            return 10 * Math.floor(n / 3) + (n % 3 === 1 ? 4 : (n % 3 === 2 ? 7 : 0));
        }
        if (mode === 'alphanumeric') {
            var n = text.length;
            return 11 * Math.floor(n / 2) + (n % 2) * 6;
        }
        return bytes.length * 8;
    }

    function charCount(mode, text, bytes) {
        return mode === 'byte' ? bytes.length : text.length;
    }

    function appendPayload(bb, mode, text, bytes) {
        var i;
        if (mode === 'numeric') {
            for (i = 0; i < text.length;) {
                var n = Math.min(3, text.length - i);
                bb.appendBits(parseInt(text.substring(i, i + n), 10), n * 3 + 1);
                i += n;
            }
        } else if (mode === 'alphanumeric') {
            for (i = 0; i + 2 <= text.length; i += 2) {
                var v = ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45
                    + ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1));
                bb.appendBits(v, 11);
            }
            if (i < text.length) bb.appendBits(ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6);
        } else {
            for (i = 0; i < bytes.length; i++) bb.appendBits(bytes[i], 8);
        }
    }

    // ---------------------------------------------------------------- symbol

    function QRSymbol(version, eclKey, modules, isFunction, mask) {
        this.version = version;
        this.ecl = eclKey;
        this.mask = mask;
        this.size = modules.length;
        this.modules = modules;
        this.isFunction = isFunction;
    }
    QRSymbol.prototype.get = function (x, y) {
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
        return this.modules[y][x];
    };

    function newGrid(size, fill) {
        var g = new Array(size);
        for (var y = 0; y < size; y++) {
            g[y] = new Array(size);
            for (var x = 0; x < size; x++) g[y][x] = fill;
        }
        return g;
    }

    // --------------------------------------------------- function patterns

    function setFunctionModule(st, x, y, isDark) {
        if (x < 0 || y < 0 || x >= st.size || y >= st.size) return;
        st.modules[y][x] = isDark;
        st.isFunction[y][x] = true;
    }

    function drawFinderPattern(st, cx, cy) {
        for (var dy = -4; dy <= 4; dy++) {
            for (var dx = -4; dx <= 4; dx++) {
                var dist = Math.max(Math.abs(dx), Math.abs(dy));
                setFunctionModule(st, cx + dx, cy + dy, dist !== 2 && dist !== 4);
            }
        }
    }

    function drawAlignmentPattern(st, cx, cy) {
        for (var dy = -2; dy <= 2; dy++) {
            for (var dx = -2; dx <= 2; dx++) {
                setFunctionModule(st, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
    }

    function drawFormatBits(st, mask) {
        var data = (st.eclFormatBits << 3) | mask;             // 5 bits
        var rem = data;
        for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        var bits = ((data << 10) | rem) ^ 0x5412;              // BCH(15,5), then mask

        // Copy 1 — around the top-left finder.
        for (var i = 0; i <= 5; i++) setFunctionModule(st, 8, i, getBit(bits, i));
        setFunctionModule(st, 8, 7, getBit(bits, 6));
        setFunctionModule(st, 8, 8, getBit(bits, 7));
        setFunctionModule(st, 7, 8, getBit(bits, 8));
        for (var i = 9; i < 15; i++) setFunctionModule(st, 14 - i, 8, getBit(bits, i));

        // Copy 2 — split between the other two finders.
        for (var i = 0; i < 8; i++) setFunctionModule(st, st.size - 1 - i, 8, getBit(bits, i));
        for (var i = 8; i < 15; i++) setFunctionModule(st, 8, st.size - 15 + i, getBit(bits, i));
        setFunctionModule(st, 8, st.size - 8, true);           // the always-dark module
    }

    function drawVersionBits(st) {
        if (st.version < 7) return;
        var rem = st.version;
        for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        var bits = (st.version << 12) | rem;                   // BCH(18,6)
        for (var i = 0; i < 18; i++) {
            var bit = getBit(bits, i);
            var a = st.size - 11 + (i % 3);
            var b = Math.floor(i / 3);
            setFunctionModule(st, a, b, bit);
            setFunctionModule(st, b, a, bit);
        }
    }

    function drawFunctionPatterns(st) {
        var size = st.size;
        for (var i = 0; i < size; i++) {          // timing patterns
            setFunctionModule(st, 6, i, i % 2 === 0);
            setFunctionModule(st, i, 6, i % 2 === 0);
        }
        drawFinderPattern(st, 3, 3);
        drawFinderPattern(st, size - 4, 3);
        drawFinderPattern(st, 3, size - 4);

        var pos = getAlignmentPatternPositions(st.version);
        var n = pos.length;
        for (var i = 0; i < n; i++) {
            for (var j = 0; j < n; j++) {
                // Skip the three that would collide with the finder patterns.
                if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
                drawAlignmentPattern(st, pos[i], pos[j]);
            }
        }

        drawFormatBits(st, 0);   // placeholder; rewritten once the mask is chosen
        drawVersionBits(st);
    }

    // ------------------------------------------------ codewords & placement

    function addEccAndInterleave(st, data) {
        var ver = st.version, ecl = st.eclIndex;
        var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
        var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
        var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
        var numShortBlocks = numBlocks - rawCodewords % numBlocks;
        var shortBlockLen = Math.floor(rawCodewords / numBlocks);
        var shortBlockDataLen = shortBlockLen - blockEccLen;

        assert(data.length === getNumDataCodewords(ver, ecl), 'internal: data length mismatch');

        var divisor = reedSolomonComputeDivisor(blockEccLen);
        var blocks = [];
        for (var i = 0, k = 0; i < numBlocks; i++) {
            var len = shortBlockDataLen + (i < numShortBlocks ? 0 : 1);
            var dat = data.slice(k, k + len);
            k += len;
            var ecc = reedSolomonComputeRemainder(dat, divisor);
            // Short blocks keep a one-byte hole at shortBlockDataLen so every
            // block array is the same length; the hole is skipped on interleave.
            var block = dat.slice();
            while (block.length < shortBlockLen + 1 - blockEccLen) block.push(0);
            blocks.push(block.concat(ecc));
        }

        var result = [];
        for (var i = 0; i < blocks[0].length; i++) {
            for (var j = 0; j < blocks.length; j++) {
                if (i !== shortBlockDataLen || j >= numShortBlocks) result.push(blocks[j][i]);
            }
        }
        assert(result.length === rawCodewords, 'internal: interleave length mismatch');
        return result;
    }

    function drawCodewords(st, data) {
        var size = st.size, i = 0;
        for (var right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;                 // the vertical timing column
            for (var vert = 0; vert < size; vert++) {
                for (var j = 0; j < 2; j++) {
                    var x = right - j;
                    var upward = ((right + 1) & 2) === 0;
                    var y = upward ? size - 1 - vert : vert;
                    if (!st.isFunction[y][x] && i < data.length * 8) {
                        st.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
                        i++;
                    }
                }
            }
        }
        assert(i === data.length * 8, 'internal: not all codeword bits placed');
    }

    function maskPredicate(mask, x, y) {
        switch (mask) {
            case 0: return (x + y) % 2 === 0;
            case 1: return y % 2 === 0;
            case 2: return x % 3 === 0;
            case 3: return (x + y) % 3 === 0;
            case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            case 5: return (x * y) % 2 + (x * y) % 3 === 0;
            case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
            case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
            default: throw new Error('qrcode: bad mask ' + mask);
        }
    }

    /** XOR the mask over every non-function module. Applying twice undoes it. */
    function applyMask(st, mask) {
        for (var y = 0; y < st.size; y++) {
            for (var x = 0; x < st.size; x++) {
                if (!st.isFunction[y][x] && maskPredicate(mask, x, y)) st.modules[y][x] = !st.modules[y][x];
            }
        }
    }

    function getPenaltyScore(st) {
        var size = st.size, result = 0, x, y;

        // Rule 1 — runs of five or more same-coloured modules in a line.
        // Rule 3 is folded in here: the finder-like 1:1:3:1:1 pattern.
        for (y = 0; y < size; y++) {
            var runColor = false, runX = 0, runHistory = [0, 0, 0, 0, 0, 0, 0];
            for (x = 0; x < size; x++) {
                if (st.modules[y][x] === runColor) {
                    runX++;
                    if (runX === 5) result += PENALTY_N1;
                    else if (runX > 5) result++;
                } else {
                    finderPenaltyAddHistory(runX, runHistory, size);
                    if (!runColor) result += finderPenaltyCountPatterns(runHistory, size) * PENALTY_N3;
                    runColor = st.modules[y][x];
                    runX = 1;
                }
            }
            result += finderPenaltyTerminateAndCount(runColor, runX, runHistory, size) * PENALTY_N3;
        }
        for (x = 0; x < size; x++) {
            var runColor2 = false, runY = 0, runHistory2 = [0, 0, 0, 0, 0, 0, 0];
            for (y = 0; y < size; y++) {
                if (st.modules[y][x] === runColor2) {
                    runY++;
                    if (runY === 5) result += PENALTY_N1;
                    else if (runY > 5) result++;
                } else {
                    finderPenaltyAddHistory(runY, runHistory2, size);
                    if (!runColor2) result += finderPenaltyCountPatterns(runHistory2, size) * PENALTY_N3;
                    runColor2 = st.modules[y][x];
                    runY = 1;
                }
            }
            result += finderPenaltyTerminateAndCount(runColor2, runY, runHistory2, size) * PENALTY_N3;
        }

        // Rule 2 — every 2x2 block of one colour.
        for (y = 0; y < size - 1; y++) {
            for (x = 0; x < size - 1; x++) {
                var c = st.modules[y][x];
                if (c === st.modules[y][x + 1] && c === st.modules[y + 1][x] && c === st.modules[y + 1][x + 1]) {
                    result += PENALTY_N2;
                }
            }
        }

        // Rule 4 — deviation of the dark-module share from 50%.
        var dark = 0;
        for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (st.modules[y][x]) dark++;
        var total = size * size;
        var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
        result += k * PENALTY_N4;
        return result;
    }

    function finderPenaltyAddHistory(currentRunLength, runHistory, size) {
        if (runHistory[0] === 0) currentRunLength += size;  // light border before the first run
        runHistory.pop();
        runHistory.unshift(currentRunLength);
    }

    function finderPenaltyCountPatterns(runHistory, size) {
        var n = runHistory[1];
        var core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3
            && runHistory[4] === n && runHistory[5] === n;
        return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0)
            + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
    }

    function finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory, size) {
        if (currentRunColor) {                 // terminate dark run
            finderPenaltyAddHistory(currentRunLength, runHistory, size);
            currentRunLength = 0;
        }
        currentRunLength += size;              // light border after the last run
        finderPenaltyAddHistory(currentRunLength, runHistory, size);
        return finderPenaltyCountPatterns(runHistory, size);
    }

    // ------------------------------------------------------------ public API

    /**
     * Encode text into a QR symbol.
     *
     * @param {string} text          payload
     * @param {object} [opts]
     * @param {string} [opts.ecl]    'L' | 'M' | 'Q' | 'H'   (default 'M')
     * @param {number} [opts.minVersion]
     * @param {number} [opts.maxVersion]
     * @param {number} [opts.mask]   force a mask 0-7, else auto by penalty
     * @param {boolean} [opts.boostEcl] raise the level for free if it still fits
     * @returns {QRSymbol}
     */
    function encode(text, opts) {
        opts = opts || {};
        text = String(text === undefined || text === null ? '' : text);
        var eclKey = (opts.ecl || 'M').toUpperCase();
        assert(ECL.hasOwnProperty(eclKey), 'unknown error correction level ' + eclKey);
        var ecl = ECL[eclKey];

        var minVersion = opts.minVersion || MIN_VERSION;
        var maxVersion = opts.maxVersion || MAX_VERSION;
        assert(MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= MAX_VERSION,
            'version range invalid');

        var mode = chooseMode(text);
        var bytes = mode === 'byte' ? toUtf8Bytes(text) : [];

        // Smallest version that fits.
        var version, dataUsedBits, dataCapacityBits;
        for (version = minVersion; ; version++) {
            dataCapacityBits = getNumDataCodewords(version, ecl.index) * 8;
            dataUsedBits = 4 + charCountBits(mode, version) + dataBitLength(mode, text, bytes);
            if (dataUsedBits <= dataCapacityBits) break;
            if (version >= maxVersion) {
                throw new Error('Data is too long for a QR code at level ' + eclKey +
                    ' (needs ' + Math.ceil(dataUsedBits / 8) + ' codewords, capacity ' +
                    Math.floor(dataCapacityBits / 8) + ')');
            }
        }

        // Spend leftover capacity on stronger error correction, at no size cost.
        if (opts.boostEcl !== false) {
            ['M', 'Q', 'H'].forEach(function (k) {
                var cand = ECL[k];
                if (cand.index > ecl.index &&
                    dataUsedBits <= getNumDataCodewords(version, cand.index) * 8) {
                    ecl = cand;
                    eclKey = k;
                }
            });
            dataCapacityBits = getNumDataCodewords(version, ecl.index) * 8;
        }

        // Build the bit stream: mode, char count, payload, terminator, padding.
        var bb = new BitBuffer();
        bb.appendBits(MODE_INDICATOR[mode], 4);
        bb.appendBits(charCount(mode, text, bytes), charCountBits(mode, version));
        appendPayload(bb, mode, text, bytes);
        assert(bb.length() === dataUsedBits, 'internal: bit length mismatch');

        bb.appendBits(0, Math.min(4, dataCapacityBits - bb.length()));
        bb.appendBits(0, (8 - bb.length() % 8) % 8);
        for (var pad = 0xEC; bb.length() < dataCapacityBits; pad ^= 0xEC ^ 0x11) bb.appendBits(pad, 8);

        var dataCodewords = [];
        for (var i = 0; i < bb.length(); i += 8) {
            var b = 0;
            for (var j = 0; j < 8; j++) b = (b << 1) | bb.bits[i + j];
            dataCodewords.push(b);
        }

        // Lay the symbol out.
        var size = version * 4 + 17;
        var st = {
            version: version,
            size: size,
            eclIndex: ecl.index,
            eclFormatBits: ecl.formatBits,
            modules: newGrid(size, false),
            isFunction: newGrid(size, false)
        };
        drawFunctionPatterns(st);
        drawCodewords(st, addEccAndInterleave(st, dataCodewords));

        // Pick the mask with the lowest penalty (or honour a forced one).
        var mask = opts.mask;
        if (mask === undefined || mask === null || mask < 0) {
            var minPenalty = Infinity;
            for (var m = 0; m < 8; m++) {
                applyMask(st, m);
                drawFormatBits(st, m);
                var p = getPenaltyScore(st);
                if (p < minPenalty) { mask = m; minPenalty = p; }
                applyMask(st, m);           // XOR again to undo
            }
        }
        assert(mask >= 0 && mask <= 7, 'bad mask');
        applyMask(st, mask);
        drawFormatBits(st, mask);

        return new QRSymbol(version, eclKey, st.modules, st.isFunction, mask);
    }

    /** Largest payload, in bytes, that still fits at the given version/level. */
    function capacityBytes(version, eclKey) {
        var ecl = ECL[(eclKey || 'M').toUpperCase()];
        var bits = getNumDataCodewords(version, ecl.index) * 8 - 4 - charCountBits('byte', version);
        return Math.floor(bits / 8);
    }

    return {
        encode: encode,
        capacityBytes: capacityBytes,
        ECL: ECL,
        MIN_VERSION: MIN_VERSION,
        MAX_VERSION: MAX_VERSION,
        // exposed for the regression suite
        _internal: {
            getNumRawDataModules: getNumRawDataModules,
            getNumDataCodewords: getNumDataCodewords,
            getAlignmentPatternPositions: getAlignmentPatternPositions,
            gfMultiply: gfMultiply,
            reedSolomonComputeDivisor: reedSolomonComputeDivisor,
            reedSolomonComputeRemainder: reedSolomonComputeRemainder,
            toUtf8Bytes: toUtf8Bytes,
            chooseMode: chooseMode,
            maskPredicate: maskPredicate
        }
    };
});
