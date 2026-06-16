import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Logged-out landing (served at app.jointemple.io). Always dark, navless:
// one path card at a time in a swipe/tap carousel so each audience —
// member, solo athlete, owner — gets the full pitch. Slides animate with
// an eased translateX (RN Animated, JS driver — reliable on web); arrows
// and dots share one control row beneath. Real Temple lockup up top,
// brand palette (steel-blue / gold) per card. Order Join → Solo → Start.

type Path = {
  key: string;
  accent: string;
  onAccent: string;
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
    accent: '#3B6BA5',
    onAccent: '#FFFFFF',
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
    key: 'solo',
    accent: '#E8B620',
    onAccent: '#111111',
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
  {
    key: 'owner',
    accent: '#3B6BA5',
    onAccent: '#FFFFFF',
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
];

export default function GetStartedScreen() {
  const { width: winW } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [measured, setMeasured] = useState(0);

  // One carousel page width. Window-width fallback for first paint;
  // onLayout corrects it before any interaction.
  const pageW = measured || Math.min(winW, 600);

  const tx = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(tx, {
      toValue: -page * pageW,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [page, pageW, tx]);

  // Functional updates so the PanResponder (created once) never reads a
  // stale page.
  const goRel = (d: number) =>
    setPage((p) => Math.max(0, Math.min(PATHS.length - 1, p + d)));
  const goTo = (i: number) =>
    setPage(Math.max(0, Math.min(PATHS.length - 1, i)));

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

  function onLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    if (w && Math.abs(w - measured) > 1) {
      setMeasured(w);
      tx.setValue(-page * w);
    }
  }

  return (
    <SafeAreaView
      className="flex-1 bg-gray-950"
      edges={['top', 'bottom', 'left', 'right']}>
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
            <Image
              source={require('../../../assets/images/temple-brand/lockup-on-dark-960px.png')}
              style={{ width: 220, height: 55 }}
              resizeMode="contain"
              accessibilityLabel="Temple"
            />
          </View>

          {/* Header */}
          <View className="gap-2">
            <Text className="text-white text-3xl font-semibold text-center">
              Welcome to Temple
            </Text>
            <Text className="text-gray-400 text-center">
              Pick how you’ll use it — swipe through, you can always switch
              later.
            </Text>
          </View>

          {/* Carousel — eased translateX track, swipe via PanResponder */}
          <View
            className="overflow-hidden"
            onLayout={onLayout}
            {...pan.panHandlers}>
            <Animated.View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                width: pageW * PATHS.length,
                transform: [{ translateX: tx }],
              }}>
              {PATHS.map((p) => (
                <View key={p.key} style={{ width: pageW }} className="px-1">
                  <PathCard path={p} />
                </View>
              ))}
            </Animated.View>
          </View>

          {/* Controls — arrows flanking the dots: ‹ • • • › */}
          <View className="flex-row items-center justify-center gap-4">
            <Arrow dir="left" disabled={page === 0} onPress={() => goRel(-1)} />
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
                      borderWidth: active ? 2 : 0,
                      borderColor: active ? p.accent : 'transparent',
                      backgroundColor: active ? 'transparent' : '#4B5563',
                    }}
                  />
                );
              })}
            </View>
            <Arrow
              dir="right"
              disabled={page === PATHS.length - 1}
              onPress={() => goRel(1)}
            />
          </View>

          {/* Sign in */}
          <View className="items-center pt-1">
            <Link href="/sign-in" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-[#6E97C6]">
                  Already have an account? Sign in
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PathCard({ path }: { path: Path }) {
  return (
    <View className="rounded-3xl border border-gray-800 bg-gray-900 p-7 gap-6 shadow-xl">
      <View className="flex-row items-center gap-4">
        <View
          style={{ borderColor: path.accent }}
          className="w-14 h-14 rounded-full border items-center justify-center">
          <Ionicons name={path.icon} size={24} color={path.accent} />
        </View>
        <View className="flex-1">
          <Text
            style={{ color: path.accent }}
            className="text-[10px] font-semibold uppercase tracking-[3px]">
            {path.kicker}
          </Text>
          <Text className="text-white text-2xl font-semibold">{path.title}</Text>
        </View>
      </View>

      <Text className="text-gray-100 text-lg font-medium">{path.headline}</Text>

      <View className="gap-2.5">
        {path.bullets.map((b) => (
          <View key={b} className="flex-row gap-2.5">
            <Ionicons name="checkmark-circle" size={18} color={path.accent} />
            <Text className="flex-1 text-gray-300 text-sm leading-5">{b}</Text>
          </View>
        ))}
      </View>

      <Link href={path.href as never} asChild>
        <Pressable
          style={{ backgroundColor: path.accent }}
          className="rounded-xl p-4 items-center active:opacity-80 mt-1">
          <Text style={{ color: path.onAccent }} className="font-semibold">
            {path.cta}
          </Text>
        </Pressable>
      </Link>
    </View>
  );
}

function Arrow({
  dir,
  disabled,
  onPress,
}: {
  dir: 'left' | 'right';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={{ opacity: disabled ? 0.3 : 1 }}
      className="w-10 h-10 rounded-full items-center justify-center border border-white/20 bg-white/5">
      <Ionicons
        name={dir === 'left' ? 'chevron-back' : 'chevron-forward'}
        size={20}
        color="#E5E7EB"
      />
    </Pressable>
  );
}
