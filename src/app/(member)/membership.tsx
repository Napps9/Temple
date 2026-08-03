import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatMoney } from '@/lib/coach-earnings';
import { embedOne } from '@/lib/embed';
import { errorMessage } from '@/lib/errors';
import { paymentNoticeCopy } from '@/lib/payment-notice';
import {
  clearPendingCheckout,
  hasPendingCheckout,
  markPendingCheckout,
} from '@/lib/pending-checkout';
import { supabase } from '@/lib/supabase';
import { useGymCurrency } from '@/lib/useGymCurrency';
import {
  CURRENT_SUB_STATUSES,
  SUB_STATUS_META,
  planKindLabel,
  planPriceLabel,
  useClearAgreedPlan,
  useGymPlans,
  useGymSelfCheckout,
  useMyAgreedPlan,
  useMyInvoices,
  useMySubscriptions,
  useStartCheckout,
  type GymPlan,
  type MemberInvoice,
  type MySubscription,
} from '@/lib/subscriptions';
import {
  useFileChangeRequest,
  useMembershipPolicies,
  useModifySubscription,
  useMyChangeRequests,
  useWithdrawChangeRequest,
  type MembershipChangePolicy,
  type MyChangeRequest,
} from '@/lib/membership-changes';

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

// A failed payment leaves the membership 'active' on purpose — Stripe
// retries for about two weeks and the member keeps training meanwhile
// (0174). But nothing gets fixed unless they know, and Temple has no
// billing portal, so the Stripe-hosted invoice is the only place they can
// actually pay. Without that link this notice would be a dead end.
function PaymentFailedNotice({ sub }: { sub: MySubscription }) {
  const dunning = embedOne(sub.plan_subscription_dunning);
  const invoiceUrl = embedOne(sub.membership_invoice_links)?.invoice_url ?? null;
  const copy = paymentNoticeCopy({
    planKind: sub.membership_plans?.kind ?? 'unlimited',
    status: sub.status,
    nextAttemptLabel: dunning?.next_payment_attempt
      ? fmtDate(dunning.next_payment_attempt)
      : null,
    lastError: dunning?.last_payment_error ?? null,
    hasInvoiceLink: !!invoiceUrl,
  });
  return (
    <View className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="alert-circle" size={18} color="#DC2626" />
        <Text className="text-red-800 dark:text-red-200 font-semibold flex-1">
          {copy.title}
        </Text>
      </View>
      <Text className="text-red-900 dark:text-red-100 text-sm">{copy.body}</Text>
      {copy.action === 'pay' && invoiceUrl ? (
        <Pressable
          onPress={() => Linking.openURL(invoiceUrl)}
          className="bg-red-600 rounded-lg px-3 py-2 items-center active:opacity-80">
          <Text className="text-white text-sm font-semibold">Pay now</Text>
        </Pressable>
      ) : copy.action === 'plans' ? null : (
        <Text className="text-red-900 dark:text-red-100 text-xs">
          Speak to the gym to update your card.
        </Text>
      )}
    </View>
  );
}

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

function DetailRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warn';
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-gray-500 dark:text-gray-400 text-sm">{label}</Text>
      <Text
        className={`text-sm font-medium ${
          tone === 'warn'
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-gray-900 dark:text-gray-50'
        }`}>
        {value}
      </Text>
    </View>
  );
}

// Forward-looking notice-period timeline. The bar is the notice window
// starting today; the dot marks where the next renewal (the member's last
// payment if they cancel now) falls within it. Assumes "cancel → keep
// access for the notice period, your last charge is the renewal in that
// window" — informational only; there's no enforced cancel flow yet.
function NoticePeriodBar({
  noticeDays,
  renewalDate,
  priceLabel,
}: {
  noticeDays: number;
  renewalDate: string | null;
  priceLabel: string | null;
}) {
  if (noticeDays <= 0) return null;
  const spanMs = noticeDays * 24 * 60 * 60 * 1000;
  const accessEnds = new Date(Date.now() + spanMs).toISOString();
  const renewalPct =
    renewalDate != null
      ? Math.min(
          1,
          Math.max(0, (new Date(renewalDate).getTime() - Date.now()) / spanMs),
        )
      : null;

  return (
    <View className="gap-2 pt-1">
      <View className="flex-row items-center justify-between">
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          If you cancel today
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {noticeDays}-day notice
        </Text>
      </View>

      <View className="relative h-2.5 rounded-full bg-primary/15">
        {renewalPct != null ? (
          <View
            className="absolute w-3 h-3 rounded-full bg-primary border-2 border-white dark:border-gray-900"
            style={{ left: `${renewalPct * 100}%`, top: -1, marginLeft: -6 }}
          />
        ) : null}
      </View>

      <View className="flex-row items-center justify-between">
        <Text className="text-gray-700 dark:text-gray-200 text-xs font-medium">
          Today
        </Text>
        <Text className="text-gray-700 dark:text-gray-200 text-xs font-medium">
          Access ends {fmtDate(accessEnds)}
        </Text>
      </View>

      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        {renewalDate != null
          ? `Your last payment would be ${
              priceLabel ? `${priceLabel} ` : ''
            }on ${fmtDate(renewalDate)}.`
          : `Your membership would stay active for ${noticeDays} more days.`}
      </Text>
    </View>
  );
}

function CurrentSubCard({
  sub,
  onContinueBilling,
  continuingBilling,
}: {
  sub: MySubscription;
  onContinueBilling?: () => void;
  continuingBilling?: boolean;
}) {
  const currency = useGymCurrency();
  const plan = sub.membership_plans;
  const kind = plan?.kind ?? 'unlimited';
  const isCredit = kind !== 'unlimited';
  const cancelling = sub.status === 'cancelled_at_period_end';
  // A one-off credit pack has no ongoing renewal to "continue" — only
  // unlimited / credit_period (recurring) legacy plans get the prompt.
  const needsBilling =
    sub.imported_legacy && sub.status === 'active' && kind !== 'credit_pack';
  // The snapshotted price the member actually pays (grandfathered), falling
  // back to the plan's current price if it predates the snapshot column.
  const priceCents = sub.price_cents ?? plan?.monthly_price_cents ?? null;
  const priceLabel =
    priceCents != null
      ? planPriceLabel({ kind, monthly_price_cents: priceCents }, currency)
      : null;
  const notice = plan?.notice_period_days ?? 0;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {plan?.name ?? 'Plan'}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            {planKindLabel({ kind, credit_count: plan?.credit_count ?? null })}
          </Text>
        </View>
        <StatusChip status={sub.status} />
      </View>

      <View className="border-t border-gray-100 dark:border-gray-800" />

      <View className="gap-1.5">
        {priceLabel != null ? (
          <DetailRow label="Price" value={priceLabel} />
        ) : null}

        {isCredit && sub.credit_balance != null ? (
          <DetailRow
            label="Credits left"
            value={`${sub.credit_balance}${
              sub.period_resets_at
                ? ` · resets ${fmtDate(sub.period_resets_at)}`
                : ''
            }`}
          />
        ) : null}

        {cancelling && sub.paid_period_end ? (
          <DetailRow
            label="Access until"
            value={fmtDate(sub.paid_period_end)}
            tone="warn"
          />
        ) : sub.paid_period_end ? (
          <DetailRow label="Renews" value={fmtDate(sub.paid_period_end)} />
        ) : null}

        <DetailRow label="Started" value={fmtDate(sub.created_at)} />
      </View>

      {!cancelling && notice > 0 ? (
        <>
          <View className="border-t border-gray-100 dark:border-gray-800" />
          <NoticePeriodBar
            noticeDays={notice}
            renewalDate={sub.paid_period_end}
            priceLabel={priceLabel}
          />
        </>
      ) : null}

      {needsBilling ? (
        <View className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 gap-2">
          <Text className="text-amber-800 dark:text-amber-300 text-sm font-medium">
            Carried over from your old gym — not yet billed through Temple
          </Text>
          <Text className="text-amber-700/80 dark:text-amber-300/80 text-xs">
            You keep access under this plan, but nothing will renew it
            automatically until you add a payment method.
          </Text>
          {onContinueBilling ? (
            <Button
              icon="card-outline"
              loading={continuingBilling}
              onPress={onContinueBilling}>
              Add payment method to continue
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// How long to wait for the webhook to record the subscription before we
// stop claiming "any second now" and tell the member it's delayed. The
// happy path lands in a few seconds; this is the genuinely-stuck cutoff.
const STUCK_AFTER_MS = 90_000;

function PendingMembershipCard({
  stuck,
  gymName,
  onRetry,
}: {
  stuck: boolean;
  gymName: string;
  onRetry: () => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        Your membership
      </Text>
      <View
        className={`bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border ${
          stuck
            ? 'border-amber-300 dark:border-amber-700'
            : 'border-gray-200 dark:border-gray-800'
        }`}>
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
            {stuck ? 'Membership not showing yet' : 'Setting up your membership…'}
          </Text>
          <View className="rounded-full border px-2.5 py-0.5 bg-amber-500/10 border-amber-500/40">
            <Text className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
              {stuck ? 'Delayed' : 'Pending'}
            </Text>
          </View>
        </View>
        {stuck ? (
          <>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Your payment went through, but we haven't been able to confirm
              your membership{gymName ? ` with ${gymName}` : ''} yet. Try again
              in a moment — if it's still not here, contact your gym and they'll
              sort it out.
            </Text>
            <Button variant="secondary" icon="refresh" onPress={onRetry}>
              Check again
            </Button>
          </>
        ) : (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="text-gray-500 dark:text-gray-400 text-sm flex-1">
              We're confirming your payment with the gym. This page updates
              automatically.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function money(cents: number, currency: string): string {
  return formatMoney(cents, currency.toUpperCase());
}

function InvoiceRow({ inv }: { inv: MemberInvoice }) {
  const hasDoc = !!(inv.invoice_url || inv.invoice_pdf);
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-medium">
            {money(inv.amount_cents, inv.currency)}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            {fmtDate(inv.occurred_at)}
            {inv.invoice_number ? ` · ${inv.invoice_number}` : ''}
          </Text>
        </View>
        {hasDoc ? null : (
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Paid
          </Text>
        )}
      </View>
      {hasDoc ? (
        <View className="flex-row flex-wrap gap-2">
          {inv.invoice_pdf ? (
            <ChipButton
              label="Download PDF"
              icon="download-outline"
              tone="neutral"
              onPress={() => Linking.openURL(inv.invoice_pdf!)}
            />
          ) : null}
          {inv.invoice_url ? (
            <ChipButton
              label="View invoice"
              icon="open-outline"
              tone="neutral"
              onPress={() => Linking.openURL(inv.invoice_url!)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// Cancel / request-cancel / withdraw for the member's recurring membership.
// Switching to a different plan lives in the plan list below; this card is
// the "leave or change my mind" surface for the active subscription.
function MembershipActions({
  sub,
  cancelPolicy,
  pending,
  pendingTargetName,
  modify,
  file,
  withdraw,
}: {
  sub: MySubscription;
  cancelPolicy: MembershipChangePolicy;
  pending: MyChangeRequest | undefined;
  pendingTargetName: string | null;
  modify: ReturnType<typeof useModifySubscription>;
  file: ReturnType<typeof useFileChangeRequest>;
  withdraw: ReturnType<typeof useWithdrawChangeRequest>;
}) {
  const [confirm, setConfirm] = useState(false);
  // Already winding down — the card shows "Access until"; nothing to do.
  if (sub.status === 'cancelled_at_period_end') return null;
  // No Stripe subscription behind this row yet — cancel/switch would
  // hit stripe-modify-subscription's "not a recurring subscription"
  // dead end. The card's own "add payment method" CTA is the only
  // action available until then.
  if (sub.imported_legacy) return null;

  if (pending) {
    const label =
      pending.kind === 'cancel'
        ? 'Cancellation requested'
        : `Plan change requested${pendingTargetName ? ` → ${pendingTargetName}` : ''}`;
    return (
      <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 gap-2">
        <Text className="text-amber-800 dark:text-amber-300 text-sm font-medium">
          {label}
        </Text>
        <Text className="text-amber-700/80 dark:text-amber-300/80 text-xs">
          Waiting for your gym to approve. You can withdraw it if you change
          your mind.
        </Text>
        <ChipButton
          label="Withdraw request"
          icon="close"
          tone="neutral"
          onPress={() => withdraw.mutate(pending.id)}
        />
      </View>
    );
  }

  const cancelBusy = modify.isPending && modify.variables?.kind === 'cancel';
  if (cancelPolicy === 'self_serve') {
    return confirm ? (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-red-300 dark:border-red-800">
        <Text className="text-gray-700 dark:text-gray-200 text-sm">
          Cancel at the end of your paid period? You'll keep access until then.
        </Text>
        <View className="flex-row gap-2">
          <Button
            variant="destructive"
            loading={cancelBusy}
            onPress={() =>
              modify.mutate({ planSubscriptionId: sub.id, kind: 'cancel' })
            }>
            Cancel membership
          </Button>
          <Button variant="ghost" onPress={() => setConfirm(false)}>
            Keep it
          </Button>
        </View>
      </View>
    ) : (
      <ChipButton
        label="Cancel membership"
        icon="close-circle-outline"
        tone="red"
        onPress={() => setConfirm(true)}
      />
    );
  }

  return (
    <ChipButton
      label="Request cancellation"
      icon="exit-outline"
      tone="neutral"
      onPress={() => file.mutate({ planSubscriptionId: sub.id, kind: 'cancel' })}
    />
  );
}

export default function MembershipScreen() {
  const { data: membership } = useGymMembership();
  const currency = useGymCurrency();
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
  const agreedPlan = useMyAgreedPlan(gymId);
  const clearAgreed = useClearAgreedPlan(gymId);
  const invoices = useMyInvoices(gymId, session?.user.id);

  // The class the AI agent agreed on the call. Once the membership is
  // current, book it as the member — through book_class, so every gate
  // (entitlement, capacity, windows) still applies — and retire the
  // staging either way: a failed auto-book routes them to pick manually,
  // not into a retry loop on every visit.
  const stagedClass = useQuery({
    queryKey: ['my-first-class', gymId],
    enabled: !!gymId && !!session,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_staged_first_class', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      const rows = (data ?? []) as {
        session_id: string;
        session_name: string;
        starts_at: string;
      }[];
      return rows[0] ?? null;
    },
  });
  const [firstClassResult, setFirstClassResult] = useState<
    { ok: boolean; name: string; starts_at: string; detail?: string } | null
  >(null);
  const autoBookTried = useRef(false);
  const queryClientRef = useQueryClient();
  const bookFirst = useMutation({
    mutationFn: async (target: { session_id: string; session_name: string; starts_at: string }) => {
      const { error } = await supabase.rpc('book_class', {
        session_id: target.session_id,
      });
      if (error) throw error;
    },
    onSettled: async (_data, err, target) => {
      await supabase.rpc('clear_my_first_class', { p_gym_id: gymId! });
      queryClientRef.invalidateQueries({ queryKey: ['my-first-class', gymId] });
      setFirstClassResult({
        ok: !err,
        name: target.session_name,
        starts_at: target.starts_at,
        detail: err ? errorMessage(err, 'the class could not be booked') : undefined,
      });
    },
  });
  const policies = useMembershipPolicies(gymId);
  const changeReqs = useMyChangeRequests(gymId, session?.user.id);
  const modify = useModifySubscription(gymId, session?.user.id);
  const fileReq = useFileChangeRequest(gymId, session?.user.id);
  const withdrawReq = useWithdrawChangeRequest(gymId, session?.user.id);

  const currentSubs = (subs.data ?? []).filter((s) =>
    CURRENT_SUB_STATUSES.has(s.status),
  );
  // Deliberately NOT filtered to current statuses. When Stripe gives up it
  // deletes the subscription and the webhook marks it cancelled, which is
  // exactly when the member most needs to see why — and nothing clears the
  // dunning row except recovery or leaving the gym.
  const failingSub = (subs.data ?? []).find(
    (s) => embedOne(s.plan_subscription_dunning) !== null,
  );
  const currentPlanIds = new Set(currentSubs.map((s) => s.plan_id));
  const awaitingActivation = awaitingPossible && currentSubs.length === 0;

  // The recurring membership (if any) is what switch / cancel act on; credit
  // packs are one-off pools and stay out of the change workflow. A pending
  // request blocks new changes until it's decided or withdrawn.
  const recurringSub = currentSubs.find(
    (s) => (s.membership_plans?.kind ?? 'unlimited') !== 'credit_pack',
  );
  const pendingForSub = (changeReqs.data ?? []).find(
    (r) => r.status === 'pending' && r.plan_subscription_id === recurringSub?.id,
  );
  const pendingTargetName =
    pendingForSub?.target_plan_id != null
      ? ((plans.data ?? []).find(
          (p) => p.plan_id === pendingForSub.target_plan_id,
        )?.name ?? null)
      : null;
  const changeError = modify.error ?? fileReq.error ?? withdrawReq.error;

  // Once we've been waiting past the cutoff with nothing recorded, switch
  // the copy from "any second now" to an honest "delayed" state. Polling
  // keeps running underneath, so it still self-heals if the gym resends
  // the event or puts the member on the plan. The 4s poll re-renders this
  // component, which is what trips the timer over.
  const pollStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (awaitingActivation) {
      if (pollStartRef.current === null) pollStartRef.current = Date.now();
    } else {
      pollStartRef.current = null;
    }
  }, [awaitingActivation]);
  const stuck =
    awaitingActivation &&
    pollStartRef.current !== null &&
    Date.now() - pollStartRef.current > STUCK_AFTER_MS;

  useEffect(() => {
    if (
      currentSubs.length > 0 &&
      stagedClass.data &&
      !autoBookTried.current &&
      !bookFirst.isPending
    ) {
      autoBookTried.current = true;
      bookFirst.mutate(stagedClass.data);
    }
  }, [currentSubs.length, stagedClass.data, bookFirst]);

  // Carry the "just checked out" intent across a refresh / nav to Account
  // via a short-lived marker, and retire it once the subscription lands.
  useEffect(() => {
    if (justCheckedOut && gymId) markPendingCheckout(gymId);
  }, [justCheckedOut, gymId]);
  useEffect(() => {
    if (currentSubs.length > 0 && gymId) clearPendingCheckout(gymId);
  }, [currentSubs.length, gymId]);

  // Reading the notice is what marks it read — so this waits for the notice
  // to actually be on screen. Marking on mount regardless meant the final
  // notice was consumed by a screen that showed nothing about it, since
  // PaymentFailedNotice used to live inside a card that only renders for a
  // current subscription.
  const markedPaymentRead = useRef(false);
  useEffect(() => {
    if (!gymId || !failingSub || markedPaymentRead.current) return;
    markedPaymentRead.current = true;
    supabase
      .rpc('mark_payment_notifications_read', { p_gym_id: gymId })
      .then(() => {
        queryClientRef.invalidateQueries({ queryKey: ['payment-notifications'] });
        queryClientRef.invalidateQueries({ queryKey: ['inbox-unread-summary'] });
      });
  }, [gymId, failingSub, queryClientRef]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/account" />

        {failingSub ? <PaymentFailedNotice sub={failingSub} /> : null}

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

        {firstClassResult ? (
          firstClassResult.ok ? (
            <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
              <Text className="text-emerald-700 dark:text-emerald-300 text-sm">
                You're booked into {firstClassResult.name} on{' '}
                {new Date(firstClassResult.starts_at).toLocaleString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                — see you there.
              </Text>
            </View>
          ) : (
            <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 gap-2">
              <Text className="text-amber-800 dark:text-amber-300 text-sm">
                We couldn't book {firstClassResult.name} automatically
                {firstClassResult.detail ? ` — ${firstClassResult.detail}` : ''}. Pick
                any class that suits you instead.
              </Text>
              <ChipButton
                label="Open booking"
                icon="calendar-outline"
                tone="amber"
                onPress={() => router.push('/book' as never)}
              />
            </View>
          )
        ) : null}

        {agreedPlan.data && currentSubs.length === 0 && !awaitingActivation ? (
          <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 gap-3">
            <Text className="text-amber-800 dark:text-amber-300 text-sm">
              You picked{' '}
              <Text className="font-semibold">{agreedPlan.data.plan_name}</Text>{' '}
              with {membership?.gymName ?? 'the gym'}'s assistant — finish
              setting it up here.
            </Text>
            {canSelfCheckout ? (
              <Button
                icon="card-outline"
                loading={
                  checkout.isPending &&
                  checkout.variables === agreedPlan.data.plan_id
                }
                onPress={() => checkout.mutate(agreedPlan.data!.plan_id)}>
                Pay for {agreedPlan.data.plan_name}
              </Button>
            ) : (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Ask at the front desk to finish setting up your plan.
              </Text>
            )}
            <ChipButton
              label="Not now"
              icon="close-outline"
              tone="neutral"
              onPress={() => clearAgreed.mutate()}
            />
          </View>
        ) : null}

        {currentSubs.length > 0 ? (
          <View className="gap-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Your membership
            </Text>
            {currentSubs.map((s) => (
              <CurrentSubCard
                key={s.id}
                sub={s}
                continuingBilling={
                  checkout.isPending &&
                  typeof checkout.variables === 'object' &&
                  checkout.variables?.legacySubscriptionId === s.id
                }
                onContinueBilling={
                  s.imported_legacy
                    ? () =>
                        checkout.mutate({
                          planId: s.plan_id,
                          legacySubscriptionId: s.id,
                        })
                    : undefined
                }
              />
            ))}
            {recurringSub ? (
              <MembershipActions
                sub={recurringSub}
                cancelPolicy={policies.data?.cancel ?? 'request'}
                pending={pendingForSub}
                pendingTargetName={pendingTargetName}
                modify={modify}
                file={fileReq}
                withdraw={withdrawReq}
              />
            ) : null}
            {changeError ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {errorMessage(changeError, 'Could not update your membership')}
              </Text>
            ) : null}
            {params.book ? (
              <Button
                icon="arrow-forward"
                onPress={() => router.push(`/book?session=${params.book}`)}>
                Continue booking your class
              </Button>
            ) : null}
          </View>
        ) : awaitingActivation ? (
          <PendingMembershipCard
            stuck={stuck}
            gymName={membership?.gymName ?? ''}
            onRetry={() => {
              pollStartRef.current = Date.now();
              subs.refetch();
            }}
          />
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
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
                          {plan.name}
                        </Text>
                        {agreedPlan.data?.plan_id === plan.plan_id ? (
                          <View className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5">
                            <Text className="text-amber-700 dark:text-amber-300 text-xs font-semibold">
                              Your pick
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text className="text-gray-500 dark:text-gray-400 text-sm">
                        {planKindLabel(plan)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
                        {planPriceLabel(plan, currency)}
                      </Text>
                      {plan.notice_period_days ? (
                        <Text className="text-gray-400 dark:text-gray-500 text-xs">
                          {plan.notice_period_days}-day notice
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  {(() => {
                    if (isCurrent) {
                      return (
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
                      );
                    }
                    if (awaitingActivation) {
                      return (
                        <Text className="text-gray-400 dark:text-gray-500 text-xs">
                          Setting up your membership…
                        </Text>
                      );
                    }
                    // Class packs are one-off — always a fresh purchase.
                    if (plan.kind === 'credit_pack') {
                      return canSelfCheckout ? (
                        <Button
                          onPress={() => checkout.mutate(plan.plan_id)}
                          loading={busy}
                          icon="card-outline">
                          Buy pack
                        </Button>
                      ) : null;
                    }
                    // Recurring plan + an existing membership = switch in place
                    // (no second subscription), governed by the gym's policy.
                    if (recurringSub) {
                      if (recurringSub.imported_legacy) {
                        return (
                          <Text className="text-gray-400 dark:text-gray-500 text-xs">
                            Add a payment method to your current plan above
                            before switching.
                          </Text>
                        );
                      }
                      if (pendingForSub) {
                        return (
                          <Text className="text-gray-400 dark:text-gray-500 text-xs">
                            Resolve your pending change first.
                          </Text>
                        );
                      }
                      const currentPrice =
                        recurringSub.price_cents ??
                        recurringSub.membership_plans?.monthly_price_cents ??
                        0;
                      const targetPrice = plan.monthly_price_cents ?? 0;
                      const isUpgrade = targetPrice > currentPrice;
                      const pol = isUpgrade
                        ? (policies.data?.upgrade ?? 'request')
                        : (policies.data?.downgrade ?? 'request');
                      if (pol === 'self_serve') {
                        const switching =
                          modify.isPending &&
                          modify.variables?.targetPlanId === plan.plan_id;
                        return (
                          <Button
                            icon="swap-horizontal-outline"
                            loading={switching}
                            onPress={() =>
                              modify.mutate({
                                planSubscriptionId: recurringSub.id,
                                kind: 'switch_plan',
                                targetPlanId: plan.plan_id,
                              })
                            }>
                            {isUpgrade
                              ? 'Upgrade to this plan'
                              : 'Switch to this plan'}
                          </Button>
                        );
                      }
                      const requesting =
                        fileReq.isPending &&
                        fileReq.variables?.targetPlanId === plan.plan_id;
                      return (
                        <Button
                          variant="secondary"
                          icon="mail-outline"
                          loading={requesting}
                          onPress={() =>
                            fileReq.mutate({
                              planSubscriptionId: recurringSub.id,
                              kind: 'switch_plan',
                              targetPlanId: plan.plan_id,
                            })
                          }>
                          Request this plan
                        </Button>
                      );
                    }
                    // No membership yet — start one.
                    return canSelfCheckout ? (
                      <Button
                        onPress={() => checkout.mutate(plan.plan_id)}
                        loading={busy}
                        icon="card-outline">
                        Subscribe
                      </Button>
                    ) : null;
                  })()}
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

        {(invoices.data?.length ?? 0) > 0 ? (
          <View className="gap-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Payment history
            </Text>
            {(invoices.data ?? []).map((inv) => (
              <InvoiceRow key={inv.provider_event_id} inv={inv} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
