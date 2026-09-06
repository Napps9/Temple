import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PageScroll } from '@/components/PageScroll';
import { PageHead } from '@/components/PageHead';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import { FieldLabel } from '@/components/SectionLabel';
import { StrengthLeaderboard } from '@/components/StrengthLeaderboard';
import { useGymMembership } from '@/lib/auth';
import { HYROX_BENCHMARKS } from '@/lib/hyrox';
import { findMovement, type Movement, type Scheme } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { useGymDiscipline } from '@/lib/useGymDiscipline';

// A curated set of common CrossFit benchmarks. Tap any movement to see
// the full per-scheme leaderboard for it. (Hyrox gyms swap this for the
// station times in HYROX_BENCHMARKS.)
const HEADLINE_BENCHMARKS: { movementKey: string; schemeKey: string }[] = [
  { movementKey: 'back_squat', schemeKey: '1rm' },
  { movementKey: 'front_squat', schemeKey: '1rm' },
  { movementKey: 'deadlift', schemeKey: '1rm' },
  { movementKey: 'bench_press', schemeKey: '1rm' },
  { movementKey: 'strict_press', schemeKey: '1rm' },
  { movementKey: 'power_clean', schemeKey: '1rm' },
  { movementKey: 'power_snatch', schemeKey: '1rm' },
  { movementKey: 'running', schemeKey: '5k' },
  { movementKey: 'rowing', schemeKey: '2000m' },
];

export default function LeaderboardsIndex() {
  const { data: membership } = useGymMembership();
  const discipline = useGymDiscipline();
  const enabled = useQuery({
    queryKey: ['gym-leaderboard-flags', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gyms')
        .select('strength_leaderboards_enabled')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data.strength_leaderboards_enabled;
    },
  });

  const [activeKey, setActiveKey] = useState<string>(
    HEADLINE_BENCHMARKS[0].movementKey + '|' + HEADLINE_BENCHMARKS[0].schemeKey,
  );

  if (enabled.data === false) {
    return (
      <Screen>
        <View className="mt-8 gap-2">
          <Text className="text-ink dark:text-ink-dk text-lg font-semibold">
            Leaderboards off
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk">
            Strength comparisons are disabled for this gym.
          </Text>
        </View>
      </Screen>
    );
  }

  const source =
    discipline === 'hyrox' ? HYROX_BENCHMARKS : HEADLINE_BENCHMARKS;
  const benchmarks = source
    .map((b) => {
      const movement = findMovement(b.movementKey)?.movement;
      const scheme = movement?.schemes.find((s) => s.key === b.schemeKey);
      return movement && scheme ? { movement, scheme } : null;
    })
    .filter((x): x is { movement: Movement; scheme: Scheme } => x !== null);

  // Fall back to the first benchmark of the active catalog so a Hyrox
  // gym (whose default activeKey points at a CrossFit benchmark) still
  // renders a board on first paint.
  const active =
    benchmarks.find((b) => `${b.movement.key}|${b.scheme.key}` === activeKey) ??
    benchmarks[0];
  const activeId = active ? `${active.movement.key}|${active.scheme.key}` : '';

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <PageScroll contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <PageHead
          lead={<BackLink inline fallbackHref="/track" />}
          title="Leaderboards"
          subtitle="Top of the gym across common benchmarks."
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-0.5">
          {benchmarks.map((b) => {
            const key = `${b.movement.key}|${b.scheme.key}`;
            const selected = key === activeId;
            return (
              <Pressable
                key={key}
                onPress={() => setActiveKey(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                className={`rounded-full px-3 py-1.5 border active:opacity-70 ${
                  selected
                    ? 'bg-raised dark:bg-raised-dk border-transparent'
                    : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk'
                }`}>
                <Text
                  className={
                    selected
                      ? 'text-ink dark:text-ink-dk text-xs font-medium'
                      : 'text-ink-2 dark:text-ink-2-dk text-xs'
                  }>
                  {b.movement.name} · {b.scheme.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {active ? (
          <View className="gap-3">
            <View>
              <FieldLabel>
                {active.scheme.label}
              </FieldLabel>
              <Text className="text-ink dark:text-ink-dk text-xl font-semibold">
                {active.movement.name}
              </Text>
            </View>
            <StrengthLeaderboard
              movementKey={active.movement.key}
              scheme={active.scheme}
            />
          </View>
        ) : null}
      </PageScroll>
    </Screen>
  );
}
