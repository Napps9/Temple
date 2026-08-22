import '@/global.css';

// Per-weight subpaths, not the package root: the root re-exports all
// eighteen cuts and every one of them ends up in the bundle. Four files
// instead of eighteen.
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
// One cut of one serif, for the wordmark and nothing else.
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { vars } from 'nativewind';
import { Component, useEffect, useMemo, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CookieBanner } from '@/components/CookieBanner';
import { hexToRgbTriplet } from '@/lib/brand';
import { ACCENT, useThemeColors, useThemePreference } from '@/lib/theme';

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
  // Four cuts, because React Native does not synthesise weights for a
  // custom family — see the font-weight plugin in tailwind.config.js.
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    Fraunces_700Bold,
  });

  // Hold on loading, but never on failure: a font that will not load is a
  // reason to render in the platform face, not a reason to show nothing.
  // Until this resolves the native splash screen is still up, so the hold
  // is invisible rather than a blank frame.
  if (!fontsLoaded && !fontError) return null;

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
  const { scheme } = useThemePreference();
  const colors = useThemeColors();

  // Push Temple's accent into Tailwind's `primary` token. vars() writes
  // both the web CSS variables (consumed by tailwind's `rgb(var(...) /
  // <alpha-value>)`) and NativeWind's runtime style cascade, so every
  // `bg-primary` / `text-primary` call site picks it up without a
  // per-component change. It stays a runtime write rather than a static
  // value in global.css because native never parses that file.
  const themeVars = useMemo(() => {
    const accent = scheme === 'dark' ? ACCENT.dark : ACCENT.light;
    return vars({
      '--color-primary': hexToRgbTriplet(accent.primary),
      '--color-primary-dark': hexToRgbTriplet(accent.primaryDark),
      '--color-on-primary': hexToRgbTriplet(accent.onPrimary),
      '--color-link': hexToRgbTriplet(accent.ink),
      '--color-secondary': hexToRgbTriplet(accent.ink),
    });
  }, [scheme]);

  // Belt-and-braces for web: writing them onto `documentElement` means
  // content rendered outside the React tree sees the same accent, and the
  // values survive route-level remounts.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const accent = scheme === 'dark' ? ACCENT.dark : ACCENT.light;
    const root = document.documentElement.style;
    root.setProperty('--color-primary', hexToRgbTriplet(accent.primary));
    root.setProperty('--color-primary-dark', hexToRgbTriplet(accent.primaryDark));
    root.setProperty('--color-on-primary', hexToRgbTriplet(accent.onPrimary));
    root.setProperty('--color-link', hexToRgbTriplet(accent.ink));
    root.setProperty('--color-secondary', hexToRgbTriplet(accent.ink));
  }, [scheme]);

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
    <View style={themeVars} className="flex-1">
      <StatusBar style={colors.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.screenBg },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="terms" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(staff)" />
        <Stack.Screen name="(member)" />
        <Stack.Screen name="athlete" />
      </Stack>
      <CookieBanner />
    </View>
  );
}
