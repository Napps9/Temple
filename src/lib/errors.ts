export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return fallback;
}

// supabase.functions.invoke surfaces a non-2xx as a FunctionsHttpError whose
// `.context` is the raw Response — our functions answer with { error } JSON,
// so dig that friendly message out rather than showing "non-2xx status".
export async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      // not JSON — fall through
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong';
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

// The entitlement gate (0082) raises this prefix when the booker needs an
// active membership (gym requires one, or their plan lapsed / ran out).
// The booking modal catches it and offers the plan options inline.
export function isMembershipRequiredError(e: unknown): boolean {
  return errorMessage(e, '').startsWith('Membership required');
}
