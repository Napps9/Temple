import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Switch, View } from 'react-native';
import { PageHead } from '@/components/PageHead';
import { Spinner } from '@/components/EmptyState';
import { Text } from '@/components/Text';

import { ActionButton } from '@/components/ActionButton';
import { Avatar } from '@/components/Avatar';
import { BackLink } from '@/components/BackLink';
import { MacroTargetsCard } from '@/components/MacroTargetsCard';
import { ChipButton } from '@/components/ChipButton';
import { MemberTagChip } from '@/components/MemberTagChip';
import { RefundDialog } from '@/components/RefundDialog';
import { RemoveMemberDialog } from '@/components/RemoveMemberDialog';
import { Screen } from '@/components/Screen';
import { FieldLabel, SectionLabel } from '@/components/SectionLabel';
import { useGymMembership, useSession } from '@/lib/auth';
import { useUnreachableEmails } from '@/lib/comms';
import { unreachableNote } from '@/lib/comms-report';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format-date';
import {
  daysAgo,
  injuryTitle,
  painColour,
  STATUS_META,
} from '@/lib/injuries';
import { movementName } from '@/lib/movements';
import { formatMoney } from '@/lib/coach-earnings';
import { supabase } from '@/lib/supabase';
import { useGymCurrency } from '@/lib/useGymCurrency';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';
import type { InjurySide, InjuryStatus } from '@/types/database';

type ProfileRow = {
  full_name: string | null;
  avatar_url: string | null;
  managed: boolean;
};

type MembershipRow = {
  id: string;
  role: string;
  created_at: string;
  left_at: string | null;
  health_flag: boolean;
  par_q_id: string | null;
  emergency_contact: string | null;
  require_membership_to_book: boolean | null;
};

type CohortRow = {
  is_intro: boolean;
  is_paying: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
};

type SubRow = {
  id: string;
  status: string;
  credit_balance: number | null;
  price_cents: number | null;
  paid_period_end: string | null;
  period_resets_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  imported_legacy: boolean;
  membership_plans: {
    name: string;
    kind: string;
    credit_count: number | null;
    notice_period_days: number | null;
  } | null;
};

type CompRow = {
  grant_id: string;
  starts_at: string;
  ends_at: string;
  credits_total: number | null;
  credits_remaining: number | null;
  reason: string | null;
  revoked_at: string | null;
};

type TagRow = {
  id: string;
  label: string;
  color: string;
  source: 'manual' | 'auto';
};

type OnboardingRow = {
  id: string;
  question_key: string;
  question_text: string;
  answer: string;
  display_order: number;
  answered_at: string;
};

export default function MemberDetailScreen() {
  const colors = useThemeColors();
  const currency = useGymCurrency();
  const { data: membership } = useGymMembership();
  const session = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ profile: string }>();
  const profileId = params.profile;
  const queryClient = useQueryClient();
  const [showRemove, setShowRemove] = useState(false);
  const [refundSub, setRefundSub] = useState<SubRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManageTags = useCan('can_manage_tags');
  const canRefund = useCan('can_refund') ?? false;
  const canRemove = useCan('can_archive_members') ?? false;
  const canSeeHealth = useCan('can_see_health_flag') ?? false;
  const unreachableQuery = useUnreachableEmails(membership?.gymId);

  // Audit trail: opening another member's profile surfaces their PAR-Q
  // history + injuries, so we log the health-data access once per view.
  // Skipped when looking at your own profile or without the capability.
  useEffect(() => {
    if (
      !membership?.gymId ||
      !profileId ||
      !canSeeHealth ||
      session?.user.id === profileId
    ) {
      return;
    }
    // PAR-Q history is still a direct read, so it still logs here. The
    // injury reads log themselves inside their RPCs (0180).
    void supabase.rpc('log_health_data_access', {
      p_gym_id: membership.gymId,
      p_subject: profileId,
      p_surface: 'member_profile',
    });
  }, [membership?.gymId, profileId, canSeeHealth, session?.user.id]);

  const profile = useQuery({
    queryKey: ['member-detail-profile', profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, managed')
        .eq('id', profileId!)
        .single();
      if (error) throw error;
      return data as ProfileRow;
    },
  });

  const gymMembership = useQuery({
    queryKey: ['member-detail-membership', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('id, role, created_at, left_at, health_flag, par_q_id, emergency_contact, require_membership_to_book')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .maybeSingle();
      if (error) throw error;
      return data as MembershipRow | null;
    },
  });

  const setBookingRequirement = useMutation({
    mutationFn: async (value: boolean) => {
      if (!membership) throw new Error('No gym');
      const { error } = await supabase.rpc('set_member_booking_requirement', {
        p_gym_id: membership.gymId,
        p_profile_id: profileId!,
        p_value: value,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['member-detail-membership'] }),
  });

  const cohort = useQuery({
    queryKey: ['member-detail-cohort', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_member_cohort')
        .select('is_intro, is_paying, is_active, is_expiring_soon, is_expired, days_until_expiry')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .maybeSingle();
      if (error) throw error;
      return data as CohortRow | null;
    },
  });

  const subs = useQuery({
    queryKey: ['member-detail-subs', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select(
          'id, status, credit_balance, price_cents, paid_period_end, period_resets_at, cancelled_at, created_at, imported_legacy, membership_plans!plan_id(name, kind, credit_count, notice_period_days)',
        )
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SubRow[];
    },
  });

  // Refund events for this member's plans — a plan refunded via
  // "end now" lands as plain `cancelled`, indistinguishable from an
  // un-refunded cancellation without this. Keyed by plan_subscription_id,
  // summing amount for the rare partial/multiple refund.
  const refunds = useQuery({
    queryKey: ['member-detail-refunds', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select('plan_subscription_id, amount_cents, occurred_at')
        .eq('gym_id', membership!.gymId)
        .eq('member_id', profileId!)
        .eq('kind', 'refund');
      if (error) throw error;
      const map = new Map<string, { cents: number; at: string }>();
      for (const r of (data ?? []) as {
        plan_subscription_id: string | null;
        amount_cents: number;
        occurred_at: string;
      }[]) {
        if (!r.plan_subscription_id) continue;
        const prev = map.get(r.plan_subscription_id);
        map.set(r.plan_subscription_id, {
          cents: (prev?.cents ?? 0) + r.amount_cents,
          at: prev && prev.at > r.occurred_at ? prev.at : r.occurred_at,
        });
      }
      return map;
    },
  });

  const comps = useQuery({
    queryKey: ['member-detail-comps', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comp_grants')
        .select('grant_id, starts_at, ends_at, credits_total, credits_remaining, reason, revoked_at')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .order('starts_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CompRow[];
    },
  });

  const tags = useQuery({
    queryKey: ['member-detail-tags', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_tags')
        .select('id, label, color, source')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!);
      if (error) throw error;
      return (data ?? []) as TagRow[];
    },
  });

  const onboarding = useQuery({
    queryKey: ['member-detail-onboarding', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding_responses')
        .select('id, question_key, question_text, answer, display_order, answered_at')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .order('display_order');
      if (error) throw error;
      return (data ?? []) as OnboardingRow[];
    },
  });

  const restore = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      const { error } = await supabase.rpc('rejoin_gym', {
        p_gym_id: membership.gymId,
        p_profile_id: profileId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['members-cohort'] });
      queryClient.invalidateQueries({ queryKey: ['member-detail-membership'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not restore member')),
  });

  const canProgram = useCan('can_program_members') ?? false;
  const canSetMacros = useCan('can_set_macro_targets') ?? false;
  // The chase list on Analysis deep-links here, and that list is gated on
  // can_see_money — which an owner can grant without can_manage_tags. Being
  // bounced to /management from your own chase list's only action is a dead
  // end, so money-capable users get in too.
  const canSeeMoneyHere = useCan('can_see_money') ?? false;

  if (canManageTags === false && !canSeeMoneyHere) {
    return <Redirect href="/management" />;
  }

  // On a deep-link / refresh straight to this route, useGymMembership hasn't
  // resolved yet (and canManageTags is still undefined, so the guard above
  // doesn't fire). The render below dereferences membership.gymId directly,
  // so hold here until it's loaded rather than crash.
  if (!membership) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
        <Spinner />
      </View>
      </Screen>
    );
  }

  const isRemoved = gymMembership.data?.left_at !== null && gymMembership.data?.left_at !== undefined;
  const unreachable = unreachableQuery.data?.get(profileId ?? '') ?? null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management/members" />

        <PageHead
          lead={
            <Avatar
              name={profile.data?.full_name}
              avatarUrl={profile.data?.avatar_url}
              size={56}
            />
          }
          title={profile.data?.full_name ?? 'Member'}
          subtitle={
            gymMembership.data
              ? `Joined ${formatDate(gymMembership.data.created_at)}${
                  isRemoved
                    ? ` · Removed ${formatDate(gymMembership.data.left_at)}`
                    : ''
                }`
              : undefined
          }
        />
        {profile.data?.managed ? (
          <Text className="text-violet-600 dark:text-violet-400 text-xs font-medium -mt-2">
            Child account (managed by a guardian)
          </Text>
        ) : null}

        {isRemoved ? (
          <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-ctl p-3 gap-2">
            <Text className="text-amber-700 dark:text-amber-300 text-sm font-medium">
              This member has been removed from the gym.
            </Text>
            <Text className="text-amber-700 dark:text-amber-300 text-sm">
              Restoring brings them back to active status, but does NOT
              re-activate any previously-cancelled subscriptions or comp
              grants — re-subscribe them separately.
            </Text>
            {canRemove ? (
              <View className="self-start">
                <ActionButton
                  kind="restore"
                  label={restore.isPending ? 'Restoring…' : 'Restore member'}
                  onPress={() => restore.mutate()}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {unreachable ? (
          <View className="bg-red-500/10 border border-red-500/30 rounded-ctl p-3 gap-1">
            <Text className="text-red-700 dark:text-red-400 text-sm font-semibold">
              {unreachable === 'complaint'
                ? 'Marked your email as spam'
                : 'We cannot email this member'}
            </Text>
            <Text className="text-red-700/90 dark:text-red-300/90 text-xs">
              {unreachableNote(unreachable, profile.data?.full_name ?? 'This member')}
            </Text>
          </View>
        ) : null}

        {cohort.data ? (
          <View className="flex-row flex-wrap gap-1">
            {cohort.data.is_intro ? <Badge label="Intro" color="#10B981" /> : null}
            {cohort.data.is_paying ? <Badge label="Paying" color={colors.primary} /> : null}
            {cohort.data.is_active ? <Badge label="Active" color="#059669" /> : null}
            {cohort.data.is_expiring_soon && cohort.data.days_until_expiry !== null ? (
              <Badge label={`Expires in ${cohort.data.days_until_expiry}d`} color="#F97316" />
            ) : null}
            {cohort.data.is_expired ? <Badge label="Expired" color={colors.ink3} /> : null}
          </View>
        ) : null}

        <View className="flex-row items-center gap-2 flex-wrap">
          {tags.data && tags.data.length > 0 ? (
            tags.data.map((t) => (
              <MemberTagChip key={t.id} label={t.label} color={t.color} source={t.source} />
            ))
          ) : (
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs">No tags yet.</Text>
          )}
          <ChipButton
            tone="neutral"
            label="Manage tags"
            icon="pricetags-outline"
            onPress={() =>
              router.push({
                pathname: '/management/tags',
                params: { profile: profileId },
              })
            }
          />
        </View>

        {canSeeHealth ? (
          <InjuriesSection gymId={membership!.gymId} profileId={profileId!} />
        ) : null}

        {canSeeMoneyHere && membership?.gymId && profileId ? (
          <PaymentTroubleCard
            gymId={membership.gymId}
            profileId={profileId}
            memberName={profile.data?.full_name ?? 'this member'}
          />
        ) : null}

        <Section title="Plans">
          {subs.data && subs.data.length > 0 ? (
            subs.data.map((s) => {
              const refund = refunds.data?.get(s.id) ?? null;
              return (
              <View
                key={s.id}
                className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-ink dark:text-ink-dk font-medium">
                    {s.membership_plans?.name ?? 'Plan'}
                  </Text>
                  {refund ? (
                    <View className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5">
                      <Text className="text-[10px] font-semibold uppercase tracking-widest text-rose-700 dark:text-rose-400">
                        Refunded
                      </Text>
                    </View>
                  ) : null}
                  {s.imported_legacy && s.status === 'active' ? (
                    <View className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5">
                      <Text className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                        Not yet billed
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {s.status}
                  {s.price_cents !== null
                    ? ` · ${formatMoney(s.price_cents, currency)}/mo`
                    : ''}
                  {s.credit_balance !== null ? ` · ${s.credit_balance} credits` : ''}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {[
                    s.paid_period_end
                      ? `paid through ${formatDate(s.paid_period_end)}`
                      : null,
                    s.period_resets_at
                      ? `next payment ${formatDate(s.period_resets_at)}`
                      : null,
                    s.membership_plans?.notice_period_days != null
                      ? `${s.membership_plans.notice_period_days}-day notice period`
                      : null,
                    s.cancelled_at
                      ? `cancelled ${formatDate(s.cancelled_at)}`
                      : null,
                    refund
                      ? `refunded ${formatMoney(refund.cents, currency)} on ${formatDate(refund.at)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || `started ${formatDate(s.created_at)}`}
                </Text>
                {canRefund &&
                !isRemoved &&
                !['cancelled', 'refunded_retained', 'lapsed'].includes(s.status) ? (
                  <ChipButton
                    className="self-start mt-1"
                    tone="red"
                    label="Refund"
                    icon="arrow-undo-outline"
                    onPress={() => setRefundSub(s)}
                  />
                ) : null}
              </View>
              );
            })
          ) : (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">No plans.</Text>
          )}
        </Section>

        {canProgram && !isRemoved ? (
          <Section title="Programming">
            <View className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-2">
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Write a personal programme on this member's calendar, upload
                programme PDFs, and set whether access is free or paid.
              </Text>
              <ChipButton
                className="self-start"
                tone="neutral"
                label="Open programming"
                icon="barbell-outline"
                onPress={() =>
                  router.push({
                    pathname: '/management/member-programming',
                    params: { profile: profileId },
                  })
                }
              />
            </View>
          </Section>
        ) : null}

        {canSetMacros && !isRemoved && membership?.gymId ? (
          <Section title="Targets">
            <MacroTargetsCard
              gymId={membership.gymId}
              profileId={profileId}
              canEdit
            />
          </Section>
        ) : null}

        {gymMembership.data &&
        gymMembership.data.role !== 'member' &&
        (membership?.role === 'owner' || membership?.role === 'admin') ? (
          <Section title="Booking">
            <View className="bg-surface dark:bg-surface-dk rounded-ctl p-3 flex-row items-center gap-3">
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dk font-medium">
                  Require a membership to book
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Staff book without a membership by default. Turn this on to
                  require this staff member to hold one, like a member.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Require a membership to book"
                value={gymMembership.data.require_membership_to_book ?? false}
                onValueChange={(v) => setBookingRequirement.mutate(v)}
                disabled={setBookingRequirement.isPending}
              />
            </View>
            {setBookingRequirement.error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {errorMessage(setBookingRequirement.error, 'Could not save')}
              </Text>
            ) : null}
          </Section>
        ) : null}

        <Section title="Comp grants">
          {comps.data && comps.data.length > 0 ? (
            comps.data.map((c) => (
              <View
                key={c.grant_id}
                className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-1">
                <Text className="text-ink dark:text-ink-dk font-medium">
                  {c.reason ?? 'Comp grant'}
                  {c.revoked_at ? ' (revoked)' : ''}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {formatDate(c.starts_at)} → {formatDate(c.ends_at)}
                  {c.credits_remaining !== null
                    ? ` · ${c.credits_remaining}/${c.credits_total} credits`
                    : ''}
                </Text>
              </View>
            ))
          ) : (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">No grants.</Text>
          )}
        </Section>

        <ParqHistorySection
          profileId={profileId!}
          gymId={membership!.gymId}
        />

        <Section title="Onboarding">
          {onboarding.data && onboarding.data.length > 0 ? (
            onboarding.data.map((r) => (
              <View
                key={r.id}
                className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-1">
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {r.question_text}
                </Text>
                <Text className="text-ink dark:text-ink-dk">{r.answer}</Text>
              </View>
            ))
          ) : (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {gymMembership.data?.par_q_id
                ? 'No non-health responses recorded.'
                : 'Onboarding not yet completed.'}
            </Text>
          )}
        </Section>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        {!isRemoved && canRemove ? (
          <View className="self-start">
            <ActionButton
              kind="remove"
              label="Remove member"
              onPress={() => setShowRemove(true)}
            />
          </View>
        ) : null}
      </ScrollView>

      {membership && profileId ? (
        <RemoveMemberDialog
          visible={showRemove}
          gymId={membership.gymId}
          profileId={profileId}
          memberName={profile.data?.full_name ?? 'this member'}
          onClose={() => setShowRemove(false)}
          onRemoved={() => {
            // A cold-opened profile has no history to pop, and the member
            // no longer exists to stand on. Replace, so the dead URL
            // doesn't survive as a history entry either.
            if (router.canGoBack()) router.back();
            else router.replace('/management/members' as never);
          }}
        />
      ) : null}

      {refundSub ? (
        <RefundDialog
          visible={refundSub !== null}
          sub={{
            id: refundSub.id,
            planName: refundSub.membership_plans?.name ?? 'Plan',
            planKind: refundSub.membership_plans?.kind ?? 'unlimited',
            creditBalance: refundSub.credit_balance,
            creditCount: refundSub.membership_plans?.credit_count ?? null,
            paidPeriodEnd: refundSub.paid_period_end,
          }}
          onClose={() => setRefundSub(null)}
          onDone={() => setRefundSub(null)}
        />
      ) : null}
    </Screen>
  );
}

// The chase list's destination. 0174 sent staff here on the reasoning that
// "PII is already gated correctly" on the member profile — but the screen
// showed no contact details at all and nothing about the payment, so the
// only affordance on a row reading "Sam Ali · £45 · card declined" was a
// chevron into a page of tags and injuries.
//
// Contact details come from gym_member_contact rather than off the money
// RPC: email needs can_see_email and phone needs can_see_full_pii, and an
// owner chasing a payment holds those separately from can_see_money.
function PaymentTroubleCard({
  gymId,
  profileId,
  memberName,
}: {
  gymId: string;
  profileId: string;
  memberName: string;
}) {
  const router = useRouter();

  const dunning = useQuery({
    queryKey: ['member-dunning', gymId, profileId],
    enabled: !!gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_subscription_dunning')
        .select(
          'past_due_since, payment_failure_count, last_payment_error, next_payment_attempt',
        )
        .eq('gym_id', gymId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const contact = useQuery({
    queryKey: ['member-contact', gymId, profileId],
    enabled: !!gymId && !!profileId && !!dunning.data,
    // A coach is refused outright rather than handed two blank fields, so
    // an error here means "no permission", not "nothing on file".
    retry: false,
    queryFn: async (): Promise<{ email: string | null; phone: string | null }> => {
      const { data, error } = await supabase.rpc('gym_member_contact', {
        p_gym_id: gymId,
        p_profile_id: profileId,
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      return { email: row?.email ?? null, phone: row?.phone ?? null };
    },
  });

  const d = dunning.data;
  if (!d) return null;

  return (
    <Section title="Payment trouble">
      <View className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-2">
        <Text className="text-ink dark:text-ink-dk text-sm font-medium">
          Failing since {formatDate(d.past_due_since)}
          {d.payment_failure_count > 1
            ? ` · ${d.payment_failure_count} attempts`
            : ''}
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {d.next_payment_attempt
            ? `Stripe retries ${formatDate(d.next_payment_attempt)}`
            : 'Stripe has stopped retrying — this one is urgent'}
          {d.last_payment_error ? ` · ${d.last_payment_error}` : ''}
        </Text>
        <View className="flex-row flex-wrap gap-2 pt-1">
          {contact.data?.email ? (
            <ChipButton
              label="Email"
              icon="mail-outline"
              onPress={() => Linking.openURL(`mailto:${contact.data!.email}`)}
            />
          ) : null}
          {contact.data?.phone ? (
            <ChipButton
              label="Call"
              icon="call-outline"
              onPress={() => Linking.openURL(`tel:${contact.data!.phone}`)}
            />
          ) : null}
          <ChipButton
            label="Message"
            icon="chatbubble-outline"
            tone="neutral"
            onPress={() => router.push(`/inbox/direct/${profileId}` as never)}
          />
        </View>
        {contact.isError ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            You can message {memberName} in Temple; seeing their email or
            phone needs a different permission.
          </Text>
        ) : null}
      </View>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <SectionLabel>
        {title}
      </SectionLabel>
      {children}
    </View>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ backgroundColor: color }} className="rounded-full px-2 py-0.5">
      <Text className="text-white text-[10px] font-semibold">{label}</Text>
    </View>
  );
}

type StaffInjuryRow = {
  id: string;
  body_region: string;
  side: InjurySide;
  description: string | null;
  pain_level: number;
  movements_hurt: string[];
  movements_ok: string[];
  started_on: string;
  status: InjuryStatus;
  updated_at: string;
  injury_updates: {
    pain_level: number;
    feeling: string | null;
    status: string;
    note: string | null;
    created_at: string;
  }[];
};

// Coach-facing injury history: every injury (open first) with the
// member's check-in trail inline, so a coach can see how it's
// trending before adjusting programming. Rendered behind
// can_see_health_flag: 0180 moved these reads onto audited RPCs that
// RAISE for staff without it, where the dropped RLS policy used to
// return empty. Unguarded, the section would tell a coach who is not
// allowed to see injuries that there are none.
function InjuriesSection({
  gymId,
  profileId,
}: {
  gymId: string;
  profileId: string;
}) {
  const injuries = useQuery({
    queryKey: ['member-injuries-staff', gymId, profileId],
    queryFn: async (): Promise<StaffInjuryRow[]> => {
      // Two audited RPCs rather than one embedded select (0180). The
      // embed is gone because injury_updates is no longer staff-readable
      // at the row level — that is what makes the audit row unavoidable
      // rather than a courtesy the screen pays.
      const [{ data, error }, { data: updates, error: uErr }] =
        await Promise.all([
          supabase.rpc('gym_member_injuries', {
            p_gym_id: gymId,
            p_profile_id: profileId,
          }),
          supabase.rpc('gym_injury_updates', {
            p_gym_id: gymId,
            p_profile_id: profileId,
          }),
        ]);
      if (error) throw error;
      if (uErr) throw uErr;

      const byInjury = new Map<string, StaffInjuryRow['injury_updates']>();
      for (const u of (updates ?? []) as unknown as ({
        injury_id: string;
      } & NonNullable<StaffInjuryRow['injury_updates']>[number])[]) {
        const list = byInjury.get(u.injury_id) ?? [];
        list.push(u);
        byInjury.set(u.injury_id, list);
      }
      return ((data ?? []) as unknown as StaffInjuryRow[]).map((r) => ({
        ...r,
        injury_updates: byInjury.get(r.id) ?? [],
      }));
    },
  });

  const rows = injuries.data ?? [];

  return (
    <Section title="Injuries">
      {rows.length === 0 ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          No injuries logged.
        </Text>
      ) : (
        rows.map((r) => {
          const status = STATUS_META[r.status];
          const updates = [...(r.injury_updates ?? [])].sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          );
          return (
            <View
              key={r.id}
              className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-2">
              <View className="flex-row items-center gap-2">
                <View
                  style={{ backgroundColor: painColour(r.pain_level) }}
                  className="w-6 h-6 rounded-full items-center justify-center">
                  <Text className="text-white text-[10px] font-bold">
                    {r.pain_level}
                  </Text>
                </View>
                <Text className="flex-1 text-ink dark:text-ink-dk font-medium" numberOfLines={1}>
                  {injuryTitle(r.body_region, r.side)}
                </Text>
                <View
                  style={{ borderColor: status.colour }}
                  className="rounded-full border px-2 py-0.5">
                  <Text
                    style={{ color: status.colour }}
                    className="text-[10px] font-semibold">
                    {status.label}
                  </Text>
                </View>
              </View>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Started {r.started_on} · last update {daysAgo(r.updated_at)}d ago
              </Text>
              {r.description ? (
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  {r.description}
                </Text>
              ) : null}
              {r.movements_hurt.length > 0 ? (
                <Text className="text-red-600 dark:text-red-400 text-xs">
                  Hurts: {r.movements_hurt.map(movementName).join(', ')}
                </Text>
              ) : null}
              {r.movements_ok.length > 0 ? (
                <Text className="text-emerald-700 dark:text-emerald-300 text-xs">
                  Feels fine: {r.movements_ok.map(movementName).join(', ')}
                </Text>
              ) : null}
              {updates.length > 0 ? (
                <View className="gap-1 border-t border-line dark:border-line-dk pt-2">
                  {updates.slice(0, 4).map((u, i) => (
                    <Text
                      key={i}
                      className="text-ink-2 dark:text-ink-2-dk text-xs">
                      {formatDate(u.created_at)} · pain {u.pain_level}/10
                      {u.feeling ? ` · ${u.feeling}` : ''}
                      {u.note ? ` — ${u.note}` : ''}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </Section>
  );
}

type ParqResponseRow = {
  id: string;
  completed_at: string;
  has_flag: boolean;
  questionnaire_id: string;
  parq_questionnaires: { version: number } | null;
};

type ParqAnswerRow = {
  question_id: string;
  answered_yes: boolean;
  explanation: string | null;
  parq_questions: { prompt: string; flag_on_yes: boolean; sort_order: number } | null;
};

function ParqHistorySection({
  profileId,
  gymId,
}: {
  profileId: string;
  gymId: string;
}) {
  const latest = useQuery({
    queryKey: ['parq-latest', gymId, profileId],
    enabled: !!gymId && !!profileId,
    queryFn: async (): Promise<ParqResponseRow | null> => {
      const { data, error } = await supabase
        .from('parq_responses')
        .select(
          'id, completed_at, has_flag, questionnaire_id, parq_questionnaires!questionnaire_id(version)',
        )
        .eq('gym_id', gymId)
        .eq('profile_id', profileId)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ParqResponseRow | null;
    },
  });

  const answers = useQuery({
    queryKey: ['parq-answers', latest.data?.id],
    enabled: !!latest.data?.id,
    queryFn: async (): Promise<ParqAnswerRow[]> => {
      const { data, error } = await supabase
        .from('parq_answers')
        .select(
          'question_id, answered_yes, explanation, parq_questions!question_id(prompt, flag_on_yes, sort_order)',
        )
        .eq('response_id', latest.data!.id);
      if (error) throw error;
      const rows = (data ?? []) as unknown as ParqAnswerRow[];
      return rows.sort(
        (a, b) =>
          (a.parq_questions?.sort_order ?? 0) -
          (b.parq_questions?.sort_order ?? 0),
      );
    },
  });

  return (
    <Section title="PAR-Q">
      {!latest.data ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          Member hasn't filled in the health screening yet.
        </Text>
      ) : (
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              v{latest.data.parq_questionnaires?.version ?? '—'} ·{' '}
              {formatDate(latest.data.completed_at)}
            </Text>
            {latest.data.has_flag ? (
              <View className="bg-red-600 rounded-full px-2 py-0.5">
                <Text className="text-white text-[10px] font-bold tracking-widest">
                  FLAGGED
                </Text>
              </View>
            ) : (
              <View className="bg-emerald-600 rounded-full px-2 py-0.5">
                <Text className="text-white text-[10px] font-bold tracking-widest">
                  CLEAR
                </Text>
              </View>
            )}
          </View>
          {(answers.data ?? []).map((a) => (
            <View
              key={a.question_id}
              className={`rounded-ctl p-3 gap-1 ${
                a.answered_yes && a.parq_questions?.flag_on_yes
                  ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                  : 'bg-surface dark:bg-surface-dk'
              }`}>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                {a.parq_questions?.prompt ?? '—'}
              </Text>
              <Text className="text-ink dark:text-ink-dk">
                {a.answered_yes ? 'Yes' : 'No'}
              </Text>
              {a.explanation ? (
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs italic">
                  {a.explanation}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </Section>
  );
}
