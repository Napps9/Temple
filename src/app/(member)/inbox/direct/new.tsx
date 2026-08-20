import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import { useThemeColors } from '@/lib/theme';
import { useGymMembership, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { GymRole } from '@/types/database';

type Candidate = {
  profile_id: string;
  full_name: string | null;
  role: GymRole;
};

export default function NewDirectMessage() {
  const colors = useThemeColors();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const [query, setQuery] = useState('');

  const dmScope = useQuery({
    queryKey: ['dm-scope', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<'full_gym' | 'member_coach_only'> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('dm_scope')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data.dm_scope;
    },
  });

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

  // Mirrors can_dm()'s server-side rule (0197): under member_coach_only,
  // the only blocked pairing is member-to-member. A non-member sender
  // reaches anyone; a member reaches anyone who is not a member. Filtering
  // here means an ineligible pick never reaches the RLS-enforced send
  // instead of failing there.
  const eligible = useMemo(() => {
    const all = candidates.data ?? [];
    const scope = dmScope.data;
    const senderRole = membership?.role;
    if (!scope || scope === 'full_gym' || !senderRole) return all;
    if (senderRole !== 'member') return all;
    return all.filter((c) => c.role !== 'member');
  }, [candidates.data, dmScope.data, membership?.role]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const all = eligible;
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
  }, [eligible, query]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <BackLink inline fallbackHref="/inbox" />
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
              New message
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Pick a recipient.
            </Text>
          </View>
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name"
          placeholderTextColor={colors.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-lg px-4 py-3 text-ink dark:text-ink-dk text-base"
        />

        {candidates.isLoading || dmScope.isLoading ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading…</Text>
        ) : filtered.length === 0 ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            No matches.
          </Text>
        ) : (
          filtered.map((c) => (
            <Pressable
              key={c.profile_id}
              onPress={() =>
                router.replace(`/inbox/direct/${c.profile_id}` as never)
              }
              className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 flex-row items-center gap-3 active:opacity-70">
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dk font-medium">
                  {c.full_name?.trim() || 'Member'}
                </Text>
              </View>
              {c.role !== 'member' ? (
                <View className="rounded-full bg-raised dark:bg-raised-dk px-2 py-0.5">
                  <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] uppercase tracking-wider">
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
