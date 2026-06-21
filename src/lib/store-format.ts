// Pure store helpers: price <-> string parsing and the sold-out rule.
// Deliberately free of react-native imports so they unit-test in node.

// "12.50" → 1250, "10" → 1000. Rejects blanks / negatives / non-numbers so
// a bad price can't be saved as 0 by accident.
export function parsePriceToCents(input: string): number | null {
  const t = input.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// 1250 → "12.50", 1000 → "10" (drops a whole-number's trailing .00).
export function formatPriceInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

// A tracked product with nothing left reads as sold out; untracked goods
// (a programme) are always available.
export function productSoldOut(p: {
  track_inventory: boolean;
  stock_quantity: number | null;
}): boolean {
  return p.track_inventory && (p.stock_quantity ?? 0) <= 0;
}
