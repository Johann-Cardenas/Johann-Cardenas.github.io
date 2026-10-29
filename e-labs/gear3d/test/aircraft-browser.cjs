/* Optional browser integration test. Requires playwright-core and an HTTP server.
 * GEAR3D_TEST_URL defaults to http://127.0.0.1:8765/e-labs/gear3d/.
 */
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

const cases = [
    ['atr72-500', 'ATR72-500'], ['erj145-er', 'ERJ145'], ['erj145-lr', 'ERJ145'],
    ['dhc8-300-basic', 'DHC8-300'], ['dhc8-300-hgw', 'DHC8-300'],
    ['a319-neo', 'A319'], ['a320-neo', 'A320'], ['a321-neo', 'A321'],
    ['a321-neo-xlr', 'A321'], ['a330-200f', 'A330-200'],
    ['a330-800', 'A330-200'], ['a330-900', 'A330-300']
];

(async () => {
    const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'gear3d-aircraft-'));
    const browser = await chromium.launch({
        executablePath: process.env.GEAR3D_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        headless: true,
        args: ['--enable-unsafe-swiftshader']
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
        const errors = [];
        page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
        await page.goto(process.env.GEAR3D_TEST_URL || 'http://127.0.0.1:8765/e-labs/gear3d/', {
            waitUntil: 'domcontentloaded', timeout: 120000
        });
        await page.waitForFunction(() => Number(document.querySelector('#g3-unit-count').textContent) > 0, { timeout: 120000 });
        await page.locator('#g3-domain').selectOption('aircraft');
        await page.locator('#g3-category').selectOption('');
        for (const [id, expectedBody] of cases) {
            await page.locator('#g3-unit').selectOption(id);
            await page.waitForFunction(() => document.querySelector('#g3-chassis-notice').textContent.includes('Illustrative overlay'), { timeout: 120000 });
            const result = await page.evaluate(async id => {
                const bodies = await import('./src/geometry/vehicleBody.js');
                const { resolveLayout } = await import('./src/core/layout.js');
                const file = id.startsWith('a3') ? 'airbus-derivatives' : 'regional-expansion';
                const { units } = await (await fetch(`./src/data/aircraft/${file}.json`)).json();
                const unit = units.find(u => u.id === id);
                await bodies.ensureVehicleBody(unit, './assets/');
                const body = bodies.buildVehicleBody(resolveLayout(unit));
                let meshes = 0, finite = true;
                body?.traverse(object => {
                    if (object.isMesh) meshes++;
                    finite &&= object.matrix.elements.every(Number.isFinite);
                });
                const result = {
                    spec: bodies.vehicleBodySpec(unit), status: bodies.vehicleBodyStatus(unit),
                    meshes, finite, fit: body?.userData.aircraftFit
                };
                // Release the test's fitted clone; the live assembly remains independent.
                body?.releaseGeometry?.();
                body?.traverse(object => {
                    if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
                    else object.material?.dispose();
                });
                return result;
            }, id);
            assert.equal(result.status, 'ready', id);
            assert.equal(result.spec.id, expectedBody, id);
            assert.ok(result.meshes > 0 && result.finite, `${id}: finite fitted geometry`);
            assert.ok(result.fit.length > 0, `${id}: published body length applied`);
            if (id.startsWith('a3') || id.startsWith('erj145')) assert.equal(result.spec.representative, true, id);
            console.log(`PASS browser model and fitted body: ${id} → ${expectedBody}`);
            if (['atr72-500', 'erj145-lr', 'dhc8-300-hgw'].includes(id)) {
                await page.locator('.g3-figure').screenshot({ path: path.join(artifacts, `${id}.png`) });
            }
        }
        assert.deepEqual(errors, []);
        console.log(`PASS all 12 models load through the UI without runtime errors. Screenshots: ${artifacts}`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
