// Pure helpers for the browser "talk to your AI" voice call (Vapi Web SDK).
// Kept RN/Vapi-import-free so they unit-test in node, same as store.ts's
// pure helpers.

export type TranscriptTurn = { role: 'user' | 'assistant'; text: string };

export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${`0${s % 60}`.slice(-2)}`;
}

// Vapi's client 'message' event is typed `any` — narrow to the final
// transcript shape we render as a chat turn. Partial transcripts are
// dropped: they update in place as a phrase is refined, and rendering
// each partial as its own bubble would make the transcript flicker.
export function finalTranscriptTurn(message: unknown): TranscriptTurn | null {
  if (typeof message !== 'object' || message === null) return null;
  const m = message as Record<string, unknown>;
  if (
    m.type === 'transcript' &&
    m.transcriptType === 'final' &&
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.transcript === 'string' &&
    m.transcript.trim().length > 0
  ) {
    return { role: m.role, text: m.transcript.trim() };
  }
  return null;
}

export function transcriptToText(turns: TranscriptTurn[]): string {
  return turns.map((t) => `${t.role === 'assistant' ? 'AI' : 'You'}: ${t.text}`).join('\n');
}
