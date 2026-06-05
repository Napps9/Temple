import { useQuery } from '@tanstack/react-query';
import { Link, Redirect } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { MemberTagChip } from '@/components/MemberTagChip';
import { RemoveMemberDialog } from '@/components/RemoveMemberDialog';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { useExportMembersCsv, exportErrorMessage } from '@/lib/csv-exports';
import { errorMessage } from '@/lib/errors';
import { useMembersFilter } from '@/lib/members-filter';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type CohortRow = {
  profile_id: string;
  joined_at: string;
  is_intro: boolean;
  is_paying: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

type TagRow = {
  id: string;
  profile_id: string;
  label: string;
  color: string;
  source: 'manual' | 'auto';
};

type SubRow = {
  profile_id: string;
  status: string;
  credit_balance: number | null;
  price_cents: number | null;
  membership_plans: { name: string } | null;
};

type CompRow = {
  profile_id: string;
  reason: string | null;
  credits_remaining: number | null;
};

export default function MembersScreen() {
  const { data: membership } = useGymMembership();
  const {
    filter,
    search,
    setFilter,
    setSearch,
  } = useMembersFilter(membership?.gymId);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(
    null,
  );

  const canManageTags = useCan('can_manage_tags');
  const canRemove = useCan('can_archive_members') ?? false;
  const canExport = useCan('can_export_members') ?? false;
  const exportMembers = useExportMembersCsv();

  const cohortQuery = useQuery({
    queryKey: ['members-cohort', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_member_cohort')
        .select(
          'profile_id, joined_at, is_intro, is_paying, is_active, is_expiring_soon, is_expired, days_until_expiry, profiles(full_name, avatar_url)',
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

  const subsQuery = useQuery({
    queryKey: ['members-subs', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select('profile_id, status, credit_balance, price_cents, membership_plans(name)')
        .eq('gym_id', membership!.gymId)
        .in('status', ['active', 'pending', 'paused', 'cancelled_at_period_end', 'refunded_retained']);
      if (error) throw error;
      return (data ?? []) as unknown as SubRow[];
    },
  });

  const compsQuery = useQuery({
    queryKey: ['members-comps', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('comp_grants')
        .select('profile_id, reason, credits_remaining')
        .eq('gym_id', membership!.gymId)
        .is('revoked_at', null)
        .lte('starts_at', nowIso)
        .gt('ends_at', nowIso);
      if (error) throw error;
      return (data ?? []) as CompRow[];
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

  const subsByMember = useMemo(() => {
    const map = new Map<string, SubRow[]>();
    for (const s of subsQuery.data ?? []) {
      const arr = map.get(s.profile_id) ?? [];
      arr.push(s);
      map.set(s.profile_id, arr);
    }
    return map;
  }, [subsQuery.data]);

  const compsByMember = useMemo(() => {
    const map = new Map<string, CompRow[]>();
    for (const c of compsQuery.data ?? []) {
      const arr = map.get(c.profile_id) ?? [];
      arr.push(c);
      map.set(c.profile_id, arr);
    }
    return map;
  }, [compsQuery.data]);

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

  if (canManageTags === false) {
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
            search by name. Tap a member to open their detail page.
          </Text>
        </View>

        {canExport ? (
          <View className="gap-2">
            <Button
              variant="secondary"
              onPress={() => exportMembers.mutate()}
              loading={exportMembers.isPending}>
              Export members CSV
            </Button>
            {exportMembers.error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {exportErrorMessage(exportMembers.error, 'members')}
              </Text>
            ) : null}
          </View>
        ) : null}

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
            filtered.map((m) => {
              const subs = subsByMember.get(m.profile_id) ?? [];
              const comps = compsByMember.get(m.profile_id) ?? [];
              const tags = tagsByMember.get(m.profile_id) ?? [];
              return (
                <View
                  key={m.profile_id}
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
                  <Link
                    href={{
                      pathname: '/management/members/[profile]',
                      params: { profile: m.profile_id },
                    }}
                    asChild>
                    <Pressable className="gap-2">
                      <View className="flex-row items-center gap-3">
                        <Avatar
                          name={m.profiles?.full_name}
                          avatarUrl={m.profiles?.avatar_url}
                          size={36}
                        />
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
                      {subs.length > 0 || comps.length > 0 ? (
                        <View className="flex-row flex-wrap gap-1">
                          {subs.map((s, i) => (
                            <PlanChip
                              key={`s-${i}`}
                              name={s.membership_plans?.name ?? 'Plan'}
                              status={s.status}
                              creditBalance={s.credit_balance}
                            />
                          ))}
                          {comps.map((c, i) => (
                            <View
                              key={`c-${i}`}
                              className="rounded-full px-2 py-0.5 border border-emerald-300 dark:border-emerald-700">
                              <Text className="text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold">
                                {c.reason ?? 'Comp'}
                                {c.credits_remaining !== null
                                  ? ` · ${c.credits_remaining} left`
                                  : ''}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      {tags.length > 0 ? (
                        <View className="flex-row flex-wrap gap-1">
                          {tags.map((t) => (
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
                  {canRemove ? (
                    <Pressable
                      onPress={() =>
                        setRemoveTarget({
                          id: m.profile_id,
                          name: m.profiles?.full_name ?? 'this member',
                        })
                      }
                      className="self-end px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 active:bg-gray-50 dark:active:bg-gray-800">
                      <Text className="text-gray-700 dark:text-gray-200 text-xs uppercase tracking-widest">
                        Remove
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
      {removeTarget && membership ? (
        <RemoveMemberDialog
          visible={!!removeTarget}
          gymId={membership.gymId}
          profileId={removeTarget.id}
          memberName={removeTarget.name}
          onClose={() => setRemoveTarget(null)}
        />
      ) : null}
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
      {row.is_intro ? <Badge label="Intro" color="#10B981" /> : null}
      {row.is_expiring_soon ? (
        <Badge label={`${row.days_until_expiry}d`} color="#F97316" />
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

function PlanChip({
  name,
  status,
  creditBalance,
}: {
  name: string;
  status: string;
  creditBalance: number | null;
}) {
  const dimmed = status !== 'active';
  return (
    <View
      className={`rounded-full px-2 py-0.5 border ${
        dimmed
          ? 'border-gray-300 dark:border-gray-700'
          : 'border-blue-300 dark:border-blue-700'
      }`}>
      <Text
        className={`text-[10px] font-semibold ${
          dimmed
            ? 'text-gray-500 dark:text-gray-400'
            : 'text-blue-700 dark:text-blue-300'
        }`}>
        {name}
        {status !== 'active' ? ` · ${status.replace(/_/g, ' ')}` : ''}
        {creditBalance !== null ? ` · ${creditBalance} cr` : ''}
      </Text>
    </View>
  );
}
