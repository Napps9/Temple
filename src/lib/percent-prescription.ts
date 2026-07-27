// Pulling percentage prescriptions out of a programmed section body.
//
// `body` is one opaque free-text string — there is no structure to read,
// so the percentages coaches already write ("Back squat 5x5 @ 75%") have
// to be recovered by scanning. The grammar in practice is
//
//     <work movement> @ <pct>% [of <reference>]
//
// and the reference, when stated, comes AFTER the percentage:
// "4x3 clean pull @ 90% of clean" is 90% of the clean, not of the pull.
//
// The load-bearing rule is that a wrong number is worse than no number.
// Anything ambiguous, or relative to a session max rather than an
// all-time one ("70% of today's 1"), resolves to nothing rather than a
// guess. detectMovementsInText already refuses bare "squat"/"clean"/
// "press", which is exactly the ambiguity signal we want.

import { detectMovementsInText } from './movement-detection';
import { findMovement } from './movements';

export type Prescription = {
  // Percentage as written, e.g. 75.
  pct: number;
  // Resolved movement, when we're confident.
  movementKey: string | null;
  // The bare term we couldn't resolve ("clean"), when asking the member
  // is worthwhile. Null when there was nothing to ask about.
  ambiguousTerm: string | null;
  // Set when the percentage isn't a percentage of a loadable all-time
  // max — a session max ("70% of today's 1") or a non-load quantity
  // ("90% effort", "70% max HR"). We show nothing for these.
  skipped: 'session_relative' | 'non_load' | null;
};

// Terms the detector deliberately leaves unresolved because they name a
// family rather than a lift. Seeing one next to a percentage is our cue
// to ask the member which variant they mean.
const AMBIGUOUS_TERMS = [
  'clean and jerk',
  'snatch',
  'clean',
  'jerk',
  'squat',
  'press',
  'deadlift',
  'lift',
];

// "of today's 1", "of your top", "of the top single", "of that".
const SESSION_RELATIVE_RE =
  /^\s*of\s+(?:the\s+|your\s+|that\s+|today'?s?\s+)*(?:today'?s?|top|best|heaviest|max|single|that|it)\b/i;

// A percentage of something that isn't a weight. "5x5 @ 90% effort"
// and "row at 70% max HR" would otherwise resolve against the section
// title and put a load on the bar nobody prescribed.
const NON_LOAD_AFTER_RE =
  /^\s*(?:of\s+)?(?:effort|rpe|max\s*hr|hr|heart\s*rate|pace|bw|bodyweight|body\s*weight|of\s+bodyweight)\b/i;
const NON_LOAD_BEFORE_RE = /\b(?:rpe|effort|max\s*hr|heart\s*rate)\s*$/i;

const PCT_RE = /(\d{1,3})\s*(?:-\s*(\d{1,3})\s*)?%/g;

// Where a clause starts, walking back from a percentage: the previous
// percentage, or a comma / semicolon / newline / "then".
function clauseStart(body: string, upto: number): number {
  const before = body.slice(0, upto);
  const marks = [
    before.lastIndexOf('%'),
    before.lastIndexOf(','),
    before.lastIndexOf(';'),
    before.lastIndexOf('\n'),
  ];
  const thenMatch = /\bthen\b/gi;
  let m: RegExpExecArray | null;
  let lastThen = -1;
  while ((m = thenMatch.exec(before)) !== null) lastThen = m.index + m[0].length;
  marks.push(lastThen);
  return Math.max(0, ...marks.map((i) => (i < 0 ? 0 : i + 1)));
}

function soleWeightedMovement(text: string): string | null {
  const keys = [
    ...new Set(detectMovementsInText(text).map((d) => d.movement_key)),
  ].filter((key) => {
    const hit = findMovement(key);
    return hit?.movement.schemes.some(
      (s) => s.metric === 'weight' && s.better === 'higher',
    );
  });
  return keys.length === 1 ? keys[0] : null;
}

function ambiguousTermIn(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of AMBIGUOUS_TERMS) {
    const re = new RegExp(`(?:^|[^a-z])${term}(?:[^a-z]|$)`, 'i');
    if (re.test(lower)) return term;
  }
  return null;
}

export function findPrescriptions(section: {
  title?: string | null;
  body?: string | null;
}): Prescription[] {
  const body = section.body ?? '';
  if (!body.includes('%')) return [];

  const titleMovement = soleWeightedMovement(section.title ?? '');
  const out: Prescription[] = [];
  PCT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = PCT_RE.exec(body)) !== null) {
    const after = body.slice(match.index + match[0].length);

    const before = body.slice(0, match.index);

    // Both guards run before any movement resolution: a session max or
    // an RPE is not a percentage of an all-time best, so there is
    // nothing to resolve and nothing worth asking the member about.
    if (SESSION_RELATIVE_RE.test(after)) {
      out.push({
        pct: parseInt(match[1], 10),
        movementKey: null,
        ambiguousTerm: null,
        skipped: 'session_relative',
      });
      continue;
    }

    if (NON_LOAD_AFTER_RE.test(after) || NON_LOAD_BEFORE_RE.test(before)) {
      out.push({
        pct: parseInt(match[1], 10),
        movementKey: null,
        ambiguousTerm: null,
        skipped: 'non_load',
      });
      continue;
    }

    // An explicit "of <movement>" after the percentage names the
    // reference lift and beats whatever the work movement was.
    let movementKey: string | null = null;
    let ambiguousTerm: string | null = null;
    const ofPhrase = /^\s*of\s+([^,.;\n]{1,40})/i.exec(after);
    if (ofPhrase) {
      movementKey = soleWeightedMovement(ofPhrase[1]);
      if (!movementKey) ambiguousTerm = ambiguousTermIn(ofPhrase[1]);
    }

    if (!movementKey && !ambiguousTerm) {
      const clause = body.slice(clauseStart(body, match.index), match.index);
      movementKey = soleWeightedMovement(clause);
      if (!movementKey) ambiguousTerm = ambiguousTermIn(clause);
    }

    if (!movementKey && !ambiguousTerm) {
      movementKey = titleMovement;
      if (!movementKey) ambiguousTerm = ambiguousTermIn(section.title ?? '');
    }

    const pcts: number[] = [parseInt(match[1], 10)];
    if (match[2]) pcts.push(parseInt(match[2], 10));
    for (const pct of pcts) {
      out.push({ pct, movementKey, ambiguousTerm, skipped: null });
    }
  }

  return out;
}
