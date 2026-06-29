import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

// E2E harness for the web build. There is no backend bundled with the
// repo, so the suite is pointed at a running app + Supabase via env:
//
//   E2E_BASE_URL   - URL of an already-running app (Vercel preview, a
//                    local `npm run web`, a staging deploy). When set, no
//                    server is started. When unset we boot `npm run web`
//                    locally (needs a local Supabase + .env.local).
//
// See docs/e2e.md for the full env contract and how to run.

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8081';
const startLocalServer = !process.env.E2E_BASE_URL;

// The remote/dev sandboxes ship a Chromium under /opt/pw-browsers that
// does not match the version this @playwright/test pins, so we launch the
// pre-installed binary by path instead of a downloaded one. Locally
// (binary absent) Playwright falls back to its managed browser.
const preinstalledChromium =
  process.env.E2E_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalledChromium)
  ? preinstalledChromium
  : undefined;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.artifacts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]]
    : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: startLocalServer
    ? {
        command: 'npm run web',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    : undefined,
});
