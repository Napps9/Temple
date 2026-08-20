// The test runner's Supabase env.
//
// `lib/supabase.ts` throws at import time when these are absent, which is
// right for the app — a build with no backend should fail loudly rather
// than at the first query. It made every module that imports it
// untestable, and the workaround was to split such modules in two and
// test only the pure half.
//
// That workaround was really two problems wearing one coat. The parse
// failure is fixed by the react-native alias in vitest.config.ts; this
// fixes the other half. The values are deliberately obvious nonsense: any
// test that actually reaches the network with them should fail, and fail
// in a way that names why.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:1/not-a-real-supabase';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key-not-a-real-key';

// `__DEV__` is a global the React Native bundler defines and the test
// runner does not. expo-modules-core reads it at import time, so anything
// reaching expo-haptics — which is every pressable in the app, via
// lib/haptic — threw "__DEV__ is not defined" before it rendered a word.
// That put Button, and therefore every component containing one, out of
// reach of a render test.
//
// False rather than true on purpose: dev-only logging and warnings are
// noise in a test run, and a test that only passes with the dev-mode
// branch is testing the wrong build.
(globalThis as { __DEV__?: boolean }).__DEV__ ??= false;
