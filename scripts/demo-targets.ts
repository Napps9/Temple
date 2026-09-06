// Writes public/demo-targets.json from src/lib/demo-targets.ts, so the
// marketing repo can fetch or vendor the list the sign-in screen actually
// honours instead of keeping its own copy by hand.
//
//   npx tsx scripts/demo-targets.ts
//
// src/lib/demo-targets.test.ts fails CI when the committed file differs
// from what this would write.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { demoTargetsJson } from '../src/lib/demo-targets';

export const DEMO_TARGETS_JSON_PATH = fileURLToPath(
  new URL('../public/demo-targets.json', import.meta.url),
);

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(DEMO_TARGETS_JSON_PATH, demoTargetsJson());
  console.log(`wrote ${DEMO_TARGETS_JSON_PATH}`);
}
