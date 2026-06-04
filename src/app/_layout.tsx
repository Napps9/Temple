import '@/global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useThemeColors, useThemePreference } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemedShell />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedShell() {
  useThemePreference();
  const colors = useThemeColors();

  // Keep the browser's OS-chrome colour (Safari notch tint, Android URL bar)
  // in sync with the in-app theme. +html.tsx ships two prefers-color-scheme
  // variants for first paint; this replaces them with a single dynamic tag
  // so a manual dark-mode toggle that overrides the OS preference doesn't
  // leave a seam between the body and the chrome.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.remove());
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = colors.screenBg;
    document.head.appendChild(meta);
  }, [colors.screenBg]);

  return (
    <>
      <StatusBar style={colors.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.screenBg },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(staff)" />
        <Stack.Screen name="(member)" />
      </Stack>
    </>
  );
}
