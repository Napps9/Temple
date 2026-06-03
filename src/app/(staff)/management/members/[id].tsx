import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useRole } from '@/lib/auth';
import { can } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type MemberDetail = {
  id: string;
  gym_id: string;
  profile_id: string;
  role: string;
  created_at: string;
  profiles: { full_name: string | null; phone: string | null } | null;
  plan_subscriptions: {
    id: string;
    status: string;
    paid_period_end: string | null;
    pause_started_at: string | null;
    plan: {
      name: string;
      monthly_price_cents: number | null;
    } | null;
  }[];
};

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

function rankSubs(subs: MemberDetail['plan_subscriptions']) {
  const rank: Record<string, number> = {
    active: 1, paused: 2, cancelled_at_period_end: 3,
    scheduled: 4, pending: 4, refunded_retained: 5, lapsed: 6, cancelled: 7,
  };
  return [...subs].sort((a, b) => (rank[a.status] ?? 99) - (rank[b.status] ?? 99))[0];
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtPrice(cents: number | null): string {
  if (cents == null) return '—';
  return `£${(cents / 100).toFixed(2)}`;
}

export default function StaffMemberDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const membershipId = params.id;
  const role = useRole();
  const queryClient = useQueryClient();

  const [confirming, setConfirming] = useState<null | 'pause' | 'cancel' | 'refund'>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [retainAccess, setRetainAccess] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const memberQuery = useQuery({
    queryKey: ['staff-member', membershipId],
    enabled: !!membershipId,
    queryFn: async (): Promise<MemberDetail | null> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select(
          'id, gym_id, profile_id, role, created_at, profiles!gym_memberships_profile_id_fkey(full_name, phone), plan_subscriptions(id, status, paid_period_end, pause_started_at, plan:membership_plans(name, monthly_price_cents))',
        )
        .eq('id', membershipId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as MemberDetail | null) ?? null;
    },
  });

  const m = memberQuery.data;
  const sub = m ? rankSubs(m.plan_subscriptions ?? []) : null;
  const subId = sub?.id ?? null;
  const profile = m?.profiles
    ? Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    : null;
  const plan = sub?.plan
    ? Array.isArray(sub.plan) ? sub.plan[0] : sub.plan
    : null;
  const statusCfg = sub ? STATUS_TONES[sub.status] : null;
  const fullPrice = plan?.monthly_price_cents ?? 0;

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!subId) throw new Error('No subscription');
      const { error } = await supabase.functions.invoke('cancel-subscription', {
        body: { planSubscriptionId: subId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirming(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['staff-member', membershipId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      if (!subId) throw new Error('No subscription');
      const { error } = await supabase.rpc('pause_subscription', {
        p_plan_subscription_id: subId,
        p_pause_ends_at: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirming(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['staff-member', membershipId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!subId) throw new Error('No subscription');
      const { error } = await supabase.rpc('resume_subscription', {
        p_plan_subscription_id: subId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['staff-member', membershipId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const refundMutation = useMutation({
    mutationFn: async () => {
      if (!subId) throw new Error('No subscription');
      const cents = Math.round(parseFloat(refundAmount) * 100);
      if (!Number.isFinite(cents) || cents <= 0) {
        throw new Error('Enter a valid amount');
      }
      const { error } = await supabase.functions.invoke('refund-payment', {
        body: {
          planSubscriptionId: subId,
          amountCents: cents,
          retainAccess,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirming(null);
      setRefundAmount('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['staff-member', membershipId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        {memberQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : null}

        {!memberQuery.isLoading && !m ? (
          <Text className="text-gray-500 dark:text-gray-400">Member not found.</Text>
        ) : null}

        {m ? (
          <View className="flex-row items-center gap-3">
            <Avatar name={profile?.full_name ?? null} size={48} />
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
                {profile?.full_name ?? 'Member'}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                {m.role} · Joined {fmtDate(m.created_at)}
              </Text>
            </View>
          </View>
        ) : null}

        {sub ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  {plan?.name ?? 'Membership'}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  {fmtPrice(plan?.monthly_price_cents ?? null)}
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
            <Row label="Renews / ends" value={fmtDate(sub.paid_period_end)} />
            {sub.pause_started_at ? (
              <Row label="Paused since" value={fmtDate(sub.pause_started_at)} />
            ) : null}
          </View>
        ) : (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400">
              No plan yet.
            </Text>
          </View>
        )}

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        {confirming === 'cancel' ? (
          <ConfirmCard
            title="Cancel this member's plan?"
            body="They'll keep access through the paid period and stop renewing."
            confirmLabel="Cancel"
            onConfirm={() => cancelMutation.mutate()}
            onCancel={() => setConfirming(null)}
            pending={cancelMutation.isPending}
          />
        ) : null}

        {confirming === 'pause' ? (
          <ConfirmCard
            title="Pause this member's plan?"
            body="Billing and access stop until you resume. They keep the prepaid days for when they come back."
            confirmLabel="Pause"
            onConfirm={() => pauseMutation.mutate()}
            onCancel={() => setConfirming(null)}
            pending={pauseMutation.isPending}
          />
        ) : null}

        {confirming === 'refund' ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-primary">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Refund a payment
            </Text>
            <Input
              label="Amount (GBP)"
              value={refundAmount}
              onChangeText={setRefundAmount}
              keyboardType="decimal-pad"
              placeholder={fullPrice ? (fullPrice / 100).toFixed(2) : '0.00'}
            />
            <Pressable
              onPress={() => setRetainAccess(!retainAccess)}
              className="flex-row items-center gap-2">
              <View
                className={`w-5 h-5 rounded border ${
                  retainAccess
                    ? 'bg-primary border-primary'
                    : 'bg-transparent border-gray-300 dark:border-gray-600'
                } items-center justify-center`}>
                {retainAccess ? (
                  <Text className="text-white text-xs">✓</Text>
                ) : null}
              </View>
              <Text className="text-gray-900 dark:text-gray-50 text-sm flex-1">
                Keep access until paid period ends
              </Text>
            </Pressable>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              {retainAccess
                ? 'Status flips to "refunded — access retained" and ends naturally at the paid_period_end.'
                : 'Status flips to "cancelled" and access ends immediately.'}
            </Text>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" onPress={() => setConfirming(null)}>
                  Back
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  onPress={() => refundMutation.mutate()}
                  loading={refundMutation.isPending}>
                  Refund
                </Button>
              </View>
            </View>
          </View>
        ) : null}

        {confirming === null && sub ? (
          <View className="gap-2">
            {sub.status === 'active' ? (
              <>
                <Button variant="secondary" onPress={() => setConfirming('pause')}>
                  Pause membership
                </Button>
                <Button variant="secondary" onPress={() => setConfirming('cancel')}>
                  Cancel membership
                </Button>
              </>
            ) : null}
            {sub.status === 'paused' ? (
              <Button
                onPress={() => resumeMutation.mutate()}
                loading={resumeMutation.isPending}>
                Resume
              </Button>
            ) : null}
            {can(role, 'can_refund') ? (
              <Button variant="secondary" onPress={() => setConfirming('refund')}>
                Refund a payment
              </Button>
            ) : null}
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
