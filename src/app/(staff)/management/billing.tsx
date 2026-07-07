import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Switch, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import {
  centsToRateInput,
  formatMoney,
  parseRateToCents,
} from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import { estimateElsewhereMarkup } from '@/lib/payment-savings';
import { supabase } from '@/lib/supabase';
import { useGymCurrency } from '@/lib/useGymCurrency';

// Phase 1 of Stripe billing: connect the gym's own Stripe (Connect
// Standard, via OAuth) so it can charge members directly. Charges,
// subscriptions, and webhooks come in later phases — this screen is the
// connection gate plus its status.
export default function BillingScreen() {
  const { data: membership } = useGymMembership();
  const role = useRole();
  const params = useLocalSearchParams<{ stripe?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const currency = useGymCurrency();
  const [volumeInput, setVolumeInput] = useState(() => centsToRateInput(500_000));
  const volumeCents = parseRateToCents(volumeInput) ?? 0;
  const elsewhere = estimateElsewhereMarkup(volumeCents);

  const account = useQuery({
    queryKey: ['gym-stripe-account', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('gym_stripe_accounts')
        .select('stripe_account_id, connected_at')
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (e) throw e;
      return data;
    },
  });

  const queryClient = useQueryClient();
  const selfCheckout = useQuery({
    queryKey: ['gym-self-checkout', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('gyms')
        .select('members_can_self_checkout')
        .eq('id', membership!.gymId)
        .single();
      if (e) throw e;
      return data.members_can_self_checkout;
    },
  });
  const setSelfCheckout = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!membership) throw new Error('No gym');
      const { error: e } = await supabase.rpc('set_member_self_checkout', {
        p_gym_id: membership.gymId,
        p_enabled: enabled,
      });
      if (e) throw e;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['gym-self-checkout'] }),
  });

  const requireMembership = useQuery({
    queryKey: ['gym-require-membership', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('gyms')
        .select('require_membership_to_book')
        .eq('id', membership!.gymId)
        .single();
      if (e) throw e;
      return data.require_membership_to_book;
    },
  });
  const setRequireMembership = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!membership) throw new Error('No gym');
      const { error: e } = await supabase.rpc('set_require_membership_to_book', {
        p_gym_id: membership.gymId,
        p_enabled: enabled,
      });
      if (e) throw e;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['gym-require-membership'] }),
  });

  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.jointemple.io';

  async function connect() {
    if (!membership) return;
    setError(null);
    setConnecting(true);
    try {
      const { data, error: e } = await supabase.functions.invoke(
        'stripe-connect-start',
        { body: { gym_id: membership.gymId, origin } },
      );
      if (e) throw e;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error('Could not start the Stripe connection');
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = url;
        return; // navigating away; leave the spinner up
      }
      throw new Error('Connecting Stripe is only available on the web for now');
    } catch (e) {
      setError(errorMessage(e, 'Could not start the Stripe connection'));
      setConnecting(false);
    }
  }

  const connected = !!account.data?.stripe_account_id;

  if (role && role !== 'owner') {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
          <BackLink label="Manage" fallbackHref="/management" />
          <Text className="text-gray-500 dark:text-gray-400">
            Only an owner can manage billing.
          </Text>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />

        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Billing & payments
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Connect your gym's Stripe account to charge members for
            memberships and credit packs. You keep 100% — Temple takes no
            cut of your payments.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            What that's worth
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Card processing itself (roughly 2.9% + 30p, set by Stripe and
            the card networks) is unavoidable anywhere you go — but many
            gym platforms add their own margin on top of it, or take a
            cut of member bookings. Temple adds nothing on top.
          </Text>
          <Input
            label={`Roughly how much do members pay you a month (${currency})?`}
            value={volumeInput}
            onChangeText={setVolumeInput}
            keyboardType="decimal-pad"
            placeholder="5000"
          />
          <View className="bg-primary/5 rounded-xl p-3">
            <Text className="text-gray-700 dark:text-gray-200 text-sm">
              At that volume, a platform charging an extra 1–3% on top of
              processing would cost you roughly{' '}
              <Text className="font-semibold">
                {formatMoney(elsewhere.lowCents, currency)}–
                {formatMoney(elsewhere.highCents, currency)}
              </Text>{' '}
              a month. On Temple, that stays with you.
            </Text>
          </View>
          <Text className="text-gray-400 dark:text-gray-500 text-[11px]">
            Illustrative only — platform fee structures vary and change
            over time.
          </Text>
        </View>

        {params.stripe === 'connected' && connected ? (
          <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
            <Text className="text-emerald-700 dark:text-emerald-300 text-sm">
              Stripe connected — you're ready to take payments.
            </Text>
          </View>
        ) : null}
        {params.stripe === 'error' ? (
          <View className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <Text className="text-red-600 dark:text-red-400 text-sm">
              That didn't complete — the connection was cancelled or timed
              out. Try again below.
            </Text>
          </View>
        ) : null}

        <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 gap-3">
          {account.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Checking connection…
            </Text>
          ) : connected ? (
            <>
              <View className="flex-row items-center gap-2">
                <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                  Connected to Stripe
                </Text>
              </View>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Member payments run through your own Stripe account
                (`{account.data?.stripe_account_id}`) — set up your plans
                below and members can subscribe and check out immediately.
              </Text>
            </>
          ) : (
            <>
              <View className="flex-row items-center gap-2">
                <Ionicons name="card-outline" size={20} color="#6B7280" />
                <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                  Not connected yet
                </Text>
              </View>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                You'll be sent to Stripe to sign in (or create an account)
                and authorise Temple. It takes a minute, and you can use an
                existing Stripe account if you have one.
              </Text>
              {error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">
                  {error}
                </Text>
              ) : null}
              <Button onPress={connect} loading={connecting}>
                Connect Stripe
              </Button>
            </>
          )}
        </View>

        <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 gap-3">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Members can choose &amp; pay
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Let members pick a plan and pay themselves. Turn this off if
                your front desk sets members up instead — staff can always
                charge a member directly.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Members can choose and pay"
              value={selfCheckout.data ?? true}
              onValueChange={(v) => setSelfCheckout.mutate(v)}
              disabled={selfCheckout.isLoading || setSelfCheckout.isPending}
            />
          </View>
          {setSelfCheckout.error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {errorMessage(setSelfCheckout.error, 'Could not save the setting')}
            </Text>
          ) : null}
        </View>

        <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 gap-3">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Require a membership to book
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                When on, members need an active membership or credits to book —
                without one they're shown your plans at the point of booking.
                Staff are exempt unless you require it for them on their profile.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Require a membership to book"
              value={requireMembership.data ?? false}
              onValueChange={(v) => setRequireMembership.mutate(v)}
              disabled={
                requireMembership.isLoading || setRequireMembership.isPending
              }
            />
          </View>
          {setRequireMembership.error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {errorMessage(setRequireMembership.error, 'Could not save the setting')}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
