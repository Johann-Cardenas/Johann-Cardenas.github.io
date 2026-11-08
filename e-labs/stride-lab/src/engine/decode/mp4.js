/* ============================================================
   Stride Lab — a minimal ISO base media file format reader.

   Enough of MP4/MOV to hand WebCodecs a correctly ordered stream
   of EncodedVideoChunks with EXACT presentation timestamps, and
   nothing more.

   Why write this rather than depend on a demuxer:
     - every timing metric in this app is a difference between two
       presentation timestamps, so the timestamps are not a detail;
     - it is one fewer cross-origin script, which matters when the
       headline claim is that nothing leaves the device and the app
       has to keep working offline;
     - the subset actually needed is small, and the parts that are
       NOT small (fragmented files, edit lists) are detected and
       handed to the fallback decoder rather than guessed at.

   Deliberately not handled, and detected rather than mishandled:
     - fragmented MP4 (moof/traf): reported, caller falls back
     - edit lists that shift or trim the media timeline
     - anything that is not ISO-BMFF (WebM, for instance)
   ============================================================ */

/** @typedef {{offset:number, size:number, duration:number, cts:number, sync:boolean}} SampleEntry */

/**
 * @typedef {Object} VideoTrackInfo
 * @property {number} id
 * @property {number} timescale        ticks per second
 * @property {number} width
 * @property {number} height
 * @property {string} codec            e.g. 'avc1.640028'
 * @property {Uint8Array|null} description  avcC / hvcC payload, if the codec needs it
 * @property {SampleEntry[]} samples   in DECODE order, with composition times
 * @property {number} rotationDeg      from the track matrix, 0/90/180/270
 */

const u32 = (dv, p) => dv.getUint32(p);
const u16 = (dv, p) => dv.getUint16(p);
const u8 = (dv, p) => dv.getUint8(p);

/** Walk the immediate children of a box range. */
function* boxes(dv, start, end) {
    let p = start;
    while (p + 8 <= end) {
        let size = u32(dv, p);
        const type = String.fromCharCode(u8(dv, p + 4), u8(dv, p + 5), u8(dv, p + 6), u8(dv, p + 7));
        let header = 8;
        if (size === 1) {
            if (p + 16 > end) throw new RangeError('truncated box header');
            /* 64-bit size. Number is exact to 2^53, far beyond any real file. */
            const hi = u32(dv, p + 8), lo = u32(dv, p + 12);
            size = hi * 4294967296 + lo;
            header = 16;
        } else if (size === 0) {
            size = end - p;
        }
        if (!Number.isSafeInteger(size) || size < header || p + size > end) throw new RangeError('invalid box size');
        yield { type, start: p + header, end: p + size, size };
        p += size;
    }
}

function findBox(dv, start, end, path) {
    let s = start, e = end;
    for (const want of path) {
        let found = null;
        for (const b of boxes(dv, s, e)) if (b.type === want) { found = b; break; }
        if (!found) return null;
        s = found.start; e = found.end;
    }
    return { start: s, end: e };
}

/**
 * Parse the first video track of an ISO-BMFF buffer.
 * @param {ArrayBuffer} buffer
 * @returns {{ok:true, track:VideoTrackInfo} | {ok:false, reason:string}}
 */
export function parseMp4(buffer) {
    try { return parseBuffer(buffer); }
    catch (error) {
        if (error instanceof RangeError || error instanceof TypeError) return { ok: false, reason: 'malformed-isobmff' };
        throw error;
    }
}

function requireBytes(box, length) {
    if (box.end - box.start < length) throw new RangeError('truncated box');
}

function tableCount(dv, box, stride, header = 8) {
    requireBytes(box, header);
    const count = u32(dv, box.start + 4);
    if (count > Math.floor((box.end - box.start - header) / stride)) throw new RangeError('invalid table count');
    return count;
}

function parseBuffer(buffer) {
    const dv = new DataView(buffer);
    const end = buffer.byteLength;

    let sawFtyp = false, moov = null, sawMoof = false;
    const media = [];
    for (const b of boxes(dv, 0, end)) {
        if (b.type === 'ftyp') sawFtyp = true;
        else if (b.type === 'moov') moov = b;
        else if (b.type === 'moof') sawMoof = true;
        else if (b.type === 'mdat') media.push(b);
    }
    if (!sawFtyp && !moov) return { ok: false, reason: 'not-isobmff' };
    if (sawMoof) return { ok: false, reason: 'fragmented' };
    if (!moov) return { ok: false, reason: 'no-moov' };

    for (const trak of [...boxes(dv, moov.start, moov.end)].filter(b => b.type === 'trak')) {
        const hdlr = findBox(dv, trak.start, trak.end, ['mdia', 'hdlr']);
        if (!hdlr) continue;
        requireBytes(hdlr, 12);
        const handler = String.fromCharCode(u8(dv, hdlr.start + 8), u8(dv, hdlr.start + 9),
            u8(dv, hdlr.start + 10), u8(dv, hdlr.start + 11));
        if (handler !== 'vide') continue;

        const tkhd = findBox(dv, trak.start, trak.end, ['tkhd']);
        const mdhd = findBox(dv, trak.start, trak.end, ['mdia', 'mdhd']);
        const stbl = findBox(dv, trak.start, trak.end, ['mdia', 'minf', 'stbl']);
        if (!mdhd || !stbl) continue;

        const elst = findBox(dv, trak.start, trak.end, ['edts', 'elst']);
        if (elst && hasNonTrivialEdit(dv, elst)) return { ok: false, reason: 'edit-list' };

        const mv = u8(dv, mdhd.start);   /* version */
        if (mv > 1) throw new RangeError('unsupported time header');
        requireBytes(mdhd, mv === 1 ? 24 : 16);
        const timescale = mv === 1 ? u32(dv, mdhd.start + 20) : u32(dv, mdhd.start + 12);
        if (!(timescale > 0)) return { ok: false, reason: 'bad-timescale' };

        let id = 0, width = 0, height = 0, rotationDeg = 0, mirrored = false;
        if (tkhd) {
            const tv = u8(dv, tkhd.start);
            if (tv > 1) throw new RangeError('unsupported track header');
            requireBytes(tkhd, tv === 1 ? 96 : 84);
            id = tv === 1 ? u32(dv, tkhd.start + 20) : u32(dv, tkhd.start + 12);
            /* Display matrix, 3x3 of 16.16 fixed point.
               The offset is worth spelling out, because getting it wrong is
               silent: every rotation reads as zero and portrait phone video is
               analyzed sideways.
                 version + flags                4
                 creation, modification         8   (16 when version 1)
                 track_ID                       4
                 reserved                       4
                 duration                       4   (8 when version 1)
                 reserved[2]                    8
                 layer, alternate_group         4
                 volume, reserved               4
                                              ----
                 matrix begins at              40   (52 when version 1) */
            const m = tkhd.start + (tv === 1 ? 52 : 40);
            const a = (u32(dv, m) | 0) / 65536;
            const b = (u32(dv, m + 4) | 0) / 65536;
            const c = (u32(dv, m + 12) | 0) / 65536;
            const d = (u32(dv, m + 16) | 0) / 65536;
            const t = transformFromMatrix(a, b, c, d);
            rotationDeg = t.rotationDeg;
            mirrored = t.mirrored;
            /* tkhd width/height are the PRE-rotation dimensions on most phone
               encoders, so they cannot be used as the display size. The coded
               size from the sample entry plus the rotation is what gives it. */
            width = u32(dv, tkhd.end - 8) / 65536;
            height = u32(dv, tkhd.end - 4) / 65536;
        }

        const sd = readStsd(dv, stbl);
        if (!sd) return { ok: false, reason: 'no-sample-description' };
        if (sd.width) { width = sd.width; height = sd.height; }

        const samples = readSampleTable(dv, stbl, media);
        if (!samples || !samples.length) return { ok: false, reason: 'no-samples' };

        return {
            ok: true,
            track: {
                id, timescale, width, height,
                codec: sd.codec, description: sd.description,
                samples, rotationDeg, mirrored
            }
        };
    }
    return { ok: false, reason: 'no-video-track' };
}

/** Only the identity edit (or none) is safe to ignore. */
function hasNonTrivialEdit(dv, elst) {
    requireBytes(elst, 8);
    const version = u8(dv, elst.start);
    if (version > 1) return true;
    const count = tableCount(dv, elst, version === 1 ? 20 : 12);
    let p = elst.start + 8;
    for (let i = 0; i < count; i++) {
        const mediaTime = version === 1
            ? Number(new DataView(dv.buffer, dv.byteOffset + p + 8, 8).getBigInt64(0))
            : (u32(dv, p + 4) | 0);
        const rate = u16(dv, p + (version === 1 ? 16 : 8));
        if (count > 1 || mediaTime !== 0 || rate !== 1 || u16(dv, p + (version === 1 ? 18 : 10)) !== 0) return true;
        p += version === 1 ? 20 : 12;
    }
    return false;
}

/**
 * Rotation and mirroring from the display matrix.
 *
 * The mirror check is not decoration. A negative determinant means the frame is
 * flipped, which some front-camera recordings carry, and a flipped frame swaps
 * the runner's left and right sides. Every per-side measurement and every
 * asymmetry index in this app would then be confidently reported for the wrong
 * leg — the exact class of error that looks completely normal in the output.
 */
function transformFromMatrix(a, b, c, d) {
    const det = a * d - b * c;
    const mirrored = det < 0;
    /* undo the mirror before reading the angle, or a flip reads as a rotation */
    const ax = mirrored ? -a : a;
    const bx = mirrored ? -b : b;
    let deg = Math.atan2(bx, ax) * 180 / Math.PI;
    /* snap: a matrix is meant to hold exact quarter turns, and float noise in a
       16.16 fixed-point value must not become an 89-degree rotation */
    deg = Math.round(deg / 90) * 90;
    return { rotationDeg: ((deg % 360) + 360) % 360, mirrored };
}

function readStsd(dv, stbl) {
    const stsd = findBox(dv, stbl.start, stbl.end, ['stsd']);
    if (!stsd) return null;
    requireBytes(stsd, 8);
    for (const e of boxes(dv, stsd.start + 8, stsd.end)) {
        requireBytes(e, 78);
        const width = u16(dv, e.start + 24);
        const height = u16(dv, e.start + 26);
        let description = null, codec = e.type;
        for (const c of boxes(dv, e.start + 78, e.end)) {
            if (c.type === 'avcC' || c.type === 'hvcC' || c.type === 'av1C' || c.type === 'vpcC') {
                description = new Uint8Array(dv.buffer, dv.byteOffset + c.start, c.end - c.start).slice();
                if (c.type === 'avcC') {
                    requireBytes(c, 4);
                    codec = `avc1.${hex(description[1])}${hex(description[2])}${hex(description[3])}`;
                }
                break;
            }
        }
        if (e.type === 'vp09' && !codec.includes('.')) codec = 'vp09.00.10.08';
        if (e.type === 'av01' && !codec.includes('.')) codec = 'av01.0.04M.08';
        if (e.type === 'hvc1' || e.type === 'hev1') codec = 'hvc1.1.6.L93.B0';
        return { codec, description, width, height };
    }
    return null;
}

const hex = (n) => n.toString(16).padStart(2, '0');

/**
 * Build the sample table: byte offsets, sizes, decode times and COMPOSITION
 * times. The ctts box is the one that must not be skipped — with B-frames the
 * decode order is not the display order, and using decode time as presentation
 * time reorders the video without any error being raised anywhere.
 */
function readSampleTable(dv, stbl, media) {
    const stts = findBox(dv, stbl.start, stbl.end, ['stts']);
    const stsc = findBox(dv, stbl.start, stbl.end, ['stsc']);
    const stsz = findBox(dv, stbl.start, stbl.end, ['stsz']);
    const stco = findBox(dv, stbl.start, stbl.end, ['stco'])
        || findBox(dv, stbl.start, stbl.end, ['co64']);
    if (!stts || !stsc || !stsz || !stco) return null;
    requireBytes(stsz, 12);
    const is64 = !findBox(dv, stbl.start, stbl.end, ['stco']);
    const ctts = findBox(dv, stbl.start, stbl.end, ['ctts']);
    const stss = findBox(dv, stbl.start, stbl.end, ['stss']);

    /* sizes */
    const uniform = u32(dv, stsz.start + 4);
    const count = u32(dv, stsz.start + 8);
    // Bound declared expansion before allocating. Even uniform-size tables
    // cannot describe more positive-byte samples than exist in the file.
    if (!count || count > dv.byteLength || count > 1000000
        || (!uniform && count > Math.floor((stsz.end - stsz.start - 12) / 4))) throw new RangeError('invalid sample count');
    const sizes = new Uint32Array(count);
    if (uniform) sizes.fill(uniform);
    else for (let i = 0; i < count; i++) sizes[i] = u32(dv, stsz.start + 12 + i * 4);

    /* decode deltas */
    const deltas = new Float64Array(count);
    {
        const n = tableCount(dv, stts, 8);
        let s = 0;
        for (let i = 0; i < n; i++) {
            const c = u32(dv, stts.start + 8 + i * 8);
            const d = u32(dv, stts.start + 12 + i * 8);
            if (!c || !d || c > count - s) throw new RangeError('invalid decode run');
            for (let k = 0; k < c && s < count; k++) deltas[s++] = d;
        }
        if (s !== count) throw new RangeError('incomplete decode table');
    }

    /* composition offsets */
    const offsets = new Float64Array(count);
    if (ctts) {
        const version = u8(dv, ctts.start);
        if (version > 1) throw new RangeError('unsupported composition version');
        const n = tableCount(dv, ctts, 8);
        let s = 0;
        for (let i = 0; i < n; i++) {
            const c = u32(dv, ctts.start + 8 + i * 8);
            const raw = u32(dv, ctts.start + 12 + i * 8);
            const o = version === 1 ? (raw | 0) : raw;
            if (!c || c > count - s) throw new RangeError('invalid composition run');
            for (let k = 0; k < c && s < count; k++) offsets[s++] = o;
        }
        if (s !== count) throw new RangeError('incomplete composition table');
    }

    /* sync samples */
    const sync = new Uint8Array(count);
    if (stss) {
        const n = tableCount(dv, stss, 4);
        for (let i = 0; i < n; i++) {
            const idx = u32(dv, stss.start + 8 + i * 4) - 1;
            if (idx < 0 || idx >= count) throw new RangeError('invalid sync index');
            sync[idx] = 1;
        }
    } else {
        sync.fill(1);   /* no stss means every sample is a sync sample */
    }

    /* chunk offsets and the sample-to-chunk map */
    const chunkCount = tableCount(dv, stco, is64 ? 8 : 4);
    if (!chunkCount || chunkCount > count) throw new RangeError('invalid chunk count');
    const chunkOffset = new Float64Array(chunkCount);
    for (let i = 0; i < chunkCount; i++) {
        chunkOffset[i] = is64
            ? Number(new DataView(dv.buffer, dv.byteOffset + stco.start + 8 + i * 8, 8).getBigUint64(0))
            : u32(dv, stco.start + 8 + i * 4);
    }
    const scCount = tableCount(dv, stsc, 12);
    const runs = [];
    for (let i = 0; i < scCount; i++) {
        runs.push({
            first: u32(dv, stsc.start + 8 + i * 12) - 1,
            perChunk: u32(dv, stsc.start + 12 + i * 12)
        });
        const run = runs[i];
        if (!run.perChunk || run.first < 0 || run.first >= chunkCount || (i ? run.first <= runs[i - 1].first : run.first !== 0)
            || u32(dv, stsc.start + 16 + i * 12) !== 1) throw new RangeError('invalid sample-to-chunk run');
    }
    if (!runs.length) throw new RangeError('empty sample-to-chunk table');

    /** @type {SampleEntry[]} */
    const samples = [];
    let sample = 0, dts = 0, runIndex = 0;
    for (let c = 0; c < chunkCount && sample < count; c++) {
        while (runIndex + 1 < runs.length && runs[runIndex + 1].first <= c) runIndex++;
        const per = runs[runIndex].perChunk;
        if (per > count - sample) throw new RangeError('chunk overflows sample count');
        let off = chunkOffset[c];
        for (let k = 0; k < per && sample < count; k++) {
            if (!Number.isSafeInteger(off) || !sizes[sample] || off < 0 || off + sizes[sample] > dv.byteLength
                || !insideMedia(media, off, sizes[sample])) throw new RangeError('invalid sample byte range');
            samples.push({
                offset: off,
                size: sizes[sample],
                duration: deltas[sample],
                cts: dts + offsets[sample],
                sync: !!sync[sample]
            });
            off += sizes[sample];
            dts += deltas[sample];
            sample++;
        }
    }
    if (sample !== count) throw new RangeError('incomplete sample map');
    return samples;
}

function insideMedia(ranges, offset, size) {
    let lo = 0, hi = ranges.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1, range = ranges[mid];
        if (offset < range.start) hi = mid - 1;
        else if (offset >= range.end) lo = mid + 1;
        else return offset + size <= range.end;
    }
    return false;
}

/**
 * The size the viewer sees, which is the coded size with the display matrix
 * applied. A quarter turn swaps the axes; the tkhd width and height cannot be
 * used for this because most phone encoders write the PRE-rotation values
 * there.
 * @param {VideoTrackInfo} track
 */
export function displaySize(track) {
    const swap = track.rotationDeg === 90 || track.rotationDeg === 270;
    return {
        width: swap ? track.height : track.width,
        height: swap ? track.width : track.height
    };
}

/**
 * The frame rate a file ACTUALLY has, from the median inter-frame interval of
 * the composition times — never from a declared value. Variable-frame-rate
 * phone video is common and the container metadata lies about it.
 */
export function measuredFps(track) {
    const cts = track.samples.map(s => s.cts).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < cts.length; i++) gaps.push(cts[i] - cts[i - 1]);
    if (!gaps.length) return NaN;
    gaps.sort((a, b) => a - b);
    const med = gaps[gaps.length >> 1];
    return med > 0 ? track.timescale / med : NaN;
}
