// Lives here rather than under app/ because it has no route of its own.
// /management/operating was a Screen, a BackLink and a heading around
// OperatingDefaultsPanel plus this card. The panel was already in the
// Manage screen's Settings tab; this card was not, and it is gated on
// can_bulk_edit_classes rather than can_manage_staff — so it becomes its
// own settings section rather than a card nested inside Gym settings,
// which would have narrowed it to whoever manages staff.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { ChipButton } from '@/components/ChipButton';
import { ReopenClosureModal } from '@/components/ReopenClosureModal';
import { useGymMembership } from '@/lib/auth';
import { drainClassChangeEmails } from '@/lib/class-change-notifications';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type Closure = {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
};

function fmtClosureDate(iso: string) {
  // Plain YYYY-MM-DD; parsing at UTC noon keeps it on the right day
  // whatever the viewer's offset.
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Closures are created from the calendar's Bulk action; this card is
// where they are reviewed and reopened.
export function ClosuresCard() {
  const { data: membership } = useGymMembership();
  const canBulkEdit = useCan('can_bulk_edit_classes') ?? false;
  const queryClient = useQueryClient();
  const [reopening, setReopening] = useState<Closure | null>(null);

  const closuresQuery = useQuery({
    queryKey: ['gym-closures-live', membership?.gymId],
    enabled: !!membership?.gymId && canBulkEdit,
    queryFn: async (): Promise<Closure[]> => {
      const { data, error } = await supabase
        .from('gym_closures')
        .select('id, starts_on, ends_on, reason')
        .is('lifted_at', null)
        .order('starts_on');
      if (error) throw error;
      return data ?? [];
    },
  });

  const reopen = useMutation({
    mutationFn: async (args: {
      closureId: string;
      exclude: { recurrence_id: string; starts_at: string }[];
    }) => {
      const { error } = await supabase.rpc('reopen_closure', {
        p_closure_id: args.closureId,
        p_exclude: args.exclude,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setReopening(null);
      if (membership?.gymId) void drainClassChangeEmails(membership.gymId);
      queryClient.invalidateQueries({ queryKey: ['closure-reopen-preview'] });
      queryClient.invalidateQueries({ queryKey: ['gym-closures-live'] });
      queryClient.invalidateQueries({ queryKey: ['gym-closures'] });
      queryClient.invalidateQueries({ queryKey: ['class-sessions-month'] });
      queryClient.invalidateQueries({ queryKey: ['class-recurrences'] });
    },
  });

  if (!canBulkEdit) return null;

  const closures = closuresQuery.data ?? [];

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <Text className="text-ink dark:text-ink-dk font-semibold">
        Closures
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        Dates the gym is shut. Classes inside a closure are cancelled, and
        anything scheduled into it later is blocked. Start one from the Bulk
        button on the Classes calendar.
      </Text>

      {closuresQuery.isLoading ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading…</Text>
      ) : closuresQuery.error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(closuresQuery.error, 'Could not load closures')}
        </Text>
      ) : closures.length === 0 ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          No closures set.
        </Text>
      ) : (
        <View className="gap-2">
          {closures.map((c) => (
            <View
              key={c.id}
              className="flex-row items-center gap-3 border border-line dark:border-line-dk rounded-lg px-3 py-2">
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dk text-sm">
                  {c.starts_on === c.ends_on
                    ? fmtClosureDate(c.starts_on)
                    : `${fmtClosureDate(c.starts_on)} – ${fmtClosureDate(c.ends_on)}`}
                </Text>
                {c.reason ? (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    {c.reason}
                  </Text>
                ) : null}
              </View>
              <ChipButton
                label="Reopen"
                icon="lock-open-outline"
                tone="neutral"
                onPress={() => setReopening(c)}
              />
            </View>
          ))}
        </View>
      )}

      <ReopenClosureModal
        visible={reopening !== null}
        closureId={reopening?.id ?? null}
        closureLabel={
          reopening
            ? reopening.starts_on === reopening.ends_on
              ? fmtClosureDate(reopening.starts_on)
              : `${fmtClosureDate(reopening.starts_on)} – ${fmtClosureDate(reopening.ends_on)}`
            : ''
        }
        onClose={() => setReopening(null)}
        onConfirm={(exclude) =>
          reopening && reopen.mutate({ closureId: reopening.id, exclude })
        }
        pending={reopen.isPending}
        error={
          reopen.error
            ? errorMessage(reopen.error, 'Could not reopen those dates')
            : null
        }
      />
    </View>
  );
}
