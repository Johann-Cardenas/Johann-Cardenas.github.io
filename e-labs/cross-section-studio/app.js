/* ============================================================
   Cross-Section Studio — procedural pavement section renderer
   Deterministic, true-to-scale, publication-oriented.
   Three.js (ES modules via CDN import map).
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

(function () {
    'use strict';

    /* ========================================================
       0. Deterministic RNG
       ======================================================== */
    function xmur3(str) {
        let h = 1779033703 ^ str.length;
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        return function () {
            h = Math.imul(h ^ (h >>> 16), 2246822507);
            h = Math.imul(h ^ (h >>> 13), 3266489909);
            return (h ^= h >>> 16) >>> 0;
        };
    }

    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function seededRng(key) { return mulberry32(xmur3(key)()); }

    /* ========================================================
       1. Material definitions (FAA + highway presets)
       One texture tile covers TILE_MM of material and is
       rendered at TEX_SIZE px — all material dimensions
       (aggregate radii, cracks, strata) are given in mm.
       ======================================================== */
    const TEX_SIZE = 1024;             // texture resolution (px per tile)
    const TILE_MM = 512;               // physical size of one tile (mm)
    const PX = TEX_SIZE / TILE_MM;     // px per mm
    const MATERIALS = {
        p401: {
            name: 'Asphalt Concrete', spec: 'FAA P-401',
            base: '#34383d', mottle: { colors: ['#2b2f34', '#3e434a', '#24272b'], count: 36, alpha: 0.08 },
            aggs: [{ cover: 0.32, rMin: 2, rMax: 5, colors: ['#4a4f57', '#282c30', '#555b64', '#3a3e44'], angular: true }],
            noise: 13, rough: 0.55, topRough: 0.45, heightAgg: 0.35, normal: 0.8
        },
        p209: {
            name: 'Crushed Aggregate Base', spec: 'FAA P-209',
            base: '#8a7355', mottle: { colors: ['#7c6647', '#9c8564'], count: 30, alpha: 0.1 },
            aggs: [{ cover: 0.82, rMin: 12, rMax: 20, colors: ['#b59a76', '#8f7a5c', '#c2ab88', '#7c6647', '#a89070'], angular: true, edge: 0.3 }],
            noise: 15, rough: 0.95, heightAgg: 1.0, normal: 1.3
        },
        p154: {
            name: 'Granular Subbase', spec: 'FAA P-154',
            base: '#9b988f', mottle: { colors: ['#8d8a81', '#a8a59c'], count: 34, alpha: 0.1 },
            aggs: [{ cover: 0.68, rMin: 7, rMax: 25, colors: ['#b8b5ad', '#93908a', '#c4c1b9', '#807d75', '#aca99f'], angular: true, edge: 0.22 }],
            noise: 20, rough: 0.95, heightAgg: 0.8, normal: 1.15
        },
        subgrade: {
            name: 'Compacted Subgrade', spec: 'In-situ soil',
            base: '#7b5f41', mottle: { colors: ['#6f5539', '#87694a', '#755a3e'], count: 44, alpha: 0.1 },
            aggs: [{ cover: 0.2, rMin: 1.5, rMax: 3.5, colors: ['#8a6c4c', '#6a5136', '#93755a'], angular: false }],
            strata: { bands: 7, alpha: 0.08 },
            noise: 22, rough: 1.0, heightAgg: 0.25, normal: 0.75
        },
        pcc: {
            name: 'Portland Cement Concrete', spec: 'FAA P-501',
            base: '#c9cbcd', mottle: { colors: ['#c2c4c6', '#d1d3d5', '#bcbec0'], count: 40, alpha: 0.09 },
            aggs: [{ cover: 0.1, rMin: 1.5, rMax: 3, colors: ['#b5b7b9', '#d8dadc', '#aaacae'], angular: false }],
            voids: { count: 240, rMin: 0.8, rMax: 2, alpha: 0.3 },
            noise: 8, rough: 0.5, heightAgg: 0.12, normal: 0.45
        },
        ctb: {
            name: 'Cement-Treated Base', spec: 'FAA P-304',
            base: '#a9a08c', mottle: { colors: ['#9c937f', '#b6ad99', '#a29985'], count: 38, alpha: 0.11 },
            aggs: [{ cover: 0.3, rMin: 2.5, rMax: 6, colors: ['#b7ae9a', '#948b77', '#c0b7a3'], angular: true }],
            noise: 14, rough: 0.8, heightAgg: 0.45, normal: 0.85
        },
        lcb: {
            name: 'Lean Concrete Base', spec: 'FAA P-306',
            base: '#bdbfba', mottle: { colors: ['#b1b3ae', '#c8cac5'], count: 30, alpha: 0.1 },
            aggs: [{ cover: 0.44, rMin: 6, rMax: 14, colors: ['#a9aba6', '#cccec9', '#94968f', '#b8bab5'], angular: false, edge: 0.15 }],
            voids: { count: 150, rMin: 1, rMax: 3, alpha: 0.35 },
            noise: 12, rough: 0.75, heightAgg: 0.6, normal: 0.95
        },
        oga: {
            name: 'Open-Graded Aggregate', spec: 'Drainage layer',
            base: '#2e3236', mottle: { colors: ['#26292d', '#383c41'], count: 20, alpha: 0.12 },
            aggs: [{ cover: 0.8, rMin: 18, rMax: 30, colors: ['#7f858d', '#6a7077', '#8f959d', '#5d636b'], angular: true, edge: 0.35 }],
            noise: 9, rough: 1.0, heightAgg: 1.25, normal: 1.5
        },
        rca: {
            name: 'Recycled Concrete Aggregate', spec: 'RCA',
            base: '#9aa0a3', mottle: { colors: ['#8b9194', '#a7adb0'], count: 26, alpha: 0.1 },
            aggs: [{ cover: 0.72, rMin: 10, rMax: 22, colors: ['#c3c7c9', '#8b9194', '#aeb4b7', '#7a8083', '#d0d4d6'], angular: true, edge: 0.28 }],
            noise: 12, rough: 0.9, heightAgg: 0.9, normal: 1.2
        },
        ssand: {
            name: 'Stabilized Sand', spec: 'Fine subbase',
            base: '#d3c19b', mottle: { colors: ['#c8b690', '#ddcba5'], count: 30, alpha: 0.09 },
            aggs: [{ cover: 0.13, rMin: 1, rMax: 2.2, colors: ['#c4b28c', '#e0d0ac', '#b9a781'], angular: false }],
            noise: 15, rough: 0.85, heightAgg: 0.15, normal: 0.5
        },
        lts: {
            name: 'Lime-Treated Soil', spec: 'Modified subgrade',
            base: '#8d8170', mottle: { colors: ['#817566', '#998d7b'], count: 34, alpha: 0.1 },
            aggs: [{ cover: 0.18, rMin: 1.5, rMax: 3.5, colors: ['#9a8e7c', '#7f7362'], angular: false }],
            streaks: { count: 26, color: '#e9e4d8', alpha: 0.18 },
            noise: 16, rough: 0.9, heightAgg: 0.3, normal: 0.7
        },
        sma: {
            name: 'Stone Matrix Asphalt', spec: 'SMA surface course',
            base: '#26282c', mottle: { colors: ['#1f2124', '#2e3135'], count: 30, alpha: 0.09 },
            aggs: [{ cover: 0.52, rMin: 4, rMax: 9, colors: ['#3c4046', '#2e3237', '#484d54', '#33373c'], angular: true, edge: 0.25 }],
            speckle: { count: 900, rMin: 0.4, rMax: 1.1, colors: ['#8f959c', '#6a7076'], alpha: 0.5 },
            noise: 11, rough: 0.6, topRough: 0.5, heightAgg: 0.6, normal: 1.0
        },
        ogfc: {
            name: 'Open-Graded Friction Course', spec: 'OGFC / porous asphalt',
            base: '#1c1e21', mottle: { colors: ['#17191b', '#232629'], count: 24, alpha: 0.1 },
            aggs: [{ cover: 0.58, rMin: 5, rMax: 10, colors: ['#34383e', '#2a2e33', '#3e434a'], angular: true, edge: 0.3 }],
            voids: { count: 460, rMin: 1.2, rMax: 3.2, alpha: 0.55 },
            noise: 10, rough: 0.95, heightAgg: 0.95, normal: 1.4
        },
        binder: {
            name: 'HMA Binder Course', spec: 'Intermediate course',
            base: '#33363b', mottle: { colors: ['#2a2d31', '#3d4147'], count: 32, alpha: 0.09 },
            aggs: [{ cover: 0.42, rMin: 3, rMax: 8, colors: ['#4d525a', '#2c3034', '#5a606a', '#3e4349'], angular: true, edge: 0.18 }],
            noise: 12, rough: 0.6, heightAgg: 0.5, normal: 0.95
        },
        atb: {
            name: 'Asphalt-Treated Base', spec: 'ATB / black base',
            base: '#3a3c3e', mottle: { colors: ['#313335', '#454749'], count: 30, alpha: 0.1 },
            aggs: [{ cover: 0.58, rMin: 5, rMax: 12, colors: ['#565a5e', '#43474b', '#66696d', '#4b4f53'], angular: true, edge: 0.24 }],
            noise: 13, rough: 0.75, heightAgg: 0.75, normal: 1.1
        },
        fdr: {
            name: 'Full-Depth Reclamation', spec: 'FDR / recycled base',
            base: '#6e6353', mottle: { colors: ['#615748', '#7b6f5e'], count: 34, alpha: 0.11 },
            aggs: [
                { cover: 0.3, rMin: 4, rMax: 12, colors: ['#3a3835', '#2f2d2a', '#454340'], angular: true, edge: 0.2 },
                { cover: 0.28, rMin: 3, rMax: 9, colors: ['#a08b6a', '#8d7a5c', '#b19c7b'], angular: true, edge: 0.18 }
            ],
            noise: 16, rough: 0.9, heightAgg: 0.7, normal: 1.05
        },
        clay: {
            name: 'Clay Subgrade', spec: 'High-plasticity soil',
            base: '#8a5f3f', mottle: { colors: ['#7c5435', '#996b49', '#70492c'], count: 46, alpha: 0.12 },
            aggs: [{ cover: 0.1, rMin: 1, rMax: 2.5, colors: ['#9c6f4c', '#774f30'], angular: false }],
            strata: { bands: 5, alpha: 0.07 },
            fissures: { count: 10, color: '#4a2f1a', alpha: 0.5, width: 1.6 },
            noise: 18, rough: 1.0, heightAgg: 0.2, normal: 0.8
        },
        rock: {
            name: 'Weathered Bedrock', spec: 'Rock / residual soil',
            base: '#7a766f', mottle: { colors: ['#6d6963', '#87837c', '#5f5b55'], count: 38, alpha: 0.12 },
            aggs: [{ cover: 0.16, rMin: 2, rMax: 6, colors: ['#8d8982', '#6a665f', '#94908a'], angular: true }],
            strata: { bands: 9, alpha: 0.12 },
            fissures: { count: 14, color: '#3f3c37', alpha: 0.45, width: 1.3 },
            noise: 14, rough: 0.85, heightAgg: 0.35, normal: 0.9
        }
    };

    const MATERIAL_GROUPS = [
        { label: 'Asphalt', keys: ['p401', 'sma', 'ogfc', 'binder', 'atb'] },
        { label: 'Concrete', keys: ['pcc', 'lcb', 'ctb'] },
        { label: 'Base & Subbase', keys: ['p209', 'p154', 'oga', 'rca', 'fdr', 'ssand'] },
        { label: 'Subgrade & Soil', keys: ['lts', 'subgrade', 'clay', 'rock'] }
    ];
    const MATERIAL_ORDER = MATERIAL_GROUPS.flatMap(g => g.keys);

    /* ========================================================
       2. Procedural texture factory (seeded, cached)
       ======================================================== */
    const texCache = {};

    function drawPoly(ctx, rng, x, y, r, angular) {
        const sides = angular ? 5 + Math.floor(rng() * 3) : 8 + Math.floor(rng() * 3);
        const irr = angular ? 0.45 : 0.18;
        const rot = rng() * Math.PI * 2;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const ang = rot + (i / sides) * Math.PI * 2;
            const rad = r * (1 - irr * rng());
            const px = x + Math.cos(ang) * rad;
            const py = y + Math.sin(ang) * rad;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    function jitterColor(hex, rng, amt) {
        const n = parseInt(hex.slice(1), 16);
        let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        const d = Math.round((rng() - 0.5) * 2 * amt);
        r = Math.max(0, Math.min(255, r + d));
        g = Math.max(0, Math.min(255, g + d));
        b = Math.max(0, Math.min(255, b + d));
        return `rgb(${r},${g},${b})`;
    }

    function generateMaterial(key) {
        if (texCache[key]) return texCache[key];
        const def = MATERIALS[key];
        const rng = seededRng('xs-studio:' + key);
        const S = TEX_SIZE;

        const dCan = document.createElement('canvas'); dCan.width = dCan.height = S;
        const hCan = document.createElement('canvas'); hCan.width = hCan.height = S;
        const d = dCan.getContext('2d');
        const h = hCan.getContext('2d');

        // --- base fill
        d.fillStyle = def.base; d.fillRect(0, 0, S, S);
        h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, S, S);

        // --- mottling at two scales (large patches + mid-frequency variation)
        if (def.mottle) {
            const passes = [
                { count: def.mottle.count, rMin: 40, rMax: 150, alpha: def.mottle.alpha, relief: true },
                { count: Math.round(def.mottle.count * 2.2), rMin: 8, rMax: 34, alpha: def.mottle.alpha * 0.85, relief: false }
            ];
            for (const pass of passes) {
                for (let i = 0; i < pass.count; i++) {
                    const x = rng() * S, y = rng() * S;
                    const r = (pass.rMin + rng() * (pass.rMax - pass.rMin)) * PX;
                    const g = d.createRadialGradient(x, y, 0, x, y, r);
                    const c = def.mottle.colors[Math.floor(rng() * def.mottle.colors.length)];
                    g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
                    d.globalAlpha = pass.alpha; d.fillStyle = g;
                    d.fillRect(x - r, y - r, r * 2, r * 2);
                    if (pass.relief) {
                        // gentle large-scale undulation in the height field
                        const hv2 = 128 + Math.round((rng() - 0.5) * 16);
                        const hg = h.createRadialGradient(x, y, 0, x, y, r);
                        hg.addColorStop(0, `rgba(${hv2},${hv2},${hv2},0.5)`);
                        hg.addColorStop(1, `rgba(${hv2},${hv2},${hv2},0)`);
                        h.fillStyle = hg;
                        h.fillRect(x - r, y - r, r * 2, r * 2);
                    }
                }
            }
            d.globalAlpha = 1;
        }

        // --- horizontal strata (soils)
        if (def.strata) {
            for (let i = 0; i < def.strata.bands; i++) {
                const y = (i + 0.3 + rng() * 0.4) * (S / def.strata.bands);
                const bh = (8 + rng() * 22) * PX;
                d.globalAlpha = def.strata.alpha;
                d.fillStyle = rng() > 0.5 ? '#000000' : '#ffffff';
                d.fillRect(0, y, S, bh);
                h.globalAlpha = 0.1; h.fillStyle = 'rgb(96,96,96)';
                h.fillRect(0, y, S, bh); h.globalAlpha = 1;
            }
            d.globalAlpha = 1;
        }

        // --- aggregates (drawn with 4-way wrap for seamless tiling)
        (def.aggs || []).forEach((agg, ai) => {
            const rMinPx = agg.rMin * PX, rMaxPx = agg.rMax * PX;
            const rAvg = (rMinPx + rMaxPx) / 2;
            const count = Math.floor((S * S * agg.cover) / (Math.PI * rAvg * rAvg));
            for (let i = 0; i < count; i++) {
                const x = rng() * S, y = rng() * S;
                const r = rMinPx + rng() * (rMaxPx - rMinPx);
                const col = jitterColor(agg.colors[Math.floor(rng() * agg.colors.length)], rng, 14);
                const hv = Math.round(128 + (def.heightAgg || 0.5) * (36 + rng() * 52));
                const shadeAng = rng() * Math.PI * 2;
                const sx = Math.cos(shadeAng) * r, sy = Math.sin(shadeAng) * r;
                // draw the identical polygon at wrapped offsets for seamless tiling
                const seedsX = [x, x - S, x + S], seedsY = [y, y - S, y + S];
                for (const ox of seedsX) for (const oy of seedsY) {
                    if (ox < -r * 2 || ox > S + r * 2 || oy < -r * 2 || oy > S + r * 2) continue;
                    const pr = seededRng('poly:' + key + ':' + ai + ':' + i);
                    drawPoly(d, pr, ox, oy, r, agg.angular);
                    d.fillStyle = col; d.fill();
                    // directional shading — makes each particle read as a lit 3-D stone
                    const lg = d.createLinearGradient(ox - sx, oy - sy, ox + sx, oy + sy);
                    lg.addColorStop(0, 'rgba(255,255,255,0.20)');
                    lg.addColorStop(0.55, 'rgba(255,255,255,0)');
                    lg.addColorStop(1, 'rgba(0,0,0,0.24)');
                    d.fillStyle = lg; d.fill();
                    if (agg.edge) {
                        d.strokeStyle = 'rgba(0,0,0,' + agg.edge + ')';
                        d.lineWidth = Math.max(0.6, r * 0.06);
                        d.stroke();
                    }
                    const hr = seededRng('poly:' + key + ':' + ai + ':' + i);
                    drawPoly(h, hr, ox, oy, r, agg.angular);
                    // rounded relief: bright crown falling off toward the matrix plane
                    const hEdge = Math.round(128 + (hv - 128) * 0.25);
                    const hg = h.createRadialGradient(ox - r * 0.25, oy - r * 0.25, r * 0.1, ox, oy, r);
                    hg.addColorStop(0, `rgb(${hv},${hv},${hv})`);
                    hg.addColorStop(1, `rgb(${hEdge},${hEdge},${hEdge})`);
                    h.fillStyle = hg; h.fill();
                }
            }
        });

        // --- air voids / pores
        if (def.voids) {
            for (let i = 0; i < def.voids.count; i++) {
                const x = rng() * S, y = rng() * S;
                const r = (def.voids.rMin + rng() * (def.voids.rMax - def.voids.rMin)) * PX;
                d.beginPath(); d.arc(x, y, r, 0, Math.PI * 2);
                d.fillStyle = 'rgba(0,0,0,' + def.voids.alpha + ')'; d.fill();
                h.beginPath(); h.arc(x, y, r, 0, Math.PI * 2);
                h.fillStyle = 'rgb(70,70,70)'; h.fill();
            }
        }

        // --- fine mineral speckle (SMA mastic, dusted surfaces)
        if (def.speckle) {
            const sp = def.speckle;
            for (let i = 0; i < sp.count; i++) {
                const x = rng() * S, y = rng() * S;
                const r = (sp.rMin + rng() * (sp.rMax - sp.rMin)) * PX;
                d.globalAlpha = sp.alpha * (0.4 + rng() * 0.6);
                d.fillStyle = sp.colors[Math.floor(rng() * sp.colors.length)];
                d.beginPath(); d.arc(x, y, r, 0, Math.PI * 2); d.fill();
            }
            d.globalAlpha = 1;
        }

        // --- desiccation cracks / rock fractures (wrapped for tiling)
        if (def.fissures) {
            const f = def.fissures;
            for (let i = 0; i < f.count; i++) {
                const pts = [];
                let cx = rng() * S, cy = rng() * S, ang = rng() * Math.PI * 2;
                pts.push([cx, cy]);
                const segs = 5 + Math.floor(rng() * 7);
                for (let sgi = 0; sgi < segs; sgi++) {
                    ang += (rng() - 0.5) * 1.1;
                    const len = (14 + rng() * 34) * PX;
                    cx += Math.cos(ang) * len; cy += Math.sin(ang) * len;
                    pts.push([cx, cy]);
                }
                const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
                const minX = Math.min(...xs), maxX = Math.max(...xs);
                const minY = Math.min(...ys), maxY = Math.max(...ys);
                for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) {
                    if (maxX + ox < 0 || minX + ox > S || maxY + oy < 0 || minY + oy > S) continue;
                    const trace = (ctx, style, width, alpha) => {
                        ctx.globalAlpha = alpha; ctx.strokeStyle = style;
                        ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                        ctx.beginPath();
                        ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
                        for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0] + ox, pts[p][1] + oy);
                        ctx.stroke(); ctx.globalAlpha = 1;
                    };
                    trace(d, f.color, f.width * PX, f.alpha);
                    trace(h, 'rgb(70,70,70)', f.width * PX * 1.4, 0.8);
                }
            }
        }

        // --- cementitious streaks (lime-treated)
        if (def.streaks) {
            d.strokeStyle = def.streaks.color;
            for (let i = 0; i < def.streaks.count; i++) {
                d.globalAlpha = def.streaks.alpha * (0.5 + rng() * 0.5);
                d.lineWidth = (0.8 + rng() * 1.6) * PX;
                const y0 = rng() * S, x0 = rng() * S, len = (30 + rng() * 90) * PX;
                d.beginPath();
                d.moveTo(x0, y0);
                d.quadraticCurveTo(x0 + len / 2, y0 + (rng() - 0.5) * 14 * PX, x0 + len, y0 + (rng() - 0.5) * 8 * PX);
                d.stroke();
            }
            d.globalAlpha = 1;
        }

        // --- per-pixel fine grain noise (both maps)
        const noiseAmp = def.noise || 10;
        const dImg = d.getImageData(0, 0, S, S);
        const hImg = h.getImageData(0, 0, S, S);
        const nRng = seededRng('noise:' + key);
        for (let i = 0; i < dImg.data.length; i += 4) {
            const n = (nRng() - 0.5) * 2 * noiseAmp;
            dImg.data[i] += n; dImg.data[i + 1] += n; dImg.data[i + 2] += n;
            const hn = (nRng() - 0.5) * 2 * (noiseAmp * 0.8);
            hImg.data[i] += hn; hImg.data[i + 1] += hn; hImg.data[i + 2] += hn;
        }
        d.putImageData(dImg, 0, 0);
        h.putImageData(hImg, 0, 0);

        // --- normal map from height (Sobel)
        const nCan = document.createElement('canvas'); nCan.width = nCan.height = S;
        const nCtx = nCan.getContext('2d');
        const nImg = nCtx.createImageData(S, S);
        const hd = hImg.data;
        const px = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4];
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const tl = px(x - 1, y - 1), t = px(x, y - 1), tr = px(x + 1, y - 1);
                const l = px(x - 1, y), r = px(x + 1, y);
                const bl = px(x - 1, y + 1), b = px(x, y + 1), br = px(x + 1, y + 1);
                const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
                const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
                const nx = -dx / 255, ny = -dy / 255, nz = 1;
                const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
                const o = (y * S + x) * 4;
                nImg.data[o] = (nx * inv * 0.5 + 0.5) * 255;
                nImg.data[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
                nImg.data[o + 2] = (nz * inv * 0.5 + 0.5) * 255;
                nImg.data[o + 3] = 255;
            }
        }
        nCtx.putImageData(nImg, 0, 0);

        // --- roughness map: subtle variation about the preset value
        const rCan = document.createElement('canvas'); rCan.width = rCan.height = S;
        const rCtx = rCan.getContext('2d');
        const rImg = rCtx.createImageData(S, S);
        for (let i = 0; i < rImg.data.length; i += 4) {
            const v = Math.max(0, Math.min(255, 255 + (hd[i] - 128) * -0.35 + (hd[i + 1] - 128) * 0.1));
            rImg.data[i] = v; rImg.data[i + 1] = v; rImg.data[i + 2] = v;
            rImg.data[i + 3] = 255;
        }
        rCtx.putImageData(rImg, 0, 0);

        // --- three.js textures
        function makeTex(canvas, srgb) {
            const t = new THREE.CanvasTexture(canvas);
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            if (srgb) t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 8);
            return t;
        }

        // --- thumbnail
        const thumb = document.createElement('canvas');
        thumb.width = 144; thumb.height = 108;
        thumb.getContext('2d').drawImage(dCan, 0, 0, S / 2, (S / 2) * 0.75, 0, 0, 144, 108);

        texCache[key] = {
            map: makeTex(dCan, true),
            normalMap: makeTex(nCan, false),
            roughnessMap: makeTex(rCan, false),
            thumbUrl: thumb.toDataURL('image/png')
        };
        return texCache[key];
    }

    /* ========================================================
       3. State
       ======================================================== */
    let layerIdCounter = 0;
    const nextId = () => 'L' + (++layerIdCounter);

    function makeLayer(name, material, thickness, extra) {
        return Object.assign({
            id: nextId(), name, material, thickness,
            visible: true, locked: false,
            tint: null, brightness: 1, roughness: null, texScale: 1, normalStrength: null
        }, extra || {});
    }

    const DEFAULTS = {
        section: { width: 1600, length: 1400, recessX: 150, recessZ: 0, subgradeDisplay: 500 },
        camera: { mode: 'persp', azimuth: 45, elevation: 35.264, fov: 35 },
        lighting: {
            preset: 'studio', key: 2.4, ambient: 1.1,
            azimuth: 38, elevation: 55, shadowOpacity: 0.35, shadowSoftness: 4, groundShadow: true
        },
        background: { mode: 'white', color: '#f1f5f9' }
    };

    const state = {
        section: { ...DEFAULTS.section },
        camera: { ...DEFAULTS.camera },
        lighting: { ...DEFAULTS.lighting },
        background: { ...DEFAULTS.background },
        meta: { name: '', author: '', notes: '' },
        layers: []   // index 0 = top layer; last entry is always the subgrade
    };

    function defaultLayers() {
        return [
            makeLayer('P-401 Asphalt Concrete', 'p401', 75),
            makeLayer('P-209 Crushed Aggregate Base', 'p209', 150),
            makeLayer('P-154 Granular Subbase', 'p154', 510),
            makeLayer('Subgrade (infinite)', 'subgrade', 0, { subgrade: true })
        ];
    }

    const TEMPLATES = {
        'faa-flexible': {
            name: 'FAA Flexible Pavement', group: 'Airfield',
            layers: [['P-401 Asphalt Concrete', 'p401', 75], ['P-209 Crushed Aggregate Base', 'p209', 150], ['P-154 Granular Subbase', 'p154', 510]]
        },
        'faa-rigid': {
            name: 'FAA Rigid Pavement', group: 'Airfield',
            layers: [['P-501 Concrete Slab', 'pcc', 350], ['P-306 Lean Concrete Base', 'lcb', 150], ['P-154 Granular Subbase', 'p154', 250]]
        },
        'apt-flexible': {
            name: 'Airport Flexible (Stabilized)', group: 'Airfield',
            layers: [['P-401 Asphalt Concrete', 'p401', 125], ['P-304 Cement-Treated Base', 'ctb', 200], ['P-209 Crushed Aggregate Base', 'p209', 250], ['P-154 Granular Subbase', 'p154', 300]]
        },
        'apt-rigid': {
            name: 'Airport Rigid Pavement', group: 'Airfield',
            layers: [['P-501 Concrete Slab', 'pcc', 400], ['P-304 Cement-Treated Base', 'ctb', 150], ['P-154 Granular Subbase', 'p154', 250]]
        },
        'hwy-flexible': {
            name: 'Conventional Flexible Highway', group: 'Highway',
            layers: [['HMA Surface Course', 'p401', 50], ['HMA Binder Course', 'binder', 75], ['Aggregate Base', 'p209', 200], ['Granular Subbase', 'p154', 300]]
        },
        'hwy-interstate': {
            name: 'Interstate Deep-Strength HMA', group: 'Highway',
            layers: [['SMA Surface Course', 'sma', 50], ['HMA Binder Course', 'binder', 75], ['Asphalt-Treated Base', 'atb', 150], ['Aggregate Base', 'p209', 150]]
        },
        'hwy-perpetual': {
            name: 'Perpetual Pavement', group: 'Highway',
            layers: [['SMA Surface Course', 'sma', 40], ['HMA Binder Course', 'binder', 100], ['HMA Base Course', 'p401', 150], ['Rich-Bottom Fatigue Layer', 'p401', 75], ['Aggregate Base', 'p209', 150]]
        },
        'hwy-jpcp': {
            name: 'JPCP Rigid Highway', group: 'Highway',
            layers: [['JPCP Concrete Slab', 'pcc', 280], ['Cement-Treated Base', 'ctb', 100], ['Granular Subbase', 'p154', 150]]
        },
        'hwy-crcp': {
            name: 'CRCP Rigid Highway', group: 'Highway',
            layers: [['CRCP Concrete Slab', 'pcc', 330], ['Asphalt-Treated Base', 'atb', 100], ['Granular Subbase', 'p154', 150]]
        },
        'composite': {
            name: 'Composite (HMA over PCC)', group: 'Highway',
            layers: [['HMA Overlay', 'p401', 100], ['Existing JPCP Slab', 'pcc', 250], ['Aggregate Base', 'p209', 150]]
        },
        'hwy-lowvol': {
            name: 'Low-Volume Road', group: 'Highway',
            layers: [['HMA Surface', 'p401', 75], ['Aggregate Base', 'p209', 200], ['Lime-Treated Subgrade', 'lts', 300]]
        },
        'hwy-porous': {
            name: 'Permeable Pavement (Reservoir)', group: 'Highway',
            layers: [['Porous Asphalt (OGFC)', 'ogfc', 100], ['Choke Stone', 'p209', 50], ['Open-Graded Stone Reservoir', 'oga', 300]]
        },
        'hwy-fdr': {
            name: 'FDR Rehabilitation', group: 'Highway',
            layers: [['HMA Overlay', 'p401', 100], ['Full-Depth Reclamation', 'fdr', 250]]
        }
    };

    function applyTemplate(tpl) {
        state.layers = tpl.layers.map(l => makeLayer(l[0], l[1], l[2]));
        state.layers.push(makeLayer('Subgrade (infinite)', 'subgrade', 0, { subgrade: true }));
        selectedId = state.layers[0].id;
    }

    /* ========================================================
       4. Three.js scene
       ======================================================== */
    const viewport = document.getElementById('xs-viewport');
    const canvas = document.getElementById('xs-canvas');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();

    // Cameras
    const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 200);
    const perspCam = new THREE.PerspectiveCamera(35, 1, 0.01, 500);
    let activeCam = orthoCam;
    let orthoViewSize = 4;          // world units of vertical half-extent at zoom 1

    let controls = new OrbitControls(activeCam, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb9c0c8, 1.1);
    scene.add(hemi);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0006;
    keyLight.shadow.normalBias = 0.01;
    scene.add(keyLight);
    scene.add(keyLight.target);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0);
    scene.add(rimLight);

    // Shadow-catcher ground
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Section group
    let sectionGroup = null;
    const sceneInfo = { center: new THREE.Vector3(), radius: 2, totalDepth: 0 };

    // Selected-layer outline (viewport feedback; hidden during export)
    const selOutline = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0x22d3d1, transparent: true, opacity: 0.85 })
    );
    selOutline.visible = false;
    selOutline.renderOrder = 2;
    scene.add(selOutline);

    function updateSelectionOutline() {
        let mesh = null;
        if (sectionGroup) {
            sectionGroup.traverse(o => { if (o.isMesh && o.userData.layerId === selectedId) mesh = o; });
        }
        if (!mesh) { selOutline.visible = false; return; }
        selOutline.geometry.dispose();
        selOutline.geometry = new THREE.EdgesGeometry(mesh.geometry);
        selOutline.position.copy(mesh.position);
        selOutline.scale.setScalar(1.004);
        selOutline.visible = true;
    }

    function disposeGroup(group) {
        group.traverse(obj => {
            if (obj.isMesh) {
                obj.geometry.dispose();
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => {
                    ['map', 'normalMap', 'roughnessMap'].forEach(k => { if (m[k]) m[k].dispose(); });
                    m.dispose();
                });
            }
        });
    }

    function cloneTex(tex, rx, ry) {
        const t = tex.clone();
        t.repeat.set(rx, ry);
        t.needsUpdate = true;
        return t;
    }

    function faceMaterial(texs, def, layer, repX, repY, isTop) {
        const rough = layer.roughness != null ? layer.roughness
            : (isTop && def.topRough != null ? def.topRough : def.rough);
        const nStr = (layer.normalStrength != null ? layer.normalStrength : def.normal);
        const tile = TILE_MM * (layer.texScale || 1);
        const m = new THREE.MeshStandardMaterial({
            map: cloneTex(texs.map, repX / tile, repY / tile),
            normalMap: cloneTex(texs.normalMap, repX / tile, repY / tile),
            roughnessMap: cloneTex(texs.roughnessMap, repX / tile, repY / tile),
            roughness: rough,
            metalness: 0
        });
        m.normalScale.set(nStr, nStr);
        const tint = new THREE.Color(layer.tint || '#ffffff');
        tint.multiplyScalar(layer.brightness != null ? layer.brightness : 1);
        m.color.copy(tint);
        return m;
    }

    function rebuildSection() {
        if (sectionGroup) { scene.remove(sectionGroup); disposeGroup(sectionGroup); }
        sectionGroup = new THREE.Group();

        const s = state.section;
        const mm = 0.001;                        // mm -> world (metres)
        const layers = state.layers;             // 0 = top ... last = subgrade
        const stack = [...layers].reverse();     // 0 = bottom (subgrade)

        // depth of stack in mm
        let totalDepth = s.subgradeDisplay;
        layers.forEach(l => { if (!l.subgrade) totalDepth += l.thickness; });
        sceneInfo.totalDepth = totalDepth;

        let yCursor = 0; // world y of current layer base
        const x0 = -s.length * mm / 2;           // fixed back-left anchor
        const z0 = -s.width * mm / 2;

        stack.forEach((layer, i) => {
            const t = layer.subgrade ? s.subgradeDisplay : layer.thickness;
            if (t <= 0) return;
            const len = Math.max(s.length - i * s.recessX, s.length * 0.15) * mm;
            const wid = Math.max(s.width - i * s.recessZ, s.width * 0.15) * mm;
            const hgt = t * mm;

            if (layer.visible) {
                const def = MATERIALS[layer.material] || MATERIALS.subgrade;
                const texs = generateMaterial(layer.material in MATERIALS ? layer.material : 'subgrade');
                const geo = new THREE.BoxGeometry(len, hgt, wid);
                const lenMM = len / mm, widMM = wid / mm, hgtMM = hgt / mm;
                const mats = [
                    faceMaterial(texs, def, layer, widMM, hgtMM, false), // +x
                    faceMaterial(texs, def, layer, widMM, hgtMM, false), // -x
                    faceMaterial(texs, def, layer, lenMM, widMM, true),  // +y (top)
                    faceMaterial(texs, def, layer, lenMM, widMM, false), // -y
                    faceMaterial(texs, def, layer, lenMM, hgtMM, false), // +z
                    faceMaterial(texs, def, layer, lenMM, hgtMM, false)  // -z
                ];
                const mesh = new THREE.Mesh(geo, mats);
                mesh.position.set(x0 + len / 2, yCursor + hgt / 2, z0 + wid / 2);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.userData.layerId = layer.id;
                sectionGroup.add(mesh);
            }
            yCursor += hgt;
        });

        scene.add(sectionGroup);

        // scene info for camera + lights
        const box = new THREE.Box3().setFromObject(sectionGroup);
        if (box.isEmpty()) {
            sceneInfo.center.set(0, 0.2, 0); sceneInfo.radius = 1;
        } else {
            box.getCenter(sceneInfo.center);
            sceneInfo.radius = box.getSize(new THREE.Vector3()).length() / 2;
        }

        const g = Math.max(s.length, s.width) * mm * 4;
        ground.geometry.dispose();
        ground.geometry = new THREE.PlaneGeometry(g, g);
        ground.position.y = -0.001;

        updateLightRig();
        updateHud();
        updateSelectionOutline();
    }

    /* ========================================================
       5. Camera control
       ======================================================== */
    function sphericalPos(az, el, dist, target) {
        const a = THREE.MathUtils.degToRad(az);
        const e = THREE.MathUtils.degToRad(el);
        return new THREE.Vector3(
            target.x + dist * Math.cos(e) * Math.sin(a),
            target.y + dist * Math.sin(e),
            target.z + dist * Math.cos(e) * Math.cos(a)
        );
    }

    let syncingCam = false;

    function updateOrthoFrustum(aspect) {
        orthoCam.left = -orthoViewSize * aspect;
        orthoCam.right = orthoViewSize * aspect;
        orthoCam.top = orthoViewSize;
        orthoCam.bottom = -orthoViewSize;
        orthoCam.updateProjectionMatrix();
    }

    function applyCameraFromState(fit) {
        const c = state.camera;
        const target = sceneInfo.center.clone();
        const dist = sceneInfo.radius * 3.2;

        if (fit) {
            orthoViewSize = sceneInfo.radius * 1.15;
            orthoCam.zoom = 1;
            perspCam.fov = c.fov;
        }

        activeCam = c.mode === 'persp' ? perspCam : orthoCam;
        const aspect = viewport.clientWidth / Math.max(1, viewport.clientHeight);
        perspCam.aspect = aspect;
        perspCam.fov = c.fov;
        perspCam.updateProjectionMatrix();
        updateOrthoFrustum(aspect);

        const pDist = c.mode === 'persp'
            ? sceneInfo.radius / Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) * 1.25
            : dist;
        syncingCam = true;
        activeCam.position.copy(sphericalPos(c.azimuth, c.elevation, pDist, target));
        activeCam.lookAt(target);

        controls.object = activeCam;
        controls.target.copy(target);
        controls.update();
        syncingCam = false;
    }

    controls.addEventListener('change', () => {
        if (syncingCam) return;
        const off = activeCam.position.clone().sub(controls.target);
        const dist = off.length();
        const el = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, off.y / dist))));
        const az = THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z));
        state.camera.azimuth = Math.round(az * 10) / 10;
        state.camera.elevation = Math.round(el * 10) / 10;
        ui.camAz.value = state.camera.azimuth;
        ui.camEl.value = state.camera.elevation;
    });

    /* ========================================================
       6. Lighting
       ======================================================== */
    const LIGHT_PRESETS = {
        studio:     { key: 2.4, ambient: 1.1, azimuth: 38, elevation: 55, shadowOpacity: 0.35, shadowSoftness: 4, fill: 0.55, rim: 0 },
        daylight:   { key: 3.2, ambient: 1.5, azimuth: 55, elevation: 62, shadowOpacity: 0.45, shadowSoftness: 2, fill: 0.35, rim: 0 },
        softbox:    { key: 1.2, ambient: 2.0, azimuth: 20, elevation: 65, shadowOpacity: 0.18, shadowSoftness: 9, fill: 0.7, rim: 0 },
        threepoint: { key: 2.6, ambient: 0.8, azimuth: 45, elevation: 50, shadowOpacity: 0.4, shadowSoftness: 4, fill: 0.9, rim: 1.2 }
    };

    function updateLightRig() {
        const L = state.lighting;
        const target = sceneInfo.center;
        const dist = Math.max(4, sceneInfo.radius * 4);

        hemi.intensity = L.ambient;
        keyLight.intensity = L.key;
        keyLight.position.copy(sphericalPos(L.azimuth, L.elevation, dist, target));
        keyLight.target.position.copy(target);

        const p = LIGHT_PRESETS[L.preset] || LIGHT_PRESETS.studio;
        fillLight.intensity = p.fill;
        fillLight.position.copy(sphericalPos(L.azimuth - 110, 30, dist, target));
        rimLight.intensity = p.rim;
        rimLight.position.copy(sphericalPos(L.azimuth + 160, 35, dist, target));

        const ext = Math.max(1, sceneInfo.radius * 1.6);
        const sc = keyLight.shadow.camera;
        sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
        sc.near = 0.1; sc.far = dist * 3;
        sc.updateProjectionMatrix();
        keyLight.shadow.radius = L.shadowSoftness;

        groundMat.opacity = L.shadowOpacity;
        ground.visible = L.groundShadow;
    }

    /* ========================================================
       7. Background
       ======================================================== */
    function applyBackground() {
        const b = state.background;
        if (b.mode === 'transparent') {
            scene.background = null;
        } else if (b.mode === 'color') {
            scene.background = new THREE.Color(b.color);
        } else {
            scene.background = new THREE.Color('#ffffff');
        }
        ui.bgColorField.hidden = b.mode !== 'color';
    }

    /* ========================================================
       8. Render loop & resize
       ======================================================== */
    function resize() {
        const w = viewport.clientWidth, h = viewport.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        const aspect = w / h;
        perspCam.aspect = aspect;
        perspCam.updateProjectionMatrix();
        updateOrthoFrustum(aspect);
    }
    new ResizeObserver(resize).observe(viewport);

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, activeCam);
    }

    /* ========================================================
       9. Export
       ======================================================== */
    function exportImage() {
        const fmt = ui.expFormat.value;                       // png | png-alpha | jpeg
        let w, h;
        if (ui.expSize.value === 'custom') {
            w = parseInt(ui.expW.value, 10) || 2400;
            h = parseInt(ui.expH.value, 10) || 1800;
        } else {
            [w, h] = ui.expSize.value.split('x').map(Number);
        }
        w = Math.min(8192, Math.max(256, w));
        h = Math.min(8192, Math.max(256, h));

        const prevBg = scene.background;
        const prevPR = renderer.getPixelRatio();
        const prevW = canvas.width / prevPR, prevH = canvas.height / prevPR;
        const prevSelVis = selOutline.visible;
        selOutline.visible = false;              // selection highlight never appears in exports

        if (fmt === 'png-alpha') scene.background = null;
        else if (fmt === 'jpeg' && !scene.background) scene.background = new THREE.Color('#ffffff');

        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        const aspect = w / h;
        perspCam.aspect = aspect; perspCam.updateProjectionMatrix();
        updateOrthoFrustum(aspect);
        renderer.render(scene, activeCam);

        const mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
        const url = renderer.domElement.toDataURL(mime, 0.95);

        // restore
        scene.background = prevBg;
        selOutline.visible = prevSelVis;
        renderer.setPixelRatio(prevPR);
        renderer.setSize(prevW, prevH, false);
        resize();

        const a = document.createElement('a');
        const base = (state.meta.name || 'cross-section').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'cross-section';
        a.download = `${base}_${w}x${h}.${fmt === 'jpeg' ? 'jpg' : 'png'}`;
        a.href = url;
        a.click();
        toast(`Exported ${w} × ${h} ${fmt === 'jpeg' ? 'JPEG' : 'PNG'}`);
    }

    /* ========================================================
       10. Project save / load
       ======================================================== */
    function serializeProject() {
        return {
            app: 'cross-section-studio', version: 1,
            savedAt: new Date().toISOString(),
            meta: { ...state.meta },
            section: { ...state.section },
            camera: { ...state.camera },
            lighting: { ...state.lighting },
            background: { ...state.background },
            layers: state.layers.map(l => ({ ...l }))
        };
    }

    function saveProject() {
        const data = serializeProject();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        const base = (state.meta.name || 'section').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'section';
        a.download = base + '.pavement.json';
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast('Project saved');
    }

    function loadProject(data) {
        if (!data || data.app !== 'cross-section-studio' || !Array.isArray(data.layers)) {
            toast('Not a valid .pavement.json project'); return;
        }
        Object.assign(state.section, data.section || {});
        Object.assign(state.camera, data.camera || {});
        Object.assign(state.lighting, data.lighting || {});
        Object.assign(state.background, data.background || {});
        Object.assign(state.meta, data.meta || {});
        state.layers = data.layers.map(l => {
            const nl = makeLayer(l.name || 'Layer', MATERIALS[l.material] ? l.material : 'subgrade', l.thickness || 0, l.subgrade ? { subgrade: true } : {});
            ['visible', 'locked', 'tint', 'brightness', 'roughness', 'texScale', 'normalStrength'].forEach(k => { if (l[k] !== undefined) nl[k] = l[k]; });
            return nl;
        });
        if (!state.layers.some(l => l.subgrade)) {
            state.layers.push(makeLayer('Subgrade (infinite)', 'subgrade', 0, { subgrade: true }));
        }
        selectedId = state.layers[0].id;
        syncAllInputs();
        rebuildSection();
        applyBackground();
        applyCameraFromState(true);
        renderLayerRows();
        renderMaterialEditor();
        pushHistory();
        toast('Project loaded');
    }

    /* ========================================================
       11. Undo / redo
       ======================================================== */
    const history = { stack: [], index: -1, max: 60 };

    function snapshot() {
        return JSON.stringify({
            section: state.section, layers: state.layers,
            lighting: state.lighting, background: state.background
        });
    }

    function pushHistory() {
        const snap = snapshot();
        if (history.stack[history.index] === snap) return;
        history.stack = history.stack.slice(0, history.index + 1);
        history.stack.push(snap);
        if (history.stack.length > history.max) history.stack.shift();
        history.index = history.stack.length - 1;
        updateUndoButtons();
    }

    function restore(snap) {
        const d = JSON.parse(snap);
        Object.assign(state.section, d.section);
        Object.assign(state.lighting, d.lighting);
        Object.assign(state.background, d.background);
        state.layers = d.layers;
        if (!state.layers.some(l => l.id === selectedId)) selectedId = state.layers[0] && state.layers[0].id;
        syncAllInputs();
        rebuildSection();
        applyBackground();
        renderLayerRows();
        renderMaterialEditor();
    }

    function undo() { if (history.index > 0) { history.index--; restore(history.stack[history.index]); updateUndoButtons(); } }
    function redo() { if (history.index < history.stack.length - 1) { history.index++; restore(history.stack[history.index]); updateUndoButtons(); } }

    function updateUndoButtons() {
        ui.undo.disabled = history.index <= 0;
        ui.redo.disabled = history.index >= history.stack.length - 1;
    }

    /* ========================================================
       12. UI
       ======================================================== */
    const $ = id => document.getElementById(id);
    const ui = {
        template: $('xs-template'), undo: $('xs-undo'), redo: $('xs-redo'),
        open: $('xs-open'), save: $('xs-save'), fileInput: $('xs-file-input'),
        reset: $('xs-reset'), export: $('xs-export'),
        secWidth: $('xs-sec-width'), secLength: $('xs-sec-length'),
        secRecessX: $('xs-sec-recess-x'), secRecessZ: $('xs-sec-recess-z'),
        secSubgrade: $('xs-sec-subgrade'),
        camProj: $('xs-cam-proj'), camAz: $('xs-cam-az'), camEl: $('xs-cam-el'),
        camFov: $('xs-cam-fov'), camIso: $('xs-cam-iso'), camFront: $('xs-cam-front'), camFit: $('xs-cam-fit'),
        lightPreset: $('xs-light-preset'), lightKey: $('xs-light-key'), lightAmb: $('xs-light-amb'),
        lightAz: $('xs-light-az'), lightEl: $('xs-light-el'),
        shadowOp: $('xs-shadow-op'), shadowSoft: $('xs-shadow-soft'), groundShadow: $('xs-ground-shadow'),
        bgMode: $('xs-bg-mode'), bgColor: $('xs-bg-color'), bgColorField: $('xs-bg-color-field'),
        expFormat: $('xs-exp-format'), expSize: $('xs-exp-size'), expCustom: $('xs-exp-custom'),
        expW: $('xs-exp-w'), expH: $('xs-exp-h'),
        metaName: $('xs-meta-name'), metaAuthor: $('xs-meta-author'), metaNotes: $('xs-meta-notes'),
        layerRows: $('xs-layer-rows'), layersTotal: $('xs-layers-total'), addLayer: $('xs-add-layer'),
        matGrid: $('xs-mat-grid'), selTag: $('xs-sel-tag'),
        matTint: $('xs-mat-tint'), matTintReset: $('xs-mat-tint-reset'), matBright: $('xs-mat-bright'),
        matRough: $('xs-mat-rough'), matScale: $('xs-mat-scale'), matNormal: $('xs-mat-normal'),
        matReset: $('xs-mat-reset'),
        hud: $('xs-hud'), toastWrap: $('xs-toast-wrap')
    };

    let selectedId = null;
    const selectedLayer = () => state.layers.find(l => l.id === selectedId) || null;

    function toast(msg) {
        const el = document.createElement('div');
        el.className = 'xs-toast';
        el.textContent = msg;
        ui.toastWrap.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    }

    function updateHud() {
        const s = state.section;
        ui.hud.textContent = `W ${s.width} × L ${s.length} × D ${sceneInfo.totalDepth} mm`;
        const engDepth = state.layers.reduce((a, l) => a + (l.subgrade ? 0 : l.thickness), 0);
        ui.layersTotal.textContent = `Σ ${engDepth} mm above subgrade`;
    }

    function syncAllInputs() {
        const s = state.section, c = state.camera, L = state.lighting, b = state.background;
        ui.secWidth.value = s.width; ui.secLength.value = s.length;
        ui.secRecessX.value = s.recessX; ui.secRecessZ.value = s.recessZ;
        ui.secSubgrade.value = s.subgradeDisplay;
        ui.camProj.value = c.mode; ui.camAz.value = c.azimuth; ui.camEl.value = c.elevation; ui.camFov.value = c.fov;
        ui.camFov.disabled = c.mode !== 'persp';
        ui.lightPreset.value = L.preset; ui.lightKey.value = L.key; ui.lightAmb.value = L.ambient;
        ui.lightAz.value = L.azimuth; ui.lightEl.value = L.elevation;
        ui.shadowOp.value = L.shadowOpacity; ui.shadowSoft.value = L.shadowSoftness;
        ui.groundShadow.checked = L.groundShadow;
        ui.bgMode.value = b.mode; ui.bgColor.value = b.color;
        ui.bgColorField.hidden = b.mode !== 'color';
        ui.metaName.value = state.meta.name; ui.metaAuthor.value = state.meta.author; ui.metaNotes.value = state.meta.notes;
    }

    /* ---------------- Layer manager ---------------- */
    function materialOptionsHtml(current) {
        return MATERIAL_GROUPS.map(g =>
            `<optgroup label="${g.label}">` +
            g.keys.map(k => `<option value="${k}" ${k === current ? 'selected' : ''}>${MATERIALS[k].name}</option>`).join('') +
            '</optgroup>').join('');
    }

    function renderLayerRows() {
        ui.layerRows.innerHTML = '';
        state.layers.forEach((layer, idx) => {
            if (idx > 0) {
                const ins = document.createElement('div');
                ins.className = 'xs-layer-insert';
                ins.dataset.idx = idx;
                ins.innerHTML = `<button class="xs-insert-btn" type="button" title="Insert a layer here"><i class="fas fa-plus"></i><span>Insert layer</span></button>`;
                ui.layerRows.appendChild(ins);
            }
            const def = MATERIALS[layer.material] || MATERIALS.subgrade;
            const texs = generateMaterial(layer.material in MATERIALS ? layer.material : 'subgrade');
            const row = document.createElement('div');
            row.className = 'xs-layer-row'
                + (layer.id === selectedId ? ' is-selected' : '')
                + (!layer.visible ? ' is-hidden' : '')
                + (layer.subgrade ? ' is-subgrade' : '');
            row.dataset.id = layer.id;

            const isFirst = idx === 0;
            const isLastMovable = idx >= state.layers.length - 2; // can't move below subgrade
            const lockAttr = layer.locked ? 'disabled' : '';

            row.innerHTML = `
                <div class="xs-layer-move">
                    <button title="Move up" data-act="up" ${isFirst || layer.subgrade ? 'disabled' : ''}><i class="fas fa-chevron-up"></i></button>
                    <button title="Move down" data-act="down" ${isLastMovable || layer.subgrade ? 'disabled' : ''}><i class="fas fa-chevron-down"></i></button>
                </div>
                <div class="xs-layer-swatch" style="background-image:url('${texs.thumbUrl}')"></div>
                <div class="xs-layer-name">
                    <input type="text" value="${layer.name.replace(/"/g, '&quot;')}" data-act="rename" ${lockAttr}>
                    <span class="xs-layer-spec">${def.spec}</span>
                </div>
                <div class="xs-layer-mat-cell">
                    <select class="xs-select" data-act="material" ${lockAttr} style="max-width:100%">
                        ${materialOptionsHtml(layer.material)}
                    </select>
                </div>
                <div class="xs-layer-thick">
                    ${layer.subgrade
                        ? `<i class="fas fa-infinity" title="Infinite — display thickness set in Section Geometry"></i> <span>${state.section.subgradeDisplay} mm*</span>`
                        : `<input type="number" class="xs-num" data-act="thickness" value="${layer.thickness}" min="5" max="3000" step="5" ${lockAttr}> mm`}
                </div>
                <div class="xs-layer-actions">
                    <button class="xs-icon-btn ${layer.visible ? 'is-active' : ''}" data-act="visible" title="${layer.visible ? 'Hide layer' : 'Show layer'}"><i class="fas fa-eye${layer.visible ? '' : '-slash'}"></i></button>
                    <button class="xs-icon-btn ${layer.locked ? 'is-active' : ''}" data-act="lock" title="${layer.locked ? 'Unlock layer' : 'Lock layer'}"><i class="fas fa-${layer.locked ? 'lock' : 'lock-open'}"></i></button>
                    <button class="xs-icon-btn" data-act="dup" title="Duplicate layer" ${layer.subgrade ? 'disabled' : ''}><i class="fas fa-clone"></i></button>
                    <button class="xs-icon-btn xs-icon-btn--danger" data-act="del" title="Delete layer" ${layer.subgrade || layer.locked ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
                </div>`;
            ui.layerRows.appendChild(row);
        });
        updateHud();
    }

    ui.layerRows.addEventListener('click', e => {
        const insBtn = e.target.closest('.xs-insert-btn');
        if (insBtn) {
            const at = parseInt(insBtn.parentElement.dataset.idx, 10);
            const nl = makeLayer('New Layer', 'p209', 150);
            state.layers.splice(at, 0, nl);
            selectedId = nl.id;
            rebuildSection(); renderLayerRows(); renderMaterialEditor(); pushHistory();
            return;
        }
        const row = e.target.closest('.xs-layer-row');
        if (!row) return;
        const layer = state.layers.find(l => l.id === row.dataset.id);
        if (!layer) return;
        const btn = e.target.closest('[data-act]');
        const act = btn && btn.dataset.act;

        if (!act || act === 'rename' || act === 'thickness' || act === 'material') {
            if (selectedId !== layer.id) { selectedId = layer.id; renderLayerRows(); renderMaterialEditor(); }
            return;
        }

        const idx = state.layers.indexOf(layer);
        switch (act) {
            case 'up':
                if (idx > 0 && !layer.subgrade) { state.layers.splice(idx, 1); state.layers.splice(idx - 1, 0, layer); }
                break;
            case 'down':
                if (idx < state.layers.length - 2 && !layer.subgrade) { state.layers.splice(idx, 1); state.layers.splice(idx + 1, 0, layer); }
                break;
            case 'visible': layer.visible = !layer.visible; break;
            case 'lock': layer.locked = !layer.locked; break;
            case 'dup': {
                if (layer.subgrade || layer.locked) return;
                const copy = makeLayer(layer.name + ' (copy)', layer.material, layer.thickness);
                ['tint', 'brightness', 'roughness', 'texScale', 'normalStrength'].forEach(k => { copy[k] = layer[k]; });
                state.layers.splice(idx + 1, 0, copy);
                break;
            }
            case 'del':
                if (layer.subgrade || layer.locked) return;
                state.layers.splice(idx, 1);
                if (selectedId === layer.id) selectedId = state.layers[0] && state.layers[0].id;
                break;
            default: return;
        }
        selectedId = act === 'del' ? selectedId : layer.id;
        rebuildSection();
        renderLayerRows();
        renderMaterialEditor();
        pushHistory();
    });

    ui.layerRows.addEventListener('change', e => {
        const row = e.target.closest('.xs-layer-row');
        if (!row) return;
        const layer = state.layers.find(l => l.id === row.dataset.id);
        if (!layer || layer.locked) return;
        const act = e.target.dataset.act;
        if (act === 'rename') { layer.name = e.target.value.trim() || layer.name; }
        else if (act === 'thickness') {
            const v = parseFloat(e.target.value);
            if (v > 0) layer.thickness = v;
        }
        else if (act === 'material') {
            layer.material = e.target.value;
            layer.roughness = null; layer.normalStrength = null; // re-adopt preset
        }
        else return;
        selectedId = layer.id;
        rebuildSection();
        renderLayerRows();
        renderMaterialEditor();
        pushHistory();
    });

    ui.addLayer.addEventListener('click', () => {
        const nl = makeLayer('New Layer', 'p209', 150);
        state.layers.unshift(nl);
        selectedId = nl.id;
        rebuildSection(); renderLayerRows(); renderMaterialEditor(); pushHistory();
    });

    /* ---------------- Viewport click-to-select ---------------- */
    const raycaster = new THREE.Raycaster();
    let pointerDownAt = null;
    canvas.addEventListener('pointerdown', e => {
        if (e.button === 0) pointerDownAt = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', e => {
        if (!pointerDownAt || e.button !== 0) { pointerDownAt = null; return; }
        const dx = e.clientX - pointerDownAt.x, dy = e.clientY - pointerDownAt.y;
        pointerDownAt = null;
        if (dx * dx + dy * dy > 36) return;              // treat as orbit drag, not a click
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(ndc, activeCam);
        const hit = raycaster.intersectObjects(sectionGroup ? sectionGroup.children : [], false)
            .find(hh => hh.object.isMesh && hh.object.userData.layerId);
        if (!hit) return;
        if (selectedId !== hit.object.userData.layerId) {
            selectedId = hit.object.userData.layerId;
            renderLayerRows();
            renderMaterialEditor();
        }
    });

    /* ---------------- Material editor ---------------- */
    function buildMaterialGrid() {
        ui.matGrid.innerHTML = '';
        const pending = [];
        MATERIAL_GROUPS.forEach(group => {
            const lab = document.createElement('div');
            lab.className = 'xs-mat-group-label';
            lab.textContent = group.label;
            ui.matGrid.appendChild(lab);
            group.keys.forEach(key => {
                const tile = document.createElement('button');
                tile.type = 'button';
                tile.className = 'xs-mat-tile';
                tile.dataset.key = key;
                tile.innerHTML = `
                    <span class="xs-mat-thumb"></span>
                    <span class="xs-mat-label">${MATERIALS[key].name}</span>`;
                tile.title = MATERIALS[key].spec;
                tile.addEventListener('click', () => {
                    const layer = selectedLayer();
                    if (!layer || layer.locked) { toast(layer ? 'Layer is locked' : 'Select a layer first'); return; }
                    layer.material = key;
                    layer.roughness = null; layer.normalStrength = null;
                    rebuildSection(); renderLayerRows(); renderMaterialEditor(); pushHistory();
                });
                ui.matGrid.appendChild(tile);
                pending.push([key, tile.querySelector('.xs-mat-thumb')]);
            });
        });
        // generate thumbnails one per tick so 18 hi-res materials don't block boot
        (function fillNext() {
            if (!pending.length) return;
            const [key, thumbEl] = pending.shift();
            thumbEl.style.backgroundImage = `url('${generateMaterial(key).thumbUrl}')`;
            setTimeout(fillNext, 0);
        })();
    }

    function renderMaterialEditor() {
        const layer = selectedLayer();
        updateSelectionOutline();
        ui.matGrid.querySelectorAll('.xs-mat-tile').forEach(t =>
            t.classList.toggle('is-active', !!layer && t.dataset.key === layer.material));
        if (!layer) { ui.selTag.textContent = 'No layer selected'; return; }
        const def = MATERIALS[layer.material] || MATERIALS.subgrade;
        ui.selTag.textContent = layer.name;
        ui.matTint.value = layer.tint || '#ffffff';
        ui.matBright.value = layer.brightness != null ? layer.brightness : 1;
        ui.matRough.value = layer.roughness != null ? layer.roughness : def.rough;
        ui.matScale.value = layer.texScale != null ? layer.texScale : 1;
        ui.matNormal.value = layer.normalStrength != null ? layer.normalStrength : def.normal;
    }

    function onMatPropChange(mutator) {
        const layer = selectedLayer();
        if (!layer) return;
        if (layer.locked) { toast('Layer is locked'); return; }
        mutator(layer);
        rebuildSection();
        pushHistoryDebounced();
    }

    ui.matTint.addEventListener('input', () => onMatPropChange(l => { l.tint = ui.matTint.value; }));
    ui.matTintReset.addEventListener('click', () => onMatPropChange(l => { l.tint = null; ui.matTint.value = '#ffffff'; }));
    ui.matBright.addEventListener('input', () => onMatPropChange(l => { l.brightness = parseFloat(ui.matBright.value); }));
    ui.matRough.addEventListener('input', () => onMatPropChange(l => { l.roughness = parseFloat(ui.matRough.value); }));
    ui.matScale.addEventListener('input', () => onMatPropChange(l => { l.texScale = parseFloat(ui.matScale.value); }));
    ui.matNormal.addEventListener('input', () => onMatPropChange(l => { l.normalStrength = parseFloat(ui.matNormal.value); }));
    ui.matReset.addEventListener('click', () => onMatPropChange(l => {
        l.tint = null; l.brightness = 1; l.roughness = null; l.texScale = 1; l.normalStrength = null;
        renderMaterialEditor();
    }));

    let historyTimer = null;
    function pushHistoryDebounced() {
        clearTimeout(historyTimer);
        historyTimer = setTimeout(pushHistory, 450);
    }

    /* ---------------- Section geometry inputs ---------------- */
    function bindSectionInput(input, key) {
        input.addEventListener('change', () => {
            const v = parseFloat(input.value);
            if (isNaN(v)) { input.value = state.section[key]; return; }
            state.section[key] = v;
            rebuildSection();
            renderLayerRows();
            pushHistory();
        });
    }
    bindSectionInput(ui.secWidth, 'width');
    bindSectionInput(ui.secLength, 'length');
    bindSectionInput(ui.secRecessX, 'recessX');
    bindSectionInput(ui.secRecessZ, 'recessZ');
    bindSectionInput(ui.secSubgrade, 'subgradeDisplay');

    /* ---------------- Camera inputs ---------------- */
    ui.camProj.addEventListener('change', () => {
        state.camera.mode = ui.camProj.value;
        ui.camFov.disabled = state.camera.mode !== 'persp';
        applyCameraFromState(false);
    });
    ui.camAz.addEventListener('input', () => { state.camera.azimuth = parseFloat(ui.camAz.value); applyCameraFromState(false); });
    ui.camEl.addEventListener('input', () => { state.camera.elevation = parseFloat(ui.camEl.value); applyCameraFromState(false); });
    ui.camFov.addEventListener('input', () => { state.camera.fov = parseFloat(ui.camFov.value); applyCameraFromState(false); });
    ui.camIso.addEventListener('click', () => {
        state.camera.azimuth = 45; state.camera.elevation = 35.264; state.camera.mode = ui.camProj.value;
        ui.camAz.value = 45; ui.camEl.value = 35.264;
        applyCameraFromState(true);
    });
    ui.camFront.addEventListener('click', () => {
        state.camera.azimuth = 0; state.camera.elevation = 10;
        ui.camAz.value = 0; ui.camEl.value = 10;
        applyCameraFromState(true);
    });
    ui.camFit.addEventListener('click', () => applyCameraFromState(true));

    /* ---------------- Lighting inputs ---------------- */
    ui.lightPreset.addEventListener('change', () => {
        const p = LIGHT_PRESETS[ui.lightPreset.value];
        Object.assign(state.lighting, {
            preset: ui.lightPreset.value,
            key: p.key, ambient: p.ambient, azimuth: p.azimuth, elevation: p.elevation,
            shadowOpacity: p.shadowOpacity, shadowSoftness: p.shadowSoftness
        });
        syncAllInputs();
        updateLightRig();
        pushHistory();
    });
    function bindLightInput(input, key, isCheck) {
        input.addEventListener(isCheck ? 'change' : 'input', () => {
            state.lighting[key] = isCheck ? input.checked : parseFloat(input.value);
            updateLightRig();
            pushHistoryDebounced();
        });
    }
    bindLightInput(ui.lightKey, 'key');
    bindLightInput(ui.lightAmb, 'ambient');
    bindLightInput(ui.lightAz, 'azimuth');
    bindLightInput(ui.lightEl, 'elevation');
    bindLightInput(ui.shadowOp, 'shadowOpacity');
    bindLightInput(ui.shadowSoft, 'shadowSoftness');
    bindLightInput(ui.groundShadow, 'groundShadow', true);

    /* ---------------- Background ---------------- */
    ui.bgMode.addEventListener('change', () => { state.background.mode = ui.bgMode.value; applyBackground(); pushHistory(); });
    ui.bgColor.addEventListener('input', () => { state.background.color = ui.bgColor.value; state.background.mode = 'color'; ui.bgMode.value = 'color'; applyBackground(); pushHistoryDebounced(); });

    /* ---------------- Export ---------------- */
    ui.expSize.addEventListener('change', () => { ui.expCustom.hidden = ui.expSize.value !== 'custom'; });
    ui.export.addEventListener('click', exportImage);

    /* ---------------- Meta ---------------- */
    ui.metaName.addEventListener('change', () => { state.meta.name = ui.metaName.value; });
    ui.metaAuthor.addEventListener('change', () => { state.meta.author = ui.metaAuthor.value; });
    ui.metaNotes.addEventListener('change', () => { state.meta.notes = ui.metaNotes.value; });

    /* ---------------- Toolbar ---------------- */
    function populateTemplates() {
        ui.template.innerHTML = '<option value="" disabled selected>Templates…</option>';
        const groups = {};
        Object.keys(TEMPLATES).forEach(k => {
            const g = TEMPLATES[k].group || 'Built-in';
            (groups[g] = groups[g] || []).push(k);
        });
        Object.keys(groups).forEach(gName => {
            const og = document.createElement('optgroup'); og.label = gName;
            groups[gName].forEach(k => {
                const o = document.createElement('option'); o.value = k; o.textContent = TEMPLATES[k].name;
                og.appendChild(o);
            });
            ui.template.appendChild(og);
        });

        const saved = JSON.parse(localStorage.getItem('xs-user-templates') || '{}');
        const names = Object.keys(saved);
        if (names.length) {
            const gUser = document.createElement('optgroup'); gUser.label = 'My templates';
            names.forEach(n => {
                const o = document.createElement('option'); o.value = 'user:' + n; o.textContent = n;
                gUser.appendChild(o);
            });
            ui.template.appendChild(gUser);
        }
        const oSave = document.createElement('option');
        oSave.value = '__save__'; oSave.textContent = '💾 Save current as template…';
        ui.template.appendChild(oSave);
    }

    ui.template.addEventListener('change', () => {
        const v = ui.template.value;
        ui.template.selectedIndex = 0;
        if (!v) return;
        if (v === '__save__') {
            const name = prompt('Template name:');
            if (!name) return;
            const saved = JSON.parse(localStorage.getItem('xs-user-templates') || '{}');
            saved[name] = { name, layers: state.layers.filter(l => !l.subgrade).map(l => [l.name, l.material, l.thickness]) };
            localStorage.setItem('xs-user-templates', JSON.stringify(saved));
            populateTemplates();
            toast(`Template "${name}" saved`);
            return;
        }
        let tpl = null;
        if (v.startsWith('user:')) {
            const saved = JSON.parse(localStorage.getItem('xs-user-templates') || '{}');
            tpl = saved[v.slice(5)];
        } else tpl = TEMPLATES[v];
        if (!tpl) return;
        applyTemplate(tpl);
        rebuildSection();
        applyCameraFromState(true);
        renderLayerRows();
        renderMaterialEditor();
        pushHistory();
        toast(tpl.name + ' applied');
    });

    ui.undo.addEventListener('click', undo);
    ui.redo.addEventListener('click', redo);
    document.addEventListener('keydown', e => {
        if (e.target.matches('input, textarea, select')) return;
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
    });

    ui.save.addEventListener('click', saveProject);
    ui.open.addEventListener('click', () => ui.fileInput.click());
    ui.fileInput.addEventListener('change', () => {
        const f = ui.fileInput.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
            try { loadProject(JSON.parse(reader.result)); }
            catch { toast('Could not parse project file'); }
        };
        reader.readAsText(f);
        ui.fileInput.value = '';
    });

    ui.reset.addEventListener('click', () => {
        if (!confirm('Reset the section, camera and lighting to defaults?')) return;
        Object.assign(state.section, DEFAULTS.section);
        Object.assign(state.camera, DEFAULTS.camera);
        Object.assign(state.lighting, DEFAULTS.lighting);
        Object.assign(state.background, DEFAULTS.background);
        state.layers = defaultLayers();
        selectedId = state.layers[0].id;
        syncAllInputs();
        rebuildSection();
        applyBackground();
        applyCameraFromState(true);
        renderLayerRows();
        renderMaterialEditor();
        pushHistory();
        toast('Reset to defaults');
    });

    /* ========================================================
       13. Boot
       ======================================================== */
    state.layers = defaultLayers();
    selectedId = state.layers[0].id;

    buildMaterialGrid();
    syncAllInputs();
    resize();
    rebuildSection();
    applyBackground();
    applyCameraFromState(true);
    renderLayerRows();
    renderMaterialEditor();
    populateTemplates();
    pushHistory();
    animate();
})();
