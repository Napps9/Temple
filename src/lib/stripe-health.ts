import { supabase } from './supabase';

// Real Stripe Connect health for a gym, from the owner-only stripe-account
// edge function. A gym_stripe_accounts row existing only means we once
// stored an account id — this says whether the platform key can actually
// reach it and take charges (a revoked grant or wrong-account/mode key
// surfaces as reachable:false).
export type StripeHealth =
  | { connected: false }
  | { connected: true; reachable: false; accountId: string; error?: string }
  | {
      connected: true;
      reachable: true;
      accountId: string;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      detailsSubmitted: boolean;
    };

// Shared key so the billing and plans screens reuse one cached result.
export function stripeHealthQueryKey(gymId: string | null | undefined) {
  return ['gym-stripe-health', gymId] as const;
}

export async function fetchStripeHealth(gymId: string): Promise<StripeHealth> {
  const { data, error } = await supabase.functions.invoke('stripe-account', {
    body: { gym_id: gymId, action: 'status' },
  });
  if (error) throw error;
  return data as StripeHealth;
}

// The Timeline's sentence about all this lives in lib/timeline.ts with
// every other owner-visible line. That was originally forced — anything
// importing supabase failed to parse under vitest — and is now a choice:
// the react-native alias and the test env fixed the parse and the throw,
// so this module is testable. The copy stays in timeline.ts because every
// owner-visible line living in one place is worth keeping on its own.
