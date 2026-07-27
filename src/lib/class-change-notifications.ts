import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Best-effort nudge to the edge worker to drain any queued class-change
// emails. Never throws — a failed drain leaves the rows queued and
// retryable, and the in-app half of the notification has already landed.
// Same contract as drainCoverEmails in management/cover.tsx.
export async function drainClassChangeEmails(gymId: string): Promise<void> {
  try {
    await supabase.functions.invoke('send-class-change-notifications', {
      body: {
        gym_id: gymId,
        origin: Platform.OS === 'web' ? window.location.origin : undefined,
      },
    });
  } catch {
    // Non-fatal by design.
  }
}
