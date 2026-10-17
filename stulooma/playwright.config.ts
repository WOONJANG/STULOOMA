import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      executablePath: process.env.STULOOMA_CHROMIUM || '/usr/bin/chromium',
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
