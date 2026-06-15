import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';

type Props = {
  visible: boolean;
  gymId: string;
  profileId: string;
  memberName: string;
  onClose: () => void;
  onRemoved?: () => void;
};

export function RemoveMemberDialog({
  visible,
  gymId,
  profileId,
  memberName,
  onClose,
  onRemoved,
}: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const counts = useQuery({
    queryKey: ['remove-member-counts', gymId, profileId],
    enabled: visible,
    queryFn: async () => {
      const [futureBookings, activeSubs, activeComps, waitlistEntries] = await Promise.all([
        supabase
          .from('class_bookings')
          .select('id, class_sessions!inner(gym_id, starts_at)', {
            count: 'exact',
            head: true,
          })
          .eq('profile_id', profileId)
          .eq('class_sessions.gym_id', gymId)
          .gt('class_sessions.starts_at', new Date().toISOString()),
        supabase
          .from('plan_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('profile_id', profileId)
          .not('status', 'in', '(lapsed,cancelled)'),
        supabase
          .from('comp_grants')
          .select('grant_id', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('profile_id', profileId)
          .is('revoked_at', null),
        supabase
          .from('class_waitlist')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('profile_id', profileId),
      ]);

      return {
        bookings: futureBookings.count ?? 0,
        subs: activeSubs.count ?? 0,
        comps: activeComps.count ?? 0,
        waitlist: waitlistEntries.count ?? 0,
      };
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('leave_gym', {
        p_gym_id: gymId,
        p_profile_id: profileId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.warning();
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['members-cohort'] });
      queryClient.invalidateQueries({ queryKey: ['members-detail'] });
      onRemoved?.();
      onClose();
    },
    onError: (e) => {
      haptic.error();
      setError(errorMessage(e, 'Could not remove member'));
    },
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            Remove {memberName}
          </Text>

          <Text className="text-gray-700 dark:text-gray-200">
            This member will lose access to bookings, eligibility, and any
            active subscriptions or comp grants. History is preserved. You
            can restore the member from the archived view; subscriptions and
            comps will need to be re-issued.
          </Text>

          {counts.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Counting what will be cancelled…
            </Text>
          ) : counts.data ? (
            <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-1">
              <CountRow label="Future bookings" value={counts.data.bookings} />
              <CountRow label="Active subscriptions" value={counts.data.subs} />
              <CountRow label="Active comp grants" value={counts.data.comps} />
              <CountRow label="Waitlist entries" value={counts.data.waitlist} />
            </View>
          ) : null}

          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}

          <View className="flex-row gap-2 justify-end">
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
            <Button onPress={() => remove.mutate()} loading={remove.isPending}>
              Remove
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-gray-700 dark:text-gray-200 text-sm">{label}</Text>
      <Text
        className={`text-sm font-medium ${
          value === 0
            ? 'text-gray-400 dark:text-gray-500'
            : 'text-gray-900 dark:text-gray-50'
        }`}>
        {value}
      </Text>
    </View>
  );
}
