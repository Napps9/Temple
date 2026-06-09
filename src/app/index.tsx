import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type ParqState = {
  active_questionnaire_id: string | null;
  last_response_id: string | null;
  last_completed_at: string | null;
  last_had_flag: boolean | null;
  needs_parq: boolean;
};

export default function Index() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();
  const canAccessStaff = useCan('can_access_staff_area');

  // Annual PAR-Q gate. Members only — staff bypass so they can still
  // operate the gym even if their own screening lapsed.
  const parqState = useQuery({
    queryKey: ['parq-state', membership?.gymId, session?.user.id],
    enabled:
      !!session?.user.id &&
      !!membership?.gymId &&
      canAccessStaff === false,
    queryFn: async (): Promise<ParqState | null> => {
      const { data, error } = await supabase.rpc('current_parq_state', {
        p_gym_id: membership!.gymId,
        p_profile_id: session!.user.id,
      });
      if (error) throw error;
      const row = (data ?? [])[0] as ParqState | undefined;
      return row ?? null;
    },
  });

  if (session === undefined) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  if (isLoading) return <Loading />;
  if (!membership) return <Redirect href="/welcome" />;
  if (canAccessStaff === undefined) return <Loading />;
  if (canAccessStaff) return <Redirect href="/classes" />;
  if (parqState.isLoading) return <Loading />;
  if (parqState.data?.needs_parq) return <Redirect href="/parq" />;
  return <Redirect href="/book" />;
}

function Loading() {
  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950 items-center justify-center">
      <ActivityIndicator color="#2563EB" />
    </View>
  );
}
