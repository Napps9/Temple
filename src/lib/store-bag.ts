// The member's shopping bag: session-only client state, because the
// backend never needed one — the store-checkout edge function has taken
// an array of line items since 0085, the UI just never built a basket.
// Module scope on the established session-memory idiom, with a tiny
// subscription so every mounted bag badge re-renders on change.
//
// Lines key on product + variant (0256): an M tee and an L tee are two
// lines with their own quantities, not one.

export type BagLine = {
  product_id: string;
  variant_id: string | null;
  quantity: number;
};

// uuids never contain a space, so 'pid vid' round-trips safely.
const keyOf = (productId: string, variantId: string | null) =>
  `${productId} ${variantId ?? ''}`;

const bag = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeBag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addToBag(
  productId: string,
  variantId: string | null = null,
  quantity = 1,
): void {
  const k = keyOf(productId, variantId);
  bag.set(k, (bag.get(k) ?? 0) + quantity);
  emit();
}

// Sets an absolute quantity; zero or less removes the line.
export function setBagQuantity(
  productId: string,
  variantId: string | null,
  quantity: number,
): void {
  const k = keyOf(productId, variantId);
  if (quantity <= 0) bag.delete(k);
  else bag.set(k, quantity);
  emit();
}

export function clearBag(): void {
  bag.clear();
  emit();
}

export function bagCount(): number {
  let n = 0;
  for (const q of bag.values()) n += q;
  return n;
}

export function bagLines(): BagLine[] {
  return [...bag.entries()].map(([k, quantity]) => {
    const [product_id, vid] = k.split(' ');
    return { product_id, variant_id: vid || null, quantity };
  });
}
