import { useQuery } from '@tanstack/react-query';
import { Link, Redirect } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Input } from '@/components/Input';
import { MemberTagChip } from '@/components/MemberTagChip';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import { can } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type CohortRow = {
  profile_id: string;
  joined_at: string;
  is_intro: boolean;
  is_paying: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
  profiles: { full_name: string | null } | null;
};

type TagRow = {
  id: string;
  profile_id: string;
  label: string;
  color: string;
  source: 'manual' | 'auto';
};

type Filter = 'all' | 'intro' | 'expiring' | 'expired' | 'active';

export default function MembersScreen() {
  const role = useRole();
  const { data: membership } = useGymMembership();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const cohortQuery = useQuery({
    queryKey: ['members-cohort', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_member_cohort')
        .select(
          'profile_id, joined_at, is_intro, is_paying, is_active, is_expiring_soon, is_expired, days_until_expiry, profiles(full_name)',
        )
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as unknown as CohortRow[];
    },
  });

  const tagsQuery = useQuery({
    queryKey: ['member-tags', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_tags')
        .select('id, profile_id, label, color, source')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as TagRow[];
    },
  });

  const tagsByMember = useMemo(() => {
    const map = new Map<string, TagRow[]>();
    for (const t of tagsQuery.data ?? []) {
      const arr = map.get(t.profile_id) ?? [];
      arr.push(t);
      map.set(t.profile_id, arr);
    }
    return map;
  }, [tagsQuery.data]);

  const filtered = useMemo(() => {
    const rows = cohortQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === 'intro' && !r.is_intro) return false;
        if (filter === 'expiring' && !r.is_expiring_soon) return false;
        if (filter === 'expired' && !r.is_expired) return false;
        if (filter === 'active' && !r.is_active) return false;
        if (q.length > 0) {
          const name = r.profiles?.full_name?.toLowerCase() ?? '';
          return name.includes(q);
        }
        return true;
      })
      .sort((a, b) =>
        (a.profiles?.full_name ?? '').localeCompare(b.profiles?.full_name ?? ''),
      );
  }, [cohortQuery.data, filter, search]);

  if (role && !can(role, 'can_manage_tags')) {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-3xl md:mx-auto md:w-full">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Members
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            {(cohortQuery.data ?? []).length} members. Filter by cohort or
            search by name. Tap a member to edit their tags.
          </Text>
        </View>

        <Input
          label="Search"
          value={search}
          onChangeText={setSearch}
          placeholder="Name"
        />

        <View className="flex-row gap-2 flex-wrap">
          <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
          <FilterChip label="Intro" active={filter === 'intro'} onPress={() => setFilter('intro')} />
          <FilterChip
            label="Expiring"
            active={filter === 'expiring'}
            onPress={() => setFilter('expiring')}
          />
          <FilterChip
            label="Expired"
            active={filter === 'expired'}
            onPress={() => setFilter('expired')}
          />
          <FilterChip
            label="Active"
            active={filter === 'active'}
            onPress={() => setFilter('active')}
          />
        </View>

        {cohortQuery.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(cohortQuery.error, 'Could not load members')}
          </Text>
        ) : null}

        <View className="gap-2">
          {cohortQuery.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
          ) : filtered.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No members match.
            </Text>
          ) : (
            filtered.map((m) => (
              <Link key={m.profile_id} href={`/management/tags?profile=${m.profile_id}` as never} asChild>
                <Pressable className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
                  <View className="flex-row items-center gap-3">
                    <Avatar name={m.profiles?.full_name} size={36} />
                    <View className="flex-1">
                      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                        {m.profiles?.full_name ?? 'Member'}
                      </Text>
                      <Text className="text-gray-500 dark:text-gray-400 text-xs">
                        Joined {m.joined_at.slice(0, 10)}
                      </Text>
                    </View>
                    <CohortBadges row={m} />
                  </View>
                  {(tagsByMember.get(m.profile_id) ?? []).length > 0 ? (
                    <View className="flex-row flex-wrap gap-1">
                      {(tagsByMember.get(m.profile_id) ?? []).map((t) => (
                        <MemberTagChip
                          key={t.id}
                          label={t.label}
                          color={t.color}
                          source={t.source}
                        />
                      ))}
                    </View>
                  ) : null}
                </Pressable>
              </Link>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-1 rounded-full border ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
      }`}>
      <Text
        className={
          active ? 'text-primary text-sm' : 'text-gray-500 dark:text-gray-400 text-sm'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

function CohortBadges({ row }: { row: CohortRow }) {
  return (
    <View className="flex-row gap-1">
      {row.is_intro ? (
        <Badge label="Intro" color="#10B981" />
      ) : null}
      {row.is_expiring_soon ? (
        <Badge
          label={`${row.days_until_expiry}d`}
          color="#F97316"
        />
      ) : null}
      {row.is_expired ? <Badge label="Expired" color="#9CA3AF" /> : null}
      {row.is_paying ? <Badge label="Paying" color="#2563EB" /> : null}
    </View>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ backgroundColor: color }} className="rounded-full px-2 py-0.5">
      <Text className="text-white text-[10px] font-semibold">{label}</Text>
    </View>
  );
}
