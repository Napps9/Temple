import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { can } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type ShiftRow = {
  shift_id: string;
  class_session_id: string | null;
  assigned_to: string | null;
  starts_at: string;
  ends_at: string;
  state: 'assigned' | 'open' | 'covered';
  notes: string | null;
  profiles: { full_name: string | null } | null;
  class_session: { name: string | null } | null;
  shift_cover_requests: {
    request_id: string;
    requested_by: string;
    reason: string | null;
    accepted_at: string | null;
    cancelled_at: string | null;
  }[];
};

type TeamRow = { profile_id: string; full_name: string | null };

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function groupByDay(rows: ShiftRow[]): { day: string; shifts: ShiftRow[] }[] {
  const byDay: Record<string, ShiftRow[]> = {};
  for (const r of rows) {
    const key = r.starts_at.slice(0, 10);
    (byDay[key] ??= []).push(r);
  }
  return Object.keys(byDay)
    .sort()
    .map((key) => ({ day: key, shifts: byDay[key] }));
}

export default function ManageShifts() {
  const session = useSession();
  const role = useRole();
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();

  const [composing, setComposing] = useState(false);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shiftsQuery = useQuery({
    queryKey: ['shifts', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<ShiftRow[]> => {
      const since = new Date();
      since.setDate(since.getDate() - 1);
      const { data, error } = await supabase
        .from('shifts')
        .select(
          'shift_id, class_session_id, assigned_to, starts_at, ends_at, state, notes, profiles!shifts_assigned_to_fkey(full_name), class_session:class_sessions(name), shift_cover_requests(request_id, requested_by, reason, accepted_at, cancelled_at)',
        )
        .eq('gym_id', gym!.gymId)
        .gte('starts_at', since.toISOString())
        .order('starts_at');
      if (error) throw error;
      return (data ?? []) as unknown as ShiftRow[];
    },
  });

  const teamQuery = useQuery({
    queryKey: ['team-staff', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<TeamRow[]> => {
      type Raw = {
        profile_id: string;
        profiles: { full_name: string | null } | { full_name: string | null }[] | null;
      };
      const { data, error } = await supabase
        .from('gym_memberships')
        .select(
          'profile_id, profiles!gym_memberships_profile_id_fkey(full_name), role',
        )
        .eq('gym_id', gym!.gymId)
        .in('role', ['owner', 'coach', 'staff']);
      if (error) throw error;
      return ((data ?? []) as unknown as Raw[]).map((r) => ({
        profile_id: r.profile_id,
        full_name: Array.isArray(r.profiles)
          ? r.profiles[0]?.full_name ?? null
          : r.profiles?.full_name ?? null,
      }));
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!gym || !session) throw new Error('Not ready');
      if (!startsAt || !endsAt) throw new Error('Start and end required');
      const start = new Date(startsAt);
      const end = new Date(endsAt);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
        throw new Error('Use ISO format (e.g. 2025-06-10T09:00)');
      }
      if (end <= start) throw new Error('End must be after start');
      const { error } = await supabase.from('shifts').insert({
        gym_id: gym.gymId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        assigned_to: assignedTo,
        state: assignedTo ? 'assigned' : 'open',
        created_by: session.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setComposing(false);
      setStartsAt('');
      setEndsAt('');
      setAssignedTo(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['shifts', gym?.gymId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const requestCoverMutation = useMutation({
    mutationFn: async (shiftId: string) => {
      if (!session) throw new Error('Not signed in');
      const { error } = await supabase.from('shift_cover_requests').insert({
        shift_id: shiftId,
        requested_by: session.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['shifts', gym?.gymId] }),
    onError: (err) => setError(errorMessage(err)),
  });

  const acceptCoverMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc('accept_cover', {
        p_request_id: requestId,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['shifts', gym?.gymId] }),
    onError: (err) => setError(errorMessage(err)),
  });

  const grouped = useMemo(
    () => groupByDay(shiftsQuery.data ?? []),
    [shiftsQuery.data],
  );
  const canCreate = can(role, 'can_manage_staff');
  const canRequestCover = can(role, 'can_access_staff_area');

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Shifts
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              When the team's on the floor. Request cover when you can't make it.
            </Text>
          </View>
          {canCreate && !composing ? (
            <Button onPress={() => setComposing(true)}>New shift</Button>
          ) : null}
        </View>

        {composing ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              New shift
            </Text>
            <Input
              label="Starts at (ISO datetime)"
              value={startsAt}
              onChangeText={setStartsAt}
              placeholder="2025-06-10T09:00"
              autoCapitalize="none"
            />
            <Input
              label="Ends at (ISO datetime)"
              value={endsAt}
              onChangeText={setEndsAt}
              placeholder="2025-06-10T10:00"
              autoCapitalize="none"
            />
            <View className="gap-1.5">
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                Assigned to
              </Text>
              <View className="flex-row gap-2 flex-wrap">
                <Pressable
                  onPress={() => setAssignedTo(null)}
                  className={`px-3 py-2 rounded-full border ${
                    assignedTo === null
                      ? 'border-primary bg-primary/10'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Text
                    className={
                      assignedTo === null
                        ? 'text-primary text-sm'
                        : 'text-gray-700 dark:text-gray-200 text-sm'
                    }>
                    Open
                  </Text>
                </Pressable>
                {teamQuery.data?.map((t) => (
                  <Pressable
                    key={t.profile_id}
                    onPress={() => setAssignedTo(t.profile_id)}
                    className={`px-3 py-2 rounded-full border ${
                      assignedTo === t.profile_id
                        ? 'border-primary bg-primary/10'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}>
                    <Text
                      className={
                        assignedTo === t.profile_id
                          ? 'text-primary text-sm'
                          : 'text-gray-700 dark:text-gray-200 text-sm'
                      }>
                      {t.full_name ?? 'Coach'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button
                  variant="secondary"
                  onPress={() => {
                    setComposing(false);
                    setError(null);
                  }}>
                  Cancel
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  onPress={() => createMutation.mutate()}
                  loading={createMutation.isPending}>
                  Create
                </Button>
              </View>
            </View>
          </View>
        ) : null}

        {shiftsQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : null}

        {grouped.length === 0 && !shiftsQuery.isLoading ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400">
              No shifts scheduled.
            </Text>
          </View>
        ) : null}

        {grouped.map(({ day, shifts }) => (
          <View key={day} className="gap-2">
            <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
              {fmtDay(day)}
            </Text>
            {shifts.map((s) => {
              const liveRequest = s.shift_cover_requests.find(
                (r) => !r.accepted_at && !r.cancelled_at,
              );
              const assigneeName = Array.isArray(s.profiles)
                ? s.profiles[0]?.full_name ?? null
                : s.profiles?.full_name ?? null;
              const sessionName = Array.isArray(s.class_session)
                ? s.class_session[0]?.name ?? null
                : s.class_session?.name ?? null;
              const isMine = s.assigned_to === session?.user.id;
              return (
                <View
                  key={s.shift_id}
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
                  <View className="flex-row items-center gap-3">
                    {assigneeName ? (
                      <Avatar name={assigneeName} size={28} />
                    ) : (
                      <View className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-800 items-center justify-center">
                        <Ionicons name="help" size={14} color="#6B7280" />
                      </View>
                    )}
                    <View className="flex-1">
                      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                        {sessionName ?? 'Floor cover'}
                      </Text>
                      <Text className="text-gray-500 dark:text-gray-400 text-xs">
                        {fmtTime(s.starts_at)} – {fmtTime(s.ends_at)} ·{' '}
                        {assigneeName ?? 'open'}
                      </Text>
                    </View>
                    <ShiftStateChip state={s.state} liveRequest={!!liveRequest} />
                  </View>
                  {liveRequest ? (
                    <View className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 gap-2">
                      <Text className="text-amber-800 dark:text-amber-200 text-sm">
                        Cover requested
                        {liveRequest.reason ? ` — ${liveRequest.reason}` : ''}
                      </Text>
                      {canRequestCover &&
                      liveRequest.requested_by !== session?.user.id ? (
                        <Button
                          variant="secondary"
                          onPress={() =>
                            acceptCoverMutation.mutate(liveRequest.request_id)
                          }
                          loading={acceptCoverMutation.isPending}>
                          I'll take it
                        </Button>
                      ) : null}
                    </View>
                  ) : null}
                  {!liveRequest && isMine ? (
                    <Button
                      variant="secondary"
                      onPress={() => requestCoverMutation.mutate(s.shift_id)}
                      loading={requestCoverMutation.isPending}>
                      Request cover
                    </Button>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function ShiftStateChip({
  state,
  liveRequest,
}: {
  state: 'assigned' | 'open' | 'covered';
  liveRequest: boolean;
}) {
  const cfg =
    liveRequest
      ? {
          label: 'Needs cover',
          tone:
            'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200',
        }
      : state === 'open'
      ? {
          label: 'Open',
          tone: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200',
        }
      : state === 'covered'
      ? {
          label: 'Covered',
          tone:
            'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-200',
        }
      : {
          label: 'Assigned',
          tone: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200',
        };
  return (
    <View className={`px-2 py-1 rounded-full ${cfg.tone}`}>
      <Text className={`text-xs font-medium ${cfg.tone}`}>{cfg.label}</Text>
    </View>
  );
}
