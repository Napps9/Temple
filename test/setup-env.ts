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
