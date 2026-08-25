import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type StagedClass = {
  session_id: string;
  session_name: string;
  starts_at: string;
};

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
}: {
  gymId: string | undefined;
  ready: boolean;
}): { result: FirstClassResult | null } {
  const session = useSession();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<FirstClassResult | null>(null);
  const tried = useRef(false);

  const staged = useQuery({
    queryKey: ['my-first-class', gymId],
    enabled: !!gymId && !!session,
    queryFn: async (): Promise<StagedClass | null> => {
      const { data, error } = await supabase.rpc('my_staged_first_class', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      return ((data ?? []) as StagedClass[])[0] ?? null;
    },
  });

  const book = useMutation({
    mutationFn: async (target: StagedClass) => {
      const { error } = await supabase.rpc('book_class', {
        session_id: target.session_id,
      });
      if (error) throw error;
    },
    onSettled: async (_data, err, target) => {
      await supabase.rpc('clear_my_first_class', { p_gym_id: gymId! });
      queryClient.invalidateQueries({ queryKey: ['my-first-class', gymId] });
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
