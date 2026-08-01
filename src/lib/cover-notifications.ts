import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Best-effort nudge to the edge worker to drain any queued cover emails.
// Never throws — a failed drain leaves the rows queued and retryable, and
// the in-app half of the notification has already landed.
//
// Lifted out of management/cover.tsx when that screen retired (0243). It
// had been a private copy of drainClassChangeEmails with a comment
// pointing at the original, which is the state a helper is in just before
// the two quietly stop matching. The cron drains every 15 minutes on its
// own; this is what makes a coach's request reach the others now rather
// than within the quarter-hour.
export async function drainCoverEmails(gymId: string): Promise<void> {
  try {
    await supabase.functions.invoke('send-cover-notifications', {
      body: {
        gym_id: gymId,
        origin: Platform.OS === 'web' ? window.location.origin : undefined,
      },
    });
  } catch {
    // Non-fatal by design.
  }
}
