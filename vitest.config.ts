import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Until this file existed there was no vitest config at all, and one
// consequence shaped a lot of the codebase: anything importing
// `react-native` could not be parsed by the test runner ("Flow is not
// supported"), so 92 screens and every component had zero tests, and
// modules that touch `lib/supabase` had to be split in half before their
// logic could be tested at all.
//
// The alias is the whole fix. The app already runs on react-native-web —
// that is what Vercel serves — so pointing the runner at the same
// implementation the browser gets is not a test-only fiction. Components
// render through RNW into jsdom, and the modules that were untestable
// become testable.
//
// A `.test.tsx` file opts into a DOM with a docblock:
//
//     // @vitest-environment jsdom
//
// rather than the whole suite paying for one. The 1,599 existing
// `.test.ts` files keep the default node environment and are untouched by
// this — they never successfully imported react-native, so the alias
// cannot change what they see.
//
// WHAT A RENDER TEST HERE CATCHES, AND WHAT IT DOES NOT. jsdom has no
// layout engine: it does not compute width, wrapping or overflow. So
// these prove content and branching — the right tiles, the right copy,
// the right conditional — and they would NOT have caught the StatTile
// label wrapping mid-word, which is layout and needs a real browser. Both
// levels are worth having and neither substitutes for the other.
const stub = (name: string) =>
  fileURLToPath(new URL(`./test/${name}.tsx`, import.meta.url));

const stubTs = (name: string) =>
  fileURLToPath(new URL(`./test/${name}.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // The two stubs are packages that ship source vite cannot parse.
    // Stubbing is not only a workaround: a render test wants to know
    // which icon was chosen and where a link points, and a stub says
    // both more directly than a font loader and a navigation container.
    alias: [
      // The app's own path alias, from tsconfig. Any component reached
      // from a test imports its neighbours through it.
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL('./src/', import.meta.url)),
      },
      { find: /^react-native$/, replacement: 'react-native-web' },
      { find: /^@expo\/vector-icons$/, replacement: stub('expo-vector-icons') },
      { find: /^expo-router$/, replacement: stub('expo-router') },
      { find: /^nativewind$/, replacement: stub('nativewind') },
      // expo-haptics reaches expo-modules-core, which reads globals only
      // the native runtime injects. Button imports it, so without this
      // every component containing a button was untestable.
      { find: /^expo-haptics$/, replacement: stubTs('expo-haptics') },
      { find: /^react-native-svg$/, replacement: stub('react-native-svg') },
      {
        find: /^react-native-qrcode-svg$/,
        replacement: stub('react-native-qrcode-svg'),
      },
    ],
  },
  test: {
    globals: false,
    setupFiles: [fileURLToPath(new URL('./test/setup-env.ts', import.meta.url))],
    // e2e/ is Playwright's; vitest would otherwise pick up its *.spec.ts
    // and try to run browser journeys in node.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
