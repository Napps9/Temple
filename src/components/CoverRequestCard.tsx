import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type CoverOffer = {
  id: string;
  original_coach_id: string;
  class_session_id: string;
  class_sessions: {
    starts_at: string;
    duration_minutes: number;
    class_types: { name: string; color: string } | null;
    name: string;
  } | null;
  original_coach: { full_name: string | null } | null;
};

type Props = {
  offer: CoverOffer;
  canClaim: boolean;
};

export function CoverRequestCard({ offer, canClaim }: Props) {
  const session = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const claim = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('claim_cover', {
        p_session_offer_id: offer.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['cover-offers'] });
      queryClient.invalidateQueries({ queryKey: ['my-cover-requests'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not claim cover')),
  });

  const start = offer.class_sessions ? new Date(offer.class_sessions.starts_at) : null;
  const typeColor = offer.class_sessions?.class_types?.color ?? '#2563EB';
  const typeName =
    offer.class_sessions?.class_types?.name ?? offer.class_sessions?.name ?? '—';
  const isSelf = session?.user.id === offer.original_coach_id;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <View
          style={{ backgroundColor: typeColor }}
          className="rounded-full px-3 py-1">
          <Text className="text-white text-xs font-semibold">{typeName}</Text>
        </View>
        {start ? (
          <Text className="text-gray-900 dark:text-gray-50 font-medium flex-1">
            {start.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}{' '}
            at{' '}
            {start.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        ) : null}
      </View>

      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        Originally coached by {offer.original_coach?.full_name ?? 'a coach'}.
      </Text>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      {canClaim && !isSelf ? (
        <Button onPress={() => claim.mutate()} loading={claim.isPending}>
          Claim cover
        </Button>
      ) : isSelf ? (
        <Text className="text-gray-400 dark:text-gray-500 text-xs">
          You can't claim your own offer.
        </Text>
      ) : null}
    </View>
  );
}
