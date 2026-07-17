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

// Short billing-interval suffix for a recurring price ("£10.00" + "/mo").
// Monthly is the default; weekly/yearly are supported for later.
export function intervalSuffix(interval: string): string {
  return interval === 'week' ? '/wk' : interval === 'year' ? '/yr' : '/mo';
}

// The ordered gallery for a product, as a clean string[]. image_urls is the
// source of truth (first = cover); image_url is the legacy single-image
// column, used as a fallback for any product saved before the gallery
// existed. Blanks are dropped so a stray '' never renders an empty frame.
export function productImages(p: {
  image_urls?: string[] | null;
  image_url?: string | null;
}): string[] {
  const gallery = (p.image_urls ?? []).map((u) => u?.trim()).filter(
    (u): u is string => !!u,
  );
  if (gallery.length > 0) return gallery;
  const cover = p.image_url?.trim();
  return cover ? [cover] : [];
}
