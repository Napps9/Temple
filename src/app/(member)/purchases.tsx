import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { View } from 'react-native';
import { PageScroll } from '@/components/PageScroll';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { FieldLabel, SectionLabel } from '@/components/SectionLabel';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatMoney } from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import {
  intervalSuffix,
  useCancelStoreSubscription,
  useMyStoreOrders,
  useMyStoreSubscriptions,
  useStoreDownload,
  useUpdateStoreSubscriptionShipping,
  type MyStoreOrder,
  type MyStoreSubscription,
} from '@/lib/store';
import { useThemeColors } from '@/lib/theme';

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Awaiting payment', tone: 'text-amber-600 dark:text-amber-400' },
  paid: { label: 'Paid', tone: 'text-blue-600 dark:text-blue-400' },
  fulfilled: { label: 'Complete', tone: 'text-green-600 dark:text-green-400' },
  cancelled: { label: 'Cancelled', tone: 'text-ink-2 dark:text-ink-2-dk' },
  refunded: { label: 'Refunded', tone: 'text-ink-2 dark:text-ink-2-dk' },
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
      <PageScroll contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/store" />
        <PageHead
          title="Purchases"
          subtitle="Your subscriptions, orders and downloads."
        />

        {subRows.length > 0 ? (
          <View className="gap-2">
            <SectionLabel>
              Subscriptions
            </SectionLabel>
            {subRows.map((s) => (
              <SubscriptionCard key={s.id} sub={s} />
            ))}
          </View>
        ) : null}

        {orders.isLoading ? (
          <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
        ) : rows.length === 0 ? (
          subRows.length === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk">
              You haven't bought anything yet.
            </Text>
          ) : null
        ) : (
          <View className="gap-2">
            {subRows.length > 0 ? <SectionLabel>Orders</SectionLabel> : null}
            {rows.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </View>
        )}
      </PageScroll>
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
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            {sub.name_snapshot}
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs mt-0.5">
            {priceLabel}
          </Text>
        </View>
        <Text
          className={`text-xs font-semibold ${
            ended
              ? 'text-ink-2 dark:text-ink-2-dk'
              : sub.cancel_at_period_end
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-green-600 dark:text-green-400'
          }`}>
          {ended ? 'Ended' : sub.cancel_at_period_end ? 'Cancelling' : 'Active'}
        </Text>
      </View>

      {renews && !ended ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {sub.cancel_at_period_end
            ? `Access until ${renews}`
            : `Renews ${renews}`}
        </Text>
      ) : null}

      {sub.kind_snapshot === 'physical' ? (
        <ShippingSection sub={sub} disabled={ended} />
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

const ADDRESS_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'line1', label: 'Address line 1', placeholder: '1 High Street' },
  { key: 'line2', label: 'Address line 2 (optional)', placeholder: 'Flat 2' },
  { key: 'city', label: 'City', placeholder: 'London' },
  { key: 'postal_code', label: 'Postcode', placeholder: 'SW1A 1AA' },
  { key: 'country', label: 'Country', placeholder: 'GB' },
];

function formatAddress(
  name: string | null,
  addr: Record<string, string> | null,
): string {
  const parts = [
    name,
    addr?.line1,
    addr?.line2,
    addr?.city,
    addr?.postal_code,
    addr?.country,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No delivery address yet';
}

// The delivery address for a box subscription — shown read-only, editable
// inline. A saved change applies from the next cycle's order.
function ShippingSection({
  sub,
  disabled,
}: {
  sub: MyStoreSubscription;
  disabled: boolean;
}) {
  const { data: membership } = useGymMembership();
  const update = useUpdateStoreSubscriptionShipping(membership?.gymId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sub.shipping_name ?? '');
  const [addr, setAddr] = useState<Record<string, string>>(
    sub.shipping_address ?? {},
  );

  if (!editing) {
    return (
      <View className="border-t border-line dark:border-line-dk pt-2 mt-1 gap-1.5">
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          Ships to: {formatAddress(sub.shipping_name, sub.shipping_address)}
        </Text>
        {!disabled ? (
          <ChipButton
            tone="neutral"
            className="self-start"
            label="Edit delivery address"
            icon="location-outline"
            onPress={() => {
              setName(sub.shipping_name ?? '');
              setAddr(sub.shipping_address ?? {});
              setEditing(true);
            }}
          />
        ) : null}
      </View>
    );
  }

  // Enough to actually ship a box — a lone street line isn't.
  const canSave =
    (addr.line1 ?? '').trim().length > 0 &&
    (addr.city ?? '').trim().length > 0 &&
    (addr.postal_code ?? '').trim().length > 0;
  const save = () => {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(addr)) {
      const t = (v ?? '').trim();
      if (t) cleaned[k] = t;
    }
    update.mutate(
      { subscriptionId: sub.id, name, address: cleaned },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <View className="border-t border-line dark:border-line-dk pt-3 mt-1 gap-3">
      <Input label="Name" value={name} onChangeText={setName} placeholder="Full name" />
      {ADDRESS_FIELDS.map((f) => (
        <Input
          key={f.key}
          label={f.label}
          value={addr[f.key] ?? ''}
          onChangeText={(v) => setAddr((cur) => ({ ...cur, [f.key]: v }))}
          placeholder={f.placeholder}
        />
      ))}
      {update.error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">
          {errorMessage(update.error, 'Could not save the address')}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button onPress={save} loading={update.isPending} disabled={!canSave}>
            Save address
          </Button>
        </View>
        <Button variant="ghost" onPress={() => setEditing(false)}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

function OrderCard({ order }: { order: MyStoreOrder }) {
  const colors = useThemeColors();
  const download = useStoreDownload();
  const status = STATUS_LABEL[order.status] ?? STATUS_LABEL.paid;

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
            <Text className="text-ink-2 dark:text-ink-dk text-sm">
              {it.quantity}× {it.name_snapshot}
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {formatMoney(it.line_total_cents, order.currency)}
            </Text>
          </View>
        ))}
      </View>

      <View className="flex-row justify-between border-t border-line dark:border-line-dk pt-2">
        <Text className="text-ink dark:text-ink-dk font-semibold">Total</Text>
        <Text className="text-ink dark:text-ink-dk font-semibold">
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
          <Ionicons name="cube-outline" size={14} color={colors.ink3} />
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Being prepared for shipping.
          </Text>
        </View>
      ) : null}

      {order.tracking_note ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs mt-1">
          Tracking: {order.tracking_note}
        </Text>
      ) : null}
    </View>
  );
}
