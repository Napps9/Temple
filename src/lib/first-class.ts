import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '@/lib/auth';
import { invalidateBookingCaches } from '@/lib/bookings';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type StagedClass = {
  session_id: string;
  session_name: string;
  starts_at: string;
  // Trial claims only: the redemption whose hold this booking retires.
  redemption_id?: string;
};

// Two ways a class ends up waiting for somebody. 'agreed_plan' is the
// class the AI agent agreed on the call, staged on pending_members
// (0149). 'trial' is a seat claimed from a trial link and HELD until
// the gates are done (0262).
export type FirstClassSource = 'agreed_plan' | 'trial';

export type FirstClassResult = {
  ok: boolean;
  name: string;
  starts_at: string;
  detail?: string;
};

// The auto-book decision, as a value. Extracted so the one rule that
// matters is testable: exactly one attempt per staged class, and only
// once the member is ready for it — a second attempt would double-book,
// and an attempt before they're ready would be refused by the gates and
// then never retried.
export function firstClassStep(s: {
  staged: boolean;
  ready: boolean;
  tried: boolean;
  pending: boolean;
}): 'idle' | 'book' {
  if (!s.staged || !s.ready || s.tried || s.pending) return 'idle';
  return 'book';
}

// The class the AI agent agreed on the call. Once the member is ready —
// their membership is current — book it AS the member, through
// book_class, so every gate (entitlement, capacity, windows, waiver,
// PAR-Q) still applies. Staging only ever recorded intent.
//
// The staging is retired either way: a failed auto-book routes them to
// pick manually rather than into a retry loop on every visit.
export function useStagedFirstClass({
  gymId,
  ready,
  source = 'agreed_plan',
}: {
  gymId: string | undefined;
  ready: boolean;
  source?: FirstClassSource;
}): { result: FirstClassResult | null } {
  const session = useSession();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<FirstClassResult | null>(null);
  const tried = useRef(false);

  const staged = useQuery({
    queryKey: ['my-first-class', source, gymId],
    enabled: !!gymId && !!session,
    queryFn: async (): Promise<StagedClass | null> => {
      if (source === 'trial') {
        const { data, error } = await supabase.rpc('my_pending_trial_class', {
          p_gym_id: gymId!,
        });
        if (error) throw error;
        return ((data ?? []) as StagedClass[])[0] ?? null;
      }
      const { data, error } = await supabase.rpc('my_staged_first_class', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      return ((data ?? []) as StagedClass[])[0] ?? null;
    },
  });

  const book = useMutation({
    mutationFn: async (target: StagedClass): Promise<string | null> => {
      const { data, error } = await supabase.rpc('book_class', {
        session_id: target.session_id,
      });
      if (error) throw error;
      return (data as unknown as string) ?? null;
    },
    onSettled: async (bookingId, err, target) => {
      // Retire the staging either way. On the trial path this is
      // bookkeeping rather than arithmetic: the hold already stops
      // counting against capacity the moment the booking exists.
      if (source === 'trial') {
        if (target.redemption_id) {
          await supabase.rpc('mark_trial_class_booked', {
            p_redemption_id: target.redemption_id,
            p_booking_id: bookingId ?? null,
          });
        }
      } else {
        await supabase.rpc('clear_my_first_class', { p_gym_id: gymId! });
      }
      queryClient.invalidateQueries({ queryKey: ['my-first-class', source, gymId] });
      invalidateBookingCaches(queryClient);
      setResult({
        ok: !err,
        name: target.session_name,
        starts_at: target.starts_at,
        detail: err ? errorMessage(err, 'the class could not be booked') : undefined,
      });
    },
  });

  useEffect(() => {
    const step = firstClassStep({
      staged: !!staged.data,
      ready,
      tried: tried.current,
      pending: book.isPending,
    });
    if (step === 'book' && staged.data) {
      tried.current = true;
      book.mutate(staged.data);
    }
  }, [ready, staged.data, book]);

  return { result };
}
