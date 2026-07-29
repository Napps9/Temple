// The store, as things you can say.
//
// First module on the registry, and the shape every other one follows:
// the writes are the same table writes the store screen makes, the reads
// are the same RPCs its revenue panel calls. The bar gains no path of its
// own — it gains a sentence that reaches the path already there.

import { formatPrice } from '../setup-flow';

import {
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
    { name: 'price', type: 'money', desc: 'Price in pounds', required: true },
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
  preview: async (a) => ({
    title: 'Add this to the shop?',
    lines: [
      `${a.name} — ${formatPrice(a.priceCents)}`,
      a.kind === 'digital'
        ? 'A download. You will need to attach the file on the store screen before it can sell.'
        : a.stock !== null
          ? `${a.stock} in stock, and it stops selling at zero.`
          : 'Stock is not tracked, so it never sells out.',
    ],
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
      ? `${a.name} added at ${formatPrice(a.priceCents)}, hidden until you attach the file.`
      : `${a.name} is in the shop at ${formatPrice(a.priceCents)}.`;
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
    { name: 'price', type: 'money', desc: 'The new price in pounds', required: true },
  ],
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
        `${match.name} — ${formatPrice(match.price_cents)} → ${formatPrice(a.priceCents)}`,
        match.recurring
          ? 'A subscription: new subscribers pay the new price, everyone already on it keeps theirs.'
          : 'Anyone mid-checkout pays what they were shown.',
      ],
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
    return `${match.name} is now ${formatPrice(a.priceCents)}.`;
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
      title: `${formatPrice(gross)} across ${orders} order${orders === 1 ? '' : 's'} in ${period}.`,
      lines: [
        `That averages ${formatPrice(Math.round(gross / orders))} an order.`,
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

export const STORE_ACTIONS: AnyAction[] = [
  erase(addStoreProduct),
  erase(setStoreProductPrice),
  erase(storeSales),
];
