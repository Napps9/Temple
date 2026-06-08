// Movement-tag auto-detection from programmed body text.
//
// At pre-fill time we scan the section's title + body for movement
// names and rep-scheme hints, then seed the section's movement_tags
// so the member doesn't have to tap to add each one. The member can
// still remove or edit any auto-detected tag before saving.
//
// Rules:
//   - Aliases are registered per movement in src/lib/movements.ts.
//     Bare-ambiguous words like "squat" / "press" / "snatch" /
//     "jerk" are NOT registered as aliases of any movement, so the
//     detector skips them and leaves the member to pick.
//   - Longest match wins inside a single text span — "back squat"
//     beats a hypothetical bare "squat" alias and beats a (legitimate)
//     "strict pull up" beating "pull up".
//   - Overlapping matches in the same text region are deduped:
//     the first (longest) match wins; subsequent matches starting
//     inside its span are discarded.
//   - Rep-scheme inference is a separate, narrower heuristic: we
//     look for "NxM" / "Nx M" / "N x M" patterns and a few
//     longhand phrasings ("1RM", "1 rep max"). When the rep target
//     M ∈ {1, 3, 5, 10}, we attach that as the suggested track_key.
//     Otherwise the auto-tag goes in with no scheme; the member
//     can attach one later.
//   - Detection runs on lowercased input.

import { MOVEMENT_GROUPS, type Movement } from './movements';

export type DetectedTag = {
  movement_key: string;
  track_key: string | null;
};

type AliasEntry = {
  alias: string;        // lowercase, normalised whitespace
  movement_key: string;
  schemeKeys: Set<string>; // keys of available rep-max schemes (e.g. '1rm','5rm')
};

function flattenAliases(): AliasEntry[] {
  const out: AliasEntry[] = [];
  for (const group of MOVEMENT_GROUPS) {
    for (const m of group.movements) {
      const schemeKeys = new Set(m.schemes.map((s) => s.key));
      for (const a of m.aliases ?? []) {
        out.push({
          alias: a.toLowerCase().replace(/\s+/g, ' ').trim(),
          movement_key: m.key,
          schemeKeys,
        });
      }
    }
  }
  // Sort by alias length descending so longest match wins in the
  // sweep below.
  out.sort((a, b) => b.alias.length - a.alias.length);
  return out;
}

const ALIAS_INDEX = flattenAliases();

// Try to infer a rep-max scheme key ('1rm', '3rm', '5rm', '10rm')
// from the surrounding text. We look for the simplest, highest-
// confidence patterns only:
//   - "NxM" / "N x M" / "Nx M"  → M is the rep target
//   - "1RM" / "3RM" / etc.       → explicit
//   - "N-rep max" / "N rep max"  → explicit
// Returns null when no confident inference is possible.
const REP_MAX_KEYS = new Set(['1rm', '3rm', '5rm', '10rm']);

export function inferTrackKey(
  text: string,
  schemeKeys: Set<string>,
): string | null {
  const lower = text.toLowerCase();
  // Explicit "NRM" or "N-rep max" / "N rep max" first.
  const explicit = lower.match(/(\d+)\s*(?:rm|-?\s*rep\s*max)/);
  if (explicit) {
    const key = `${explicit[1]}rm`;
    if (REP_MAX_KEYS.has(key) && schemeKeys.has(key)) return key;
  }
  // "NxM" pattern — the second number is the rep target.
  const cross = lower.match(/(\d+)\s*[x×]\s*(\d+)/);
  if (cross) {
    const target = cross[2];
    const key = `${target}rm`;
    if (REP_MAX_KEYS.has(key) && schemeKeys.has(key)) return key;
  }
  return null;
}

// Word-boundary check so "row" matches "row, 500m" but not
// "thrower". JavaScript's regex \b on plain string boundaries
// isn't enough when the alias has spaces, so we hand-check the
// characters immediately around the matched span.
function isWordBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  const isWord = (c: string) => /[a-z0-9]/.test(c);
  if (before && isWord(before)) return false;
  if (after && isWord(after)) return false;
  return true;
}

export function detectMovementsInText(text: string): DetectedTag[] {
  if (!text || !text.trim()) return [];
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  // Track which character spans have been claimed so a later
  // shorter alias doesn't double-tag inside a longer one.
  type Claim = { start: number; end: number };
  const claims: Claim[] = [];
  const tags: DetectedTag[] = [];
  // De-dup against the same (movement, track) being matched twice
  // by two aliases — keep the first.
  const seen = new Set<string>();

  for (const entry of ALIAS_INDEX) {
    const alias = entry.alias;
    let searchFrom = 0;
    while (searchFrom <= lower.length - alias.length) {
      const found = lower.indexOf(alias, searchFrom);
      if (found < 0) break;
      const end = found + alias.length;
      searchFrom = end;
      if (!isWordBoundary(lower, found, end)) continue;
      // Skip if this span overlaps a longer claim.
      if (claims.some((c) => found < c.end && end > c.start)) continue;
      // Take the claim.
      claims.push({ start: found, end });
      const trackKey = inferTrackKey(text, entry.schemeKeys);
      const dedupKey = `${entry.movement_key}::${trackKey ?? ''}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      tags.push({
        movement_key: entry.movement_key,
        track_key: trackKey,
      });
    }
  }
  return tags;
}

// Convenience for tests / callers that want to inspect what aliases
// exist for a movement (validates a Movement is detectable).
export function aliasesFor(movement: Movement): string[] {
  return movement.aliases ?? [];
}
