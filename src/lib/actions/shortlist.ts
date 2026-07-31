// Which verbs to put in front of the model for this sentence.
//
// The catalogue goes up on every message. At 52 actions that is about
// eight thousand tokens a sentence, it is the largest single cost per
// turn, and it grows linearly with a catalogue whose whole point is to
// keep growing. Ranking the actions against what was actually typed and
// sending the top handful cuts it by most of that.
//
// The danger is not the ranking being imperfect — it is the ranking being
// imperfect *silently*. A shortlist that drops the right verb makes the
// bar answer "I can't do that" about something it plainly can, and
// nothing about that failure looks like a bug: no error, no log, just an
// owner learning that Temple cannot do a thing it has done before. So the
// caller retries once with the full catalogue before it ever says no,
// which turns every miss into one extra call instead of a lost capability.
// This module can therefore be judged on cost alone, and its recall is
// measured rather than asserted — see shortlist.test.ts, which scores it
// against every phrasing every action claims for itself.

import type { ActionWire } from './types';

// Words that appear in half the catalogue carry no signal, and the two
// that matter most here are the ones an owner types every time.
const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'did', 'do', 'does', 'for', 'from', 'get', 'got', 'had', 'has', 'have',
  'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'not', 'of', 'on',
  'or', 'our', 'out', 'so', 'that', 'the', 'their', 'them', 'then',
  'there', 'they', 'this', 'to', 'up', 'us', 'was', 'we', 'were', 'what',
  'when', 'which', 'who', 'will', 'with', 'you', 'your',
]);

export function tokenise(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 2) continue;
    // Crude and deliberate: "classes" and "class", "refunds" and "refund"
    // are the same word to an owner and the catalogue writes both.
    const word = raw.endsWith('ies')
      ? `${raw.slice(0, -3)}y`
      : raw.endsWith('es') && raw.length > 4
        ? raw.slice(0, -2)
        : raw.endsWith('s') && !raw.endsWith('ss')
          ? raw.slice(0, -1)
          : raw;
    if (STOP.has(word) || STOP.has(raw)) continue;
    out.push(word);
  }
  return out;
}

// The words an action answers to: its own name, and every phrasing it
// claims in `says` — which is where the owner's real vocabulary lives,
// because it was written as the sentences somebody would actually type.
function vocabularyOf(action: ActionWire): Set<string> {
  return new Set([
    ...tokenise(action.name.replace(/[._]/g, ' ')),
    ...tokenise(action.says),
  ]);
}

export type Scored = { action: ActionWire; score: number };

// Inverse document frequency, so a word in forty actions counts for
// almost nothing and a word in one counts for a lot. Without it "member"
// and "class" drown everything: they are in half the catalogue and in
// almost every sentence.
function idf(count: number, total: number): number {
  return Math.log((total + 1) / (count + 1));
}

export function scoreActions(text: string, actions: ActionWire[]): Scored[] {
  const query = new Set(tokenise(text));
  if (query.size === 0 || actions.length === 0) return [];

  const vocab = actions.map(vocabularyOf);
  const docCount = new Map<string, number>();
  for (const v of vocab) {
    for (const word of v) docCount.set(word, (docCount.get(word) ?? 0) + 1);
  }

  return actions
    .map((action, i) => {
      let score = 0;
      for (const word of query) {
        if (vocab[i].has(word)) score += idf(docCount.get(word) ?? 0, actions.length);
      }
      // Length normalisation, lightly. A `says` that lists six phrasings
      // should not beat a precise one just by covering more ground, but
      // dividing by size outright would punish the actions that document
      // themselves best.
      return { action, score: score / Math.sqrt(vocab[i].size) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.action.name.localeCompare(b.action.name));
}

// `keep` is the escape hatch for context the words cannot carry: the
// action the last card came from, so "do that again" and "the same for
// Sarah" still find it when the sentence itself says almost nothing.
export function shortlist(
  text: string,
  actions: ActionWire[],
  limit = 12,
  keep: string[] = [],
): ActionWire[] {
  const kept = actions.filter((a) => keep.includes(a.name));
  const ranked = scoreActions(text, actions)
    .map((s) => s.action)
    .filter((a) => !keep.includes(a.name));
  const out = [...kept, ...ranked].slice(0, Math.max(limit, kept.length));
  // A sentence that matches nothing is not a reason to send nothing: the
  // model still has to be able to say `cannot` about a real catalogue,
  // and the retry above only fires when it does.
  return out.length > 0 ? out : actions.slice(0, limit);
}
