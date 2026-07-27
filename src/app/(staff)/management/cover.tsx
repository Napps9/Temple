import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { CoverRangeModal } from '@/components/CoverRangeModal';
import { CoverRequestCard, type CoverOffer } from '@/components/CoverRequestCard';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { SessionPickerModal } from '@/components/SessionPickerModal';
import { BackLink } from '@/components/BackLink';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatDate } from '@/lib/format-date';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

// Best-effort nudge to the edge worker to drain any queued cover emails.
// Never throws — a failed drain leaves the rows queued and retryable, and
// the in-app half of the notification has already landed.
async function drainCoverEmails(gymId: string) {
  try {
    await supabase.functions.invoke('send-cover-notifications', {
      body: {
        gym_id: gymId,
        origin: Platform.OS === 'web' ? window.location.origin : undefined,
      },
    });
  } catch {
    // Non-fatal by design.
  }
}

type MyRequest = {
  id: string;
  range_start: string;
  range_end: string;
  requested_start: string | null;
  requested_end: string | null;
  status: 'open' | 'partial' | 'claimed' | 'cancelled' | 'expired';
  notes: string | null;
  created_at: string;
  cover_request_sessions: { claimed_by: string | null }[];
};

export default function CoverScreen() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canRequest = useCan('can_request_cover');
  const canClaim = useCan('can_claim_cover');

  // Opening this screen IS reading the cover notifications — everything
  // they point at is on it. Once per mount; the ref stops a refetch or a
  // mutation's re-render from firing it again.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || !membership?.gymId) return;
    marked.current = true;
    supabase
      .rpc('mark_cover_notifications_read', { p_gym_id: membership.gymId })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: ['unread-cover-notifications'],
        }),
      );
  }, [membership?.gymId, queryClient]);

  const offersQuery = useQuery({
    queryKey: ['cover-offers', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cover_request_sessions')
        .select(
          'id, original_coach_id, class_session_id, class_sessions!inner(name, starts_at, duration_minutes, class_type_id, class_types(name, color)), original_coach:profiles!original_coach_id(full_name)',
        )
        .eq('gym_id', membership!.gymId)
        .is('claimed_by', null)
        // !inner so PostgREST filters on the embedded class rather than
        // just nulling it — offers for classes that already ran are dead.
        .gte('class_sessions.starts_at', new Date().toISOString())
        .order('starts_at', { referencedTable: 'class_sessions', ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CoverOffer[];
    },
  });

  // The class types this coach is explicitly disqualified for —
  // the claim_cover RPC enforces this, but we disable the button
  // up front and explain why.
  const disqualifiedQuery = useQuery({
    queryKey: ['my-cover-disqualifications', membership?.gymId, session?.user.id],
    enabled: !!membership?.gymId && !!session?.user.id && canClaim === true,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('coach_class_type_qualifications')
        .select('class_type_id')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', session!.user.id)
        .eq('qualified', false);
      if (error) throw error;
      return new Set(
        (data ?? []).map((r) => (r as { class_type_id: string }).class_type_id),
      );
    },
  });

  const myRequestsQuery = useQuery({
    queryKey: ['my-cover-requests', membership?.gymId, session?.user.id],
    enabled: !!membership?.gymId && !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cover_requests')
        .select(
          'id, range_start, range_end, requested_start, requested_end, status, notes, created_at, cover_request_sessions(claimed_by)',
        )
        .eq('gym_id', membership!.gymId)
        .eq('requested_by', session!.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MyRequest[];
    },
  });

  const request = useMutation({
    mutationFn: async (sessionIds: string[]) => {
      const { data, error } = await supabase.rpc('request_cover', {
        p_session_ids: sessionIds,
        p_notes: notes.trim().length > 0 ? notes.trim() : null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setError(null);
      setPickerOpen(false);
      setNotes('');
      void drainCoverEmails(membership!.gymId);
      queryClient.invalidateQueries({ queryKey: ['cover-offers'] });
      queryClient.invalidateQueries({ queryKey: ['my-cover-requests'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not request cover')),
  });

  const requestRange = useMutation({
    mutationFn: async (args: {
      start: string;
      end: string;
      excludeSessionIds: string[];
    }) => {
      const { data, error } = await supabase.rpc('request_cover_range', {
        p_gym_id: membership!.gymId,
        p_start: args.start,
        p_end: args.end,
        p_exclude_session_ids: args.excludeSessionIds,
        p_notes: notes.trim().length > 0 ? notes.trim() : null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setError(null);
      setRangeOpen(false);
      setNotes('');
      void drainCoverEmails(membership!.gymId);
      queryClient.invalidateQueries({ queryKey: ['cover-offers'] });
      queryClient.invalidateQueries({ queryKey: ['my-cover-requests'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not request cover')),
  });

  const cancel = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc('cancel_cover_request', {
        p_request_id: requestId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cover-offers'] });
      queryClient.invalidateQueries({ queryKey: ['my-cover-requests'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not cancel request')),
  });

  if (canRequest === false && canClaim === false) {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Cover
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Hand a class — or a whole stretch of dates — off to another
            coach. First-claim wins; offers disappear from this feed the
            moment they're claimed.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Request cover
          </Text>
          <Input
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything the covering coach should know"
            multiline
          />
          <Button icon="calendar-outline" onPress={() => setRangeOpen(true)}>
            Pick dates
          </Button>
          <Button variant="secondary" onPress={() => setPickerOpen(true)}>
            Pick individual classes
          </Button>
        </View>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        <View className="gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Open offers
          </Text>
          {offersQuery.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
          ) : (offersQuery.data ?? []).length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No open offers right now.
            </Text>
          ) : (
            (offersQuery.data ?? []).map((o) => (
              <CoverRequestCard
                key={o.id}
                offer={o}
                canClaim={canClaim ?? false}
                qualified={
                  !(
                    o.class_sessions?.class_type_id != null &&
                    (disqualifiedQuery.data?.has(
                      o.class_sessions.class_type_id,
                    ) ??
                      false)
                  )
                }
              />
            ))
          )}
        </View>

        <View className="gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            My requests
          </Text>
          {myRequestsQuery.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
          ) : (myRequestsQuery.data ?? []).length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              You haven't requested cover yet.
            </Text>
          ) : (
            (myRequestsQuery.data ?? []).map((r) => {
              const isRange = r.requested_start !== null;
              const total = r.cover_request_sessions.length;
              const covered = r.cover_request_sessions.filter(
                (o) => o.claimed_by !== null,
              ).length;
              return (
                <View
                  key={r.id}
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 shadow-card">
                  <View className="flex-row justify-between items-center">
                    <Text className="text-gray-900 dark:text-gray-50 font-medium">
                      {isRange
                        ? `${formatDate(r.requested_start)} → ${formatDate(r.requested_end)}`
                        : `${formatDate(r.range_start)} → ${formatDate(r.range_end)}`}
                    </Text>
                    <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase">
                      {r.status}
                    </Text>
                  </View>
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    {total === 0
                      ? isRange
                        ? 'No classes scheduled in this window yet — anything added will be offered automatically.'
                        : 'No classes left on this request.'
                      : `${total} ${total === 1 ? 'class' : 'classes'} · ${covered} covered`}
                  </Text>
                  {r.notes ? (
                    <Text className="text-gray-500 dark:text-gray-400 text-sm">
                      {r.notes}
                    </Text>
                  ) : null}
                  {r.status === 'open' || r.status === 'partial' ? (
                    <Button
                      variant="ghost"
                      onPress={() => cancel.mutate(r.id)}
                      loading={cancel.isPending}>
                      Cancel
                    </Button>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <SessionPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => request.mutate(ids)}
        confirmLabel="Request cover"
        pending={request.isPending}
      />

      <CoverRangeModal
        visible={rangeOpen}
        onClose={() => setRangeOpen(false)}
        onConfirm={(args) => requestRange.mutate(args)}
        pending={requestRange.isPending}
      />
    </Screen>
  );
}
