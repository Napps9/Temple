// A member's rep-max history, for the surfaces that turn a programmed
// "@ 75%" into a number.
//
// Deliberately unfiltered by movement and keyed on the profile alone.
// Keying on the movements detected in the visible day would refetch on
// every arrow tap in the programming calendar and flash the chips;
// calling it per section would be an N+1 across a day's cards. The row
// count is small (rep-max results only), so one query pair per member
// is cheaper than being clever.
//
// Profile-scoped, not gym-scoped — a member's history travels with them
// across gyms and includes solo (gym_id null) rows, matching how the
// movement detail page already reads.

import { useQuery } from '@tanstack/react-query';

import { useSession } from './auth';
import {
  deriveTagValue,
  mergeJournal,
  type JournalRow,
  type SectionForDerivation,
  type TagInputRow,
} from './movement-journal';
import { findMovement } from './movements';
import { resolveOneRepMax, type MaxResolution } from './one-rep-max';
import { supabase } from './supabase';
import type { TrackedResultRow } from './track';

export const MY_REP_MAXES_KEY = 'my-rep-maxes';

type RawTagRow = {
  id: string;
  movement_key: string;
  track_key: string | null;
  performed_at: string;
  notes: string | null;
  section: (SectionForDerivation & { workout_id: string | null }) | null;
};

export type RepMaxLookup = (movementKey: string) => MaxResolution | null;

export function useMyRepMaxes(enabled = true) {
  const session = useSession();
  const on = enabled && !!session?.user.id;

  const direct = useQuery({
    queryKey: [MY_REP_MAXES_KEY, 'direct', session?.user.id],
    enabled: on,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TrackedResultRow[]> => {
      const { data, error } = await supabase
        .from('tracked_movement_results')
        .select(
          'id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at',
        )
        .eq('profile_id', session!.user.id)
        .like('track_key', '%rm')
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrackedResultRow[];
    },
  });

  const tags = useQuery({
    queryKey: [MY_REP_MAXES_KEY, 'tags', session?.user.id],
    enabled: on,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<RawTagRow[]> => {
      const { data, error } = await supabase
        .from('tracked_section_movement_tags')
        .select(
          'id, movement_key, track_key, performed_at, notes, section:tracked_workout_sections(workout_id, section_format, total_time_seconds, total_rounds, total_distance_m, total_calories, entries:tracked_section_entries(weight_numeric, reps, time_seconds, distance_numeric, calories))',
        )
        .eq('profile_id', session!.user.id)
        .like('track_key', '%rm');
      if (error) throw error;
      return (data ?? []) as unknown as RawTagRow[];
    },
  });

  const lookup: RepMaxLookup = (movementKey: string) => {
    const hit = findMovement(movementKey);
    if (!hit) return null;
    return resolveOneRepMax(
      journalFor(movementKey, hit.movement, direct.data, tags.data),
      hit.movement,
    );
  };

  return { lookup, isLoading: on && (direct.isLoading || tags.isLoading) };
}

function journalFor(
  movementKey: string,
  movement: ReturnType<typeof findMovement> extends infer T
    ? T extends { movement: infer M }
      ? M
      : never
    : never,
  directData: TrackedResultRow[] | undefined,
  tagData: RawTagRow[] | undefined,
): JournalRow[] {
  const directRows = (directData ?? [])
    .filter((r) => r.movement_key === movementKey)
    .map((r) => ({
      id: r.id,
      workout_id: r.workout_id,
      movement_key: r.movement_key,
      track_key: r.track_key,
      value_numeric: r.value_numeric,
      value_seconds: r.value_seconds,
      value_unit: r.value_unit,
      notes: r.notes,
      performed_at: r.performed_at,
    }));

  const tagRows: TagInputRow[] = (tagData ?? [])
    .filter((t) => t.movement_key === movementKey)
    .map((t) => {
      const scheme = t.track_key
        ? movement.schemes.find((s) => s.key === t.track_key)
        : undefined;
      const derived =
        scheme && t.section
          ? deriveTagValue(scheme, t.section)
          : { value_numeric: null, value_seconds: null };
      return {
        id: t.id,
        workout_id: t.section?.workout_id ?? null,
        section_title: null,
        movement_key: t.movement_key,
        track_key: t.track_key,
        notes: t.notes,
        performed_at: t.performed_at,
        value_numeric: derived.value_numeric,
        value_seconds: derived.value_seconds,
        value_unit: scheme?.metric === 'weight' ? 'kg' : null,
      };
    });

  return mergeJournal(directRows, tagRows);
}
