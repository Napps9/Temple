import { useState } from 'react';

// NativeWind, stubbed for the test runner.
//
// It ships source vite cannot parse, so it has to be stubbed — but the
// consequence is the important part and it is not a workaround, it is a
// boundary. NativeWind is what turns `className="text-3xl"` into a style
// at build time. Without it, className is inert in these tests: every
// component still renders its structure and all of its text, and none of
// it has any styling at all.
//
// That is precisely why a render test here cannot see a wrapped label or
// an overflowing tile, and why the note in vitest.config.ts says a real
// browser is the only thing that can. A test that asserted on layout in
// this environment would be asserting on nothing.
//
// The colour scheme is real state so a test can flip it and check a
// component reads dark mode, which is behaviour rather than styling.
export function useColorScheme() {
  const [colorScheme, set] = useState<'light' | 'dark'>('light');
  return {
    colorScheme,
    setColorScheme: (s: 'light' | 'dark') => set(s),
    toggleColorScheme: () => set((c) => (c === 'light' ? 'dark' : 'light')),
  };
}

export function cssInterop<T>(component: T): T {
  return component;
}

export function remapProps<T>(component: T): T {
  return component;
}

export function vars(values: Record<string, string>) {
  return values;
}

export function useUnstableNativeVariable() {
  return undefined;
}

export function styled<T>(component: T): T {
  return component;
}

export function colorScheme() {
  return { get: () => 'light', set: () => {} };
}
