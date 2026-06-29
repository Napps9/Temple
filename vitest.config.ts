import { defineConfig } from 'vitest/config';

// Unit tests live under src/. Scoping the glob here keeps vitest from
// trying to run the Playwright E2E specs in e2e/ (also *.spec.ts), which
// import @playwright/test and only run under the Playwright runner.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
