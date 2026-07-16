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
