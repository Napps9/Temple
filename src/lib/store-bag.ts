// The member's shopping bag: session-only client state, because the
// backend never needed one — the store-checkout edge function has taken
// an array of line items since 0085, the UI just never built a basket.
// Module scope on the established session-memory idiom, with a tiny
// subscription so every mounted bag badge re-renders on change.

export type BagLine = { product_id: string; quantity: number };

const bag = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeBag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addToBag(productId: string, quantity = 1): void {
  bag.set(productId, (bag.get(productId) ?? 0) + quantity);
  emit();
}

// Sets an absolute quantity; zero or less removes the line.
export function setBagQuantity(productId: string, quantity: number): void {
  if (quantity <= 0) bag.delete(productId);
  else bag.set(productId, quantity);
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
  return [...bag.entries()].map(([product_id, quantity]) => ({
    product_id,
    quantity,
  }));
}
