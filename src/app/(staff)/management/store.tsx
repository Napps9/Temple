import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Redirect } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { formatMoney } from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import {
  formatPriceInput,
  intervalSuffix,
  parsePriceToCents,
  productSoldOut,
  useAdminStoreProducts,
  useCancelStoreSubscription,
  useGymStoreConfig,
  useStaffStoreOrders,
  useStaffStoreSubscriptions,
  useStoreRevenue,
  type AdminProduct,
  type StaffOrder,
  type StaffSubscription,
} from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type Tab = 'products' | 'orders' | 'subscriptions' | 'settings';

const randomSuffix = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function StoreManageScreen() {
  const canManageStore = useCan('can_manage_store');
  const [tab, setTab] = useState<Tab>('products');

  if (canManageStore === false) return <Redirect href="/management" />;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Store
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Sell merch, programmes and tickets to your members.
          </Text>
        </View>

        <View className="flex-row gap-2">
          {(['products', 'orders', 'subscriptions', 'settings'] as Tab[]).map((t) => {
            const selected = t === tab;
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                className={`px-4 py-2 rounded-full ${
                  selected ? 'bg-primary' : 'bg-slate-200 dark:bg-gray-800'
                }`}>
                <Text
                  className={`text-sm font-medium capitalize ${
                    selected ? 'text-white' : 'text-gray-700 dark:text-gray-200'
                  }`}>
                  {t}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'products' ? (
          <ProductsTab />
        ) : tab === 'orders' ? (
          <OrdersTab />
        ) : tab === 'subscriptions' ? (
          <SubscriptionsTab />
        ) : (
          <SettingsTab />
        )}
      </ScrollView>
    </Screen>
  );
}

// ── Products ────────────────────────────────────────────────────────────

type Draft = {
  id?: string;
  name: string;
  description: string;
  kind: 'physical' | 'digital';
  price: string;
  image_url: string | null;
  track_inventory: boolean;
  stock: string;
  digital_asset_path: string | null;
  digital_asset_name: string | null;
  active: boolean;
  recurring: boolean;
};

function blankDraft(): Draft {
  return {
    name: '',
    description: '',
    kind: 'physical',
    price: '',
    image_url: null,
    track_inventory: true,
    stock: '0',
    digital_asset_path: null,
    digital_asset_name: null,
    active: true,
    recurring: false,
  };
}

function draftFrom(p: AdminProduct): Draft {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    kind: p.kind,
    price: formatPriceInput(p.price_cents),
    image_url: p.image_url,
    track_inventory: p.track_inventory,
    stock: p.stock_quantity != null ? String(p.stock_quantity) : '0',
    digital_asset_path: p.digital_asset_path,
    digital_asset_name: p.digital_asset_path
      ? p.digital_asset_path.split('/').pop() ?? 'file'
      : null,
    active: p.active,
    recurring: p.recurring,
  };
}

function ProductsTab() {
  const { data: membership } = useGymMembership();
  const products = useAdminStoreProducts(membership?.gymId);
  const config = useGymStoreConfig(membership?.gymId);
  const [editing, setEditing] = useState<Draft | null>(null);

  const currency = config.data?.currency ?? 'GBP';

  if (editing) {
    return (
      <ProductEditor
        draft={editing}
        currency={currency}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <View className="gap-3">
      {!config.data?.store_enabled ? (
        <View className="bg-amber-50 dark:bg-amber-950/40 rounded-xl p-3">
          <Text className="text-amber-800 dark:text-amber-300 text-sm">
            The store is switched off, so members can't see it yet. Turn it on
            under Settings.
          </Text>
        </View>
      ) : null}

      <Button icon="add" onPress={() => setEditing(blankDraft())}>
        Add product
      </Button>

      {products.isLoading ? (
        <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
      ) : (products.data ?? []).length === 0 ? (
        <Text className="text-gray-500 dark:text-gray-400">
          No products yet. Add your first one above.
        </Text>
      ) : (
        (products.data ?? []).map((p) => (
          <Pressable
            key={p.id}
            onPress={() => setEditing(draftFrom(p))}
            className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3 shadow-card active:opacity-70">
            {p.image_url ? (
              <Image
                source={{ uri: p.image_url }}
                className="w-12 h-12 rounded-lg"
              />
            ) : (
              <View className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
                <Ionicons
                  name={p.kind === 'digital' ? 'cloud-download-outline' : 'cube-outline'}
                  size={20}
                  color="#9CA3AF"
                />
              </View>
            )}
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                {p.name}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {formatMoney(p.price_cents, currency)}
                {p.recurring ? '/mo' : ''} ·{' '}
                {p.recurring
                  ? 'Subscription'
                  : p.kind === 'digital'
                    ? 'Digital'
                    : 'Physical'}
                {!p.recurring && p.track_inventory
                  ? ` · ${p.stock_quantity ?? 0} in stock`
                  : ''}
                {!p.active ? ' · Hidden' : ''}
              </Text>
            </View>
            {productSoldOut(p) ? (
              <View className="px-2 py-1 rounded-full bg-red-100 dark:bg-red-950/50">
                <Text className="text-red-600 dark:text-red-400 text-xs font-semibold">
                  Sold out
                </Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            )}
          </Pressable>
        ))
      )}
    </View>
  );
}

function ProductEditor({
  draft,
  currency,
  onClose,
}: {
  draft: Draft;
  currency: string;
  onClose: () => void;
}) {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const queryClient = useQueryClient();
  const gymId = membership?.gymId;
  const [d, setD] = useState<Draft>(draft);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-store-products', gymId] });
    queryClient.invalidateQueries({ queryKey: ['store-products', gymId] });
  };

  const pickImage = useMutation({
    mutationFn: async () => {
      if (!gymId) throw new Error('No gym');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error('Photo library permission denied');
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (res.canceled || res.assets.length === 0) return;
      const asset = res.assets[0];
      const blob = await (await fetch(asset.uri)).blob();
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${gymId}/images/${randomSuffix()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('store-product-images')
        .upload(path, blob, { contentType: asset.mimeType ?? `image/${ext}` });
      if (upErr) throw upErr;
      const { data } = supabase.storage
        .from('store-product-images')
        .getPublicUrl(path);
      set({ image_url: data.publicUrl });
    },
    onError: (e) => setError(errorMessage(e, 'Could not upload image')),
  });

  const pickAsset = useMutation({
    mutationFn: async () => {
      if (!gymId) throw new Error('No gym');
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
      });
      if (res.canceled || res.assets.length === 0) return;
      const file = res.assets[0];
      const blob = await (await fetch(file.uri)).blob();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const path = `${gymId}/digital/${randomSuffix()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('store-digital-assets')
        .upload(path, blob, {
          contentType: file.mimeType ?? 'application/octet-stream',
        });
      if (upErr) throw upErr;
      set({ digital_asset_path: path, digital_asset_name: file.name });
    },
    onError: (e) => setError(errorMessage(e, 'Could not upload file')),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!gymId || !session?.user.id) throw new Error('No gym');
      const name = d.name.trim();
      if (!name) throw new Error('Give the product a name');
      const priceCents = parsePriceToCents(d.price);
      if (priceCents == null) throw new Error('Enter a valid price');

      // Recurring products are untracked (no per-purchase stock); a recurring
      // physical good is a subscription box shipped each cycle.
      const recurring = d.recurring;
      const kind = d.kind;
      const tracks = recurring ? false : d.track_inventory;
      let stock: number | null = null;
      if (tracks) {
        const n = Number.parseInt(d.stock, 10);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error('Stock must be a non-negative whole number');
        }
        stock = n;
      }
      // A one-off digital good must carry its file; a recurring one may be a
      // service with no download (e.g. a locker rental).
      if (kind === 'digital' && !recurring && !d.digital_asset_path) {
        throw new Error('Upload the file members will download');
      }

      const fields = {
        name,
        description: d.description.trim() || null,
        kind,
        price_cents: priceCents,
        image_url: d.image_url,
        track_inventory: tracks,
        stock_quantity: stock,
        digital_asset_path: kind === 'digital' ? d.digital_asset_path : null,
        active: d.active,
        recurring,
        recurring_interval: recurring ? 'month' : null,
      };

      if (d.id) {
        const { error } = await supabase
          .from('store_products')
          .update({
            ...fields,
            // Drop the cached Stripe price so a price edit takes effect for
            // new subscribers (Stripe prices are immutable; existing
            // subscribers stay on the price they signed up at).
            ...(recurring ? { stripe_price_id: null } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', d.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('store_products')
          .insert({ ...fields, gym_id: gymId, created_by: session.user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the product')),
  });

  const archive = useMutation({
    mutationFn: async () => {
      if (!d.id) return;
      const { error } = await supabase
        .from('store_products')
        .update({ archived_at: new Date().toISOString(), active: false })
        .eq('id', d.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (e) => setError(errorMessage(e, 'Could not remove the product')),
  });

  return (
    <View className="gap-4">
      <Pressable
        onPress={onClose}
        className="flex-row items-center gap-1 self-start active:opacity-70">
        <Ionicons name="chevron-back" size={18} color="#6B7280" />
        <Text className="text-gray-600 dark:text-gray-300">All products</Text>
      </Pressable>

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-4">
        <Input
          label="Name"
          value={d.name}
          onChangeText={(v) => set({ name: v })}
          placeholder="Gym water bottle"
        />
        <Input
          label="Description"
          value={d.description}
          onChangeText={(v) => set({ description: v })}
          placeholder="What members are buying"
          multiline
        />

        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">
              Recurring (monthly)
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              A monthly subscription — programming, a locker rental, or a
              shipped box. Members are billed each month until they cancel.
            </Text>
          </View>
          <Switch
            value={d.recurring}
            onValueChange={(v) =>
              set(
                v
                  ? { recurring: true, track_inventory: false }
                  : { recurring: false },
              )
            }
          />
        </View>

        <View className="gap-2">
          <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
            Type
          </Text>
          <View className="flex-row gap-2">
            {(['physical', 'digital'] as const).map((k) => {
              const selected = d.kind === k;
              return (
                <Pressable
                  key={k}
                  onPress={() =>
                    set({
                      kind: k,
                      // Recurring is always untracked; a new one-off digital
                      // good defaults to unlimited stock.
                      track_inventory: d.recurring ? false : k === 'physical',
                    })
                  }
                  className={`flex-1 px-3 py-2 rounded-lg border items-center ${
                    selected
                      ? 'bg-primary border-primary'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
                  }`}>
                  <Text
                    className={`text-sm font-medium ${
                      selected ? 'text-white' : 'text-gray-700 dark:text-gray-200'
                    }`}>
                    {k === 'physical' ? 'Physical' : 'Digital'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            {d.kind === 'physical'
              ? d.recurring
                ? 'A box shipped every month — Stripe collects the address; price it to include shipping.'
                : 'Shipped to the member — Stripe collects their address at checkout.'
              : 'Delivered as a file the member downloads in the app and by email.'}
          </Text>
        </View>

        <Input
          label={d.recurring ? `Price (${currency}) / month` : `Price (${currency})`}
          value={d.price}
          onChangeText={(v) => set({ price: v })}
          keyboardType="decimal-pad"
          placeholder="20"
        />

        {!d.recurring ? (
          <>
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  Track inventory
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {d.kind === 'digital'
                    ? 'On for limited tickets; off for an unlimited download.'
                    : 'Sells out automatically when stock hits zero.'}
                </Text>
              </View>
              <Switch
                value={d.track_inventory}
                onValueChange={(v) => set({ track_inventory: v })}
              />
            </View>

            {d.track_inventory ? (
              <Input
                label="Stock"
                value={d.stock}
                onChangeText={(v) => set({ stock: v })}
                keyboardType="number-pad"
                placeholder="50"
              />
            ) : null}
          </>
        ) : null}

        <View className="gap-2">
          <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
            Photo
          </Text>
          <View className="flex-row items-center gap-3">
            {d.image_url ? (
              <Image
                source={{ uri: d.image_url }}
                className="w-16 h-16 rounded-lg"
              />
            ) : (
              <View className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
                <Ionicons name="image-outline" size={22} color="#9CA3AF" />
              </View>
            )}
            <ChipButton
              tone="neutral"
              label={
                pickImage.isPending
                  ? 'Uploading…'
                  : d.image_url
                    ? 'Change photo'
                    : 'Upload photo'
              }
              icon="camera-outline"
              onPress={() => pickImage.mutate()}
              disabled={pickImage.isPending}
            />
          </View>
        </View>

        {d.kind === 'digital' ? (
          <View className="gap-2">
            <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
              {d.recurring ? 'Download file (optional)' : 'Download file'}
            </Text>
            <View className="flex-row items-center gap-3">
              <Ionicons
                name={d.digital_asset_path ? 'document-text' : 'document-outline'}
                size={22}
                color={d.digital_asset_path ? '#16A34A' : '#9CA3AF'}
              />
              <Text className="flex-1 text-gray-600 dark:text-gray-300 text-sm" numberOfLines={1}>
                {d.digital_asset_name ?? 'No file yet'}
              </Text>
              <ChipButton
                tone="neutral"
                label={pickAsset.isPending ? 'Uploading…' : 'Upload file'}
                icon="cloud-upload-outline"
                onPress={() => pickAsset.mutate()}
                disabled={pickAsset.isPending}
              />
            </View>
          </View>
        ) : null}

        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">
              Visible in store
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Hide to take it off sale without deleting it.
            </Text>
          </View>
          <Switch
            value={d.active}
            onValueChange={(v) => set({ active: v })}
          />
        </View>
      </View>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      <Button onPress={() => save.mutate()} loading={save.isPending}>
        {d.id ? 'Save changes' : 'Add to store'}
      </Button>

      {d.id ? (
        <ChipButton
          tone="red"
          className="self-start"
          label="Remove from store"
          icon="trash-outline"
          onPress={() => archive.mutate()}
          disabled={archive.isPending}
        />
      ) : null}
    </View>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────

function OrdersTab() {
  const { data: membership } = useGymMembership();
  const orders = useStaffStoreOrders(membership?.gymId);

  if (orders.isLoading) {
    return <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>;
  }
  const rows = orders.data ?? [];
  if (rows.length === 0) {
    return (
      <Text className="text-gray-500 dark:text-gray-400">
        No orders yet. They'll show here as members buy.
      </Text>
    );
  }
  return (
    <View className="gap-3">
      {rows.map((o) => (
        <OrderCard key={o.id} order={o} />
      ))}
    </View>
  );
}

// ── Subscriptions ─────────────────────────────────────────────────────────

function formatShortDate(iso: string): string {
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

function SubscriptionsTab() {
  const { data: membership } = useGymMembership();
  const subs = useStaffStoreSubscriptions(membership?.gymId);

  if (subs.isLoading) {
    return <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>;
  }
  const rows = subs.data ?? [];
  if (rows.length === 0) {
    return (
      <Text className="text-gray-500 dark:text-gray-400">
        No subscribers yet. Mark a product as recurring to start selling
        subscriptions.
      </Text>
    );
  }
  return (
    <View className="gap-3">
      {rows.map((s) => (
        <SubscriberCard key={s.id} sub={s} />
      ))}
    </View>
  );
}

function SubscriberCard({ sub }: { sub: StaffSubscription }) {
  const { data: membership } = useGymMembership();
  const cancel = useCancelStoreSubscription(membership?.gymId);
  const priceLabel = `${formatMoney(sub.unit_price_cents, sub.currency)}${intervalSuffix(
    sub.interval,
  )}`;
  const ended = sub.status === 'cancelled';
  const renews = sub.current_period_end
    ? formatShortDate(sub.current_period_end)
    : null;
  const stateLabel = ended
    ? 'Ended'
    : sub.cancel_at_period_end
      ? 'Cancelling'
      : sub.status === 'past_due'
        ? 'Past due'
        : 'Active';
  const stateTone = ended
    ? 'text-gray-500 dark:text-gray-400'
    : sub.cancel_at_period_end || sub.status === 'past_due'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-green-600 dark:text-green-400';

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 shadow-card">
      <View className="flex-row items-center justify-between">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">
          {sub.buyer_name ?? 'Member'}
        </Text>
        <Text className={`text-xs font-semibold ${stateTone}`}>{stateLabel}</Text>
      </View>
      <Text className="text-gray-600 dark:text-gray-300 text-sm">
        {sub.product_name ?? 'Subscription'} · {priceLabel}
      </Text>
      {renews && !ended ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {sub.cancel_at_period_end ? `Ends ${renews}` : `Renews ${renews}`}
        </Text>
      ) : null}
      {!ended && !sub.cancel_at_period_end ? (
        <ChipButton
          tone="red"
          className="self-start mt-1"
          label={cancel.isPending ? 'Cancelling…' : 'Cancel'}
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

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  paid: {
    bg: 'bg-blue-100 dark:bg-blue-950/50',
    text: 'text-blue-700 dark:text-blue-300',
  },
  fulfilled: {
    bg: 'bg-green-100 dark:bg-green-950/50',
    text: 'text-green-700 dark:text-green-300',
  },
  refunded: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-600 dark:text-gray-300',
  },
  cancelled: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-600 dark:text-gray-300',
  },
};

function OrderCard({ order }: { order: StaffOrder }) {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fulfil = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('fulfil_store_order', {
        p_order_id: order.id,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['staff-store-orders', membership?.gymId],
      }),
    onError: (e) => setError(errorMessage(e, 'Could not update the order')),
  });

  const addr = order.shipping_address ?? {};
  const st = STATUS_STYLE[order.status] ?? STATUS_STYLE.refunded;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 shadow-card">
      <View className="flex-row items-center justify-between">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">
          {order.buyer_name ?? 'Member'}
        </Text>
        <View className={`px-2 py-1 rounded-full ${st.bg}`}>
          <Text className={`text-xs font-semibold capitalize ${st.text}`}>
            {order.status}
          </Text>
        </View>
      </View>
      <Text className="text-gray-600 dark:text-gray-300 text-sm">
        {order.items_summary ?? '—'}
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        {formatMoney(order.total_cents, order.currency)}
        {order.shipping_cents > 0
          ? ` (incl. ${formatMoney(order.shipping_cents, order.currency)} shipping)`
          : ''}
      </Text>

      {order.has_physical && (order.shipping_name || addr.line1) ? (
        <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 mt-1">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest mb-1">
            Ship to
          </Text>
          <Text className="text-gray-700 dark:text-gray-200 text-sm">
            {order.shipping_name}
          </Text>
          <Text className="text-gray-600 dark:text-gray-300 text-sm">
            {[addr.line1, addr.line2, addr.city, addr.postal_code, addr.country]
              .filter(Boolean)
              .join(', ')}
          </Text>
        </View>
      ) : null}

      {order.status === 'paid' ? (
        <View className="gap-2 mt-1">
          {order.has_physical ? (
            <Input
              label="Tracking / note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="Royal Mail AB123…"
            />
          ) : null}
          <ChipButton
            tone="primary"
            className="self-start"
            label={
              fulfil.isPending
                ? 'Saving…'
                : order.has_physical
                  ? 'Mark shipped'
                  : 'Mark done'
            }
            icon="checkmark-circle-outline"
            onPress={() => fulfil.mutate()}
            disabled={fulfil.isPending}
          />
        </View>
      ) : order.tracking_note ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          Note: {order.tracking_note}
        </Text>
      ) : null}

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
    </View>
  );
}

// ── Settings ────────────────────────────────────────────────────────────

function SettingsTab() {
  const role = useRole();
  const canSeeRevenue = useCan('can_see_store_revenue') ?? false;

  return (
    <View className="gap-5">
      {role === 'owner' ? <StoreSettingsPanel /> : (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Only an owner can switch the store on or set the shipping fee.
        </Text>
      )}
      {canSeeRevenue ? <RevenuePanel /> : null}
    </View>
  );
}

function StoreSettingsPanel() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const config = useGymStoreConfig(membership?.gymId);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [fee, setFee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currency = config.data?.currency ?? 'GBP';
  const enabledValue = enabled ?? config.data?.store_enabled ?? false;
  const feeValue =
    fee ??
    (config.data ? formatPriceInput(config.data.store_shipping_fee_cents) : '0');

  const save = useMutation({
    mutationFn: async () => {
      if (!membership?.gymId) throw new Error('No gym');
      const feeCents = parsePriceToCents(feeValue);
      if (feeCents == null) throw new Error('Enter a valid shipping fee');
      const { error } = await supabase.rpc('set_store_settings', {
        p_gym_id: membership.gymId,
        p_enabled: enabledValue,
        p_shipping_fee_cents: feeCents,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['store-config', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save settings')),
  });

  if (config.isLoading) {
    return <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>;
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-gray-900 dark:text-gray-50 font-medium">
            Store open
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            When on, members see the Store in their account.
          </Text>
        </View>
        <Switch value={enabledValue} onValueChange={setEnabled} />
      </View>
      <Input
        label={`Shipping fee (${currency})`}
        value={feeValue}
        onChangeText={setFee}
        keyboardType="decimal-pad"
        placeholder="0"
      />
      <Text className="text-gray-400 dark:text-gray-500 text-xs">
        Added once to any order containing a physical item. Leave at 0 for free
        shipping or collection.
      </Text>
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button onPress={() => save.mutate()} loading={save.isPending}>
        Save settings
      </Button>
    </View>
  );
}

function monthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(now) };
}

function RevenuePanel() {
  const { data: membership } = useGymMembership();
  const range = useMemo(monthRange, []);
  const revenue = useStoreRevenue(
    membership?.gymId,
    range.start,
    range.end,
    true,
  );
  const rows = revenue.data ?? [];

  return (
    <View className="gap-2">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        Sales this month
      </Text>
      {revenue.isLoading ? (
        <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
      ) : rows.length === 0 ? (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
          <Text className="text-gray-500 dark:text-gray-400">
            No sales yet this month.
          </Text>
        </View>
      ) : (
        <View className="flex-row gap-3 flex-wrap">
          {rows.map((r) => (
            <View
              key={r.currency}
              className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 flex-1 min-w-[150px]">
              <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
                {formatMoney(r.gross_cents, r.currency)}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {r.order_count} {r.order_count === 1 ? 'order' : 'orders'}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
