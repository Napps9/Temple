import { Ionicons } from '@expo/vector-icons';
import { ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { ChipButton } from '@/components/ChipButton';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatMoney } from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import {
  intervalSuffix,
  useCancelStoreSubscription,
  useMyStoreOrders,
  useMyStoreSubscriptions,
  useStoreDownload,
  type MyStoreOrder,
  type MyStoreSubscription,
} from '@/lib/store';

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Awaiting payment', tone: 'text-amber-600 dark:text-amber-400' },
  paid: { label: 'Paid', tone: 'text-blue-600 dark:text-blue-400' },
  fulfilled: { label: 'Complete', tone: 'text-green-600 dark:text-green-400' },
  cancelled: { label: 'Cancelled', tone: 'text-gray-500 dark:text-gray-400' },
  refunded: { label: 'Refunded', tone: 'text-gray-500 dark:text-gray-400' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function PurchasesScreen() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const orders = useMyStoreOrders(membership?.gymId, session?.user.id, {
    pollForPaid: true,
  });
  const subs = useMyStoreSubscriptions(membership?.gymId, session?.user.id, {
    pollForActive: true,
  });

  const rows = orders.data ?? [];
  const subRows = subs.data ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Store" fallbackHref="/store" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Purchases
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Your subscriptions, orders and downloads.
          </Text>
        </View>

        {subRows.length > 0 ? (
          <View className="gap-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Subscriptions
            </Text>
            {subRows.map((s) => (
              <SubscriptionCard key={s.id} sub={s} />
            ))}
          </View>
        ) : null}

        {orders.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : rows.length === 0 ? (
          subRows.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400">
              You haven't bought anything yet.
            </Text>
          ) : null
        ) : (
          <View className="gap-2">
            {subRows.length > 0 ? (
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                Orders
              </Text>
            ) : null}
            {rows.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function SubscriptionCard({ sub }: { sub: MyStoreSubscription }) {
  const { data: membership } = useGymMembership();
  const cancel = useCancelStoreSubscription(membership?.gymId);
  const priceLabel = `${formatMoney(sub.unit_price_cents, sub.currency)}${intervalSuffix(
    sub.interval,
  )}`;
  const ended = sub.status === 'cancelled';
  const renews = sub.current_period_end ? formatDate(sub.current_period_end) : null;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 shadow-card">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {sub.name_snapshot}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
            {priceLabel}
          </Text>
        </View>
        <Text
          className={`text-xs font-semibold ${
            ended
              ? 'text-gray-500 dark:text-gray-400'
              : sub.cancel_at_period_end
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-green-600 dark:text-green-400'
          }`}>
          {ended ? 'Ended' : sub.cancel_at_period_end ? 'Cancelling' : 'Active'}
        </Text>
      </View>

      {renews && !ended ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {sub.cancel_at_period_end
            ? `Access until ${renews}`
            : `Renews ${renews}`}
        </Text>
      ) : null}

      {!ended && !sub.cancel_at_period_end ? (
        <ChipButton
          tone="red"
          className="self-start mt-1"
          label={cancel.isPending ? 'Cancelling…' : 'Cancel subscription'}
          icon="close-circle-outline"
          onPress={() => cancel.mutate(sub.id)}
          disabled={cancel.isPending}
        />
      ) : null}
      {cancel.error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">
          {errorMessage(cancel.error, 'Could not cancel')}
        </Text>
      ) : null}
    </View>
  );
}

function OrderCard({ order }: { order: MyStoreOrder }) {
  const download = useStoreDownload();
  const status = STATUS_LABEL[order.status] ?? STATUS_LABEL.paid;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 shadow-card">
      <View className="flex-row items-center justify-between">
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {formatDate(order.created_at)}
        </Text>
        <Text className={`text-xs font-semibold ${status.tone}`}>
          {order.has_physical && order.status === 'fulfilled'
            ? 'Shipped'
            : status.label}
        </Text>
      </View>

      <View className="gap-0.5">
        {order.items.map((it, i) => (
          <View key={i} className="flex-row justify-between">
            <Text className="text-gray-800 dark:text-gray-100 text-sm">
              {it.quantity}× {it.name_snapshot}
            </Text>
            <Text className="text-gray-600 dark:text-gray-300 text-sm">
              {formatMoney(it.line_total_cents, order.currency)}
            </Text>
          </View>
        ))}
      </View>

      <View className="flex-row justify-between border-t border-gray-100 dark:border-gray-800 pt-2">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">Total</Text>
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">
          {formatMoney(order.total_cents, order.currency)}
        </Text>
      </View>

      {order.downloads.length > 0 ? (
        <View className="gap-2 mt-1">
          {order.downloads.map((d, i) => (
            <ChipButton
              key={i}
              tone="primary"
              className="self-start"
              label={`Download ${d.name}`}
              icon="cloud-download-outline"
              onPress={() => download.mutate(d.asset_path)}
              disabled={download.isPending}
            />
          ))}
          {download.error ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">
              {errorMessage(download.error, 'Could not open the download')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {order.has_physical && order.status === 'paid' ? (
        <View className="flex-row items-center gap-1.5 mt-1">
          <Ionicons name="cube-outline" size={14} color="#9CA3AF" />
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Being prepared for shipping.
          </Text>
        </View>
      ) : null}

      {order.tracking_note ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          Tracking: {order.tracking_note}
        </Text>
      ) : null}
    </View>
  );
}
