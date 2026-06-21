import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linking, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import type {
  StoreOrderStatus,
  StoreProductKind,
  StoreSubscriptionStatus,
} from '@/types/database';

// Pure helpers live in their own RN-free module so they unit-test in node;
// re-exported here so '@/lib/store' stays the one import for store code.
export {
  formatPriceInput,
  intervalSuffix,
  parsePriceToCents,
  productSoldOut,
} from '@/lib/store-format';

function checkoutOrigin(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : 'https://app.jointemple.io';
}

// ── Member-facing ───────────────────────────────────────────────────────

export type StoreConfig = {
  store_enabled: boolean;
  store_shipping_fee_cents: number;
  currency: string;
};

export function useGymStoreConfig(gymId: string | undefined) {
  return useQuery({
    queryKey: ['store-config', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<StoreConfig> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('store_enabled, store_shipping_fee_cents, currency')
        .eq('id', gymId!)
        .single();
      if (error) throw error;
      return data as StoreConfig;
    },
  });
}

export type StoreProduct = {
  id: string;
  name: string;
  description: string | null;
  kind: StoreProductKind;
  price_cents: number;
  image_url: string | null;
  track_inventory: boolean;
  stock_quantity: number | null;
  sold_out: boolean;
  recurring: boolean;
  recurring_interval: string | null;
};

// The member catalogue, via the security-definer RPC (hides the asset
// path). Active, non-archived products, newest first.
export function useStoreProducts(gymId: string | undefined) {
  return useQuery({
    queryKey: ['store-products', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<StoreProduct[]> => {
      const { data, error } = await supabase.rpc('list_store_products', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      return (data ?? []) as StoreProduct[];
    },
  });
}

// Opens a Stripe Checkout for a basket and sends the browser to it. Mirrors
// the membership useStartCheckout. mutate([{ product_id, quantity }]).
export function useStartStoreCheckout(gymId: string | undefined) {
  return useMutation({
    mutationFn: async (items: { product_id: string; quantity: number }[]) => {
      if (!gymId) throw new Error('No gym');
      const { data, error } = await supabase.functions.invoke('store-checkout', {
        body: { gym_id: gymId, items, origin: checkoutOrigin() },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const b = await ctx.json();
            if (b?.error) msg = String(b.error);
          } catch {
            // keep generic message
          }
        }
        throw new Error(msg);
      }
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error('Could not start checkout');
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = url;
        return;
      }
      throw new Error('Paying online is only available on the web for now.');
    },
  });
}

export type MyOrderItem = {
  name_snapshot: string;
  kind_snapshot: StoreProductKind;
  quantity: number;
  line_total_cents: number;
};

export type MyOrderDownload = { name: string; asset_path: string };

export type MyStoreOrder = {
  id: string;
  status: StoreOrderStatus;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
  has_physical: boolean;
  tracking_note: string | null;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  items: MyOrderItem[];
  downloads: MyOrderDownload[];
};

// The member's own orders with their lines and digital downloads. Three
// reads (orders / items / deliveries), all self-scoped by RLS, stitched
// client-side. Polls briefly after a checkout so a just-paid order appears
// without a manual reload.
export function useMyStoreOrders(
  gymId: string | undefined,
  profileId: string | undefined,
  opts?: { pollForPaid?: boolean },
) {
  return useQuery({
    queryKey: ['my-store-orders', gymId, profileId],
    enabled: !!gymId && !!profileId,
    refetchInterval: opts?.pollForPaid
      ? (query) => {
          const data = query.state.data as MyStoreOrder[] | undefined;
          // Poll while a just-placed order is still settling — a pending
          // order created in the last few minutes. An older abandoned
          // pending order (a back-out before paying) must not poll forever,
          // and a prior settled order must not stop a new order's poll.
          const settling =
            !!data &&
            data.some(
              (o) =>
                o.status === 'pending' &&
                Date.now() - new Date(o.created_at).getTime() < 5 * 60 * 1000,
            );
          return settling ? 3000 : false;
        }
      : false,
    queryFn: async (): Promise<MyStoreOrder[]> => {
      const { data: orders, error } = await supabase
        .from('store_orders')
        .select(
          'id, status, subtotal_cents, shipping_cents, total_cents, currency, has_physical, tracking_note, created_at, paid_at, fulfilled_at',
        )
        .eq('gym_id', gymId!)
        .eq('profile_id', profileId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const orderIds = (orders ?? []).map((o) => o.id);
      if (orderIds.length === 0) return [];

      const [{ data: items }, { data: deliveries }] = await Promise.all([
        supabase
          .from('store_order_items')
          .select('id, order_id, name_snapshot, kind_snapshot, quantity, line_total_cents')
          .in('order_id', orderIds),
        supabase
          .from('store_digital_deliveries')
          .select('order_item_id, name_snapshot, asset_path')
          .eq('profile_id', profileId!),
      ]);

      const itemToOrder = new Map<string, string>();
      const itemsByOrder = new Map<string, MyOrderItem[]>();
      for (const it of items ?? []) {
        itemToOrder.set(it.id, it.order_id);
        const list = itemsByOrder.get(it.order_id) ?? [];
        list.push(it);
        itemsByOrder.set(it.order_id, list);
      }
      const downloadsByOrder = new Map<string, MyOrderDownload[]>();
      for (const d of deliveries ?? []) {
        const orderId = itemToOrder.get(d.order_item_id);
        if (!orderId) continue;
        const list = downloadsByOrder.get(orderId) ?? [];
        list.push({ name: d.name_snapshot, asset_path: d.asset_path });
        downloadsByOrder.set(orderId, list);
      }

      return (orders ?? []).map((o) => ({
        ...o,
        items: itemsByOrder.get(o.id) ?? [],
        downloads: downloadsByOrder.get(o.id) ?? [],
      })) as MyStoreOrder[];
    },
  });
}

// Mints a short-lived signed URL for a purchased digital asset and opens
// it. The member has storage read on the object via their delivery row.
export function useStoreDownload() {
  return useMutation({
    mutationFn: async (assetPath: string) => {
      const { data, error } = await supabase.storage
        .from('store-digital-assets')
        .createSignedUrl(assetPath, 3600);
      if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? 'Could not prepare the download');
      }
      const url = data.signedUrl;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    },
  });
}

// ── Staff-facing ────────────────────────────────────────────────────────

export type AdminProduct = {
  id: string;
  name: string;
  description: string | null;
  kind: StoreProductKind;
  price_cents: number;
  image_url: string | null;
  track_inventory: boolean;
  stock_quantity: number | null;
  digital_asset_path: string | null;
  active: boolean;
  archived_at: string | null;
  recurring: boolean;
  recurring_interval: string | null;
};

export function useAdminStoreProducts(gymId: string | undefined) {
  return useQuery({
    queryKey: ['admin-store-products', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<AdminProduct[]> => {
      const { data, error } = await supabase
        .from('store_products')
        .select(
          'id, name, description, kind, price_cents, image_url, track_inventory, stock_quantity, digital_asset_path, active, archived_at, recurring, recurring_interval',
        )
        .eq('gym_id', gymId!)
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AdminProduct[];
    },
  });
}

export type StaffOrder = {
  id: string;
  status: StoreOrderStatus;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
  has_physical: boolean;
  shipping_name: string | null;
  shipping_address: Record<string, string> | null;
  tracking_note: string | null;
  buyer_name: string | null;
  item_count: number;
  items_summary: string | null;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
};

export function useStaffStoreOrders(gymId: string | undefined) {
  return useQuery({
    queryKey: ['staff-store-orders', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<StaffOrder[]> => {
      const { data, error } = await supabase.rpc('staff_store_orders', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      return (data ?? []) as StaffOrder[];
    },
  });
}

export type StoreRevenueRow = {
  currency: string;
  gross_cents: number;
  order_count: number;
};

export function useStoreRevenue(
  gymId: string | undefined,
  start: string,
  end: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['store-revenue', gymId, start, end],
    enabled: !!gymId && enabled,
    queryFn: async (): Promise<StoreRevenueRow[]> => {
      const { data, error } = await supabase.rpc('store_revenue_summary', {
        p_gym_id: gymId!,
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      return (data ?? []) as StoreRevenueRow[];
    },
  });
}

// ── Recurring subscriptions ─────────────────────────────────────────────

export type MyStoreSubscription = {
  id: string;
  product_id: string | null;
  name_snapshot: string;
  kind_snapshot: StoreProductKind;
  unit_price_cents: number;
  currency: string;
  interval: string;
  status: StoreSubscriptionStatus;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  shipping_name: string | null;
  shipping_address: Record<string, string> | null;
  created_at: string;
};

// The member's own store subscriptions (self-select RLS), newest first.
// Polls briefly so a just-started subscription appears after checkout.
export function useMyStoreSubscriptions(
  gymId: string | undefined,
  profileId: string | undefined,
  opts?: { pollForActive?: boolean },
) {
  return useQuery({
    queryKey: ['my-store-subscriptions', gymId, profileId],
    enabled: !!gymId && !!profileId,
    refetchInterval: opts?.pollForActive
      ? (query) => {
          const data = query.state.data as MyStoreSubscription[] | undefined;
          // Stop as soon as a freshly-created subscription appears (the one
          // this checkout just made — works even when the member already
          // had other active subs). Bounded by attempts as a safety net so
          // a normal visit / abandoned checkout can't poll forever.
          const justAppeared =
            !!data &&
            data.some(
              (s) => Date.now() - new Date(s.created_at).getTime() < 60 * 1000,
            );
          if (justAppeared) return false;
          return query.state.dataUpdateCount < 6 ? 3000 : false;
        }
      : false,
    queryFn: async (): Promise<MyStoreSubscription[]> => {
      const { data, error } = await supabase
        .from('store_subscriptions')
        .select(
          'id, product_id, name_snapshot, kind_snapshot, unit_price_cents, currency, interval, status, cancel_at_period_end, current_period_end, shipping_name, shipping_address, created_at',
        )
        .eq('gym_id', gymId!)
        .eq('profile_id', profileId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MyStoreSubscription[];
    },
  });
}

// Cancel a store subscription at period end via the edge function.
export function useCancelStoreSubscription(gymId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { error } = await supabase.functions.invoke(
        'store-cancel-subscription',
        { body: { subscription_id: subscriptionId } },
      );
      if (error) {
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const b = await ctx.json();
            if (b?.error) msg = String(b.error);
          } catch {
            // keep generic message
          }
        }
        throw new Error(msg);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['my-store-subscriptions', gymId],
      });
      queryClient.invalidateQueries({ queryKey: ['staff-store-subscriptions', gymId] });
    },
  });
}

// Update the delivery address on a box subscription (member self or staff);
// takes effect from the next cycle's order.
export function useUpdateStoreSubscriptionShipping(gymId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      subscriptionId: string;
      name: string;
      address: Record<string, string>;
    }) => {
      const { error } = await supabase.rpc('update_store_subscription_shipping', {
        p_sub_id: vars.subscriptionId,
        p_name: vars.name,
        p_address: vars.address,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['my-store-subscriptions', gymId],
      });
      queryClient.invalidateQueries({ queryKey: ['staff-store-subscriptions', gymId] });
    },
  });
}

export type StaffSubscription = {
  id: string;
  product_name: string | null;
  buyer_name: string | null;
  unit_price_cents: number;
  currency: string;
  interval: string;
  status: StoreSubscriptionStatus;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  created_at: string;
};

export function useStaffStoreSubscriptions(gymId: string | undefined) {
  return useQuery({
    queryKey: ['staff-store-subscriptions', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<StaffSubscription[]> => {
      const { data, error } = await supabase.rpc('staff_store_subscriptions', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      return (data ?? []) as StaffSubscription[];
    },
  });
}
