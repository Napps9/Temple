import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { GymRole } from '@/types/database';

type Candidate = {
  profile_id: string;
  full_name: string | null;
  role: GymRole;
};

export default function NewDirectMessage() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const [query, setQuery] = useState('');

  const candidates = useQuery({
    queryKey: ['dm-candidates', membership?.gymId, session?.user.id],
    enabled: !!membership?.gymId && !!session?.user.id,
    queryFn: async (): Promise<Candidate[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, role, profiles!profile_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .is('left_at', null)
        .neq('profile_id', session!.user.id);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as unknown as {
          profile_id: string;
          role: GymRole;
          profiles: { full_name: string | null } | null;
        };
        return {
          profile_id: row.profile_id,
          full_name: row.profiles?.full_name ?? null,
          role: row.role,
        };
      });
    },
  });

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const all = candidates.data ?? [];
    if (!trimmed) {
      // Default sort: coaches/admins/owner first, then members.
      const order: Record<GymRole, number> = {
        owner: 0,
        admin: 1,
        coach: 2,
        staff: 3,
        member: 4,
      };
      return all
        .slice()
        .sort(
          (a, b) =>
            order[a.role] - order[b.role] ||
            (a.full_name ?? '').localeCompare(b.full_name ?? ''),
        );
    }
    return all
      .filter((c) =>
        (c.full_name ?? '').toLowerCase().includes(trimmed),
      )
      .sort((a, b) =>
        (a.full_name ?? '').localeCompare(b.full_name ?? ''),
      );
  }, [candidates.data, query]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <Link href="/inbox" asChild>
            <Pressable hitSlop={6} className="active:opacity-70">
              <Ionicons name="chevron-back" size={22} color="#9CA3AF" />
            </Pressable>
          </Link>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              New message
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Pick a recipient.
            </Text>
          </View>
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
        />

        {candidates.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : filtered.length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            No matches.
          </Text>
        ) : (
          filtered.map((c) => (
            <Pressable
              key={c.profile_id}
              onPress={() =>
                router.replace(`/inbox/direct/${c.profile_id}` as never)
              }
              className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  {c.full_name?.trim() || 'Member'}
                </Text>
              </View>
              {c.role !== 'member' ? (
                <View className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5">
                  <Text className="text-gray-600 dark:text-gray-300 text-[10px] uppercase tracking-wider">
                    {c.role}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
