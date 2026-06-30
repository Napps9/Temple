import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from './auth';
import { supabase } from './supabase';

// A member's starred movements, persisted in tracked_movement_favourites
// (self-only RLS, no gym_id — they travel with the profile). Held as a
// Set of movement_key so the Movement Library and detail star toggle can
// check membership in O(1).

const favouritesKey = (uid?: string) => ['movement-favourites', uid] as const;

export function useFavouriteMovements() {
  const session = useSession();
  return useQuery({
    queryKey: favouritesKey(session?.user.id),
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('tracked_movement_favourites')
        .select('movement_key');
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.movement_key));
    },
  });
}

export function useToggleFavouriteMovement() {
  const session = useSession();
  const queryClient = useQueryClient();
  const key = favouritesKey(session?.user.id);
  return useMutation({
    mutationFn: async ({
      movementKey,
      on,
    }: {
      movementKey: string;
      on: boolean;
    }) => {
      if (!session?.user.id) throw new Error('Not signed in');
      if (on) {
        const { error } = await supabase
          .from('tracked_movement_favourites')
          .insert({ profile_id: session.user.id, movement_key: movementKey });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('tracked_movement_favourites')
          .delete()
          .eq('profile_id', session.user.id)
          .eq('movement_key', movementKey);
        if (error) throw error;
      }
    },
    // Optimistic: flip the star immediately, roll back on failure.
    onMutate: async ({ movementKey, on }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<Set<string>>(key);
      const next = new Set(prev ?? []);
      if (on) next.add(movementKey);
      else next.delete(movementKey);
      queryClient.setQueryData(key, next);
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
