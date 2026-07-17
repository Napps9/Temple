// AI-assisted resolution of unmatched movement names for the workout
// importer. Sends only the DEDUPED distinct names plus the movement
// vocab (key + display name) to the infer-import edge function — never
// per-member rows, and names are generic gym vocabulary, not PII. Falls
// back to [] whenever the AI is unavailable, so the caller just keeps
// those names unresolved (the deterministic vocab match still stands).

import { supabase } from '@/lib/supabase';

import { movementVocab, normaliseMovementName } from './workout-columns';

export type MovementResolution = {
  name: string; // the original unmatched value
  key: string; // resolved movement vocab key
  confidence: 'high' | 'medium' | 'low';
};

export async function resolveMovements(
  gymId: string,
  names: string[],
): Promise<MovementResolution[]> {
  const distinct = Array.from(
    new Set(names.map((n) => n.trim()).filter(Boolean)),
  );
  if (distinct.length === 0) return [];
  try {
    const { data, error } = await supabase.functions.invoke('infer-import', {
      body: {
        mode: 'resolve_movements',
        gym_id: gymId,
        names: distinct,
        vocab: movementVocab(),
      },
    });
    if (error || !data) return [];
    const rows = (data as { resolutions?: MovementResolution[] }).resolutions;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// Normalised override map for buildResults, from the resolutions the
// owner accepted.
export function overridesFrom(
  resolutions: MovementResolution[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of resolutions) m.set(normaliseMovementName(r.name), r.key);
  return m;
}
