import '@/global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { vars } from 'nativewind';
import { Component, useEffect, useMemo, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CookieBanner } from '@/components/CookieBanner';
import { hexToPrimaryDarkRgbTriplet, hexToRgbTriplet } from '@/lib/brand';
import { useThemeColors, useThemePreference } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// Find-or-create a single `<meta name=...>` tag and set its content,
// so re-rendering doesn't pile up duplicates in <head>.
function setMetaTag(name: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

// Find-or-create a single `<link rel=...>` tag and set its href.
function setLinkTag(rel: string, href: string) {
  let tag = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
}

// Re-encode a logo into a square, upright PNG data URL for use as a
// favicon / touch icon. Browsers honour EXIF orientation when rendering
// an <img> (so the in-app logo looks right), but the favicon pipeline
// does not — a phone-photo logo carrying an orientation tag shows up
// rotated in the browser tab. Decoding with `imageOrientation:
// 'from-image'` bakes the rotation in, and the canvas centre-crops to a
// square (matching GymLogo's cover fit) so the icon isn't squashed.
// Needs CORS on the logo host (Supabase Storage sends it); on any
// failure the caller keeps the raw URL, so this only ever upgrades.
async function squareIconDataUrl(url: string, size: number): Promise<string> {
  const res = await fetch(url, { mode: 'cors' });
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas context');
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL('image/png');
}

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
  const brand = useGymBrand();

  // Drive Tailwind's `primary` token from the gym's saved colour. The
  // var() helper writes both web CSS variables (consumed by tailwind's
  // `rgb(var(--color-primary) / <alpha-value>)`) and NativeWind's
  // runtime style cascade, so `bg-primary` / `text-primary` / etc.
  // pick up the brand everywhere in the tree without a per-component
  // refactor. Memoised so we don't re-create the style object on
  // unrelated re-renders.
  const themeVars = useMemo(
    () =>
      vars({
        '--color-primary': hexToRgbTriplet(brand.primaryColor),
        '--color-primary-dark': hexToPrimaryDarkRgbTriplet(brand.primaryColor),
        '--color-link': hexToRgbTriplet(brand.textColor),
        '--color-secondary': hexToRgbTriplet(brand.secondaryColor),
      }),
    [brand.primaryColor, brand.textColor, brand.secondaryColor],
  );

  // Belt-and-braces for web: writing the vars onto `documentElement`
  // means even content rendered outside the React tree (theme-color
  // meta tag, scroll bar gutter, etc.) sees the same primary, and the
  // values survive route-level remounts without a frame of default
  // blue.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.documentElement.style.setProperty(
      '--color-primary',
      hexToRgbTriplet(brand.primaryColor),
    );
    document.documentElement.style.setProperty(
      '--color-primary-dark',
      hexToPrimaryDarkRgbTriplet(brand.primaryColor),
    );
    document.documentElement.style.setProperty(
      '--color-link',
      hexToRgbTriplet(brand.textColor),
    );
    document.documentElement.style.setProperty(
      '--color-secondary',
      hexToRgbTriplet(brand.secondaryColor),
    );
  }, [brand.primaryColor, brand.textColor, brand.secondaryColor]);

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

  // PWA branding — make the browser tab, the iOS "Add to Home Screen"
  // icon, and the Android PWA install dialog all use the gym's logo and
  // name. The web build sits on a single domain, so we can't ship per-
  // gym static favicons — we swap the link / meta tags at runtime once
  // useGymBrand resolves. Members who tap "Add to Home Screen" while
  // signed into their gym get a tappable icon that IS their gym's
  // logo, with the gym's name underneath, launching into the standalone
  // PWA. Falls back to the Temple defaults when no logo is configured.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const { logoUrl, gymName, primaryColor } = brand;
    let cancelled = false;

    document.title = gymName;
    setMetaTag('apple-mobile-web-app-title', gymName);
    setMetaTag('apple-mobile-web-app-capable', 'yes');
    setMetaTag('mobile-web-app-capable', 'yes');
    setMetaTag(
      'apple-mobile-web-app-status-bar-style',
      'black-translucent',
    );

    // Point the favicon, iOS touch icon, and PWA install manifest (inlined
    // as a data URL to avoid a server route for a runtime-derived value) at
    // the gym's logo. Called twice: synchronously with the raw URL so an
    // icon is always present, then again with a normalised upright/square
    // PNG once the canvas re-encode resolves.
    function setIcons(iconHref: string | null, iconSizes: string) {
      if (iconHref) {
        setLinkTag('icon', iconHref);
        setLinkTag('shortcut icon', iconHref);
        setLinkTag('apple-touch-icon', iconHref);
      }
      const manifest = {
        name: gymName,
        short_name: gymName,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: colors.screenBg,
        theme_color: primaryColor,
        icons: iconHref
          ? [
              { src: iconHref, sizes: iconSizes, type: 'image/png', purpose: 'any' },
              { src: iconHref, sizes: 'any', type: 'image/png', purpose: 'maskable' },
            ]
          : [],
      };
      setLinkTag(
        'manifest',
        'data:application/manifest+json;charset=utf-8,' +
          encodeURIComponent(JSON.stringify(manifest)),
      );
    }

    setIcons(logoUrl, 'any');
    if (logoUrl) {
      squareIconDataUrl(logoUrl, 256)
        .then((dataUrl) => {
          if (!cancelled) setIcons(dataUrl, '256x256');
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [brand, colors.screenBg]);

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
