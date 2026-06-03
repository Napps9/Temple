import { useQuery } from '@tanstack/react-query';
import { ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type BillingEvent = {
  provider_event_id: string;
  kind: string;
  amount_cents: number;
  currency: string;
  occurred_at: string;
};

function fmtAmount(cents: number, currency: string): string {
  const amount = cents / 100;
  const sym = currency.toUpperCase() === 'GBP' ? '£'
            : currency.toUpperCase() === 'USD' ? '$'
            : currency.toUpperCase() === 'EUR' ? '€'
            : `${currency.toUpperCase()} `;
  return `${sym}${amount.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const KIND_LABEL: Record<string, string> = {
  'invoice.paid': 'Payment',
  'charge.refunded': 'Refund',
  'customer.subscription.updated': 'Subscription updated',
};

export default function Receipts() {
  const session = useSession();

  const eventsQuery = useQuery({
    queryKey: ['receipts', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<BillingEvent[]> => {
      const { data, error } = await supabase
        .from('billing_events')
        .select('provider_event_id, kind, amount_cents, currency, occurred_at')
        .in('kind', ['invoice.paid', 'charge.refunded'])
        .order('occurred_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as BillingEvent[];
    },
  });

  const events = eventsQuery.data ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Receipts
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Every payment and refund on your account.
          </Text>
        </View>

        {eventsQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : null}

        {!eventsQuery.isLoading && events.length === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400">
              No payments yet.
            </Text>
          </View>
        ) : null}

        {events.map((e) => {
          const isRefund = e.kind === 'charge.refunded';
          return (
            <View
              key={e.provider_event_id}
              className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1">
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  {KIND_LABEL[e.kind] ?? e.kind}
                </Text>
                <Text
                  className={`font-semibold ${
                    isRefund
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-gray-900 dark:text-gray-50'
                  }`}>
                  {isRefund ? '−' : ''}
                  {fmtAmount(e.amount_cents, e.currency)}
                </Text>
              </View>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {fmtDate(e.occurred_at)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
