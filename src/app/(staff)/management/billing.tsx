import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { ConnectOnboardingStatus } from '@/types/database';

type ConnectAccount = {
  provider_account_id: string | null;
  onboarding_status: ConnectOnboardingStatus;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  country: string | null;
  default_currency: string | null;
};

const STATUS_COPY: Record<
  ConnectOnboardingStatus,
  { title: string; description: string; tone: 'info' | 'progress' | 'ok' | 'warn' }
> = {
  not_started: {
    title: 'Stripe not connected',
    description:
      'Connect a Stripe account to take payments from members. Stripe holds your funds and pays them out to your bank.',
    tone: 'info',
  },
  in_progress: {
    title: 'Stripe onboarding in progress',
    description:
      'You started Stripe onboarding but Stripe still needs more details before payouts can be enabled.',
    tone: 'progress',
  },
  completed: {
    title: 'Stripe connected',
    description: 'Payments and payouts are live. Members can now sign up to plans.',
    tone: 'ok',
  },
  rejected: {
    title: 'Stripe rejected this account',
    description:
      'Stripe declined to verify this account. Contact Stripe support or start again with a new account.',
    tone: 'warn',
  },
};

const TONE_BADGE: Record<'info' | 'progress' | 'ok' | 'warn', string> = {
  info: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200',
  progress: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200',
  ok: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200',
  warn: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-200',
};

export default function BillingSettings() {
  const { data: gym } = useGymMembership();
  const [error, setError] = useState<string | null>(null);

  const connectQuery = useQuery({
    queryKey: ['stripe-connect-account', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<ConnectAccount | null> => {
      const { data, error } = await supabase
        .from('stripe_connect_accounts')
        .select(
          'provider_account_id, onboarding_status, charges_enabled, payouts_enabled, details_submitted, country, default_currency',
        )
        .eq('gym_id', gym!.gymId)
        .maybeSingle();
      if (error) throw error;
      return (data as ConnectAccount | null) ?? null;
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      if (!gym?.gymId) throw new Error('No gym');
      const { data, error } = await supabase.functions.invoke<{ url: string }>(
        'create-connect-link',
        { body: { gymId: gym.gymId } },
      );
      if (error) throw error;
      if (!data?.url) throw new Error('No link returned');
      await Linking.openURL(data.url);
    },
    onError: (err) => setError(errorMessage(err)),
    onSuccess: () => setError(null),
  });

  const status: ConnectOnboardingStatus =
    connectQuery.data?.onboarding_status ?? 'not_started';
  const copy = STATUS_COPY[status];
  const ctaLabel =
    status === 'not_started' ? 'Connect Stripe' : 'Continue Stripe onboarding';

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Billing
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Connect Stripe to take payments and manage memberships.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                {copy.title}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                {copy.description}
              </Text>
            </View>
            <View className={`px-2 py-1 rounded-full ${TONE_BADGE[copy.tone]}`}>
              <Text className={`text-xs font-medium ${TONE_BADGE[copy.tone]}`}>
                {status.replace('_', ' ')}
              </Text>
            </View>
          </View>

          {connectQuery.data ? (
            <View className="gap-1">
              <DetailRow
                label="Charges enabled"
                value={connectQuery.data.charges_enabled ? 'Yes' : 'No'}
              />
              <DetailRow
                label="Payouts enabled"
                value={connectQuery.data.payouts_enabled ? 'Yes' : 'No'}
              />
              <DetailRow
                label="Details submitted"
                value={connectQuery.data.details_submitted ? 'Yes' : 'No'}
              />
              {connectQuery.data.country ? (
                <DetailRow label="Country" value={connectQuery.data.country} />
              ) : null}
              {connectQuery.data.default_currency ? (
                <DetailRow
                  label="Currency"
                  value={connectQuery.data.default_currency.toUpperCase()}
                />
              ) : null}
            </View>
          ) : null}

          {status !== 'completed' ? (
            <Button
              onPress={() => connectMutation.mutate()}
              loading={connectMutation.isPending}>
              {ctaLabel}
            </Button>
          ) : null}

          {error ? (
            <View className="flex-row items-center gap-2">
              <Ionicons name="warning-outline" size={16} color="#EF4444" />
              <Text className="text-red-500 dark:text-red-400 text-sm flex-1">
                {error}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Plans
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Coming soon — author your membership plans and set notice periods.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="text-gray-500 dark:text-gray-400 text-sm">{label}</Text>
      <Text className="text-gray-900 dark:text-gray-50 text-sm">{value}</Text>
    </View>
  );
}
