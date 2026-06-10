import '@/global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Component, useEffect, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useThemeColors, useThemePreference } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// A crash anywhere in the tree used to render as a silent black screen
// on the deployed app — no error, no route, nothing to report. Render
// the message + stack instead so a screenshot of a failure is also the
// bug report.
class CrashScreen extends Component<
  { children: ReactNode },
  { error: Error | null; componentStack: string | null }
> {
  state = { error: null as Error | null, componentStack: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(_error: Error, info: { componentStack?: string | null }) {
    // The component stack names the actual component that looped/threw —
    // far more useful than the minified JS stack on production builds.
    this.setState({ componentStack: info?.componentStack ?? null });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    const pathname =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.pathname
        : '(native)';
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: '#0B0F1A' }}
        contentContainerStyle={{ padding: 24, gap: 12 }}>
        <Text style={{ color: '#F87171', fontSize: 20, fontWeight: '600' }}>
          The app crashed
        </Text>
        <Text style={{ color: '#9CA3AF' }}>Route: {pathname}</Text>
        <Text style={{ color: '#F9FAFB' }}>{String(error.message || error)}</Text>
        {componentStack ? (
          <Text style={{ color: '#FBBF24', fontFamily: 'monospace', fontSize: 11 }}>
            {componentStack}
          </Text>
        ) : null}
        {error.stack ? (
          <Text style={{ color: '#9CA3AF', fontFamily: 'monospace', fontSize: 11 }}>
            {error.stack}
          </Text>
        ) : null}
        <Pressable
          onPress={() => this.setState({ error: null, componentStack: null })}
          style={{
            backgroundColor: '#2563EB',
            borderRadius: 8,
            paddingVertical: 12,
            alignItems: 'center',
          }}>
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Try again</Text>
        </Pressable>
      </ScrollView>
    );
  }
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <CrashScreen>
            <ThemedShell />
          </CrashScreen>
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
