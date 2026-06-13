import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';
import { useConsentState } from '@/lib/consent';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type ParqState = {
  active_questionnaire_id: string | null;
  last_response_id: string | null;
  last_completed_at: string | null;
  last_had_flag: boolean | null;
  needs_parq: boolean;
};

type WaiverState = {
  active_waiver_id: string | null;
  last_signature_id: string | null;
  last_signed_at: string | null;
  needs_waiver: boolean;
};

export default function Index() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();
  const canAccessStaff = useCan('can_access_staff_area');

  // Data-processing consent gates everyone (member and staff alike) —
  // no consent, no entry. It's just a name / DOB / tick-box step with
  // no gym-setup dependency, so it can't deadlock an owner on first
  // login the way a PAR-Q gate would (PAR-Q needs a questionnaire the
  // owner hasn't published yet, so that stays members-only below).
  const consent = useConsentState();

  // Waiver gate. Members only — staff bypass (same rationale as PAR-Q:
  // they need to operate the gym; the booking-time gate in
  // _book_class_for still catches anyone who actually books).
  const waiverState = useQuery({
    queryKey: ['waiver-state', membership?.gymId, session?.user.id],
    enabled:
      !!session?.user.id &&
      !!membership?.gymId &&
      canAccessStaff === false,
    queryFn: async (): Promise<WaiverState | null> => {
      const { data, error } = await supabase.rpc('current_waiver_state', {
        p_gym_id: membership!.gymId,
        p_profile_id: session!.user.id,
      });
      if (error) throw error;
      const row = (data ?? [])[0] as WaiverState | undefined;
      return row ?? null;
    },
  });

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
  // Gymless users (brand-new sign-ups and ex-members alike) land in the
  // athlete area — read-only portable training history plus the
  // join / start-a-gym CTAs that /welcome used to be the only home for.
  if (!membership) return <Redirect href="/athlete" />;
  if (consent.isLoading) return <Loading />;
  if (consent.data && !consent.data.consented) {
    return <Redirect href="/consent" />;
  }
  if (canAccessStaff === undefined) return <Loading />;
  if (canAccessStaff) return <Redirect href="/classes" />;
  if (waiverState.isLoading) return <Loading />;
  if (waiverState.data?.needs_waiver) return <Redirect href="/waiver" />;
  if (parqState.isLoading) return <Loading />;
  if (parqState.data?.needs_parq) return <Redirect href="/parq" />;
  return <Redirect href="/book" />;
}

function Loading() {
  return (
    <View className="flex-1 bg-slate-100 dark:bg-gray-950 items-center justify-center">
      <ActivityIndicator color="#2563EB" />
    </View>
  );
}
