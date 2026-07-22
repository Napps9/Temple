import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { MemberTagChip } from '@/components/MemberTagChip';
import { RemoveMemberDialog } from '@/components/RemoveMemberDialog';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format-date';
import {
  useChangeRequestQueue,
  useDecideChangeRequest,
  type StaffChangeRequest,
} from '@/lib/membership-changes';
import { useMembersFilter } from '@/lib/members-filter';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';

type CohortRow = {
  profile_id: string;
  joined_at: string;
  is_intro: boolean;
  is_paying: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
  profiles: {
    full_name: string | null;
    avatar_url: string | null;
    managed: boolean;
  } | null;
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

type PendingRow = {
  id: string;
  email: string;
  full_name: string | null;
  plan_name: string | null;
  credits_remaining: number | null;
  tags: string[];
  status: 'pending' | 'invited' | 'linked' | 'skipped';
  created_at: string;
};

type ListItem =
  | { kind: 'member'; key: string; name: string; row: CohortRow }
  | { kind: 'pending'; key: string; name: string; row: PendingRow };

export function MembersList() {
  const { data: membership } = useGymMembership();
  const { filter, search, setFilter, setSearch } = useMembersFilter(membership?.gymId);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  const canRemove = useCan('can_archive_members') ?? false;
  // Imported members live in pending_members (RLS-gated on
  // can_manage_staff, the same gate as the import surface). Staff who
  // can manage tags but not staff simply see none — the query returns
  // empty under RLS and the section stays hidden.
  const canManageStaff = useCan('can_manage_staff') ?? false;
  // Membership change requests surface here as a per-member marker + a
  // "Requests" filter, so can_assign_plan staff can approve/reject
  // without leaving the list. The RPC throws for anyone without the
  // capability, so gate the query on it.
  const canAssignPlan = useCan('can_assign_plan') ?? false;

  const cohortQuery = useQuery({
    queryKey: ['members-cohort', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_member_cohort')
        .select(
          // profiles!profile_id: member_injuries' FKs (profiles +
          // composite to gym_memberships) gave PostgREST a second
          // resolution path — the bare embed became ambiguous.
          'profile_id, joined_at, is_intro, is_paying, is_active, is_expiring_soon, is_expired, days_until_expiry, profiles!profile_id(full_name, avatar_url, managed)',
        )
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as unknown as CohortRow[];
    },
  });

  const pendingQuery = useQuery({
    queryKey: ['members-pending', membership?.gymId],
    enabled: !!membership?.gymId && canManageStaff,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_members')
        .select('id, email, full_name, plan_name, credits_remaining, tags, status, created_at')
        .eq('gym_id', membership!.gymId)
        .in('status', ['pending', 'invited']);
      if (error) throw error;
      return (data ?? []) as PendingRow[];
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
        .in('status', [
          'active',
          'pending',
          'paused',
          'cancelled_at_period_end',
          'refunded_retained',
        ]);
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

  const flagsQuery = useQuery({
    queryKey: ['members-health-flags', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id')
        .eq('gym_id', membership!.gymId)
        .eq('health_flag', true)
        .is('left_at', null);
      if (error) throw error;
      return new Set(
        (data ?? []).map((r) => (r as { profile_id: string }).profile_id),
      );
    },
  });

  // Members with an unresolved injury get an amber badge; RLS hides
  // the rows from staff without can_see_health_flag, so this set is
  // simply empty for them.
  const injuriesQuery = useQuery({
    queryKey: ['members-open-injuries', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('member_injuries')
        .select('profile_id')
        .eq('gym_id', membership!.gymId)
        .neq('status', 'resolved');
      if (error) throw error;
      return new Set(
        (data ?? []).map((r) => (r as { profile_id: string }).profile_id),
      );
    },
  });

  const requestsQuery = useChangeRequestQueue(
    canAssignPlan ? membership?.gymId : undefined,
  );

  const requestsByMember = useMemo(() => {
    const map = new Map<string, StaffChangeRequest[]>();
    for (const r of requestsQuery.data ?? []) {
      const arr = map.get(r.profile_id) ?? [];
      arr.push(r);
      map.set(r.profile_id, arr);
    }
    return map;
  }, [requestsQuery.data]);

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

  const items = useMemo<ListItem[]>(() => {
    const q = search.trim().toLowerCase();
    const showMembers = filter !== 'imported';
    const showPending = filter === 'all' || filter === 'imported';

    const memberItems: ListItem[] = showMembers
      ? (cohortQuery.data ?? [])
          .filter((r) => {
            if (filter === 'intro' && !r.is_intro) return false;
            if (filter === 'expiring' && !r.is_expiring_soon) return false;
            if (filter === 'expired' && !r.is_expired) return false;
            if (filter === 'active' && !r.is_active) return false;
            if (filter === 'managed' && !r.profiles?.managed) return false;
            if (filter === 'requests' && !requestsByMember.has(r.profile_id))
              return false;
            if (q.length > 0) {
              return (r.profiles?.full_name?.toLowerCase() ?? '').includes(q);
            }
            return true;
          })
          .map((r) => ({
            kind: 'member' as const,
            key: `m:${r.profile_id}`,
            name: r.profiles?.full_name ?? '',
            row: r,
          }))
      : [];

    const pendingItems: ListItem[] = showPending
      ? (pendingQuery.data ?? [])
          .filter((r) => {
            if (q.length === 0) return true;
            return (
              (r.full_name?.toLowerCase() ?? '').includes(q) ||
              r.email.toLowerCase().includes(q)
            );
          })
          .map((r) => ({
            kind: 'pending' as const,
            key: `p:${r.id}`,
            name: r.full_name ?? r.email,
            row: r,
          }))
      : [];

    return [...memberItems, ...pendingItems].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [cohortQuery.data, pendingQuery.data, filter, search, requestsByMember]);

  return (
    <View className="gap-4">
      <Input label="Search" value={search} onChangeText={setSearch} placeholder="Name" />

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
        <FilterChip
          label="Children"
          active={filter === 'managed'}
          onPress={() => setFilter('managed')}
        />
        {canManageStaff ? (
          <FilterChip
            label="Imported"
            active={filter === 'imported'}
            onPress={() => setFilter('imported')}
          />
        ) : null}
        {canAssignPlan ? (
          <FilterChip
            label={
              (requestsQuery.data?.length ?? 0) > 0
                ? `Requests (${requestsQuery.data!.length})`
                : 'Requests'
            }
            active={filter === 'requests'}
            onPress={() => setFilter('requests')}
          />
        ) : null}
      </View>

      {cohortQuery.error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(cohortQuery.error, 'Could not load members')}
        </Text>
      ) : null}
      {pendingQuery.error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(pendingQuery.error, 'Could not load imported members')}
        </Text>
      ) : null}
      {canManageStaff && (pendingQuery.data?.length ?? 0) > 0 ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {pendingQuery.data!.length} imported{' '}
          {pendingQuery.data!.length === 1 ? 'member hasn’t' : 'members haven’t'}{' '}
          signed up yet — they show below with an Imported badge. Send a join
          invite to bring them in.
        </Text>
      ) : null}

      <View className="gap-2">
        {cohortQuery.isLoading || pendingQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : items.length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">No members match.</Text>
        ) : (
          items.map((it) => {
            if (it.kind === 'pending') {
              return (
                <PendingMemberCard
                  key={it.key}
                  row={it.row}
                  gymId={membership?.gymId ?? null}
                  canSend={canManageStaff}
                  onSent={() => pendingQuery.refetch()}
                />
              );
            }
            const m = it.row;
            const subs = subsByMember.get(m.profile_id) ?? [];
            const comps = compsByMember.get(m.profile_id) ?? [];
            const tags = tagsByMember.get(m.profile_id) ?? [];
            const memberRequests = requestsByMember.get(m.profile_id) ?? [];
            return (
              <View
                key={m.profile_id}
                className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 shadow-card">
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
                          Joined {m.joined_at ? formatDate(m.joined_at) : '—'}
                        </Text>
                      </View>
                      <CohortBadges
                        row={m}
                        flagged={flagsQuery.data?.has(m.profile_id) ?? false}
                        injured={injuriesQuery.data?.has(m.profile_id) ?? false}
                        requested={memberRequests.length > 0}
                      />
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
                {canAssignPlan && memberRequests.length > 0 && membership ? (
                  <RequestActionRow
                    requests={memberRequests}
                    gymId={membership.gymId}
                  />
                ) : null}
                {canRemove ? (
                  <View className="self-end">
                    <ActionButton
                      kind="remove"
                      label="Remove"
                      onPress={() =>
                        setRemoveTarget({
                          id: m.profile_id,
                          name: m.profiles?.full_name ?? 'this member',
                        })
                      }
                    />
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      {removeTarget && membership ? (
        <RemoveMemberDialog
          visible={!!removeTarget}
          gymId={membership.gymId}
          profileId={removeTarget.id}
          memberName={removeTarget.name}
          onClose={() => setRemoveTarget(null)}
        />
      ) : null}
    </View>
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

function CohortBadges({
  row,
  flagged,
  injured,
  requested,
}: {
  row: CohortRow;
  flagged: boolean;
  injured: boolean;
  requested: boolean;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row flex-wrap gap-1 justify-end">
      {requested ? <Badge label="Request" color="#F59E0B" /> : null}
      {row.profiles?.managed ? <Badge label="Child" color="#8B5CF6" /> : null}
      {flagged ? <Badge label="PAR-Q" color="#DC2626" /> : null}
      {injured ? <Badge label="Injury" color="#F59E0B" /> : null}
      {row.is_intro ? <Badge label="Intro" color="#10B981" /> : null}
      {row.is_expiring_soon ? (
        <Badge label={`${row.days_until_expiry}d`} color="#F97316" />
      ) : null}
      {row.is_expired ? <Badge label="Expired" color="#9CA3AF" /> : null}
      {row.is_paying ? <Badge label="Paying" color={colors.primary} /> : null}
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

// A member's pending membership-change request(s), actioned inline so
// can_assign_plan staff can approve or reject straight from the list.
// Approve/reject both run through the shared decide mutation, which
// invalidates the queue — so a decided request drops off the list and
// the member's "Request" marker clears on the next render.
function RequestActionRow({
  requests,
  gymId,
}: {
  requests: StaffChangeRequest[];
  gymId: string;
}) {
  const decide = useDecideChangeRequest(gymId);
  return (
    <View className="gap-2 border-t border-gray-100 dark:border-gray-800 pt-3">
      {requests.map((req) => {
        const isCancel = req.kind === 'cancel';
        const acting =
          decide.isPending && decide.variables?.requestId === req.id;
        const title = isCancel
          ? 'Wants to cancel their membership'
          : `Wants to switch${
              req.current_plan_name ? ` from ${req.current_plan_name}` : ''
            }${req.target_plan_name ? ` to ${req.target_plan_name}` : ''}`;
        return (
          <View key={req.id} className="gap-2">
            <View className="flex-row items-center gap-2">
              <Badge
                label={isCancel ? 'Cancel' : 'Switch'}
                color={isCancel ? '#DC2626' : '#F59E0B'}
              />
              <Text className="flex-1 text-gray-600 dark:text-gray-300 text-sm">
                {title}
              </Text>
            </View>
            {req.member_note ? (
              <Text className="text-gray-500 dark:text-gray-400 text-xs italic">
                “{req.member_note}”
              </Text>
            ) : null}
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  icon="checkmark"
                  loading={acting && decide.variables?.decision === 'approve'}
                  disabled={acting}
                  onPress={() =>
                    decide.mutate({ requestId: req.id, decision: 'approve' })
                  }>
                  Approve
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  variant="secondary"
                  icon="close"
                  loading={acting && decide.variables?.decision === 'reject'}
                  disabled={acting}
                  onPress={() =>
                    decide.mutate({ requestId: req.id, decision: 'reject' })
                  }>
                  Reject
                </Button>
              </View>
            </View>
          </View>
        );
      })}
      {decide.error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(decide.error, 'Could not apply the decision')}
        </Text>
      ) : null}
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

// An imported row that hasn't been claimed yet. It has no profile, so
// there's no detail page to link to — the one action is sending the
// join invite (the same send-member-join-invites edge function the
// import handover uses, scoped to this single row). On a successful
// send the server flips the row to 'invited'; we refetch so the card
// re-renders in its "waiting" state.
function PendingMemberCard({
  row,
  gymId,
  canSend,
  onSent,
}: {
  row: PendingRow;
  gymId: string | null;
  canSend: boolean;
  onSent: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: async () => {
      if (!gymId) throw new Error('Missing gym');
      const { data, error: e } = await supabase.functions.invoke(
        'send-member-join-invites',
        {
          body: {
            gym_id: gymId,
            pending_member_ids: [row.id],
            origin: Platform.OS === 'web' ? window.location.origin : undefined,
          },
        },
      );
      if (e) throw e;
      return data as { sent: number; failed: number };
    },
    onSuccess: (d) => {
      if (d.sent === 0) {
        setError('Could not send — the email address may be undeliverable.');
        return;
      }
      setError(null);
      onSent();
    },
    onError: (e) => setError(errorMessage(e, 'Could not send invite')),
  });

  const invited = row.status === 'invited';
  const planLabel = row.plan_name
    ? `${row.plan_name}${
        row.credits_remaining !== null ? ` · ${row.credits_remaining} cr` : ''
      }`
    : null;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 shadow-card">
      <Link
        href={{
          pathname: '/management/members/imported/[id]',
          params: { id: row.id },
        }}
        asChild>
        <Pressable className="gap-2">
          <View className="flex-row items-center gap-3">
            <Avatar name={row.full_name} size={36} />
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                {row.full_name ?? row.email}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                Imported {row.created_at ? formatDate(row.created_at) : '—'} · not
                signed up
              </Text>
            </View>
            <Badge label={invited ? 'Invited' : 'Imported'} color="#F59E0B" />
          </View>
          {planLabel ? (
            <View className="flex-row flex-wrap gap-1">
              <View className="rounded-full px-2 py-0.5 border border-gray-300 dark:border-gray-700">
                <Text className="text-gray-500 dark:text-gray-400 text-[10px] font-semibold">
                  {planLabel}
                </Text>
              </View>
            </View>
          ) : null}
          {row.tags.length > 0 ? (
            <View className="flex-row flex-wrap gap-1">
              {row.tags.map((t, i) => (
                <View
                  key={`t-${i}`}
                  className="rounded-full px-2 py-0.5 border border-gray-300 dark:border-gray-700">
                  <Text className="text-gray-500 dark:text-gray-400 text-[10px] font-semibold">
                    {t}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>
      </Link>
      {canSend && !invited ? (
        <View className="self-end items-end gap-1">
          <ChipButton
            label={send.isPending ? 'Sending…' : 'Send invite'}
            icon="mail-outline"
            tone="primary"
            onPress={() => send.mutate()}
            disabled={send.isPending || (send.data?.sent ?? 0) > 0}
          />
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
          ) : null}
        </View>
      ) : invited ? (
        <Text className="self-end text-gray-400 dark:text-gray-500 text-xs">
          Invite sent · waiting for sign-up
        </Text>
      ) : null}
    </View>
  );
}
