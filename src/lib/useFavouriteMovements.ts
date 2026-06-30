import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from './auth';
import { catalogGroups, findGroup, type Discipline } from './movements';
import { supabase } from './supabase';

// Two-level favourites: a member can star an individual movement
// (tracked_movement_favourites) or a whole group (tracked_group_favourites).
// A group star also stars all of the group's movements; the Track home
// renders a group tile while the group is starred and ≥2 of its movements
// remain selected, a single movement tile when one remains, and nothing at
// zero. Individually-starred movements never auto-merge into a group.
//
// Defaults mirror today's home and are NOT persisted until the member first
// customises: a CrossFit gym defaults to its groups starred (group tiles), a
// Hyrox gym to its movements starred individually (station tiles). The first
// edit materialises those defaults into rows (via the reconcile diff below)
// so they become editable without a migration or trigger.

export type FavouriteState = { groups: Set<string>; movements: Set<string> };

function disciplineDefaults(discipline: Discipline): FavouriteState {
  const list = catalogGroups(discipline);
  const movements = new Set<string>();
  for (const g of list) for (const m of g.movements) movements.add(m.key);
  const groups =
    discipline === 'hyrox' ? new Set<string>() : new Set(list.map((g) => g.key));
  return { groups, movements };
}

const favKey = (uid?: string) => ['movement-favourites', uid] as const;

const EMPTY: FavouriteState = { groups: new Set(), movements: new Set() };

export function useMovementFavourites(discipline: Discipline) {
  const session = useSession();
  const queryClient = useQueryClient();
  const key = favKey(session?.user.id);

  const query = useQuery({
    queryKey: key,
    enabled: !!session?.user.id,
    queryFn: async (): Promise<FavouriteState> => {
      const [mv, gp] = await Promise.all([
        supabase.from('tracked_movement_favourites').select('movement_key'),
        supabase.from('tracked_group_favourites').select('group_key'),
      ]);
      if (mv.error) throw mv.error;
      if (gp.error) throw gp.error;
      return {
        movements: new Set((mv.data ?? []).map((r) => r.movement_key)),
        groups: new Set((gp.data ?? []).map((r) => r.group_key)),
      };
    },
  });

  const raw = query.data;
  const customized = !!raw && (raw.groups.size > 0 || raw.movements.size > 0);
  const effective = raw
    ? customized
      ? raw
      : disciplineDefaults(discipline)
    : undefined;

  // Reconcile the DB to a desired full state. The caller passes the exact
  // add/delete lists (diffed against the persisted rows), so the first edit
  // off the defaults inserts the whole materialised set.
  const apply = useMutation({
    mutationFn: async (a: {
      next: FavouriteState;
      mAdd: string[];
      mDel: string[];
      gAdd: string[];
      gDel: string[];
    }) => {
      const uid = session?.user.id;
      if (!uid) throw new Error('Not signed in');
      if (a.mAdd.length) {
        const { error } = await supabase
          .from('tracked_movement_favourites')
          .insert(a.mAdd.map((movement_key) => ({ profile_id: uid, movement_key })));
        if (error) throw error;
      }
      if (a.mDel.length) {
        const { error } = await supabase
          .from('tracked_movement_favourites')
          .delete()
          .eq('profile_id', uid)
          .in('movement_key', a.mDel);
        if (error) throw error;
      }
      if (a.gAdd.length) {
        const { error } = await supabase
          .from('tracked_group_favourites')
          .insert(a.gAdd.map((group_key) => ({ profile_id: uid, group_key })));
        if (error) throw error;
      }
      if (a.gDel.length) {
        const { error } = await supabase
          .from('tracked_group_favourites')
          .delete()
          .eq('profile_id', uid)
          .in('group_key', a.gDel);
        if (error) throw error;
      }
    },
    onMutate: async (a) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<FavouriteState>(key);
      queryClient.setQueryData(key, a.next);
      return { prev };
    },
    onError: (_e, _a, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  // Read the live persisted/effective state from the cache so rapid toggles
  // diff against the latest optimistic value, not a stale render closure.
  function persistedNow(): FavouriteState {
    return queryClient.getQueryData<FavouriteState>(key) ?? EMPTY;
  }
  function effectiveNow(): FavouriteState {
    const p = persistedNow();
    return p.groups.size > 0 || p.movements.size > 0
      ? p
      : disciplineDefaults(discipline);
  }

  function commit(next: FavouriteState) {
    const persisted = persistedNow();
    apply.mutate({
      next,
      mAdd: [...next.movements].filter((k) => !persisted.movements.has(k)),
      mDel: [...persisted.movements].filter((k) => !next.movements.has(k)),
      gAdd: [...next.groups].filter((k) => !persisted.groups.has(k)),
      gDel: [...persisted.groups].filter((k) => !next.groups.has(k)),
    });
  }

  function toggleMovement(movementKey: string, on: boolean) {
    if (!raw) return; // not loaded yet — avoid inserting over unseen rows
    const eff = effectiveNow();
    const next = {
      groups: new Set(eff.groups),
      movements: new Set(eff.movements),
    };
    if (on) next.movements.add(movementKey);
    else next.movements.delete(movementKey);
    commit(next);
  }

  function toggleGroup(groupKey: string, on: boolean) {
    if (!raw) return;
    const eff = effectiveNow();
    const next = {
      groups: new Set(eff.groups),
      movements: new Set(eff.movements),
    };
    const g = findGroup(groupKey);
    if (on) {
      next.groups.add(groupKey);
      g?.movements.forEach((m) => next.movements.add(m.key));
    } else {
      next.groups.delete(groupKey);
      g?.movements.forEach((m) => next.movements.delete(m.key));
    }
    commit(next);
  }

  return {
    loading: query.isLoading,
    groups: effective?.groups ?? new Set<string>(),
    movements: effective?.movements ?? new Set<string>(),
    toggleMovement,
    toggleGroup,
  };
}
