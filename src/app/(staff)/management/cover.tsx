import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { CoverRequestCard, type CoverOffer } from '@/components/CoverRequestCard';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { SessionPickerModal } from '@/components/SessionPickerModal';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { can } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type MyRequest = {
  id: string;
  range_start: string;
  range_end: string;
  status: 'open' | 'partial' | 'claimed' | 'cancelled' | 'expired';
  notes: string | null;
  created_at: string;
};

export default function CoverScreen() {
  const role = useRole();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const offersQuery = useQuery({
    queryKey: ['cover-offers', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cover_request_sessions')
        .select(
          'id, original_coach_id, class_session_id, class_sessions(name, starts_at, duration_minutes, class_types(name, color)), original_coach:profiles!original_coach_id(full_name)',
        )
        .eq('gym_id', membership!.gymId)
        .is('claimed_by', null);
      if (error) throw error;
      return (data ?? []) as unknown as CoverOffer[];
    },
  });

  const myRequestsQuery = useQuery({
    queryKey: ['my-cover-requests', membership?.gymId, session?.user.id],
    enabled: !!membership?.gymId && !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cover_requests')
        .select('id, range_start, range_end, status, notes, created_at')
        .eq('gym_id', membership!.gymId)
        .eq('requested_by', session!.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as MyRequest[];
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

  if (role && !can(role, 'can_request_cover') && !can(role, 'can_claim_cover')) {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Cover
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Hand a class off to another coach. First-claim wins; offers
            disappear from this feed the moment they're claimed.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
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
          <Button onPress={() => setPickerOpen(true)}>Pick classes to cover</Button>
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
                canClaim={can(role, 'can_claim_cover')}
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
            (myRequestsQuery.data ?? []).map((r) => (
              <View
                key={r.id}
                className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
                <View className="flex-row justify-between items-center">
                  <Text className="text-gray-900 dark:text-gray-50 font-medium">
                    {r.range_start.slice(0, 10)} → {r.range_end.slice(0, 10)}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase">
                    {r.status}
                  </Text>
                </View>
                {r.notes ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    {r.notes}
                  </Text>
                ) : null}
                {r.status === 'open' ? (
                  <Button
                    variant="ghost"
                    onPress={() => cancel.mutate(r.id)}
                    loading={cancel.isPending}>
                    Cancel
                  </Button>
                ) : null}
              </View>
            ))
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
    </Screen>
  );
}
