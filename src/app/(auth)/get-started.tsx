import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Image,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

// Logged-out landing (served at app.jointemple.io). Deliberately always
// dark and navless: one path card at a time in a swipe/click carousel so
// each audience — member, solo athlete, owner — gets the full pitch
// without three cards competing for the first read. Depth comes from
// static brand-colour glows ("rich but calm"); the only colour that moves
// is the per-path accent, and only when you swipe. Order stays
// Join → Solo → Start so between-gyms athletes aren't an afterthought.

type Path = {
  key: string;
  accent: string;
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
    accent: '#10B981',
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
    accent: '#F59E0B',
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
    accent: '#2563EB',
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
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [measured, setMeasured] = useState(0);

  // Width of one carousel page. Fall back to the window width for the
  // first paint; onLayout corrects it before any interaction.
  const pageW = measured || Math.min(winW, 600);

  function onLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    if (w && Math.abs(w - measured) > 1) setMeasured(w);
  }

  function goTo(i: number) {
    const next = Math.max(0, Math.min(PATHS.length - 1, i));
    setPage(next);
    scrollRef.current?.scrollTo({ x: next * pageW, animated: true });
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / pageW);
    if (i !== page) setPage(i);
  }

  return (
    <SafeAreaView
      className="flex-1 bg-[#070B16]"
      edges={['top', 'bottom', 'left', 'right']}>
      {/* Ambient brand-colour glows — static, soft, low opacity. */}
      <View className="absolute inset-0" pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="glowBlue" cx="18%" cy="6%" rx="75%" ry="55%">
              <Stop offset="0%" stopColor="#2563EB" stopOpacity={0.3} />
              <Stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="glowEmerald" cx="90%" cy="96%" rx="70%" ry="55%">
              <Stop offset="0%" stopColor="#10B981" stopOpacity={0.16} />
              <Stop offset="100%" stopColor="#10B981" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#glowBlue)" />
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#glowEmerald)" />
        </Svg>
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
          {/* Logo lockup — present but understated. */}
          <View className="flex-row items-center justify-center gap-2.5">
            <Image
              source={require('../../../assets/images/icon.png')}
              style={{ width: 32, height: 32, borderRadius: 9 }}
            />
            <Text className="text-white text-lg font-semibold tracking-tight">
              Temple
            </Text>
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

          {/* Carousel */}
          <View className="relative" onLayout={onLayout}>
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={onScroll}>
              {PATHS.map((p) => (
                <View key={p.key} style={{ width: pageW }} className="px-1">
                  <PathCard path={p} />
                </View>
              ))}
            </ScrollView>

            {/* Prev / next — overlaid so cards keep full width. */}
            <Arrow dir="left" hidden={page === 0} onPress={() => goTo(page - 1)} />
            <Arrow
              dir="right"
              hidden={page === PATHS.length - 1}
              onPress={() => goTo(page + 1)}
            />
          </View>

          {/* Dots */}
          <View className="flex-row items-center justify-center gap-2">
            {PATHS.map((p, i) => {
              const active = i === page;
              return (
                <Pressable
                  key={p.key}
                  hitSlop={8}
                  onPress={() => goTo(i)}
                  style={{
                    width: active ? 22 : 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: active ? p.accent : '#334155',
                  }}
                />
              );
            })}
          </View>

          {/* Sign in */}
          <View className="items-center pt-1">
            <Link href="/sign-in" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-[#60A5FA]">
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
    <View className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 gap-5 shadow-xl">
      <View className="flex-row items-center gap-3">
        <View
          style={{ backgroundColor: `${path.accent}22` }}
          className="w-12 h-12 rounded-2xl items-center justify-center">
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
          className="rounded-xl p-3.5 items-center active:opacity-80 mt-1">
          <Text className="text-white font-semibold">{path.cta}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function Arrow({
  dir,
  hidden,
  onPress,
}: {
  dir: 'left' | 'right';
  hidden: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={hidden}
      hitSlop={8}
      style={{
        position: 'absolute',
        top: '50%',
        left: dir === 'left' ? 0 : undefined,
        right: dir === 'right' ? 0 : undefined,
        transform: [{ translateY: -18 }],
        opacity: hidden ? 0 : 1,
      }}
      className="w-9 h-9 rounded-full items-center justify-center bg-white/10 border border-white/10">
      <Ionicons
        name={dir === 'left' ? 'chevron-back' : 'chevron-forward'}
        size={20}
        color="#E5E7EB"
      />
    </Pressable>
  );
}
