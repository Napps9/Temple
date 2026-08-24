import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandHeadline } from '@/components/BrandHeadline';
import { LegalConsentNotice } from '@/components/LegalConsentNotice';
import { TempleLockup } from '@/components/TempleMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useThemePreference } from '@/lib/theme';

// Logged-out landing (served at app.jointemple.io). Theme-aware (the
// top-right toggle flips the app-wide scheme), navless.
// The three paths are a stacked deck mirroring the mark: one solid front
// card — ink on the light page, paper on the dark one — with the cards
// behind reduced to hairline ghosts, exactly the logo's own treatment.
// The deck used to wear the old logo's three colours (cream, steel blue,
// gold); those went when the mark went monochrome. Advancing shuffles the
// front card to the back (the deck cycles); every card fills to the
// tallest so the deck never resizes, and the CTA is pinned to the bottom.

const INK = '#14161A';
const PAPER = '#F4F5F6';

type Path = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  kicker: string;
  title: string;
  headline: string;
  bullets: string[];
  cta: string;
  href: string;
};

const PATHS: Path[] = [
  {
    key: 'member',
    icon: 'people-outline',
    kicker: 'Member',
    title: 'Join a gym',
    headline: 'Show up sharper. Stay in the loop.',
    bullets: [
      'Book classes in three taps, see who else is in',
      'Track every workout — weights, PRs, the lot',
      'Hear from your coach without the WhatsApp chaos',
      'Health screening sorted once, not every quarter',
    ],
    cta: 'I have an invite',
    href: '/accept-invite',
  },
  {
    key: 'owner',
    icon: 'business-outline',
    kicker: 'Owner',
    title: 'Start a gym',
    headline: 'The whiteboard, the front desk, the books — one app.',
    bullets: [
      'Programming, schedules and bookings on one calendar',
      'Members, plans and comms in one place',
      'A public join link the moment you’re ready',
      'Insights that tell you what’s working',
      'Make it look like your gym, not a template',
    ],
    cta: 'Get set up',
    href: '/create-gym',
  },
  {
    key: 'solo',
    icon: 'flame-outline',
    kicker: 'Solo',
    title: 'Train solo',
    headline: 'Keep the streak. Keep the data. Keep going.',
    bullets: [
      'Log workouts and PRs the same way members do',
      '12-week heatmap + workout streak track the work you put in',
      'Free during beta — yours forever',
      'Join a gym later? Your history walks in with you',
    ],
    cta: 'Start solo tracking',
    href: '/start-solo',
  },
];

// The one card treatment, per scheme — the front layer of the mark.
type Look = {
  bg: string;
  fg: string;
  border: string;
  // The ghost cards behind, front-to-back — the mark's 0.55 / 0.3 strokes.
  ghosts: [string, string];
  ctaBg: string;
  ctaText: string;
};

const LOOKS: Record<'light' | 'dark', Look> = {
  light: {
    bg: INK,
    fg: PAPER,
    border: '#2A2E33',
    ghosts: ['rgba(20,22,26,0.55)', 'rgba(20,22,26,0.30)'],
    ctaBg: PAPER,
    ctaText: INK,
  },
  dark: {
    bg: PAPER,
    fg: INK,
    border: '#E2E4E6',
    ghosts: ['rgba(244,245,246,0.55)', 'rgba(244,245,246,0.30)'],
    ctaBg: INK,
    ctaText: PAPER,
  },
};

const N = PATHS.length;
const TALLEST = PATHS.reduce((a, b) =>
  b.bullets.length > a.bullets.length ? b : a,
);
// Stack offsets per depth: 0 = front, 1 = middle, 2 = back.
const OFFSET = [0, 13, 26];
const CARD_PAD = 28;
const CARD_RADIUS = 24;
const CTA_GAP = 24;

export default function GetStartedScreen() {
  const { scheme } = useThemePreference();
  const dark = scheme === 'dark';
  const look = LOOKS[dark ? 'dark' : 'light'];
  const [page, setPage] = useState(0);

  // One animated "slot" per card (0 front … N-1 back). Initial arrangement
  // matches page 0.
  const slots = useRef(PATHS.map((_, i) => new Animated.Value(i))).current;

  const depthOf = (i: number, p: number) => (i - p + N) % N;

  useEffect(() => {
    Animated.parallel(
      slots.map((sv, i) =>
        Animated.timing(sv, {
          toValue: depthOf(i, page),
          duration: 360,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
      ),
    ).start();
  }, [page, slots]);

  // Cyclic so the front always has a back to drop to.
  const goRel = (d: number) => setPage((p) => (p + d + N) % N);
  const goTo = (i: number) => setPage(i);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        if (g.dx <= -40) goRel(1);
        else if (g.dx >= 40) goRel(-1);
      },
    }),
  ).current;

  return (
    <SafeAreaView
      className="flex-1 bg-ground dark:bg-ground-dk"
      edges={['top', 'bottom', 'left', 'right']}>
      <View className="absolute top-3 right-3 z-10">
        <ThemeToggle />
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: 20,
          paddingVertical: 32,
        }}>
        <View className="w-full max-w-xl mx-auto gap-8">
          {/* Brand lockup (mark + wordmark), understated up top. */}
          <View className="items-center">
            <TempleLockup size={30} />
          </View>

          {/* Header */}
          <View className="gap-2">
            <BrandHeadline className="text-3xl font-semibold text-center">
              Welcome to Temple
            </BrandHeadline>
            <Text className="text-ink-2 dark:text-ink-2-dk text-center">
              Pick how you’ll use it — swipe through, you can always switch
              later.
            </Text>
          </View>

          {/* Deck — reserve room (pr/pb) for the ghost cards behind. */}
          <View className="pr-7 pb-7" {...pan.panHandlers}>
            <View className="relative">
              {/* Invisible sizer: tallest card sets the deck height so the
                  whole deck stays one fixed, uniform size. */}
              <View style={{ opacity: 0 }} pointerEvents="none">
                <View
                  style={{
                    backgroundColor: look.bg,
                    borderColor: look.border,
                    borderWidth: 1,
                    borderRadius: CARD_RADIUS,
                    padding: CARD_PAD,
                  }}>
                  <CardContent path={TALLEST} look={look} />
                  <View style={{ paddingTop: CTA_GAP }}>
                    <CardCta path={TALLEST} look={look} interactive={false} />
                  </View>
                </View>
              </View>

              {PATHS.map((p, i) => {
                const depth = depthOf(i, page);
                const sv = slots[i];
                const off = sv.interpolate({
                  inputRange: [0, 1, 2],
                  outputRange: OFFSET,
                });
                const contentOpacity = sv.interpolate({
                  inputRange: [0, 1, 2],
                  outputRange: [1, 0, 0],
                });
                // A card behind the front is a ghost: no fill, a hairline in
                // the page's ink — the same 0.55 / 0.3 steps the mark uses.
                const bg = sv.interpolate({
                  inputRange: [0, 1],
                  outputRange: [look.bg, 'rgba(0,0,0,0)'],
                  extrapolate: 'clamp',
                });
                const borderColor = sv.interpolate({
                  inputRange: [0, 1, 2],
                  outputRange: [look.border, look.ghosts[0], look.ghosts[1]],
                });
                const shadowOpacity = sv.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.25, 0],
                  extrapolate: 'clamp',
                });
                return (
                  <Animated.View
                    key={p.key}
                    pointerEvents={depth === 0 ? 'auto' : 'none'}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: N - depth,
                      backgroundColor: bg,
                      borderColor,
                      borderWidth: 1,
                      borderRadius: CARD_RADIUS,
                      padding: CARD_PAD,
                      transform: [{ translateX: off }, { translateY: off }],
                      shadowColor: '#000',
                      shadowOpacity,
                      shadowRadius: 24,
                      shadowOffset: { width: 0, height: 14 },
                      elevation: depth === 0 ? 8 : 0,
                    }}>
                    <Animated.View style={{ opacity: contentOpacity, flex: 1 }}>
                      <CardContent path={p} look={look} />
                      <View style={{ marginTop: 'auto', paddingTop: CTA_GAP }}>
                        <CardCta path={p} look={look} interactive={depth === 0} />
                      </View>
                    </Animated.View>
                  </Animated.View>
                );
              })}
            </View>
          </View>

          {/* Controls — arrows flanking the dots: ‹ • • • › */}
          <View className="flex-row items-center justify-center gap-4">
            <Arrow dir="left" onPress={() => goRel(-1)} />
            <View className="flex-row items-center gap-2">
              {PATHS.map((p, i) => {
                const active = i === page;
                return (
                  <Pressable
                    key={p.key}
                    hitSlop={8}
                    onPress={() => goTo(i)}
                    style={{
                      width: active ? 12 : 6,
                      height: active ? 12 : 6,
                      borderRadius: 6,
                      backgroundColor: active
                        ? look.bg
                        : dark
                          ? '#4B5563'
                          : '#CBD5E1',
                      borderWidth: active ? 1 : 0,
                      borderColor: active
                        ? dark
                          ? 'rgba(17,17,17,0.30)'
                          : 'rgba(255,255,255,0.45)'
                        : 'transparent',
                    }}
                  />
                );
              })}
            </View>
            <Arrow dir="right" onPress={() => goRel(1)} />
          </View>

          {/* Sign in */}
          <View className="items-center pt-1">
            <Link href="/sign-in" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-ink-2 dark:text-ink-2-dk underline">
                  Already have an account? Sign in
                </Text>
              </Pressable>
            </Link>
          </View>

          <LegalConsentNotice />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CardContent({ path, look }: { path: Path; look: Look }) {
  return (
    <View style={{ gap: CTA_GAP }}>
      <View className="flex-row items-center gap-4">
        <View
          style={{ borderColor: look.fg }}
          className="w-14 h-14 rounded-full border items-center justify-center">
          <Ionicons name={path.icon} size={24} color={look.fg} />
        </View>
        <View className="flex-1">
          <Text
            style={{ color: look.fg }}
            className="text-[10px] font-semibold uppercase tracking-[3px] opacity-70">
            {path.kicker}
          </Text>
          <Text style={{ color: look.fg }} className="text-2xl font-semibold">
            {path.title}
          </Text>
        </View>
      </View>

      <Text style={{ color: look.fg }} className="text-lg font-medium">
        {path.headline}
      </Text>

      <View className="gap-2.5">
        {path.bullets.map((b) => (
          <View key={b} className="flex-row gap-2.5">
            <Ionicons name="checkmark-circle" size={18} color={look.fg} />
            <Text
              style={{ color: look.fg }}
              className="flex-1 text-sm leading-5 opacity-90">
              {b}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CardCta({
  path,
  look,
  interactive,
}: {
  path: Path;
  look: Look;
  interactive: boolean;
}) {
  const label = (
    <Text style={{ color: look.ctaText }} className="font-semibold">
      {path.cta}
    </Text>
  );
  if (interactive) {
    return (
      <Link href={path.href as never} asChild>
        <Pressable
          style={{ backgroundColor: look.ctaBg }}
          className="rounded-ctl p-4 items-center active:opacity-80">
          {label}
        </Pressable>
      </Link>
    );
  }
  return (
    <View
      style={{ backgroundColor: look.ctaBg }}
      className="rounded-ctl p-4 items-center">
      {label}
    </View>
  );
}

function Arrow({
  dir,
  onPress,
}: {
  dir: 'left' | 'right';
  onPress: () => void;
}) {
  const { scheme } = useThemePreference();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="w-10 h-10 rounded-full items-center justify-center border border-line-strong bg-white dark:border-white/20 dark:bg-white/5">
      <Ionicons
        name={dir === 'left' ? 'chevron-back' : 'chevron-forward'}
        size={20}
        color={scheme === 'dark' ? '#E5E7EB' : '#374151'}
      />
    </Pressable>
  );
}
