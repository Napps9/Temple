// What the bar remembers of the last minute.
//
// Every sentence used to go up alone — the text and the catalogue, nothing
// else. So "show me Marcus" then "put him on Unlimited" could not work,
// and the owner named him twice. That is not a model limitation; the
// conversation was simply never sent.
//
// The rule this module exists to enforce is the one from the roadmap: a
// stale subject is worse than no subject. Three days on, "put him on
// Unlimited" must not quietly resolve to whoever happened to be on screen
// then — it should fail to understand, which is recoverable, rather than
// act on the wrong person, which is not. So history is bounded twice, by
// how many turns and by how long ago, and the second bound is the one that
// matters.
//
// Pure and tested here rather than inline in the feed, because "did it
// carry the right subject forward" is exactly the kind of thing that is
// easy to get subtly wrong and impossible to notice.

export type Turn = {
  role: 'owner' | 'gym';
  text: string;
  at: number;
};

// Six turns is three exchanges — enough for "show me Marcus", the card,
// "put him on Unlimited". Beyond that the model is being handed an essay
// to answer one sentence.
export const MAX_TURNS = 6;

// Ten minutes. Long enough to finish a thought, short enough that coming
// back after lunch starts clean. An owner who has walked away and returned
// is a different context even though it is the same screen.
export const FRESH_MS = 10 * 60 * 1000;

const MAX_CHARS = 300;

// The turns worth sending: recent by both measures, oldest first, and
// trimmed. A card's title carries the subject ("Put Marcus Webb on
// Unlimited?"), which is what makes a pronoun resolvable at all — so the
// gym's side is worth keeping, not just the owner's.
export function recentTurns(turns: Turn[], now: number): Turn[] {
  return turns
    .filter((t) => t.text.trim().length > 0 && now - t.at <= FRESH_MS)
    .slice(-MAX_TURNS)
    .map((t) => ({ ...t, text: t.text.trim().slice(0, MAX_CHARS) }));
}

// The wire shape: Anthropic's own alternating roles, so the parser needs
// no translation layer. Consecutive turns from the same side are merged
// rather than sent as two — the API rejects two user messages in a row,
// and a card plus its receipt is genuinely one thing said.
export type WireTurn = { role: 'user' | 'assistant'; content: string };

export function toWireTurns(turns: Turn[]): WireTurn[] {
  const out: WireTurn[] = [];
  for (const t of turns) {
    const role = t.role === 'owner' ? 'user' : 'assistant';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${t.text}`;
    else out.push({ role, content: t.text });
  }
  // A conversation handed to the model has to begin with the owner: the
  // first thing said cannot be a reply to nothing.
  while (out.length > 0 && out[0].role === 'assistant') out.shift();
  return out;
}
