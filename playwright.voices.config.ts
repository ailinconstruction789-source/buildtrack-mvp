import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests', testMatch: 'customer-voices.spec.ts', fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 60_000, expect: { timeout: 15_000 },
  outputDir: 'node_modules/.cache/buildtrack-voices-browser/results',
  reporter: [['list'], ['json', { outputFile: 'node_modules/.cache/buildtrack-voices-browser/report.json' }]],
  use: { baseURL: 'http://127.0.0.1:3146', headless: true, trace: 'off', video: 'off', screenshot: 'only-on-failure', serviceWorkers: 'block' },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'node scripts/sales-ui-test/server.mjs', url: 'http://127.0.0.1:3146/customer-voices',
    reuseExistingServer: false, timeout: 360_000, stdout: 'pipe' },
});
