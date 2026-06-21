import { Ionicons } from '@expo/vector-icons';
import { ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { ChipButton } from '@/components/ChipButton';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatMoney } from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import {
  useMyStoreOrders,
  useStoreDownload,
  type MyStoreOrder,
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

  const rows = orders.data ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Store" fallbackHref="/store" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Purchases
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Your orders and downloads.
          </Text>
        </View>

        {orders.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : rows.length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400">
            You haven't bought anything yet.
          </Text>
        ) : (
          rows.map((o) => <OrderCard key={o.id} order={o} />)
        )}
      </ScrollView>
    </Screen>
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
