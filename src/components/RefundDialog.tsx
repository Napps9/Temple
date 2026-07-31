import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/coach-earnings';
import { computeRefund, type PlanKind, type RefundMode } from '@/lib/refunds';
import { supabase } from '@/lib/supabase';
import { currencySymbol } from '@/lib/setup-flow';
import { useGymCurrency } from '@/lib/useGymCurrency';

type RefundSub = {
  id: string;
  planName: string;
  planKind: string;
  creditBalance: number | null;
  creditCount: number | null;
  paidPeriodEnd: string | null;
};

const MODES: { mode: RefundMode; title: string; blurb: string }[] = [
  {
    mode: 'prorata_revoke',
    title: 'Refund the unused part & end now',
    blurb: 'Give back what they haven’t used, cut access immediately, stop renewals.',
  },
  {
    mode: 'full_period_end',
    title: 'Full refund, keep access to period end',
    blurb: 'Refund in full but let them finish the period they paid for, then it ends.',
  },
  {
    mode: 'full_revoke',
    title: 'Full refund & end now',
    blurb: 'Refund in full and cut access immediately.',
  },
  {
    mode: 'keep',
    title: 'Refund & keep access',
    blurb: 'Goodwill — money back, membership and renewals carry on unchanged.',
  },
];

export function RefundDialog({
  visible,
  onClose,
  sub,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  sub: RefundSub;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const gymCurrency = useGymCurrency();
  const [selected, setSelected] = useState<RefundMode>('prorata_revoke');
  const [customMajor, setCustomMajor] = useState('');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The payment we'd refund against — the most recent settled charge for
  // this subscription. Its amount is the basis for every preview; the edge
  // function recomputes server-side, so this is a display estimate.
  const charge = useQuery({
    queryKey: ['refund-source-charge', sub.id],
    enabled: visible,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('billing_events')
        .select('amount_cents, currency, occurred_at')
        .eq('plan_subscription_id', sub.id)
        .in('kind', ['checkout', 'invoice'])
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (e) throw e;
      return data as {
        amount_cents: number;
        currency: string | null;
        occurred_at: string;
      } | null;
    },
  });

  // A refund is denominated in whatever the charge was taken in, not in
  // whatever the gym bills in today. They are almost always the same and
  // the one time they are not is the time the number has to be right.
  const currency = charge.data?.currency?.toUpperCase() ?? gymCurrency;
  const money = (cents: number) => formatMoney(cents, currency);

  const now = new Date().toISOString();
  const ent = charge.data
    ? {
        planKind: sub.planKind as PlanKind,
        chargeCents: charge.data.amount_cents,
        periodStart: charge.data.occurred_at,
        periodEnd: sub.paidPeriodEnd,
        creditsTotal: sub.creditCount,
        creditsRemaining: sub.creditBalance,
      }
    : null;

  const customCents =
    customMajor.trim() === '' ? null : Math.round(parseFloat(customMajor) * 100);

  function previewCents(mode: RefundMode): number | null {
    if (!ent) return null;
    return computeRefund(ent, mode, now, mode === 'keep' ? customCents : null).refundCents;
  }

  const refund = useMutation({
    mutationFn: async () => {
      const { data, error: e } = await supabase.functions.invoke('stripe-refund', {
        body: {
          plan_subscription_id: sub.id,
          mode: selected,
          custom_cents: selected === 'keep' ? customCents : null,
          notify_member: notify,
        },
      });
      if (e) {
        const ctx = (e as { context?: Response }).context;
        let msg = e.message;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const b = await ctx.json();
            if (b?.error) msg = String(b.error);
          } catch {
            // keep generic
          }
        }
        throw new Error(msg);
      }
      return data as { ok: boolean; refund_cents: number };
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['member-detail-subs'] });
      queryClient.invalidateQueries({ queryKey: ['member-detail-refunds'] });
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e, 'Could not process the refund')),
  });

  const selectedCents = previewCents(selected);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-center px-4">
        <View className="bg-white dark:bg-gray-900 rounded-2xl p-5 gap-3 max-w-lg md:max-w-2xl w-full self-center">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Refund {sub.planName}
          </Text>

          {charge.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading payment…</Text>
          ) : !charge.data ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No settled payment found for this plan, so there’s nothing to refund.
            </Text>
          ) : (
            <>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                Last payment {money(charge.data.amount_cents)}. Pick what happens:
              </Text>
              <View className="gap-2">
                {MODES.map((m) => {
                  const on = selected === m.mode;
                  const cents = previewCents(m.mode);
                  return (
                    <Pressable
                      key={m.mode}
                      onPress={() => setSelected(m.mode)}
                      className={`rounded-xl border p-3 gap-0.5 ${
                        on
                          ? 'border-primary bg-primary/5'
                          : 'border-gray-200 dark:border-gray-700'
                      }`}>
                      <View className="flex-row items-center justify-between gap-2">
                        <Text
                          className={`flex-1 text-sm font-medium ${
                            on ? 'text-primary' : 'text-gray-900 dark:text-gray-50'
                          }`}>
                          {m.title}
                        </Text>
                        <Text
                          className={`text-sm font-semibold ${
                            on ? 'text-primary' : 'text-gray-700 dark:text-gray-200'
                          }`}>
                          {cents !== null ? money(cents) : '—'}
                        </Text>
                      </View>
                      <Text className="text-gray-500 dark:text-gray-400 text-xs">
                        {m.blurb}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {selected === 'keep' ? (
                <View className="gap-1">
                  <Text className="text-gray-700 dark:text-gray-200 text-xs">
                    Amount to refund ({currencySymbol(currency)}) — leave blank for the full{' '}
                    {money(charge.data.amount_cents)}
                  </Text>
                  <TextInput
                    value={customMajor}
                    onChangeText={setCustomMajor}
                    keyboardType="decimal-pad"
                    placeholder={(charge.data.amount_cents / 100).toFixed(2)}
                    placeholderTextColor="#9CA3AF"
                    className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-50 text-base"
                  />
                </View>
              ) : null}

              <View className="flex-row items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2.5">
                <View className="flex-1">
                  <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
                    Email the member
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    Send a note telling them they’ve been refunded and what
                    happens to their access.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Email the member about this refund"
                  value={notify}
                  onValueChange={setNotify}
                />
              </View>

              {error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
              ) : null}

              <View className="flex-row gap-2 pt-1">
                <View className="flex-1">
                  <Button variant="secondary" onPress={onClose}>
                    Cancel
                  </Button>
                </View>
                <View className="flex-1">
                  <Button
                    variant="destructive"
                    onPress={() => refund.mutate()}
                    loading={refund.isPending}
                    disabled={!ent || selectedCents === null}>
                    {selectedCents !== null ? `Refund ${money(selectedCents)}` : 'Refund'}
                  </Button>
                </View>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
