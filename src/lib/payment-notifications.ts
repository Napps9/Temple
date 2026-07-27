import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Best-effort nudge to drain queued failed-payment emails.
//
// Unlike the cover and class-change drains, this is the SECONDARY path.
// A payment fails inside a Stripe webhook with no browser present, so
// stripe-webhook invokes the worker itself; this covers the case where
// that invoke failed, using the moment an owner opens the chase list.
// Never throws — a stuck row stays queued and the member already has the
// in-app notice.
export async function drainPaymentEmails(gymId: string): Promise<void> {
  try {
    await supabase.functions.invoke('send-payment-notifications', {
      body: {
        gym_id: gymId,
        origin: Platform.OS === 'web' ? window.location.origin : undefined,
      },
    });
  } catch {
    // Non-fatal by design.
  }
}
