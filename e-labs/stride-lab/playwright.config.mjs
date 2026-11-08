import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './test/browser', testMatch: '**/*.spec.mjs',
    timeout: 300000, expect: { timeout: 10000 }, workers: 1, retries: 0,
    forbidOnly: !!process.env.CI,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:8765', viewport: { width: 1440, height: 1000 },
        screenshot: 'only-on-failure', trace: 'retain-on-failure',
        actionTimeout: 15000,
        launchOptions: { args: process.env.STRIDE_SOFTWARE_GL === '1' ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] }
    },
    projects: [
        { name: 'chrome', use: { browserName: 'chromium', channel: process.env.STRIDE_BROWSER_CHANNEL || 'chrome' } },
        { name: 'firefox', use: { browserName: 'firefox' } }
    ],
    webServer: { command: 'node test/browser/server.mjs', url: 'http://127.0.0.1:8765/e-labs/stride-lab/', reuseExistingServer: false }
});
