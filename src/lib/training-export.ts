// Handing somebody their training record.
//
// Free, and not behind the athlete tier: 0237 put BROWSING the history
// behind the subscription because that is the product, but a copy of your
// own data is a right rather than a feature and cannot be sold back to
// you. The RPC underneath is `security definer` for exactly that reason —
// it answers when the policies do not.

import { downloadFile } from './download';

export type TrainingSummary = {
  workouts: number;
  results: number;
  races: number;
  gyms: number;
  first_at: string | null;
  last_at: string | null;
};

export function exportFilename(now: Date): string {
  return `temple-training-history-${now.toISOString().slice(0, 10)}.json`;
}

// What the locked card says. Kept pure and separate from the screen so the
// plurals and the empty case are testable — "1 sessions" on the one screen
// whose job is to be worth paying for would undo the whole pitch.
export function waitingLine(s: TrainingSummary): string {
  if (s.workouts === 0) return 'Nothing logged yet.';
  const sessions = `${s.workouts} session${s.workouts === 1 ? '' : 's'}`;
  const since = s.first_at
    ? ` since ${new Date(s.first_at).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })}`
    : '';
  const gyms =
    s.gyms > 1 ? `, across ${s.gyms} gyms` : s.gyms === 1 ? ', at one gym' : '';
  return `${sessions}${since}${gyms}.`;
}

export async function shareTrainingExport(
  payload: unknown,
  now: Date = new Date(),
): Promise<void> {
  await downloadFile(
    exportFilename(now),
    JSON.stringify(payload, null, 2),
    'application/json',
  );
}
