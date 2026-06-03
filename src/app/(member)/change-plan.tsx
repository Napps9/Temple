import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Plan = {
  plan_id: string;
  name: string;
  kind: 'unlimited' | 'credit_period' | 'credit_pack';
  credit_count: number | null;
  period_length: string | null;
  monthly_price_cents: number | null;
  stripe_price_id: string | null;
};

type CurrentSub = {
  id: string;
  status: string;
  plan_id: string;
  plan: { name: string; monthly_price_cents: number | null } | null;
};

type AffectedBooking = {
  booking_id: string;
  class_session_id: string;
  starts_at: string;
  class_type_id: string | null;
  class_type_name: string | null;
};

function fmtPrice(cents: number | null): string {
  if (cents == null) return '—';
  return `£${(cents / 100).toFixed(2)}`;
}

function fmtSessionDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatKind(p: Plan): string {
  switch (p.kind) {
    case 'unlimited':
      return 'Unlimited classes';
    case 'credit_period':
      return `${p.credit_count ?? '?'} per ${p.period_length ?? 'cycle'}`;
    case 'credit_pack':
      return `${p.credit_count ?? '?'}-class pack`;
  }
}

export default function ChangePlan() {
  const session = useSession();
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();
  const [chosenPlanId, setChosenPlanId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentQuery = useQuery({
    queryKey: ['member-current-sub', session?.user.id, gym?.gymId],
    enabled: !!session?.user.id && !!gym?.gymId,
    queryFn: async (): Promise<CurrentSub | null> => {
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select(
          'id, status, plan_id, plan:membership_plans(name, monthly_price_cents)',
        )
        .eq('profile_id', session!.user.id)
        .eq('gym_id', gym!.gymId)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as CurrentSub | null) ?? null;
    },
  });

  const plansQuery = useQuery({
    queryKey: ['change-plan-plans', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select(
          'plan_id, name, kind, credit_count, period_length, monthly_price_cents, stripe_price_id',
        )
        .eq('gym_id', gym!.gymId)
        .is('archived_at', null)
        .order('monthly_price_cents', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as Plan[];
    },
  });

  const affectedQuery = useQuery({
    queryKey: ['change-plan-affected', currentQuery.data?.id, chosenPlanId],
    enabled: !!currentQuery.data?.id && !!chosenPlanId,
    queryFn: async (): Promise<AffectedBooking[]> => {
      const { data, error } = await supabase.rpc(
        'get_affected_bookings_on_plan_change',
        {
          p_plan_subscription_id: currentQuery.data!.id,
          p_new_plan_id: chosenPlanId!,
        },
      );
      if (error) throw error;
      return (data ?? []) as AffectedBooking[];
    },
  });

  const changeMutation = useMutation({
    mutationFn: async () => {
      if (!currentQuery.data || !chosenPlanId) throw new Error('Pick a plan');
      const { error } = await supabase.functions.invoke('change-plan', {
        body: {
          planSubscriptionId: currentQuery.data.id,
          newPlanId: chosenPlanId,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-billing'] });
      router.replace('/billing');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const currentSub = currentQuery.data;
  const otherPlans = (plansQuery.data ?? []).filter(
    (p) => currentSub && p.plan_id !== currentSub.plan_id,
  );
  const chosenPlan = otherPlans.find((p) => p.plan_id === chosenPlanId) ?? null;
  const isUpgrade =
    !!chosenPlan?.monthly_price_cents &&
    !!currentSub?.plan?.monthly_price_cents &&
    chosenPlan.monthly_price_cents > currentSub.plan.monthly_price_cents;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Change plan
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Switch between membership plans in place.
          </Text>
        </View>

        {currentQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : null}

        {!currentQuery.isLoading && !currentSub ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400">
              You need an active plan to switch.
            </Text>
          </View>
        ) : null}

        {currentSub ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1">
            <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
              Currently on
            </Text>
            <View className="flex-row items-center justify-between">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                {currentSub.plan
                  ? Array.isArray(currentSub.plan)
                    ? currentSub.plan[0]?.name
                    : currentSub.plan.name
                  : 'Plan'}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                {fmtPrice(
                  currentSub.plan
                    ? Array.isArray(currentSub.plan)
                      ? currentSub.plan[0]?.monthly_price_cents ?? null
                      : currentSub.plan.monthly_price_cents
                    : null,
                )}
              </Text>
            </View>
          </View>
        ) : null}

        {!confirming
          ? otherPlans.map((p) => {
              const isSelected = chosenPlanId === p.plan_id;
              const isLive = !!p.stripe_price_id;
              return (
                <Pressable
                  key={p.plan_id}
                  onPress={() => (isLive ? setChosenPlanId(p.plan_id) : null)}
                  disabled={!isLive}
                  className={`bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 border ${
                    isSelected ? 'border-primary' : 'border-transparent'
                  } ${isLive ? '' : 'opacity-50'}`}>
                  <View className="flex-row items-center">
                    <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                      {p.name}
                    </Text>
                    {isSelected ? (
                      <Ionicons name="checkmark-circle" size={20} color="#2563EB" />
                    ) : null}
                  </View>
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    {formatKind(p)} · {fmtPrice(p.monthly_price_cents)}
                  </Text>
                  {!isLive ? (
                    <Text className="text-amber-700 dark:text-amber-300 text-xs">
                      Not yet available.
                    </Text>
                  ) : null}
                </Pressable>
              );
            })
          : null}

        {chosenPlanId && !confirming ? (
          <Button onPress={() => setConfirming(true)}>Review change</Button>
        ) : null}

        {confirming && chosenPlan ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-primary">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Switch to {chosenPlan.name}?
            </Text>
            <Text className="text-gray-700 dark:text-gray-200 text-sm">
              {isUpgrade
                ? "We'll charge a prorated amount for the rest of this cycle right now."
                : "The difference applies as a credit on your next bill — you won't be refunded directly."}
            </Text>

            {affectedQuery.data && affectedQuery.data.length > 0 ? (
              <View className="gap-2 pt-1">
                <Text className="text-amber-700 dark:text-amber-300 text-sm font-medium">
                  These bookings aren't covered on the new plan:
                </Text>
                {affectedQuery.data.map((b) => (
                  <View
                    key={b.booking_id}
                    className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                    <Text className="text-gray-900 dark:text-gray-50 text-sm">
                      {b.class_type_name ?? 'Class'}
                    </Text>
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">
                      {fmtSessionDate(b.starts_at)}
                    </Text>
                  </View>
                ))}
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  You'll need to cancel or reschedule these from the Book tab
                  before they happen — they won't be released automatically.
                </Text>
              </View>
            ) : null}

            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}

            <View className="flex-row gap-3 pt-2">
              <View className="flex-1">
                <Button variant="secondary" onPress={() => setConfirming(false)}>
                  Back
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  onPress={() => changeMutation.mutate()}
                  loading={changeMutation.isPending}>
                  Confirm switch
                </Button>
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
