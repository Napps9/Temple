import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Sheet, SheetAction } from '@/components/Sheet';
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
    <Sheet
      visible={visible}
      title={`Remove ${memberName} from the gym?`}
      onClose={onClose}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={onClose}>
              Keep them
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button
              variant="destructive"
              onPress={() => remove.mutate()}
              loading={remove.isPending}>
              Remove
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-3 pb-1">
        <Text className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-5">
          They lose access to bookings, eligibility, and any active
          subscriptions or comp grants. History is preserved — you can restore
          them from the archived view, but subscriptions and comps have to be
          re-issued.
        </Text>

        {counts.isLoading ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">
            Counting what will be cancelled…
          </Text>
        ) : counts.data ? (
          <View className="rounded-card border border-line dark:border-line-dk overflow-hidden">
            <CountRow label="Future bookings" value={counts.data.bookings} first />
            <CountRow label="Active subscriptions" value={counts.data.subs} />
            <CountRow label="Active comp grants" value={counts.data.comps} />
            <CountRow label="Waitlist entries" value={counts.data.waitlist} />
          </View>
        ) : null}

        {error ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-red-500 dark:text-red-400 text-[13px]">
            {error}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

function CountRow({
  label,
  value,
  first,
}: {
  label: string;
  value: number;
  first?: boolean;
}) {
  return (
    <View
      className={`flex-row justify-between px-3.5 py-2.5 ${
        first ? '' : 'border-t border-line dark:border-line-dk'
      }`}>
      <Text className="text-ink-2 dark:text-ink-2-dk text-[13.5px]">{label}</Text>
      <Text
        className={`text-[13.5px] font-semibold ${
          value === 0
            ? 'text-ink-3 dark:text-ink-3-dk'
            : 'text-ink dark:text-ink-dk'
        }`}>
        {value}
      </Text>
    </View>
  );
}
