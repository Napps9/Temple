import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import {
  pendingGymFromSession,
  pendingInviteFromSession,
  pendingJoinFromSession,
  useGymMembership,
  useRole,
  useSession,
} from '@/lib/auth';
import { useConsentState } from '@/lib/consent';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

// Required setup keys mirror the non-optional STEPS in /onboarding.
const REQUIRED_SETUP_KEYS = new Set([
  'logo',
  'settings',
  'class_type_and_schedule',
  'parq',
  'stripe',
  'plan',
]);

type SetupRow = { step_key: string; done: boolean };

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
  const role = useRole();
  const params = useLocalSearchParams<{ checkout?: string; book?: string }>();

  // Owner-only setup gate. Returning owners with complete setup short-
  // circuit cheaply; new ones get sent to the dedicated /onboarding
  // page unless they've permanently dismissed it (gyms.onboarding_
  // dismissed_at) — a DB flag, not sessionStorage, so skipping sticks
  // across sign-ins and devices instead of reappearing next session.
  const setupProgress = useQuery({
    queryKey: ['gym-setup-progress', membership?.gymId],
    enabled: !!membership?.gymId && role === 'owner',
    queryFn: async (): Promise<SetupRow[]> => {
      const { data, error } = await supabase.rpc('get_gym_setup_progress', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return (data ?? []) as SetupRow[];
    },
  });

  const onboardingDismissed = useQuery({
    queryKey: ['gym-onboarding-dismissed', membership?.gymId],
    enabled: !!membership?.gymId && role === 'owner',
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('onboarding_dismissed_at')
        .eq('id', membership!.gymId)
        .maybeSingle();
      if (error) throw error;
      return !!data?.onboarding_dismissed_at;
    },
  });

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

  // The plan the AI front desk closed on, still unpaid. Members only —
  // routes them to the membership page to finish, until they pay or
  // dismiss it there.
  const agreedPlan = useQuery({
    queryKey: ['my-agreed-plan', membership?.gymId],
    enabled:
      !!session?.user.id &&
      !!membership?.gymId &&
      canAccessStaff === false,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc('my_agreed_plan', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return ((data ?? []) as unknown[]).length > 0;
    },
  });

  if (session === undefined) return <Loading />;
  // Accountless visitors land on the three-path picker (Join / Solo /
  // Start) rather than a sign-in form — we don't yet know which they're
  // here for, and the picker links to /sign-in for returning users.
  if (!session) return <Redirect href="/get-started" />;
  if (isLoading) return <Loading />;
  // Gymless users land in the athlete area — read-only portable training
  // history plus the join / start-a-gym CTAs. The exception: someone who
  // deferred gym creation for email confirmation has their gym name/slug
  // stashed in metadata, so send them to /welcome to finish it in one tap
  // rather than stranding them on the gymless home with no way to resume.
  if (!membership) {
    const resumable =
      pendingGymFromSession(session) ||
      pendingJoinFromSession(session) ||
      pendingInviteFromSession(session);
    return <Redirect href={resumable ? '/welcome' : '/athlete'} />;
  }
  if (consent.isLoading) return <Loading />;
  if (consent.data && !consent.data.consented) {
    return <Redirect href="/consent" />;
  }
  if (canAccessStaff === undefined) return <Loading />;
  if (canAccessStaff) {
    if (role === 'owner') {
      if (setupProgress.isLoading || onboardingDismissed.isLoading) return <Loading />;
      const rows = setupProgress.data ?? [];
      const requiredPending = rows.some(
        (r) => REQUIRED_SETUP_KEYS.has(r.step_key) && !r.done,
      );
      if (requiredPending && !onboardingDismissed.data) {
        // Conversational setup is the front door; /onboarding survives as
        // the checklist escape hatch linked from inside it.
        return <Redirect href="/setup" />;
      }
    }
    // Staff land on the Timeline — what happened, what needs you — with
    // the calendar one pill away (docs/roadmap.md phase 1).
    return <Redirect href="/timeline" />;
  }
  if (waiverState.isLoading) return <Loading />;
  if (waiverState.data?.needs_waiver) return <Redirect href="/waiver" />;
  if (parqState.isLoading) return <Loading />;
  if (parqState.data?.needs_parq) return <Redirect href="/parq" />;
  // Returning from Stripe Checkout: land on the membership page so the
  // result (and any pending state) is visible while the webhook settles.
  if (params.checkout) {
    const bookQ = params.book ? `&book=${params.book}` : '';
    return (
      <Redirect href={`/membership?checkout=${params.checkout}${bookQ}`} />
    );
  }
  if (agreedPlan.isLoading) return <Loading />;
  if (agreedPlan.data) return <Redirect href="/membership" />;
  // The booking surface stays open to everyone; the membership gate (if
  // the gym requires one) is applied at the point of booking, in
  // ClassDetailModal, not by routing away from it.
  return <Redirect href="/book" />;
}

function Loading() {
  return (
    <View className="flex-1 bg-ground dark:bg-ground-dk items-center justify-center">
      <ActivityIndicator color="#2563EB" />
    </View>
  );
}
