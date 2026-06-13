import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { GymLogo } from '@/components/GymLogo';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { findMovement } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

type LoggedMovement = { key: string; name: string; group: string; last: string };

export default function AthleteHome() {
  const session = useSession();
  const colors = useThemeColors();

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

  const logged = movements.data ?? [];

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-3">
          <GymLogo size={44} logoUrl={null} name="Temple" primaryColor={colors.primary} />
          <View className="flex-1">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Athlete
            </Text>
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Your training
            </Text>
          </View>
          <Link href="/athlete/account" asChild>
            <Pressable
              hitSlop={8}
              accessibilityLabel="Account"
              className="w-10 h-10 rounded-full bg-white dark:bg-gray-900 items-center justify-center active:opacity-70">
              <Ionicons name="person-outline" size={18} color={colors.iconPrimary} />
            </Pressable>
          </Link>
        </View>

        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          You're not in a gym right now, but your workout history is yours —
          {logged.length > 0 ? ' it stays here and ' : ' '}follows you into any
          gym on the network when you join.
        </Text>

        {/* Join / start CTAs replace /welcome for gymless users. */}
        <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Train with a gym
          </Text>
          <View className="flex-row gap-2">
            <Link href="/accept-invite" asChild>
              <Pressable className="flex-1 bg-primary active:bg-primary-dark rounded-xl px-4 py-3 items-center">
                <Text className="text-white font-semibold">Join a gym</Text>
              </Pressable>
            </Link>
            <Link href="/create-gym" asChild>
              <Pressable className="flex-1 rounded-xl px-4 py-3 items-center border border-gray-200 dark:border-gray-700 active:opacity-70">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  Start a gym
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Movements you've logged
            </Text>
            {workoutCount.data ? (
              <Text className="text-gray-400 dark:text-gray-500 text-xs">
                {workoutCount.data} workout{workoutCount.data === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>

          {movements.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
          ) : logged.length === 0 ? (
            <View className="bg-white dark:bg-gray-900 rounded-2xl p-6 items-center gap-2">
              <Ionicons name="barbell-outline" size={28} color="#9CA3AF" />
              <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
                No logged movements yet. Join a gym to start tracking — your PRs
                and history will live here.
              </Text>
            </View>
          ) : (
            <View className="gap-2">
              {logged.map((m) => (
                <Pressable
                  key={m.key}
                  onPress={() => router.push(`/athlete/movement/${m.key}` as never)}
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3 active:opacity-70">
                  <View className="flex-1">
                    <Text className="text-gray-900 dark:text-gray-50 font-medium">
                      {m.name}
                    </Text>
                    <Text className="text-gray-400 dark:text-gray-500 text-xs">
                      {m.group}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
