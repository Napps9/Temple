import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
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
  useMyInvoices,
  useMySubscriptions,
  useStartCheckout,
  type GymPlan,
  type MemberInvoice,
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

function CurrentSubCard({ sub }: { sub: MySubscription }) {
  const plan = sub.membership_plans;
  const kind = plan?.kind ?? 'unlimited';
  const isCredit = kind !== 'unlimited';
  const cancelling = sub.status === 'cancelled_at_period_end';
  // The snapshotted price the member actually pays (grandfathered), falling
  // back to the plan's current price if it predates the snapshot column.
  const priceCents = sub.price_cents ?? plan?.monthly_price_cents ?? null;
  const priceLabel =
    priceCents != null
      ? planPriceLabel({ kind, monthly_price_cents: priceCents })
      : null;
  const notice = plan?.notice_period_days ?? 0;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-gray-200 dark:border-gray-800">
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
  const amount = (cents / 100).toFixed(2);
  const c = currency.toUpperCase();
  const symbol = c === 'GBP' ? '£' : c === 'USD' ? '$' : c === 'EUR' ? '€' : '';
  return symbol ? `${symbol}${amount}` : `${amount} ${c}`;
}

function InvoiceRow({ inv }: { inv: MemberInvoice }) {
  const hasDoc = !!(inv.invoice_url || inv.invoice_pdf);
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-gray-200 dark:border-gray-800">
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
  const invoices = useMyInvoices(gymId, session?.user.id);

  const currentSubs = (subs.data ?? []).filter((s) =>
    CURRENT_SUB_STATUSES.has(s.status),
  );
  const currentPlanIds = new Set(currentSubs.map((s) => s.plan_id));
  const awaitingActivation = awaitingPossible && currentSubs.length === 0;

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
