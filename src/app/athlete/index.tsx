import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ListRow } from '@/components/ListRow';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { RecordMovementResultModal } from '@/components/RecordMovementResultModal';
import { Screen } from '@/components/Screen';
import { FieldLabel } from '@/components/SectionLabel';
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
import { useThemeColors } from '@/lib/theme';

type LoggedMovement = { key: string; name: string; group: string; last: string };

// The offset plate behind each panel echoes the Temple mark — a hairline
// ghost card, the same treatment as the two cards behind the mark's front
// card, in the mark's one ink (docs/brand-assets.md).
function GhostCard({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View className="relative">
      <View
        pointerEvents="none"
        className="absolute rounded-card border-2"
        style={{ borderColor: colors.ink + '4D', top: 5, left: 5, right: -5, bottom: -5 }}
      />
      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
        {children}
      </View>
    </View>
  );
}

export default function AthleteHome() {
  const session = useSession();
  const colors = useThemeColors();
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
            <FieldLabel>
              Athlete
            </FieldLabel>
            <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
              Your training
            </Text>
          </View>
          <Link href="/athlete/account" asChild>
            <Pressable
              hitSlop={8}
              accessibilityLabel="Account"
              className="w-10 h-10 rounded-full bg-surface dark:bg-surface-dk border border-line dark:border-line-dk items-center justify-center active:opacity-70">
              <Ionicons name="person-outline" size={18} color={colors.ink} />
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
          <GhostCard>
            <View className="flex-row items-center gap-3">
              <View
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.ink + '14' }}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.ink} />
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
          </GhostCard>
        ) : null}

        {/* Solo tracking — the paid athlete tier (free during beta). */}
        {athleteActive.data ? (
          <GhostCard>
            <View className="flex-row items-center gap-3">
              <View
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.ink + '14' }}>
                <Ionicons name="barbell-outline" size={20} color={colors.ink} />
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
          </GhostCard>
        ) : (
          <GhostCard>
            <View className="flex-row items-center gap-3">
              <View
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.ink + '14' }}>
                <Ionicons name="barbell-outline" size={20} color={colors.ink} />
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
          </GhostCard>
        )}

        {/* Join / start CTAs replace /welcome for gymless users. */}
        <GhostCard>
          <View className="flex-row items-center gap-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.ink + '14' }}>
              <Ionicons name="people-outline" size={20} color={colors.ink} />
            </View>
            <Text className="text-ink dark:text-ink-dk font-semibold flex-1">
              Train with a gym
            </Text>
          </View>
          <View className="flex-row gap-2">
            <Link href="/accept-invite" asChild>
              <Pressable className="flex-1 bg-primary active:bg-primary-dark rounded-ctl px-4 py-3 items-center">
                <Text className="text-on-primary font-semibold">Join a gym</Text>
              </Pressable>
            </Link>
            <Link href="/create-gym" asChild>
              <Pressable className="flex-1 rounded-ctl px-4 py-3 items-center border border-line dark:border-line-dk active:opacity-70">
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  Start a gym
                </Text>
              </Pressable>
            </Link>
          </View>
        </GhostCard>

        <GhostCard>
          <View className="flex-row items-center gap-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.ink + '14' }}>
              <Ionicons name="time-outline" size={20} color={colors.ink} />
            </View>
            <View className="flex-1 flex-row items-center justify-between">
              <FieldLabel>
                Movements you've logged
              </FieldLabel>
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
              <Ionicons name="barbell-outline" size={28} color={colors.ink3} />
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
                No logged movements yet. Start solo tracking above, or join a
                gym — your PRs and history live here either way.
              </Text>
            </View>
          ) : (
            <View className="gap-2">
              {logged.map((m) => (
                <ListRow
                  key={m.key}
                  onPress={() => router.push(`/athlete/movement/${m.key}` as never)}
                  title={m.name}
                  subtitle={m.group}
                />
              ))}
            </View>
          )}
        </GhostCard>
      </ScrollView>

      <RecordMovementResultModal
        visible={recording}
        solo
        onClose={() => setRecording(false)}
      />
    </Screen>
  );
}
