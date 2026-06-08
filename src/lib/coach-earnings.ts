// Pure helpers for coach-earnings UI: cents <-> string parsing, total
// computation. The compute_coach_earnings RPC returns per-class-type
// rows; renderers usually want a total + per-row display.

export type EarningsRow = {
  class_type_id: string;
  class_type_name: string;
  class_type_color: string;
  class_count: number;
  rate_cents: number;
  earnings_cents: number;
  currency: string;
};

// Sum earnings_cents across the row set. Currency is taken from the
// first row (the RPC returns one consistent gym currency).
export function totalEarnings(rows: EarningsRow[]): {
  cents: number;
  classes: number;
  currency: string;
} {
  let cents = 0;
  let classes = 0;
  for (const r of rows) {
    cents += r.earnings_cents;
    classes += r.class_count;
  }
  return {
    cents,
    classes,
    currency: rows[0]?.currency ?? 'GBP',
  };
}

// Format cents as a localised currency string. Intl.NumberFormat
// handles the symbol per currency code.
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

// Parse a user-entered rate (e.g. "25", "25.50", "£25.50") to integer
// cents. Returns null on bad input or negative.
export function parseRateToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(/,/g, '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// Render integer cents back into a plain-number input field
// (no currency symbol).
export function centsToRateInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
