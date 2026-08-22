// Exports the web build pointed at the harness rather than at Supabase.
//
// The URL is read at build time by src/lib/supabase.ts, so this is the
// whole trick: the bundle believes localhost:8100 is its backend, and
// every line of app code runs unmodified.

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const OUT = process.env.SHOT_EXPORT_DIR || '/tmp/shot-export';
const PORT = process.env.SHOT_PORT || '8100';

rmSync(OUT, { recursive: true, force: true });

execFileSync(
  'npx',
  // --clear matters: EXPO_PUBLIC_* is inlined at transform time, so a
  // cached module keeps whatever URL the last build baked in and the app
  // quietly talks to the wrong backend.
  ['expo', 'export', '-p', 'web', '--output-dir', OUT, '--clear'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_PUBLIC_SUPABASE_URL: `http://localhost:${PORT}`,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'harness-anon-key',
    },
  },
);

console.log(`exported to ${OUT}, pointed at http://localhost:${PORT}`);
