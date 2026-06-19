import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  clearPendingCheckout,
  hasPendingCheckout,
  markPendingCheckout,
} from '@/lib/pending-checkout';
import {
  CURRENT_SUB_STATUSES,
  SUB_STATUS_META,
  planKindLabel,
  planPriceLabel,
  useGymPlans,
  useGymSelfCheckout,
  useMySubscriptions,
  useStartCheckout,
  type GymPlan,
  type MySubscription,
} from '@/lib/subscriptions';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const TONE_CLASS: Record<'active' | 'warn' | 'muted', string> = {
  active:
    'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  warn: 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400',
  muted:
    'bg-gray-500/10 border-gray-400/40 text-gray-600 dark:text-gray-300',
};

function StatusChip({ status }: { status: MySubscription['status'] }) {
  const meta = SUB_STATUS_META[status];
  return (
    <View className={`rounded-full border px-2.5 py-0.5 ${TONE_CLASS[meta.tone]}`}>
      <Text
        className={`text-[10px] font-semibold uppercase tracking-widest ${TONE_CLASS[meta.tone]}`}>
        {meta.label}
      </Text>
    </View>
  );
}

function CurrentSubCard({ sub }: { sub: MySubscription }) {
  const isCredit = sub.membership_plans?.kind !== 'unlimited';
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 border border-gray-200 dark:border-gray-800">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
          {sub.membership_plans?.name ?? 'Plan'}
        </Text>
        <StatusChip status={sub.status} />
      </View>
      {isCredit && sub.credit_balance != null ? (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          {sub.credit_balance} credit{sub.credit_balance === 1 ? '' : 's'} left
          {sub.period_resets_at
            ? ` · resets ${fmtDate(sub.period_resets_at)}`
            : ''}
        </Text>
      ) : null}
      {sub.status === 'cancelled_at_period_end' && sub.paid_period_end ? (
        <Text className="text-amber-600 dark:text-amber-400 text-sm">
          Access until {fmtDate(sub.paid_period_end)}.
        </Text>
      ) : sub.paid_period_end ? (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Renews {fmtDate(sub.paid_period_end)}.
        </Text>
      ) : null}
    </View>
  );
}

function PendingMembershipCard() {
  return (
    <View className="gap-2">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        Your membership
      </Text>
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 border border-gray-200 dark:border-gray-800">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
            Setting up your membership…
          </Text>
          <View className="rounded-full border px-2.5 py-0.5 bg-amber-500/10 border-amber-500/40">
            <Text className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
              Pending
            </Text>
          </View>
        </View>
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" />
          <Text className="text-gray-500 dark:text-gray-400 text-sm flex-1">
            We're confirming your payment with the gym. This page updates
            automatically.
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function MembershipScreen() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const params = useLocalSearchParams<{ checkout?: string; book?: string }>();
  const gymId = membership?.gymId;

  const justCheckedOut = params.checkout === 'success';
  // Poll while the webhook settles — either we just returned from Stripe,
  // or a marker from a prior return (across a refresh / nav) is still live.
  const awaitingPossible = justCheckedOut || hasPendingCheckout(gymId);

  const plans = useGymPlans(gymId);
  const subs = useMySubscriptions(gymId, session?.user.id, {
    pollUntilCurrent: awaitingPossible,
  });
  const selfCheckout = useGymSelfCheckout(gymId);
  const canSelfCheckout = selfCheckout.data ?? true;

  const checkout = useStartCheckout(gymId);

  const currentSubs = (subs.data ?? []).filter((s) =>
    CURRENT_SUB_STATUSES.has(s.status),
  );
  const currentPlanIds = new Set(currentSubs.map((s) => s.plan_id));
  const awaitingActivation = awaitingPossible && currentSubs.length === 0;

  // Carry the "just checked out" intent across a refresh / nav to Account
  // via a short-lived marker, and retire it once the subscription lands.
  useEffect(() => {
    if (justCheckedOut && gymId) markPendingCheckout(gymId);
  }, [justCheckedOut, gymId]);
  useEffect(() => {
    if (currentSubs.length > 0 && gymId) clearPendingCheckout(gymId);
  }, [currentSubs.length, gymId]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Account" fallbackHref="/account" />

        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Membership
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Pick a plan to book classes
            {membership?.gymName ? ` at ${membership.gymName}` : ''}.
          </Text>
        </View>

        {params.checkout === 'success' ? (
          <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
            <Text className="text-emerald-700 dark:text-emerald-300 text-sm">
              Payment received — setting up your membership. It can take a few
              seconds to show here.
            </Text>
          </View>
        ) : params.checkout === 'cancelled' ? (
          <View className="bg-gray-500/10 border border-gray-400/30 rounded-xl p-4">
            <Text className="text-gray-600 dark:text-gray-300 text-sm">
              Checkout cancelled — you haven't been charged.
            </Text>
          </View>
        ) : null}

        {currentSubs.length > 0 ? (
          <View className="gap-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Your membership
            </Text>
            {currentSubs.map((s) => (
              <CurrentSubCard key={s.id} sub={s} />
            ))}
            {params.book ? (
              <Button
                icon="arrow-forward"
                onPress={() => router.push(`/book?session=${params.book}`)}>
                Continue booking your class
              </Button>
            ) : null}
          </View>
        ) : awaitingActivation ? (
          <PendingMembershipCard />
        ) : null}

        {checkout.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(checkout.error, 'Could not start checkout')}
          </Text>
        ) : null}

        <View className="gap-3">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            {currentSubs.length > 0 ? 'Switch or add a plan' : 'Plans'}
          </Text>

          {plans.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Loading plans…
            </Text>
          ) : (plans.data ?? []).length === 0 ? (
            <EmptyState
              icon="pricetags-outline"
              title="No plans available"
              description="This gym hasn't published any membership plans yet."
            />
          ) : (
            (plans.data ?? []).map((plan: GymPlan) => {
              const isCurrent = currentPlanIds.has(plan.plan_id);
              const busy =
                checkout.isPending && checkout.variables === plan.plan_id;
              return (
                <View
                  key={plan.plan_id}
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-gray-200 dark:border-gray-800">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
                        {plan.name}
                      </Text>
                      <Text className="text-gray-500 dark:text-gray-400 text-sm">
                        {planKindLabel(plan)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
                        {planPriceLabel(plan)}
                      </Text>
                      {plan.notice_period_days ? (
                        <Text className="text-gray-400 dark:text-gray-500 text-xs">
                          {plan.notice_period_days}-day notice
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  {isCurrent ? (
                    <View className="flex-row items-center gap-1.5 self-start rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1">
                      <Ionicons
                        name="checkmark-circle"
                        size={14}
                        color="#10B981"
                      />
                      <Text className="text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                        Current plan
                      </Text>
                    </View>
                  ) : awaitingActivation ? (
                    <Text className="text-gray-400 dark:text-gray-500 text-xs">
                      Setting up your membership…
                    </Text>
                  ) : canSelfCheckout ? (
                    <Button
                      onPress={() => checkout.mutate(plan.plan_id)}
                      loading={busy}
                      icon="card-outline">
                      {plan.kind === 'credit_pack' ? 'Buy pack' : 'Subscribe'}
                    </Button>
                  ) : null}
                </View>
              );
            })
          )}

          {!canSelfCheckout && (plans.data ?? []).length > 0 ? (
            <View className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Your gym sets up memberships for you — ask a coach to put you on
                a plan.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
