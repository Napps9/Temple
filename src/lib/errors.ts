export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return fallback;
}

// The booking gate raises this prefix when the booker has no current
// PAR-Q response (see 0038). Surfaces tied to book_class detect it and
// route into /parq rather than displaying the raw RPC error.
export function isParqRequiredError(e: unknown): boolean {
  return errorMessage(e, '').startsWith('PAR-Q required');
}

// Likewise, the booking gate raises this prefix when the gym has an
// active waiver the booker hasn't signed (see 0041). Surfaces route
// into /waiver.
export function isWaiverRequiredError(e: unknown): boolean {
  return errorMessage(e, '').startsWith('Waiver required');
}
