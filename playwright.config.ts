// Browser journeys against the running app — the layer nothing else
// covers. jsdom has no layout engine and the render tests stub
// NativeWind, so a real browser is the only thing in the repo that can
// see a wrapped label, a missing card, or the whole stack disagreeing.
//
// Runs against the DEPLOYED app by default — this project does all its
// testing where it lives (Vercel + hosted Supabase), so the target is
// app.jointemple.io with the demo gym seeded there (the "Demo gym"
// workflow). E2E_BASE_URL overrides for anyone pointing it elsewhere.
//
// Prerequisites (docs/running-a-gym.md):
//   - the demo gym seeded on the target (Demo gym workflow -> seed)
//   - journeys 2 and 3 talk to the parser edge functions, so those need
//     ANTHROPIC_API_KEY set on the hosted functions — set E2E_PARSER=0
//     to skip them where it isn't.
//
// Two projects on purpose: the campaign-report bug this suite exists
// for (StatTile wrapping "RECIPIENTS" mid-word) only shows at phone
// width. Everything runs at both.

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'https://app.jointemple.io';

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
});
