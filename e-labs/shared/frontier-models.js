/* Procedural visuals restored from Frontier before da93986; pure teaching models. */
(function(root) {
  "use strict";
        function _hash(n) { let s = Math.sin(n) * 43758.5453; return s - Math.floor(s); }
        function _noise2d(x, y) {
            const ix = Math.floor(x), iy = Math.floor(y);
            const fx = x - ix, fy = y - iy;
            const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
            const a = _hash(ix + iy * 57.0);
            const b = _hash(ix + 1 + iy * 57.0);
            const c = _hash(ix + (iy + 1) * 57.0);
            const d = _hash(ix + 1 + (iy + 1) * 57.0);
            return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
        }
        function _fbm(x, y, octaves) {
            let v = 0, amp = 0.5, freq = 1;
            for (let i = 0; i < octaves; i++) { v += amp * _noise2d(x * freq, y * freq); amp *= 0.5; freq *= 2.0; }
            return v;
        }
        function _clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
        function _mix(a, b, t) { return a + (b - a) * t; }
        function _smoothstep(a, b, t) { const x = _clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }

        // Image generators — upgraded for visual complexity
        const imageGenerators = {
            // ─── Plasma: multi-octave turbulence with vivid HSL cycling ───
            plasma: (x, y, size, t) => {
                const nx = x / size, ny = y / size;
                const v1 = Math.sin(nx * 12.0 + t) + Math.sin(ny * 12.0 + t * 0.7);
                const v2 = Math.sin(Math.sqrt((nx - 0.5) * (nx - 0.5) + (ny - 0.5) * (ny - 0.5)) * 14.0);
                const v3 = Math.sin(nx * 8.0 + ny * 6.0 + t * 1.3);
                const turb = _fbm(nx * 6.0 + t * 0.3, ny * 6.0 - t * 0.2, 4);
                const val = (v1 + v2 + v3 + turb * 2.0 + 5.0) / 10.0;
                const hue = (val * 360 + t * 60) % 360 / 360;
                return hslToRgb(hue, 0.85, 0.35 + val * 0.3);
            },

            // ─── Mandelbrot: deep zoom with smooth iteration coloring ───
            mandelbrot: (x, y, size) => {
                // Zoom into the Seahorse Valley
                const cx = -0.745 + (x / size - 0.5) * 0.015;
                const cy = 0.186 + (y / size - 0.5) * 0.015;
                let zx = 0, zy = 0, iter = 0;
                const maxIter = 200;
                while (zx * zx + zy * zy < 256 && iter < maxIter) {
                    const tmp = zx * zx - zy * zy + cx;
                    zy = 2 * zx * zy + cy;
                    zx = tmp;
                    iter++;
                }
                if (iter === maxIter) return { r: 0, g: 0, b: 0 };
                // Smooth iteration count
                const logZn = Math.log(zx * zx + zy * zy) / 2;
                const nu = Math.log(logZn / Math.log(2)) / Math.log(2);
                const smooth = iter + 1 - nu;
                const t = smooth / maxIter;
                // Rich palette: deep blue → cyan → gold → magenta → deep blue
                const r = Math.floor(255 * (0.5 + 0.5 * Math.cos(6.2832 * (t + 0.0))));
                const g = Math.floor(255 * (0.5 + 0.5 * Math.cos(6.2832 * (t + 0.33))));
                const b = Math.floor(255 * (0.5 + 0.5 * Math.cos(6.2832 * (t + 0.67))));
                return { r, g, b };
            },

            // ─── 3D Sphere: glass sphere with environment reflection + checker floor ───
            sphere3d: (x, y, size) => {
                const u = (x / size - 0.5) * 2.4;
                const v = (y / size - 0.5) * 2.4;
                const scx = 0.0, scy = -0.1;
                const rad = 0.75;
                const ddx = u - scx, ddy = v - scy;
                const dist2 = ddx * ddx + ddy * ddy;

                // Checker floor behind sphere
                function checkerFloor(uu, vv) {
                    const floorY = 0.65;
                    if (vv < floorY) return null;
                    const fz = 1.0 / (vv - floorY + 0.001);
                    const fx = uu * fz;
                    const check = ((Math.floor(fx * 1.5) + Math.floor(fz * 0.5)) & 1) === 0;
                    const fade = Math.min(1.0, 1.0 / (fz * 0.15 + 1));
                    const c = check ? 0.85 : 0.25;
                    return { r: Math.floor(c * fade * 200), g: Math.floor(c * fade * 210), b: Math.floor(c * fade * 230) };
                }

                if (dist2 > rad * rad) {
                    // Outside sphere — sky gradient or floor
                    const floor = checkerFloor(u, v);
                    if (floor) return floor;
                    const skyT = _clamp(0.5 - v * 0.6, 0, 1);
                    return { r: Math.floor(_mix(15, 70, skyT)), g: Math.floor(_mix(15, 50, skyT)), b: Math.floor(_mix(40, 130, skyT)) };
                }

                const nz = Math.sqrt(rad * rad - dist2);
                const nx = ddx / rad, ny = ddy / rad, nnz = nz / rad;
                const lx = 0.5, ly = -0.6, lz = 0.65;
                const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
                const diffuse = Math.max(0, (nx * lx + ny * ly + nnz * lz) / ll);
                // Reflection vector for environment mapping
                const dotNL = (nx * lx + ny * ly + nnz * lz) / ll;
                const rx = 2 * dotNL * nx - lx / ll;
                const ry = 2 * dotNL * ny - ly / ll;
                const specular = Math.pow(Math.max(0, nnz * 0.4 + ry * -0.3 + rx * 0.2), 48);
                // Fresnel rim
                const fresnel = Math.pow(1 - nnz, 3) * 0.7;
                // Tinted glass
                const baseR = 40 + diffuse * 100, baseG = 120 + diffuse * 80, baseB = 200 + diffuse * 40;
                const r = _clamp(Math.floor(baseR + specular * 220 + fresnel * 120), 0, 255);
                const g = _clamp(Math.floor(baseG + specular * 230 + fresnel * 180), 0, 255);
                const b = _clamp(Math.floor(baseB + specular * 255 + fresnel * 220), 0, 255);
                return { r, g, b };
            },

            // ─── Raymarching: multi-object scene with soft shadows & AO ───
            raymarching: (x, y, size) => {
                const u = (x / size - 0.5) * 2.2;
                const v = (y / size - 0.5) * 2.2;
                const ox = 0, oy = 0.4, oz = -3.5;
                const len = Math.sqrt(u * u + v * v + 1);
                const dx = u / len, dy = -v / len, dz = 1 / len;

                function sdSphere(px, py, pz, cx, cy, cz, r) {
                    const a = px - cx, b = py - cy, c = pz - cz;
                    return Math.sqrt(a * a + b * b + c * c) - r;
                }
                function sdBox(px, py, pz, bx, by, bz) {
                    const qx = Math.abs(px) - bx, qy = Math.abs(py) - by, qz = Math.abs(pz) - bz;
                    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
                    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
                }
                function sdTorus(px, py, pz, R, r) {
                    const qxz = Math.sqrt(px * px + pz * pz) - R;
                    return Math.sqrt(qxz * qxz + py * py) - r;
                }
                function scene(px, py, pz) {
                    const s = sdSphere(px, py, pz, -0.8, 0.35, 0.5, 0.55);
                    const b = sdBox(px - 0.7, py + 0.1, pz - 0.3, 0.4, 0.4, 0.4);
                    const t = sdTorus(px, py - 0.9, pz + 0.2, 0.6, 0.15);
                    const floor = py + 0.5;
                    return { d: Math.min(s, Math.min(b, Math.min(t, floor))), id: s < b && s < t && s < floor ? 1 : b < t && b < floor ? 2 : t < floor ? 3 : 0 };
                }

                let t = 0, hitId = -1;
                for (let i = 0; i < 80; i++) {
                    const px = ox + t * dx, py = oy + t * dy, pz = oz + t * dz;
                    const res = scene(px, py, pz);
                    if (res.d < 0.005) { hitId = res.id; break; }
                    t += res.d;
                    if (t > 15) break;
                }

                if (hitId < 0) {
                    const sky = _clamp(0.5 - v * 0.5, 0, 1);
                    return { r: Math.floor(_mix(10, 50, sky)), g: Math.floor(_mix(8, 30, sky)), b: Math.floor(_mix(25, 90, sky)) };
                }

                const hp = { x: ox + t * dx, y: oy + t * dy, z: oz + t * dz };
                const e = 0.001;
                const nx2 = scene(hp.x + e, hp.y, hp.z).d - scene(hp.x - e, hp.y, hp.z).d;
                const ny2 = scene(hp.x, hp.y + e, hp.z).d - scene(hp.x, hp.y - e, hp.z).d;
                const nz2 = scene(hp.x, hp.y, hp.z + e).d - scene(hp.x, hp.y, hp.z - e).d;
                const nl = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2) || 1;
                const nnx = nx2 / nl, nny = ny2 / nl, nnz = nz2 / nl;

                const llx = 1.5, lly = 2.0, llz = -1.0;
                const ldx = llx - hp.x, ldy = lly - hp.y, ldz = llz - hp.z;
                const ldl = Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz);
                const diff = Math.max(0, (nnx * ldx + nny * ldy + nnz * ldz) / ldl);
                const spec = Math.pow(Math.max(0, diff), 32);
                const ao = 0.6 + 0.4 * _clamp(scene(hp.x + nnx * 0.15, hp.y + nny * 0.15, hp.z + nnz * 0.15).d / 0.15, 0, 1);
                const fog = Math.exp(-t * 0.08);

                let cr, cg, cb;
                if (hitId === 0) { // floor checker
                    const ch = ((Math.floor(hp.x + 100) + Math.floor(hp.z + 100)) & 1) === 0;
                    cr = ch ? 200 : 60; cg = ch ? 200 : 60; cb = ch ? 210 : 65;
                } else if (hitId === 1) { cr = 220; cg = 80; cb = 80; }
                else if (hitId === 2) { cr = 80; cg = 180; cb = 220; }
                else { cr = 240; cg = 200; cb = 80; }

                const shade = (0.15 + diff * 0.65 + spec * 0.3) * ao * fog;
                return { r: _clamp(Math.floor(cr * shade), 0, 255), g: _clamp(Math.floor(cg * shade), 0, 255), b: _clamp(Math.floor(cb * shade), 0, 255) };
            },

            // ─── Galaxy: multi-arm spiral with nebula clouds, dust & stars ───
            galaxy: (x, y, size) => {
                const cx = size / 2, cy = size / 2;
                const ddx = (x - cx) / (size / 2), ddy = (y - cy) / (size / 2);
                const dist = Math.sqrt(ddx * ddx + ddy * ddy);
                const angle = Math.atan2(ddy, ddx);

                // Deterministic star field using hash
                const starSeed = _hash(x * 13.731 + y * 7.319);
                if (starSeed > 0.997) {
                    const bright = 180 + starSeed * 75;
                    return { r: Math.floor(bright), g: Math.floor(bright * 0.95), b: Math.floor(bright) };
                }

                // Multiple spiral arms
                let armBrightness = 0;
                for (let arm = 0; arm < 4; arm++) {
                    const armAngle = arm * Math.PI / 2;
                    const spiralAngle = angle - armAngle + dist * 4.0;
                    const wrap = ((spiralAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
                    const armWidth = 0.45 + dist * 0.25;
                    const armVal = Math.exp(-(wrap * wrap) / (armWidth * armWidth));
                    armBrightness += armVal;
                }

                // Core glow
                const coreGlow = Math.exp(-dist * dist * 6.0) * 1.5;
                // Nebula clouds
                const nebula = _fbm(ddx * 3.0 + 1.7, ddy * 3.0 + 2.3, 5) * 0.6;
                // Dust lanes (dark)
                const dust = _fbm(ddx * 5.0, ddy * 5.0 + 3.1, 4);
                const dustMask = _smoothstep(0.3, 0.55, dust) * 0.6;

                const falloff = Math.max(0, 1 - dist * 0.85);
                let brightness = (armBrightness * falloff + coreGlow + nebula * falloff * 0.5) * (1 - dustMask);
                brightness = _clamp(brightness, 0, 1);

                // Color: warm core → blue-purple arms
                const coreT = _clamp(coreGlow * 2, 0, 1);
                const r = _clamp(Math.floor(brightness * _mix(100, 255, coreT) + nebula * 40), 0, 255);
                const g = _clamp(Math.floor(brightness * _mix(70, 200, coreT) + nebula * 15), 0, 255);
                const b = _clamp(Math.floor(brightness * _mix(180, 180, coreT) + nebula * 60), 0, 255);
                return { r, g, b };
            },

            // ─── Ocean: realistic waves with sun reflection and atmospheric fog ───
            ocean: (x, y, size) => {
                const nx = x / size, ny = y / size;

                // Multi-layer waves
                const w1 = Math.sin(nx * 25 + ny * 3.5) * 0.35;
                const w2 = Math.sin(nx * 12 - ny * 18 + 1.2) * 0.25;
                const w3 = Math.sin((nx * 1.5 + ny) * 35 + 0.5) * 0.15;
                const w4 = _fbm(nx * 8.0, ny * 6.0, 4) * 0.25;
                const height = (w1 + w2 + w3 + w4 + 1) / 2;

                // Depth gradient (horizon at top)
                const depth = _clamp(ny, 0, 1);
                const fog = _smoothstep(0.0, 0.4, ny);

                // Foam on wave crests
                const foam = _smoothstep(0.68, 0.78, height) * (1 - depth * 0.5);

                // Sun reflection (sun at top-center)
                const sunX = 0.5, sunY = 0.05;
                const sunDist = Math.sqrt((nx - sunX) * (nx - sunX) + (ny - sunY) * (ny - sunY));
                const sunReflect = Math.exp(-sunDist * sunDist * 12) * (0.4 + height * 0.6) * _smoothstep(0.5, 0.0, ny);

                // Base water color
                const deepR = 10, deepG = 40, deepB = 90;
                const shallowR = 30, shallowG = 120, shallowB = 170;
                const t = _clamp(depth * 0.8 + height * 0.2, 0, 1);
                let r = _mix(shallowR, deepR, t) + height * 20 + foam * 200 + sunReflect * 250;
                let g = _mix(shallowG, deepG, t) + height * 30 + foam * 210 + sunReflect * 230;
                let b = _mix(shallowB, deepB, t) + height * 15 + foam * 180 + sunReflect * 180;

                // Horizon fog
                const fogR = 140, fogG = 160, fogB = 190;
                const fogAmt = 1 - fog;
                r = _mix(r, fogR, fogAmt * 0.7);
                g = _mix(g, fogG, fogAmt * 0.7);
                b = _mix(b, fogB, fogAmt * 0.7);

                return { r: _clamp(Math.floor(r), 0, 255), g: _clamp(Math.floor(g), 0, 255), b: _clamp(Math.floor(b), 0, 255) };
            },

            // ─── Tunnel: neon-lit infinite tunnel with smooth color transitions ───
            tunnel: (x, y, size) => {
                const cx = size / 2, cy = size / 2;
                const ddx = (x - cx) / cx, ddy = (y - cy) / cy;
                const dist = Math.sqrt(ddx * ddx + ddy * ddy);
                const angle = Math.atan2(ddy, ddx);

                if (dist < 0.005) return { r: 0, g: 0, b: 0 };

                const depth = 1.0 / dist;
                const twist = angle + depth * 0.4;

                // Hexagonal pattern
                const ringFreq = depth * 5.0;
                const segFreq = twist * 4.0 / Math.PI;
                const rings = Math.sin(ringFreq * Math.PI) * 0.5 + 0.5;
                const segs = Math.sin(segFreq * Math.PI) * 0.5 + 0.5;
                const pattern = rings * 0.6 + segs * 0.4;

                // Neon glow lines
                const neonRing = Math.exp(-Math.pow(Math.sin(ringFreq * Math.PI * 2) * 3, 2));
                const neonSeg = Math.exp(-Math.pow(Math.sin(segFreq * Math.PI * 2) * 3, 2));
                const neon = Math.max(neonRing * 0.8, neonSeg * 0.5);

                const fadeIn = _smoothstep(0.0, 0.3, dist);
                const fadeOut = _clamp(3.0 / (depth + 1), 0, 1);
                const brightness = fadeIn * fadeOut;

                // Color cycling by depth
                const hue = ((depth * 0.3 + angle * 0.15) % 1 + 1) % 1;
                const base = hslToRgb(hue, 0.7, pattern * 0.15 * brightness);
                const glow = hslToRgb((hue + 0.5) % 1, 1.0, 0.5);

                const r = _clamp(Math.floor(base.r + glow.r * neon * brightness * 1.4), 0, 255);
                const g = _clamp(Math.floor(base.g + glow.g * neon * brightness * 1.4), 0, 255);
                const b = _clamp(Math.floor(base.b + glow.b * neon * brightness * 1.4), 0, 255);
                return { r, g, b };
            },

            // ─── Terrain: 6-octave heightmap with biomes, lighting & atmosphere ───
            terrain3d: (x, y, size) => {
                const nx = x / size, ny = y / size;

                // 6-octave fractal terrain
                const height = _fbm(nx * 5.0 + 0.3, ny * 5.0 + 0.7, 6);

                // Normal for lighting via central differences
                const eps = 0.005;
                const hL = _fbm((nx - eps) * 5.0 + 0.3, ny * 5.0 + 0.7, 6);
                const hR = _fbm((nx + eps) * 5.0 + 0.3, ny * 5.0 + 0.7, 6);
                const hU = _fbm(nx * 5.0 + 0.3, (ny - eps) * 5.0 + 0.7, 6);
                const hD = _fbm(nx * 5.0 + 0.3, (ny + eps) * 5.0 + 0.7, 6);
                const dhdx = (hR - hL) / (2 * eps * 5);
                const dhdy = (hD - hU) / (2 * eps * 5);
                const nLen = Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
                const shade = Math.max(0, (-dhdx * 0.5 + -dhdy * 0.6 + 1) / nLen);
                const lighting = 0.25 + shade * 0.75;

                // Biome coloring by height
                let r, g, b;
                if (height < 0.28) { // Deep water
                    r = 20; g = 50; b = 130;
                } else if (height < 0.35) { // Shallow water
                    const t = (height - 0.28) / 0.07;
                    r = _mix(20, 40, t); g = _mix(50, 90, t); b = _mix(130, 150, t);
                } else if (height < 0.38) { // Sand / beach
                    r = 190; g = 175; b = 130;
                } else if (height < 0.58) { // Grass / forest
                    const t = (height - 0.38) / 0.20;
                    r = _mix(60, 35, t); g = _mix(145, 110, t); b = _mix(50, 35, t);
                } else if (height < 0.72) { // Rock / mountain
                    const t = (height - 0.58) / 0.14;
                    r = _mix(95, 130, t); g = _mix(80, 125, t); b = _mix(65, 115, t);
                } else { // Snow caps
                    const t = _smoothstep(0.72, 0.82, height);
                    r = _mix(130, 245, t); g = _mix(125, 245, t); b = _mix(115, 255, t);
                }

                // Atmospheric perspective
                const atmo = _smoothstep(0.0, 1.0, ny) * 0.15;
                r = _mix(r, 160, atmo); g = _mix(g, 180, atmo); b = _mix(b, 210, atmo);

                return { r: _clamp(Math.floor(r * lighting), 0, 255), g: _clamp(Math.floor(g * lighting), 0, 255), b: _clamp(Math.floor(b * lighting), 0, 255) };
            },

            // ─── Particles: nebula-style with 120 particles, glow & connections ───
            particles: (x, y, size) => {
                const numParticles = 120;
                let totalR = 0, totalG = 0, totalB = 0;

                for (let i = 0; i < numParticles; i++) {
                    const seed1 = _hash(i * 17.31);
                    const seed2 = _hash(i * 31.17 + 7);
                    const seed3 = _hash(i * 53.71 + 13);
                    const px = seed1 * size;
                    const py = seed2 * size;
                    const psize = 4 + seed3 * 22;
                    const ddx = x - px, ddy = y - py;
                    const dist = Math.sqrt(ddx * ddx + ddy * ddy);

                    if (dist < psize) {
                        const falloff = 1 - dist / psize;
                        const glow = falloff * falloff * falloff; // cubic falloff for soft glow
                        const hue = (seed1 + seed2 * 0.3) % 1;
                        const c = hslToRgb(hue, 0.85, 0.5);
                        totalR += c.r * glow * 0.9;
                        totalG += c.g * glow * 0.9;
                        totalB += c.b * glow * 0.9;
                    }
                }

                // Background nebula fog
                const fogVal = _fbm(x / size * 4.0 + 2.1, y / size * 4.0 + 3.7, 5);
                const fogBright = fogVal * 0.12;
                totalR += fogBright * 80;
                totalG += fogBright * 40;
                totalB += fogBright * 120;

                if (totalR < 2 && totalG < 2 && totalB < 2) {
                    // Faint star
                    const s = _hash(x * 7.13 + y * 13.37);
                    if (s > 0.998) return { r: 200, g: 200, b: 220 };
                    return { r: 3, g: 5, b: 15 };
                }

                return { r: _clamp(Math.floor(totalR), 0, 255), g: _clamp(Math.floor(totalG), 0, 255), b: _clamp(Math.floor(totalB), 0, 255) };
            }
        };
        function hslToRgb(h, s, l) {
            let r, g, b;
            if (s === 0) {
                r = g = b = l;
            } else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1/6) return p + (q - p) * 6 * t;
                    if (t < 1/2) return q;
                    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                    return p;
                };
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                r = hue2rgb(p, q, h + 1/3);
                g = hue2rgb(p, q, h);
                b = hue2rgb(p, q, h - 1/3);
            }
            return {
                r: Math.round(r * 255),
                g: Math.round(g * 255),
                b: Math.round(b * 255)
            };
        }
  const visuals = {
    plasma: "Neon Plasma", mandelbrot: "Deep Fractal", sphere3d: "Glass Sphere",
    raymarching: "3D Scene", galaxy: "Spiral Galaxy", ocean: "Ocean Sunset",
    tunnel: "Neon Tunnel", terrain3d: "World Map", particles: "Nebula"
  };
  function renderImage(visual = "plasma", resolution = 128) {
    if (!imageGenerators[visual] || ![32,64,128,256].includes(resolution)) throw new Error("Unsupported visual or resolution");
    const pixels = new Uint8ClampedArray(resolution * resolution * 4);
    for (let y=0; y<resolution; y++) for (let x=0; x<resolution; x++) {
      const c = imageGenerators[visual](x,y,resolution,0.7), k=(y*resolution+x)*4;
      pixels[k]=c.r; pixels[k+1]=c.g; pixels[k+2]=c.b; pixels[k+3]=255;
    }
    return pixels;
  }
  // Equal pixel counts, different illustrative scheduling orders. Eight by eight tiles
  // do not represent a specific GPU's block size or number of simultaneous threads.
  function pixelOrder(resolution, tiled=false) {
    const order = new Uint32Array(resolution**2), side=resolution/8;
    for(let k=0;k<order.length;k++) {
      if (!tiled) order[k]=k;
      else { const tile=k%64, offset=Math.floor(k/64); order[k]=(Math.floor(tile/8)*side+Math.floor(offset/side))*resolution+(tile%8)*side+offset%side; }
    }
    return order;
  }
  function renderStage(elapsed, {resolution=128, frames=1, launch=.12}={}) {
    const pixels=resolution**2;
    return Object.fromEntries([['cpu',pixels/8192,0],['gpu',pixels/131072,launch]].map(([name,compute,overhead])=>{
      const frameTime=compute+overhead,total=frameTime*frames, time=Math.max(0,Math.min(elapsed,total));
      const complete=time>=total, done=complete?frames:Math.floor(time/frameTime), within=time-done*frameTime;
      const fraction=complete?1:Math.max(0,Math.min(1,(within-overhead)/compute));
      return [name,{phase:complete?'Complete':within<overhead?'Launch / transfer':'Compute',completedFrames:done,frame:complete?frames-1:done,pixels:Math.floor(fraction*pixels),time,total,progress:complete?1:(done+fraction)/frames}];
    }));
  }
  const api={visuals,renderImage,pixelOrder,renderStage};
  if(typeof module!=="undefined" && module.exports) module.exports=api; else root.FrontierModels=api;
})(typeof window==="undefined"?globalThis:window);
