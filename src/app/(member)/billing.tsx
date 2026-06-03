import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { computePaidPeriodEnd, type Interval } from '@/lib/billing/notice-math';
import { computeResumedPaidPeriodEnd } from '@/lib/billing/pause-math';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Sub = {
  id: string;
  status: string;
  paid_period_end: string | null;
  pause_started_at: string | null;
  billing_interval: string | null;
  plan: {
    name: string;
    monthly_price_cents: number | null;
    notice_period: string | null;
  } | null;
};

type GymSettings = { member_can_pause: boolean };

function parseInterval(s: string | null): Interval | null {
  if (!s) return null;
  const m = s.match(/^(\d+)\s+(day|days|week|weeks|month|months|year|years)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  if (u.startsWith('day')) return { days: n };
  if (u.startsWith('week')) return { days: n * 7 };
  if (u.startsWith('month')) return { months: n };
  if (u.startsWith('year')) return { months: n * 12 };
  return null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtAmount(cents: number | null): string {
  if (cents == null) return '—';
  return `£${(cents / 100).toFixed(2)}`;
}

const STATUS_TONES: Record<string, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-200' },
  paused: { label: 'Paused', tone: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200' },
  cancelled_at_period_end: { label: 'Cancelling', tone: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-200' },
  scheduled: { label: 'Scheduled', tone: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200' },
  pending: { label: 'Pending', tone: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200' },
  lapsed: { label: 'Lapsed', tone: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-200' },
  cancelled: { label: 'Cancelled', tone: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200' },
  refunded_retained: { label: 'Refunded', tone: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200' },
};

export default function MemberBilling() {
  const session = useSession();
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<null | 'cancel' | 'pause' | 'resume'>(null);
  const [error, setError] = useState<string | null>(null);

  const subQuery = useQuery({
    queryKey: ['member-billing', session?.user.id, gym?.gymId],
    enabled: !!session?.user.id && !!gym?.gymId,
    queryFn: async (): Promise<Sub | null> => {
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select(
          'id, status, paid_period_end, pause_started_at, billing_interval, plan:membership_plans(name, monthly_price_cents, notice_period)',
        )
        .eq('profile_id', session!.user.id)
        .eq('gym_id', gym!.gymId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Sub | null) ?? null;
    },
  });

  const settingsQuery = useQuery({
    queryKey: ['gym-settings', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<GymSettings | null> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('member_can_pause')
        .eq('id', gym!.gymId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as GymSettings | null) ?? null;
    },
  });

  const sub = subQuery.data;
  const settings = settingsQuery.data;

  // Cancel preview: when will access end?
  const cancelPreview = (() => {
    if (!sub?.paid_period_end) return null;
    const notice = parseInterval(sub.plan?.notice_period ?? '0') ?? {};
    const billing = parseInterval(sub.billing_interval);
    return computePaidPeriodEnd({
      now: new Date(),
      paidPeriodEnd: new Date(sub.paid_period_end),
      billingInterval: billing,
      noticePeriod: notice,
    });
  })();

  // Resume preview: when would the period end after resume?
  const resumePreview = (() => {
    if (!sub || sub.status !== 'paused' || !sub.pause_started_at) return null;
    return computeResumedPaidPeriodEnd({
      paidPeriodEnd: sub.paid_period_end ? new Date(sub.paid_period_end) : null,
      pauseStartedAt: new Date(sub.pause_started_at),
      resumeAt: new Date(),
    });
  })();

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!sub) throw new Error('No subscription');
      const { error } = await supabase.functions.invoke('cancel-subscription', {
        body: { planSubscriptionId: sub.id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirming(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['member-billing'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      if (!sub) throw new Error('No subscription');
      const { error } = await supabase.rpc('pause_subscription', {
        p_plan_subscription_id: sub.id,
        p_pause_ends_at: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirming(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['member-billing'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      if (!gym) throw new Error('No gym');
      const { data, error } = await supabase.functions.invoke<{ url: string }>(
        'billing-portal',
        { body: { gymId: gym.gymId } },
      );
      if (error) throw error;
      if (!data?.url) throw new Error('No portal URL returned');
      await Linking.openURL(data.url);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!sub) throw new Error('No subscription');
      const { error } = await supabase.rpc('resume_subscription', {
        p_plan_subscription_id: sub.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirming(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['member-billing'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const status = sub?.status ?? null;
  const statusCfg = status ? STATUS_TONES[status] : null;
  const canCancel = status === 'active';
  const canPause = status === 'active' && (settings?.member_can_pause ?? false);
  const canResume = status === 'paused';

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Billing
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Your membership and payments.
          </Text>
        </View>

        {subQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : null}

        {!subQuery.isLoading && !sub ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              No membership yet
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Ask your gym to set you up with a plan, or sign up below.
            </Text>
            <Link href="/signup" asChild>
              <Pressable>
                <Button>Browse plans</Button>
              </Pressable>
            </Link>
          </View>
        ) : null}

        {sub ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  {sub.plan?.name ?? 'Membership'}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  {fmtAmount(sub.plan?.monthly_price_cents ?? null)}
                </Text>
              </View>
              {statusCfg ? (
                <View className={`rounded-full px-2 py-1 ${statusCfg.tone}`}>
                  <Text className={`text-xs font-medium ${statusCfg.tone}`}>
                    {statusCfg.label}
                  </Text>
                </View>
              ) : null}
            </View>
            <View className="gap-1 pt-1">
              <Row label="Next renewal" value={fmtDate(sub.paid_period_end)} />
              {sub.status === 'cancelled_at_period_end' ? (
                <Row
                  label="Access ends"
                  value={fmtDate(sub.paid_period_end)}
                />
              ) : null}
              {sub.status === 'paused' && sub.pause_started_at ? (
                <Row label="Paused since" value={fmtDate(sub.pause_started_at)} />
              ) : null}
            </View>
          </View>
        ) : null}

        {error ? (
          <View className="flex-row items-start gap-2 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
            <Ionicons name="warning-outline" size={16} color="#DC2626" />
            <Text className="text-red-700 dark:text-red-200 text-sm flex-1">
              {error}
            </Text>
          </View>
        ) : null}

        {confirming === 'cancel' && cancelPreview ? (
          <ConfirmCard
            title="Cancel your membership?"
            body={`Access continues until ${fmtDate(
              cancelPreview.toISOString(),
            )}. You'll keep being charged through that period.`}
            confirmLabel="Yes, cancel"
            onConfirm={() => cancelMutation.mutate()}
            onCancel={() => setConfirming(null)}
            pending={cancelMutation.isPending}
          />
        ) : null}

        {confirming === 'pause' ? (
          <ConfirmCard
            title="Pause your membership?"
            body="Billing and access stop until you resume. The time you've already paid for is held and returns when you resume."
            confirmLabel="Pause"
            onConfirm={() => pauseMutation.mutate()}
            onCancel={() => setConfirming(null)}
            pending={pauseMutation.isPending}
          />
        ) : null}

        {confirming === 'resume' && resumePreview ? (
          <ConfirmCard
            title="Resume your membership?"
            body={`Your next renewal will be on ${fmtDate(
              resumePreview.toISOString(),
            )} — the same number of days you had left when you paused.`}
            confirmLabel="Resume"
            onConfirm={() => resumeMutation.mutate()}
            onCancel={() => setConfirming(null)}
            pending={resumeMutation.isPending}
          />
        ) : null}

        {confirming === null && sub ? (
          <View className="gap-2">
            {canCancel ? (
              <Button variant="secondary" onPress={() => setConfirming('cancel')}>
                Cancel membership
              </Button>
            ) : null}
            {canPause ? (
              <Button variant="secondary" onPress={() => setConfirming('pause')}>
                Pause
              </Button>
            ) : null}
            {canResume ? (
              <Button onPress={() => setConfirming('resume')}>Resume</Button>
            ) : null}
            <Pressable
              onPress={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  Update card and invoices
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  Opens your gym's secure Stripe billing portal.
                </Text>
              </View>
              <Text className="text-primary">
                {portalMutation.isPending ? '…' : '→'}
              </Text>
            </Pressable>
            <Link href="/receipts" asChild>
              <Pressable className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                    Receipts
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    Every payment and refund.
                  </Text>
                </View>
                <Text className="text-primary">→</Text>
              </Pressable>
            </Link>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-gray-500 dark:text-gray-400 text-sm">{label}</Text>
      <Text className="text-gray-900 dark:text-gray-50 text-sm">{value}</Text>
    </View>
  );
}

function ConfirmCard({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  pending,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-primary">
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">{title}</Text>
      <Text className="text-gray-700 dark:text-gray-200 text-sm">{body}</Text>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button variant="secondary" onPress={onCancel} disabled={pending}>
            Back
          </Button>
        </View>
        <View className="flex-1">
          <Button onPress={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </View>
      </View>
    </View>
  );
}
