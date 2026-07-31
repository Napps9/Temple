// The store, as things you can say.
//
// First module on the registry, and the shape every other one follows:
// the writes are the same table writes the store screen makes, the reads
// are the same RPCs its revenue panel calls. The bar gains no path of its
// own — it gains a sentence that reaches the path already there.

import { formatPrice } from '../setup-flow';

import {
  ActionError,
  argEnum,
  argInt,
  argMoney,
  argString,
  erase,
  type ActionContext,
  type ActionSpec,
  type AnyAction,
} from './types';

type AddProduct = {
  name: string;
  priceCents: number;
  kind: 'physical' | 'digital';
  stock: number | null;
};

export const addStoreProduct: ActionSpec<AddProduct> = {
  name: 'store.add_product',
  kind: 'do',
  capability: 'can_manage_store',
  says:
    'Put something new in the shop — "add a water bottle for £1", "sell ' +
    'hoodies at £35, we have 20", "add the technique guide as a £12 download".',
  args: [
    { name: 'name', type: 'string', desc: 'What it is called', required: true },
    {
      name: 'price',
      type: 'money',
      desc: 'Price in whole currency as they said it — not minor units',
      required: true,
    },
    {
      name: 'kind',
      type: 'enum',
      values: ['physical', 'digital'],
      desc: 'physical unless it is a file the member downloads',
    },
    {
      name: 'stock',
      type: 'integer',
      desc: 'How many they have, if they said. Omit to not track stock.',
      min: 0,
      max: 100000,
    },
  ],
  invalidate: ['store-products', 'admin-store-products'],
  sanitise: (raw) => {
    const name = argString(raw, 'name', 80);
    const priceCents = argMoney(raw, 'price');
    if (!name || priceCents === null) return null;
    return {
      name,
      priceCents,
      kind: argEnum(raw, 'kind', ['physical', 'digital'] as const) ?? 'physical',
      stock: argInt(raw, 'stock', 0, 100000),
    };
  },
  preview: async (a, ctx) => ({
    title: 'Add this to the shop?',
    lines: [
      `${a.name} — ${formatPrice(a.priceCents, ctx.currency)}`,
      a.kind === 'digital'
        ? 'A download. You will need to attach the file on the store screen before it can sell.'
        : a.stock !== null
          ? `${a.stock} in stock, and it stops selling at zero.`
          : 'Stock is not tracked, so it never sells out.',
    ],
    yes: 'Yes, add it',
  }),
  apply: async (a, ctx) => {
    const { error } = await ctx.supabase.from('store_products').insert({
      gym_id: ctx.gymId,
      created_by: ctx.userId,
      name: a.name,
      kind: a.kind,
      price_cents: a.priceCents,
      description: null,
      image_urls: [],
      image_url: null,
      track_inventory: a.stock !== null,
      stock_quantity: a.stock,
      digital_asset_path: null,
      // A download with no file attached would be a broken purchase, so
      // it goes up hidden and the store screen turns it on once the file
      // is there. Physical stock is sellable the moment it exists.
      active: a.kind !== 'digital',
      recurring: false,
      recurring_interval: null,
    });
    if (error) throw error;
    return a.kind === 'digital'
      ? `${a.name} added at ${formatPrice(a.priceCents, ctx.currency)}, hidden until you attach the file.`
      : `${a.name} is in the shop at ${formatPrice(a.priceCents, ctx.currency)}.`;
  },
};

type SetPrice = { name: string; priceCents: number };

export const setStoreProductPrice: ActionSpec<SetPrice> = {
  name: 'store.set_price',
  kind: 'do',
  capability: 'can_manage_store',
  says:
    'Change what something in the shop costs — "make the water bottle £2", ' +
    '"drop hoodies to £30".',
  args: [
    { name: 'name', type: 'string', desc: 'The product, as they named it', required: true },
    {
      name: 'price',
      type: 'money',
      desc: 'The new price in whole currency as they said it — not minor units',
      required: true,
    },
  ],
  invalidate: ['store-products', 'admin-store-products'],
  sanitise: (raw) => {
    const name = argString(raw, 'name', 80);
    const priceCents = argMoney(raw, 'price');
    return name && priceCents !== null ? { name, priceCents } : null;
  },
  preview: async (a, ctx) => {
    const match = await findProduct(a.name, ctx);
    if (!match) {
      return { title: `Nothing in the shop called “${a.name}”.`, lines: [] };
    }
    return {
      title: 'Change this price?',
      lines: [
        `${match.name} — ${formatPrice(match.price_cents, ctx.currency)} → ${formatPrice(a.priceCents, ctx.currency)}`,
        match.recurring
          ? 'A subscription: new subscribers pay the new price, everyone already on it keeps theirs.'
          : 'Anyone mid-checkout pays what they were shown.',
      ],
      yes: 'Yes, change it',
    };
  },
  apply: async (a, ctx) => {
    const match = await findProduct(a.name, ctx);
    if (!match) throw new Error('No such product');
    const { error } = await ctx.supabase
      .from('store_products')
      .update({
        price_cents: a.priceCents,
        updated_at: new Date().toISOString(),
        // Stripe prices are immutable, so a recurring product's cached
        // price id has to go or new subscribers sign up at the old rate.
        ...(match.recurring ? { stripe_price_id: null } : {}),
      })
      .eq('id', match.id);
    if (error) throw error;
    return `${match.name} is now ${formatPrice(a.priceCents, ctx.currency)}.`;
  },
};

type StoreSales = { days: number };

export const storeSales: ActionSpec<StoreSales> = {
  name: 'store.sales',
  kind: 'ask',
  capability: 'can_see_store_revenue',
  says:
    'How the shop is doing — "what are sales like in the store", "how much ' +
    'did the shop take last month".',
  args: [
    {
      name: 'days',
      type: 'integer',
      desc: 'How far back they asked about. 30 if they did not say.',
      min: 1,
      max: 730,
    },
  ],
  sanitise: (raw) => ({ days: argInt(raw, 'days', 1, 730) ?? 30 }),
  preview: async (a, ctx) => {
    const end = new Date();
    const start = new Date(end.getTime() - a.days * 86_400_000);
    const [summary, products] = await Promise.all([
      ctx.supabase.rpc('store_revenue_summary', {
        p_gym_id: ctx.gymId,
        p_period_start: start.toISOString(),
        p_period_end: end.toISOString(),
      }),
      ctx.supabase.rpc('list_store_products', { p_gym_id: ctx.gymId }),
    ]);
    const row = ((summary.data ?? []) as StoreRevenueRow[])[0];
    const gross = row?.gross_cents ?? 0;
    const orders = row?.order_count ?? 0;
    const period = a.days === 30 ? 'the last 30 days' : `the last ${a.days} days`;
    if (orders === 0) {
      return {
        title: `Nothing sold in ${period}.`,
        lines: [liveProductsLine(products.data as ProductRow[] | null)],
      };
    }
    return {
      title: `${formatPrice(gross, ctx.currency)} across ${orders} order${orders === 1 ? '' : 's'} in ${period}.`,
      lines: [
        `That averages ${formatPrice(Math.round(gross / orders), ctx.currency)} an order.`,
        liveProductsLine(products.data as ProductRow[] | null),
      ],
    };
  },
};

type StoreRevenueRow = { gross_cents: number; order_count: number };
type ProductRow = { active: boolean; archived_at: string | null };

function liveProductsLine(products: ProductRow[] | null): string {
  const live = (products ?? []).filter((p) => p.active && !p.archived_at).length;
  if (live === 0) return 'Nothing is on sale right now.';
  return `${live} thing${live === 1 ? '' : 's'} on sale.`;
}

type ProductMatch = {
  id: string;
  name: string;
  price_cents: number;
  recurring: boolean;
};

// Named the way the owner says it, which is rarely the way it was typed
// in — "the water bottle" has to find "Temple Water Bottle 750ml".
async function findProduct(
  query: string,
  ctx: ActionContext,
): Promise<ProductMatch | null> {
  const { data } = await ctx.supabase
    .from('store_products')
    .select('id, name, price_cents, recurring')
    .eq('gym_id', ctx.gymId)
    .is('archived_at', null);
  const rows = (data ?? []) as ProductMatch[];
  return matchProduct(rows, query);
}

export function matchProduct<T extends { name: string }>(
  rows: T[],
  query: string,
): T | null {
  const q = query.toLowerCase().replace(/^the /, '').trim();
  const exact = rows.find((r) => r.name.toLowerCase() === q);
  if (exact) return exact;
  const contains = rows.filter(
    (r) => r.name.toLowerCase().includes(q) || q.includes(r.name.toLowerCase()),
  );
  // Two products that both answer to "bottle" is not a price change to
  // guess at — the bar says it can't tell them apart instead.
  return contains.length === 1 ? contains[0] : null;
}

// ============================================================================
// store.refund_order
// ============================================================================
//
// store_order_status has allowed 'refunded' since the shop was built and
// nothing wrote it — money.refund is memberships only and says so, and the
// orders screen has no refund button. So a wrong-size hoodie was refunded
// in the Stripe dashboard and the order sat in Temple saying 'paid'.
//
// The money moves through refund-store-order on the gym's connected
// account, the same shape as the membership refund: the amount is
// recomputed server-side and the secret key never comes near here.
//
// The card carries the two consequences an owner cannot see from the
// order row. Stock only comes back if nothing shipped, because refunding
// a posted hoodie does not put it on the shelf. And a downloaded file
// cannot be un-downloaded — the link stops working, which is worth
// saying rather than implying.

type RefundOrder = {
  who: string | null;
  what: string | null;
  amountCents: number | null;
};

type OrderRow = {
  id: string;
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
  fulfilled_at: string | null;
  has_physical: boolean;
  profiles: { full_name: string | null } | null;
  store_order_items: { name_snapshot: string; quantity: number }[];
};

function orderLine(o: OrderRow, currency: string): string {
  const items = o.store_order_items
    .map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.name_snapshot}` : i.name_snapshot))
    .join(', ');
  const when = new Date(o.created_at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  return `${o.profiles?.full_name?.trim() || 'A member'} — ${items || 'an order'}, ${formatPrice(o.total_cents, currency)}, ${when}`;
}

async function refundableOrders(ctx: ActionContext): Promise<OrderRow[]> {
  const { data } = await ctx.supabase
    .from('store_orders')
    .select(
      'id, status, total_cents, currency, created_at, fulfilled_at, has_physical, ' +
        'profiles!profile_id(full_name), store_order_items(name_snapshot, quantity)',
    )
    .eq('gym_id', ctx.gymId)
    .in('status', ['paid', 'fulfilled'])
    .order('created_at', { ascending: false })
    .limit(40);
  return (data ?? []) as unknown as OrderRow[];
}

function matchOrders(rows: OrderRow[], a: RefundOrder): OrderRow[] {
  let out = rows;
  if (a.who) {
    const q = a.who.toLowerCase();
    out = out.filter((o) => (o.profiles?.full_name ?? '').toLowerCase().includes(q));
  }
  if (a.what) {
    const q = a.what.toLowerCase();
    out = out.filter((o) =>
      o.store_order_items.some((i) => i.name_snapshot.toLowerCase().includes(q)),
    );
  }
  return out;
}

export const refundStoreOrder: ActionSpec<RefundOrder> = {
  name: 'store.refund_order',
  kind: 'do',
  capability: 'can_refund',
  says:
    'Give somebody their money back for something they bought in the shop ' +
    "— \"refund Marcus's hoodie\", \"give Sarah her money back for the water " +
    'bottle", "refund that last shop order". Not for a membership payment, ' +
    'which is money.refund.',
  args: [
    { name: 'who', type: 'string', desc: 'The member, if they named one' },
    { name: 'what', type: 'string', desc: 'The thing bought, if they named it' },
    {
      name: 'amount',
      type: 'money',
      desc: 'Only if they named a sum to give back rather than the whole order',
    },
  ],
  invalidate: [
    'staff-store-orders',
    'my-store-orders',
    'store-products',
    'admin-store-products',
    'store-revenue',
  ],
  sanitise: (raw) => ({
    who: argString(raw, 'who', 60),
    what: argString(raw, 'what', 60),
    amountCents: argMoney(raw, 'amount'),
  }),
  preview: async (a, ctx) => {
    const rows = await refundableOrders(ctx);
    if (rows.length === 0) {
      return { title: 'Nothing in the shop has been paid for yet.', lines: [] };
    }
    const hits = matchOrders(rows, a);
    if (hits.length === 0) {
      return {
        title: 'No shop order matches that.',
        lines: rows.slice(0, 4).map((o) => orderLine(o, ctx.currency)),
      };
    }
    if (hits.length > 1) {
      return {
        title: 'Which order?',
        lines: [],
        choices: hits.slice(0, 5).map((o) => ({
          label: orderLine(o, ctx.currency),
          args: {
            who: o.profiles?.full_name ?? a.who,
            what: o.store_order_items[0]?.name_snapshot ?? a.what,
            amount: a.amountCents === null ? undefined : a.amountCents / 100,
          },
        })),
      };
    }
    const o = hits[0];
    const cents =
      a.amountCents !== null && a.amountCents < o.total_cents
        ? a.amountCents
        : o.total_cents;
    const digital = o.store_order_items.length > 0 && !o.has_physical;
    return {
      title: `Refund ${formatPrice(cents, ctx.currency)} to ${o.profiles?.full_name?.trim() || 'them'}?`,
      lines: [
        orderLine(o, ctx.currency),
        cents < o.total_cents
          ? `Part of the order — ${formatPrice(o.total_cents - cents, ctx.currency)} stays with you.`
          : 'The whole order.',
        o.fulfilled_at === null
          ? 'It has not gone out, so anything you track the stock of goes back on the shelf.'
          : 'It has already gone out, so the stock is not put back — you have posted it.',
        ...(digital
          ? ['Their download stops working. What they already downloaded is theirs.']
          : []),
      ],
      yes: 'Yes, refund it',
    };
  },
  apply: async (a, ctx) => {
    const hits = matchOrders(await refundableOrders(ctx), a);
    if (hits.length !== 1) throw new ActionError('I lost track of which order you meant.');
    const o = hits[0];
    const { data, error } = await ctx.supabase.functions.invoke('refund-store-order', {
      body: {
        order_id: o.id,
        custom_cents:
          a.amountCents !== null && a.amountCents < o.total_cents ? a.amountCents : undefined,
      },
    });
    if (error) throw new ActionError(await refundFailure(error));
    const r = (data ?? {}) as { refundCents?: number; restocked?: boolean };
    const amount = formatPrice(r.refundCents ?? o.total_cents, ctx.currency);
    const who = o.profiles?.full_name?.trim() || 'them';
    return r.restocked
      ? `${amount} refunded to ${who}, and the stock is back on the shelf.`
      : `${amount} refunded to ${who}.`;
  },
};

// The edge function answers in words; these are the ones an owner can act
// on, and the rest is plumbing.
async function refundFailure(e: unknown): Promise<string> {
  const res = (e as { context?: Response }).context;
  if (res && typeof res.json === 'function') {
    try {
      const body = await res.json();
      const msg = String((body as { error?: string })?.error ?? '');
      if (msg) return msg;
    } catch {
      // fall through
    }
  }
  return 'The refund did not go through.';
}

export const STORE_ACTIONS: AnyAction[] = [
  erase(addStoreProduct),
  erase(setStoreProductPrice),
  erase(refundStoreOrder),
  erase(storeSales),
];
