import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type MemberRow = {
  id: string;
  role: string;
  created_at: string;
  profiles: { full_name: string | null } | null;
  plan_subscriptions: {
    status: string;
    paid_period_end: string | null;
    plan: { name: string } | null;
  }[];
};

const STATUS_TONE: Record<string, string> = {
  active: 'text-emerald-700 dark:text-emerald-300',
  paused: 'text-amber-700 dark:text-amber-300',
  cancelled_at_period_end: 'text-orange-700 dark:text-orange-300',
  scheduled: 'text-blue-700 dark:text-blue-300',
  pending: 'text-blue-700 dark:text-blue-300',
  lapsed: 'text-red-700 dark:text-red-300',
  cancelled: 'text-gray-500 dark:text-gray-400',
  refunded_retained: 'text-amber-700 dark:text-amber-300',
};

function rankSubs(subs: MemberRow['plan_subscriptions']) {
  const rank: Record<string, number> = {
    active: 1,
    paused: 2,
    cancelled_at_period_end: 3,
    scheduled: 4,
    pending: 4,
    refunded_retained: 5,
    lapsed: 6,
    cancelled: 7,
  };
  return [...subs].sort((a, b) => (rank[a.status] ?? 99) - (rank[b.status] ?? 99))[0];
}

export default function StaffMembersList() {
  const { data: gym } = useGymMembership();
  const [search, setSearch] = useState('');

  const membersQuery = useQuery({
    queryKey: ['staff-members', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select(
          'id, role, created_at, profiles!gym_memberships_profile_id_fkey(full_name), plan_subscriptions(status, paid_period_end, plan:membership_plans(name))',
        )
        .eq('gym_id', gym!.gymId)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as MemberRow[];
    },
  });

  const all = membersQuery.data ?? [];
  const filtered = search.trim()
    ? all.filter((m) => {
        const name = (Array.isArray(m.profiles)
          ? m.profiles[0]?.full_name
          : m.profiles?.full_name) ?? '';
        return name.toLowerCase().includes(search.trim().toLowerCase());
      })
    : all;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Members
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Everyone signed up to your gym.
          </Text>
        </View>

        <TextInput
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-gray-900 dark:text-gray-50"
          placeholder="Search by name…"
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {membersQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : null}

        {filtered.length === 0 && !membersQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            No members match.
          </Text>
        ) : null}

        {filtered.map((m) => {
          const name = Array.isArray(m.profiles)
            ? m.profiles[0]?.full_name
            : m.profiles?.full_name;
          const primary = rankSubs(m.plan_subscriptions ?? []);
          const planName = primary?.plan
            ? Array.isArray(primary.plan)
              ? primary.plan[0]?.name
              : primary.plan.name
            : null;
          return (
            <Link key={m.id} href={`/management/members/${m.id}`} asChild>
              <Pressable className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3">
                <Avatar name={name ?? null} size={36} />
                <View className="flex-1 gap-0.5">
                  <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                    {name ?? 'Member'}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {m.role} · {planName ?? 'no plan'}
                  </Text>
                </View>
                {primary ? (
                  <Text
                    className={`text-xs font-medium ${
                      STATUS_TONE[primary.status] ?? 'text-gray-500 dark:text-gray-400'
                    }`}>
                    {primary.status.replace(/_/g, ' ')}
                  </Text>
                ) : null}
              </Pressable>
            </Link>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
