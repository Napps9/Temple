import { useContext } from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

// The insets, for a component that is also rendered by the test suite.
//
// useSafeAreaInsets() throws when there is no SafeAreaProvider above it,
// which is right for a screen — a screen without one is a build mistake.
// It is wrong for the modal shell, which is mounted by render tests whose
// harness provides a QueryClientProvider and nothing else, and jsdom has
// no insets to report in any case.
//
// So read the context and fall back to zero. On device the provider is
// mounted in app/_layout.tsx above the router, and this is exactly
// useSafeAreaInsets(); in a test it is four zeros, which is the honest
// answer for a window with no notch.
const NONE: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function useSheetInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? NONE;
}
