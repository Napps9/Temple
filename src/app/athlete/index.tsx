import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { RecordMovementResultModal } from '@/components/RecordMovementResultModal';
import { Screen } from '@/components/Screen';
import { TempleMark } from '@/components/TempleMark';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { findMovement } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import {
  shareTrainingExport,
  waitingLine,
  type TrainingSummary,
} from '@/lib/training-export';
import { useThemeColors, useThemePreference } from '@/lib/theme';

type LoggedMovement = { key: string; name: string; group: string; last: string };

// Company identity colours (the Temple mark), not the per-gym runtime
// `primary` token — see docs/brand-assets.md. The three panels below echo
// the mark's offset gold/steel/ink-or-cream stack.
const BRAND_GOLD = '#E8B620';
const BRAND_STEEL = '#3B6BA5';
const BRAND_INK = '#111111';
const BRAND_CREAM = '#F4F2ED';

function AccentCard({
  accent,
  children,
}: {
  accent: string;
  children: ReactNode;
}) {
  return (
    <View className="relative">
      <View
        pointerEvents="none"
        className="absolute rounded-2xl"
        style={{ backgroundColor: accent, top: 5, left: 5, right: -5, bottom: -5 }}
      />
      <View className="bg-surface dark:bg-surface-dk border border-gray-200 dark:border-gray-800 rounded-2xl p-4 gap-3">
        {children}
      </View>
    </View>
  );
}

export default function AthleteHome() {
  const session = useSession();
  const colors = useThemeColors();
  const { scheme } = useThemePreference();
  const inkOrCream = scheme === 'dark' ? BRAND_CREAM : BRAND_INK;
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  // The paid athlete tier (free during beta) — gates solo logging.
  const athleteActive = useQuery({
    queryKey: ['athlete-active', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc('is_athlete_active');
      if (error) throw error;
      return data as boolean;
    },
  });

  const activate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('start_athlete_subscription', {});
      if (error) throw error;
    },
    onSuccess: () => {
      setActivateError(null);
      queryClient.invalidateQueries({ queryKey: ['athlete-active'] });
    },
    onError: (e) => setActivateError(errorMessage(e, 'Could not start tracking')),
  });

  // Every movement the athlete has ever logged — directly (a recorded
  // rep-max) or via a tagged workout section — unioned across all gyms
  // they've trained at. This is the portable history: it follows the
  // profile, not any gym.
  const movements = useQuery({
    queryKey: ['athlete-logged-movements', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<LoggedMovement[]> => {
      const [direct, tags] = await Promise.all([
        supabase
          .from('tracked_movement_results')
          .select('movement_key, performed_at')
          .eq('profile_id', session!.user.id)
          .order('performed_at', { ascending: false }),
        supabase
          .from('tracked_section_movement_tags')
          .select('movement_key, performed_at')
          .eq('profile_id', session!.user.id)
          .order('performed_at', { ascending: false }),
      ]);
      if (direct.error) throw direct.error;
      if (tags.error) throw tags.error;
      const lastByKey = new Map<string, string>();
      for (const r of [...(direct.data ?? []), ...(tags.data ?? [])]) {
        const row = r as { movement_key: string; performed_at: string };
        const prev = lastByKey.get(row.movement_key);
        if (!prev || row.performed_at > prev) {
          lastByKey.set(row.movement_key, row.performed_at);
        }
      }
      const out: LoggedMovement[] = [];
      for (const [key, last] of lastByKey) {
        const meta = findMovement(key);
        if (!meta) continue;
        out.push({ key, name: meta.movement.name, group: meta.group.name, last });
      }
      return out.sort((a, b) => (a.last < b.last ? 1 : -1));
    },
  });

  const workoutCount = useQuery({
    queryKey: ['athlete-workout-count', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('tracked_workouts')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', session!.user.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // What is waiting, counted past the policies. The tracked_* reads above
  // are gated on the subscription (0237), so for the one person this screen
  // exists to convert they come back empty — and the copy would promise a
  // history the page then fails to show. This answers regardless (0238),
  // and says nothing about any individual session: counts and a range.
  const waiting = useQuery({
    queryKey: ['my-training-summary', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<TrainingSummary> => {
      const { data, error } = await supabase.rpc('my_training_summary');
      if (error) throw error;
      return data as TrainingSummary;
    },
  });

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Free, and not behind the tier: the right of access is not a product
  // feature. Deliberately reachable whether or not somebody subscribes.
  const downloadHistory = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const { data, error } = await supabase.rpc('export_my_training_history');
      if (error) throw error;
      await shareTrainingExport(data);
    } catch (e) {
      setExportError(errorMessage(e, 'Could not put your history together'));
    } finally {
      setExporting(false);
    }
  };

  const logged = movements.data ?? [];
  const held = waiting.data;
  // Locked, not empty. Somebody with nothing logged is a different screen
  // from somebody whose record is sitting behind the tier.
  const lockedHistory =
    !athleteActive.data && (held?.workouts ?? 0) > 0;

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-3">
          <TempleMark size={44} />
          <View className="flex-1">
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-widest">
              Athlete
            </Text>
            <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
              Your training
            </Text>
          </View>
          <Link href="/athlete/account" asChild>
            <Pressable
              hitSlop={8}
              accessibilityLabel="Account"
              className="w-10 h-10 rounded-full bg-surface dark:bg-surface-dk border border-gray-200 dark:border-gray-800 items-center justify-center active:opacity-70">
              <Ionicons name="person-outline" size={18} color={colors.iconPrimary} />
            </Pressable>
          </Link>
        </View>

        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          You're not in a gym right now, but your workout history is yours — it
          is kept, and it follows you into any gym on the network when you join.
        </Text>

        {/* Locked, not empty. Without this the page tells somebody their
            history is theirs and then shows them nothing, because the
            tracked_* reads are gated on the subscription (0237). */}
        {lockedHistory ? (
          <AccentCard accent={BRAND_STEEL}>
            <View className="flex-row items-center gap-3">
              <View
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: BRAND_STEEL + '26' }}>
                <Ionicons name="lock-closed-outline" size={20} color={BRAND_STEEL} />
              </View>
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  Your training is still here
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {waitingLine(held!)}
                </Text>
              </View>
            </View>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Nothing has been deleted. Start solo tracking to open it back up
              and pick up where you left off — or take a copy, free, whether you
              subscribe or not.
            </Text>
            {exportError ? (
              <Text
                accessibilityLiveRegion="polite"
                className="text-red-500 dark:text-red-400 text-sm">
                {exportError}
              </Text>
            ) : null}
            <Button
              variant="secondary"
              onPress={downloadHistory}
              loading={exporting}>
              Download my history
            </Button>
          </AccentCard>
        ) : null}

        {/* Solo tracking — the paid athlete tier (free during beta). */}
        {athleteActive.data ? (
          <AccentCard accent={BRAND_GOLD}>
            <View className="flex-row items-center gap-3">
              <View
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: BRAND_GOLD + '26' }}>
                <Ionicons name="barbell-outline" size={20} color={BRAND_GOLD} />
              </View>
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  Solo tracking is on
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Log lifts and PRs without a gym.
                </Text>
              </View>
            </View>
            <Button onPress={() => setRecording(true)}>Log a result</Button>
          </AccentCard>
        ) : (
          <AccentCard accent={BRAND_GOLD}>
            <View className="flex-row items-center gap-3">
              <View
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: BRAND_GOLD + '26' }}>
                <Ionicons name="barbell-outline" size={20} color={BRAND_GOLD} />
              </View>
              <View className="flex-1 flex-row items-center gap-2">
                <Text className="text-ink dark:text-ink-dk font-semibold flex-1">
                  Keep tracking on your own
                </Text>
                <View className="rounded-full bg-amber-500/15 px-2 py-0.5">
                  <Text className="text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-widest">
                    Free in beta
                  </Text>
                </View>
              </View>
            </View>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Turn on solo tracking to log workouts and PRs even when you're not
              in a gym. It's free while we're in beta.
            </Text>
            {activateError ? (
              <Text
                accessibilityLiveRegion="polite"
                className="text-red-500 dark:text-red-400 text-sm">
                {activateError}
              </Text>
            ) : null}
            <Button onPress={() => activate.mutate()} loading={activate.isPending}>
              Start solo tracking
            </Button>
          </AccentCard>
        )}

        {/* Join / start CTAs replace /welcome for gymless users. */}
        <AccentCard accent={BRAND_STEEL}>
          <View className="flex-row items-center gap-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: BRAND_STEEL + '26' }}>
              <Ionicons name="people-outline" size={20} color={BRAND_STEEL} />
            </View>
            <Text className="text-ink dark:text-ink-dk font-semibold flex-1">
              Train with a gym
            </Text>
          </View>
          <View className="flex-row gap-2">
            <Link href="/accept-invite" asChild>
              <Pressable className="flex-1 bg-primary active:bg-primary-dark rounded-xl px-4 py-3 items-center">
                <Text className="text-white font-semibold">Join a gym</Text>
              </Pressable>
            </Link>
            <Link href="/create-gym" asChild>
              <Pressable className="flex-1 rounded-xl px-4 py-3 items-center border border-line dark:border-line-dk active:opacity-70">
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  Start a gym
                </Text>
              </Pressable>
            </Link>
          </View>
        </AccentCard>

        <AccentCard accent={inkOrCream}>
          <View className="flex-row items-center gap-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: inkOrCream + '26' }}>
              <Ionicons name="time-outline" size={20} color={inkOrCream} />
            </View>
            <View className="flex-1 flex-row items-center justify-between">
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-widest">
                Movements you've logged
              </Text>
              {workoutCount.data ? (
                <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                  {workoutCount.data} workout{workoutCount.data === 1 ? '' : 's'}
                </Text>
              ) : null}
            </View>
          </View>

          {movements.isLoading ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading…</Text>
          ) : logged.length === 0 ? (
            <View className="items-center gap-2 py-2">
              <Ionicons name="barbell-outline" size={28} color={colors.iconTertiary} />
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
                No logged movements yet. Start solo tracking above, or join a
                gym — your PRs and history live here either way.
              </Text>
            </View>
          ) : (
            <View className="gap-2">
              {logged.map((m) => (
                <Pressable
                  key={m.key}
                  onPress={() => router.push(`/athlete/movement/${m.key}` as never)}
                  className="bg-surface dark:bg-surface-dk border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex-row items-center gap-3 active:opacity-70">
                  <View className="flex-1">
                    <Text className="text-ink dark:text-ink-dk font-medium">
                      {m.name}
                    </Text>
                    <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                      {m.group}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.iconTertiary} />
                </Pressable>
              ))}
            </View>
          )}
        </AccentCard>
      </ScrollView>

      <RecordMovementResultModal
        visible={recording}
        solo
        onClose={() => setRecording(false)}
      />
    </Screen>
  );
}
