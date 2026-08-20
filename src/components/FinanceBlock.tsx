import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { CardHeading } from '@/components/CardHeading';
import { ChipButton } from '@/components/ChipButton';
import { StatTile } from '@/components/StatTile';
import { formatMoney } from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format-date';
import { monthLabel, monthRange, pctDelta, previousMonthRange } from '@/lib/metrics';
import { drainPaymentEmails } from '@/lib/payment-notifications';
import { supabase } from '@/lib/supabase';
import { useGymCurrency } from '@/lib/useGymCurrency';

// ============================================================================
// Finance — confirmed, pending, forward. Gated on can_see_money by the
// caller, which is owner-only by default, so the block is simply absent
// for coaches and staff.
// ============================================================================

type FinanceRow = {
  currency: string;
  confirmed_cents: number;
  confirmed_count: number;
  pending_cents: number;
  pending_count: number;
  at_risk_cents: number;
  at_risk_count: number;
  forward_mrr_cents: number;
  forward_count: number;
};

type OverdueRow = {
  subscription_id: string;
  profile_id: string;
  full_name: string | null;
  plan_name: string;
  amount_cents: number;
  currency: string;
  past_due_since: string;
  payment_failure_count: number;
  next_payment_attempt: string | null;
  last_payment_error: string | null;
  notice_status: string | null;
};

function useFinanceMonth(gymId: string | undefined, monthStart: string) {
  return useQuery({
    queryKey: ['finance-summary', gymId, monthStart],
    enabled: !!gymId,
    queryFn: async (): Promise<FinanceRow[]> => {
      const { data, error } = await supabase.rpc('compute_finance_summary', {
        p_gym_id: gymId!,
        p_month_start: monthStart,
      });
      if (error) throw error;
      return (data ?? []) as unknown as FinanceRow[];
    },
  });
}

// The RPC returns a row per currency. Pick the one the gym actually trades
// in — same rule as the Revenue tile above this block, and for the same
// reason: a stray foreign charge shouldn't rename the headline number.
function primaryFinanceRow(rows: FinanceRow[], fallback: string): FinanceRow {
  const empty: FinanceRow = {
    currency: fallback,
    confirmed_cents: 0,
    confirmed_count: 0,
    pending_cents: 0,
    pending_count: 0,
    at_risk_cents: 0,
    at_risk_count: 0,
    forward_mrr_cents: 0,
    forward_count: 0,
  };
  if (rows.length === 0) return empty;
  return (
    rows.find((r) => r.forward_count > 0 || r.pending_count > 0) ??
    [...rows].sort((a, b) => b.confirmed_count - a.confirmed_count)[0]!
  );
}

export function FinanceBlock({ gymId }: { gymId: string }) {
  // Secondary drain. stripe-webhook invokes the worker when the payment
  // fails, but nothing retries a failed invoke, and an owner opening the
  // Money block is the next moment a stuck email can go out. It lives here
  // rather than in OverdueList because that only mounts while someone is
  // still at risk — and a member whose subscription Stripe has since
  // deleted drops off the list with their final-notice email still queued.
  useEffect(() => {
    if (gymId) void drainPaymentEmails(gymId);
  }, [gymId]);

  const currency = useGymCurrency();
  const now = new Date();
  const thisMonth = monthRange(now);
  const lastMonth = previousMonthRange(now);

  const current = useFinanceMonth(gymId, thisMonth.start);
  const previous = useFinanceMonth(gymId, lastMonth.start);

  const cur = primaryFinanceRow(current.data ?? [], currency);
  const prev = primaryFinanceRow(previous.data ?? [], currency);
  const ccy = cur.currency;
  const loading = current.isLoading || previous.isLoading;

  const error = current.error ?? previous.error;
  if (error) {
    return (
      <View className="gap-3">
        <Text className="text-ink dark:text-ink-dk text-lg font-semibold">
          Money
        </Text>
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(error, 'Could not load the finance summary')}
        </Text>
      </View>
    );
  }

  const projected = cur.confirmed_cents + cur.pending_cents;

  return (
    <View className="gap-3">
      <CardHeading
        size="section"
        title="Money"
        subtitle={monthLabel(thisMonth.start)}
        what="Confirmed is what has actually settled this month. Pending is what Stripe is scheduled to take from existing memberships before the month ends. Expected monthly is what the memberships you have already sold are worth per month, each at the price that member pays."
        why="Confirmed alone understates a month that is only half over, so Month projected adds the renewals still to come. At risk is money already failing — Stripe has tried and been declined — and is kept OUT of Month projected on purpose: counting it is how a forecast lies. Anyone in At risk is listed underneath to chase."
      />
      <View className="flex-row flex-wrap -m-1.5">
        <View className="w-1/2 lg:w-1/3 p-1.5">
          <StatTile
            title="Confirmed"
            value={loading ? '—' : formatMoney(cur.confirmed_cents, ccy)}
            subtitle={`vs ${monthLabel(lastMonth.start)}`}
            delta={
              loading
                ? undefined
                : pctDelta(cur.confirmed_cents, prev.confirmed_cents)
            }
          />
        </View>
        <View className="w-1/2 lg:w-1/3 p-1.5">
          <StatTile
            title="Pending"
            value={loading ? '—' : formatMoney(cur.pending_cents, ccy)}
            subtitle={
              cur.pending_count === 1
                ? '1 renewal still due'
                : `${cur.pending_count} renewals still due`
            }
            tone="muted"
          />
        </View>
        <View className="w-1/2 lg:w-1/3 p-1.5">
          <StatTile
            title="At risk"
            value={loading ? '—' : formatMoney(cur.at_risk_cents, ccy)}
            subtitle={
              cur.at_risk_count === 1
                ? '1 payment failing'
                : `${cur.at_risk_count} payments failing`
            }
            tone={cur.at_risk_count > 0 ? 'red' : 'muted'}
          />
        </View>
        <View className="w-1/2 lg:w-1/3 p-1.5">
          <StatTile
            title="Month projected"
            value={loading ? '—' : formatMoney(projected, ccy)}
            subtitle="confirmed + pending"
          />
        </View>
        <View className="w-1/2 lg:w-1/3 p-1.5">
          <StatTile
            title="Expected monthly"
            value={loading ? '—' : formatMoney(cur.forward_mrr_cents, ccy)}
            subtitle={
              cur.forward_count === 1
                ? 'from 1 active membership'
                : `from ${cur.forward_count} active memberships`
            }
            href="/management/plans"
          />
        </View>
      </View>
      {cur.at_risk_count > 0 ? <OverdueList gymId={gymId} /> : null}
    </View>
  );
}

// Who to chase. Sits under the Money block because "At risk £420" is only
// useful next to the four people it is. Deep-links to the member rather
// than showing contact details: gym_overdue_memberships deliberately
// returns no email or phone, since those are governed by can_see_email /
// can_see_full_pii and routing them through a money RPC would sidestep it.
function OverdueList({ gymId }: { gymId: string }) {
  const queryClient = useQueryClient();
  const rows = useQuery({
    queryKey: ['overdue-memberships', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<OverdueRow[]> => {
      const { data, error } = await supabase.rpc('gym_overdue_memberships', {
        p_gym_id: gymId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as OverdueRow[];
    },
  });

  // Same key and shape as the Timeline's useMoneyAuthority, so the two
  // screens share one cache entry.
  const authority = useQuery({
    queryKey: ['agent-authority', gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_authority')
        .select('action_kind, level')
        .eq('gym_id', gymId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const jobOn = (authority.data ?? []).some(
    (a) => a.action_kind === 'chase_message',
  );

  // Which of these failures the teammate is already on: an approved or
  // executed chase on the open case. Read under the same can_see_money
  // RLS the nudge detail screen uses.
  const chases = useQuery({
    queryKey: ['payment-chases', gymId],
    enabled: !!gymId && jobOn,
    queryFn: async (): Promise<Set<string>> => {
      const [cases, actions] = await Promise.all([
        supabase
          .from('agent_cases')
          .select('id, plan_subscription_id')
          .eq('gym_id', gymId)
          .neq('stage', 'closed'),
        supabase
          .from('agent_actions')
          .select('case_id, status')
          .eq('gym_id', gymId)
          .eq('action_kind', 'chase_message')
          .in('status', ['approved', 'executed']),
      ]);
      if (cases.error) throw cases.error;
      if (actions.error) throw actions.error;
      const chasedCases = new Set(
        (actions.data ?? []).map((a) => a.case_id).filter(Boolean),
      );
      return new Set(
        (cases.data ?? [])
          .filter((c) => chasedCases.has(c.id))
          .map((c) => c.plan_subscription_id),
      );
    },
  });

  const chase = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { error } = await supabase.rpc('request_payment_chase', {
        p_gym_id: gymId,
        p_subscription_id: subscriptionId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, subscriptionId) => {
      // Mark the row chased before the refetch lands: with only the
      // invalidation, the chip re-arms for a beat and a double-tap
      // spends the second touch on a duplicate email.
      queryClient.setQueryData<Set<string>>(
        ['payment-chases', gymId],
        (old) => new Set([...(old ?? []), subscriptionId]),
      );
      // The outbound queue drains on a 15-minute cron; the owner just
      // asked, so nudge the worker now. Best-effort — quiet hours or a
      // failure here just leave it to the cron.
      void supabase.functions.invoke('send-agent-messages', {
        body: { gym_id: gymId },
      });
      void queryClient.invalidateQueries({ queryKey: ['payment-chases', gymId] });
      void queryClient.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
    },
  });

  const list = rows.data ?? [];
  if (rows.error) {
    return (
      <Text className="text-red-500 dark:text-red-400 text-sm">
        {errorMessage(rows.error, 'Could not load who needs chasing')}
      </Text>
    );
  }
  if (rows.isLoading || list.length === 0) return null;

  // Capped — a gym with thirty failing cards has a collections problem,
  // not a scrolling problem.
  const shown = list.slice(0, 6);

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <Text className="text-ink dark:text-ink-dk font-semibold">
        Needs chasing
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        Stripe has tried to take these and been declined. It keeps retrying for
        about two weeks and gives up after that. Unlimited members can keep
        booking meanwhile; members on a credit plan cannot, because their
        credits only arrive when the payment goes through.
      </Text>
      {jobOn ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          Chase for me skips my three-day wait — I send the nudge now, and
          the receipt lands in the Timeline.
        </Text>
      ) : null}
      <View className="gap-2">
        {shown.map((r) => (
          <Pressable
            key={r.subscription_id}
            onPress={() => router.push(`/management/members/${r.profile_id}` as never)}
            className="flex-row items-center gap-3 border border-line dark:border-line-dk rounded-lg px-3 py-2 active:opacity-70">
            <View className="flex-1">
              <Text className="text-ink dark:text-ink-dk text-sm">
                {r.full_name ?? 'Member'}
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                {r.plan_name} · failing since {formatDate(r.past_due_since)}
                {r.payment_failure_count > 1
                  ? ` · ${r.payment_failure_count} attempts`
                  : ''}
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                {r.next_payment_attempt
                  ? `Stripe retries ${formatDate(r.next_payment_attempt)}`
                  : 'Stripe has stopped retrying'}
                {r.last_payment_error ? ` · ${r.last_payment_error}` : ''}
              </Text>
              {/* Whether they have actually been told. "Emailed, ignored"
                  and "never emailed" need different phone calls. */}
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                {r.notice_status === 'sent'
                  ? 'Emailed'
                  : r.notice_status === 'queued'
                    ? 'Email not sent yet'
                    : r.notice_status === 'failed'
                      ? 'Email could not be delivered'
                      : 'Not emailed — no address on file'}
              </Text>
            </View>
            <Text className="text-ink dark:text-ink-dk text-sm font-semibold">
              {formatMoney(r.amount_cents, r.currency)}
            </Text>
            <View className="items-stretch gap-1.5">
              {jobOn ? (
                chases.data?.has(r.subscription_id) ? (
                  <ChipButton
                    label="Chasing"
                    icon="sparkles"
                    tone="neutral"
                  />
                ) : (
                  <ChipButton
                    label={
                      chase.isPending && chase.variables === r.subscription_id
                        ? 'Handing over…'
                        : 'Chase for me'
                    }
                    icon="sparkles-outline"
                    tone="primary"
                    disabled={chase.isPending}
                    onPress={() => chase.mutate(r.subscription_id)}
                  />
                )
              ) : null}
              {/* The one action that needs no PII and no extra fetch. Email
                  and phone live on the member's own screen, one member at a
                  time, each behind its own capability. */}
              <ChipButton
                label="Message"
                icon="chatbubble-outline"
                tone="neutral"
                onPress={() => router.push(`/inbox/direct/${r.profile_id}` as never)}
              />
              {chase.error && chase.variables === r.subscription_id ? (
                <Text className="text-red-500 dark:text-red-400 text-xs max-w-[140px]">
                  {errorMessage(chase.error, "That didn't go through")}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </Pressable>
        ))}
        {list.length > shown.length ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            +{list.length - shown.length} more
          </Text>
        ) : null}
      </View>
    </View>
  );
}
