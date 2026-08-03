// Browser journeys against the running app — the layer nothing else
// covers. jsdom has no layout engine and the render tests stub
// NativeWind, so a real browser is the only thing in the repo that can
// see a wrapped label, a missing card, or the whole stack disagreeing.
//
// Prerequisites (docs/running-a-gym.md):
//   - a running stack with the demo gym seeded (npm run seed:demo)
//   - the web app served (this config starts `expo start --web` itself
//     unless E2E_BASE_URL points at one already running)
//   - journeys 2 and 3 talk to the parser edge functions, so those need
//     the functions reachable and ANTHROPIC_API_KEY set — set
//     E2E_PARSER=0 to skip them on a stack without it.
//
// Two projects on purpose: the campaign-report bug this suite exists
// for (StatTile wrapping "RECIPIENTS" mid-word) only shows at phone
// width. Everything runs at both.

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8081';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // The journeys share one seeded gym and journey 3 writes to it —
  // serial keeps the runs readable and the gym's state explainable.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npx expo start --web --port 8081',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
