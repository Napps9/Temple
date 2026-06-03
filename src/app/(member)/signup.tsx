import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
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

function formatPrice(cents: number | null): string {
  if (cents == null) return 'free';
  return `£${(cents / 100).toFixed(2)}`;
}

function formatKind(p: Plan): string {
  switch (p.kind) {
    case 'unlimited':
      return 'Unlimited classes';
    case 'credit_period':
      return `${p.credit_count ?? '?'} classes per ${p.period_length ?? 'cycle'}`;
    case 'credit_pack':
      return `${p.credit_count ?? '?'}-class pack`;
  }
}

export default function Signup() {
  const { data: gym } = useGymMembership();
  const [selected, setSelected] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: ['signup-plans', gym?.gymId],
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

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      if (!gym || !selected) throw new Error('Pick a plan');
      const { data, error } = await supabase.functions.invoke<{ url: string }>(
        'create-checkout-session',
        {
          body: {
            gymId: gym.gymId,
            planId: selected,
            discountCode: discountCode.trim() || undefined,
          },
        },
      );
      if (error) throw error;
      if (!data?.url) throw new Error('No checkout URL returned');
      await Linking.openURL(data.url);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const plans = plansQuery.data ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Join {gym?.gymName ?? 'your gym'}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Pick a plan to get started. Payment is via Stripe.
          </Text>
        </View>

        {plansQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading plans…</Text>
        ) : null}

        {!plansQuery.isLoading && plans.length === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400">
              No plans available yet — ask your gym to set one up.
            </Text>
          </View>
        ) : null}

        {plans.map((p) => {
          const isSelected = selected === p.plan_id;
          const isLive = !!p.stripe_price_id;
          return (
            <Pressable
              key={p.plan_id}
              onPress={() => (isLive ? setSelected(p.plan_id) : null)}
              disabled={!isLive}
              className={`bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 border ${
                isSelected
                  ? 'border-primary'
                  : 'border-transparent'
              } ${isLive ? '' : 'opacity-50'}`}>
              <View className="flex-row items-center gap-2">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                  {p.name}
                </Text>
                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={20} color="#2563EB" />
                ) : null}
              </View>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                {formatKind(p)}
              </Text>
              <Text className="text-gray-900 dark:text-gray-50">
                {formatPrice(p.monthly_price_cents)}
                {p.kind !== 'credit_pack' ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    {' '}
                    / cycle
                  </Text>
                ) : null}
              </Text>
              {!isLive ? (
                <Text className="text-amber-700 dark:text-amber-300 text-xs">
                  Not yet available for signup.
                </Text>
              ) : null}
            </Pressable>
          );
        })}

        {selected ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Promo code (optional)
            </Text>
            <Input
              label="Code"
              value={discountCode}
              onChangeText={setDiscountCode}
              autoCapitalize="characters"
              placeholder="e.g. SUMMER25"
            />
          </View>
        ) : null}

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        <Button
          onPress={() => checkoutMutation.mutate()}
          loading={checkoutMutation.isPending}
          disabled={!selected}>
          Continue to Stripe
        </Button>
        <Text className="text-gray-500 dark:text-gray-400 text-xs text-center">
          Card details are entered on Stripe's secure page.
        </Text>
      </ScrollView>
    </Screen>
  );
}
