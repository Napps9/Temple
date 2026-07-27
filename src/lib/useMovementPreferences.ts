// A member's answers to "which lift do you mean by this word?".
//
// The percentage resolver asks once per ambiguous term ("clean",
// "squat") and the answer is reused everywhere that word appears in
// future programming. See migration 0168.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from './auth';
import { supabase } from './supabase';

// The DB CHECK requires the stored term to already be lower-cased and
// trimmed; normalise here so both the write and the lookup agree.
export function normaliseTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function useMovementPreferences() {
  const session = useSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['movement-preferences', session?.user.id],
    enabled: !!session?.user.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from('member_movement_preferences')
        .select('term, movement_key')
        .eq('profile_id', session!.user.id);
      if (error) throw error;
      return new Map(
        (data ?? []).map((r) => [
          (r as { term: string }).term,
          (r as { movement_key: string }).movement_key,
        ]),
      );
    },
  });

  const set = useMutation({
    mutationFn: async (args: { term: string; movementKey: string }) => {
      const { error } = await supabase
        .from('member_movement_preferences')
        .upsert(
          {
            profile_id: session!.user.id,
            term: normaliseTerm(args.term),
            movement_key: args.movementKey,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'profile_id,term' },
        );
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['movement-preferences'] }),
  });

  return { preferences: query.data ?? new Map<string, string>(), set };
}
