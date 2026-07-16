// Fuzzy person-matching for the member importer, to catch a member who
// appears twice under different emails — e.g. their Stripe email differs
// from the email in a CSV export. Email is the system's join key, so
// these slip past the exact-email overlap check; this flags them so an
// owner doesn't stage a duplicate (or double-bill a Stripe subscriber
// brought in via CSV).
//
// Pure + dependency-free so it unit-tests cleanly.

// Lowercase, strip accents, drop anything that isn't a letter or space,
// collapse whitespace. "José  Núñez-Smith" -> "jose nunez smith". A single
// comma is read as surname-first ("Smith, John" -> "john smith") so a
// name stored that way still matches its natural-order twin.
export function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  let n = name;
  const parts = n.split(',');
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    n = `${parts[1].trim()} ${parts[0].trim()}`;
  }
  return n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(name: string | null | undefined): string[] {
  const n = normalizeName(name);
  return n ? n.split(' ') : [];
}

// Fuzzy name equality: identical normalized names, or the same first AND
// last token (tolerates an added/removed middle name or initial —
// "John Smith" vs "John A Smith"). Single-token names must match exactly.
export function namesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  if (ta.length >= 2 && tb.length >= 2) {
    return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
  }
  return false;
}

function isoDate(d: string | null | undefined): string {
  const s = (d ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// Both dates present (ISO YYYY-MM-DD) and equal.
export function dobsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = isoDate(a);
  return na !== '' && na === isoDate(b);
}

export type Person = { name: string | null | undefined; dob?: string | null };

export type MatchResult = { match: boolean; confidence: 'name' | 'name+dob' };

// Does `row` likely refer to the same person as `candidate`?
//   - Requires a fuzzy name match.
//   - When BOTH carry a DOB, the DOBs must also match — this both raises
//     confidence and rules out two different same-name people.
//   - When either side has no DOB (e.g. a Stripe subscriber), it's a
//     name-only match — reported at lower confidence so the caller can
//     treat it as "review", not "certain".
export function isLikelyDuplicate(row: Person, candidate: Person): MatchResult {
  if (!namesMatch(row.name, candidate.name)) {
    return { match: false, confidence: 'name' };
  }
  const bothHaveDob = isoDate(row.dob) !== '' && isoDate(candidate.dob) !== '';
  if (bothHaveDob) {
    return dobsMatch(row.dob, candidate.dob)
      ? { match: true, confidence: 'name+dob' }
      : { match: false, confidence: 'name+dob' };
  }
  return { match: true, confidence: 'name' };
}
