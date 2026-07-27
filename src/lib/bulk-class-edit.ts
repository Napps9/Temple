// Input parsing and result wording for the bulk class-edit modal.
//
// bulk_edit_sessions (0169) takes three nullable values where null means
// "leave unchanged", and returns four counters rather than raising when
// individual classes can't take the change. Both halves need turning
// into something a human reads, and both are easier to get right — and
// to test — away from the modal.

export type BulkEditFields = {
  capacity: number | null;
  durationMinutes: number | null;
  shiftMinutes: number | null;
};

export type BulkEditResult = {
  updated: number;
  skipped_overbooked: number;
  skipped_past: number;
  skipped_conflict: number;
  notified: number;
  recurrences_updated: number;
  recurrences_split: number;
  recurrences_unchanged: number;
};

// Blank means "leave unchanged", which is why this can't just be
// Number(): Number('') is 0, and a capacity of 0 is a different
// instruction from not touching capacity at all.
export function parseOptionalInt(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^-?\d+$/.test(trimmed)) return 'invalid';
  return Number(trimmed);
}

export function validateBulkEdit(
  capacity: string,
  duration: string,
  shift: string,
): { error: string } | { fields: BulkEditFields } {
  const c = parseOptionalInt(capacity);
  const d = parseOptionalInt(duration);
  const s = parseOptionalInt(shift);

  if (c === 'invalid') return { error: 'Capacity must be a whole number' };
  if (d === 'invalid') return { error: 'Duration must be a whole number' };
  if (s === 'invalid') return { error: 'The time shift must be a whole number' };
  if (c !== null && c < 1) return { error: 'Capacity must be at least 1' };
  if (d !== null && d < 1) return { error: 'Duration must be at least 1 minute' };
  if (c === null && d === null && s === null) {
    return { error: 'Change at least one of capacity, duration or start time' };
  }
  return { fields: { capacity: c, durationMinutes: d, shiftMinutes: s } };
}

function shiftPhrase(minutes: number): string {
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (mins || !hours) parts.push(`${mins}m`);
  return `${parts.join(' ')} ${minutes > 0 ? 'later' : 'earlier'}`;
}

export function describeBulkEdit(fields: BulkEditFields, classCount: number): string {
  const changes: string[] = [];
  if (fields.capacity !== null) changes.push(`capacity ${fields.capacity}`);
  if (fields.durationMinutes !== null) {
    changes.push(`${fields.durationMinutes} minutes long`);
  }
  if (fields.shiftMinutes !== null && fields.shiftMinutes !== 0) {
    changes.push(`starting ${shiftPhrase(fields.shiftMinutes)}`);
  }
  if (changes.length === 0) return 'Nothing will change.';
  const noun = classCount === 1 ? '1 class' : `${classCount} classes`;
  return `${noun}: ${changes.join(', ')}.`;
}

export function describeBulkEditResult(result: BulkEditResult): string {
  const parts = [
    result.updated === 1 ? '1 class updated' : `${result.updated} classes updated`,
  ];
  if (result.skipped_overbooked > 0) {
    parts.push(
      `${result.skipped_overbooked} left alone — more members are booked in than the new capacity`,
    );
  }
  if (result.skipped_past > 0) {
    parts.push(`${result.skipped_past} skipped — the new time is in the past`);
  }
  if (result.skipped_conflict > 0) {
    parts.push(
      `${result.skipped_conflict} skipped — the new time clashes with another class in the series`,
    );
  }
  if (result.notified > 0) {
    parts.push(
      result.notified === 1 ? '1 member told' : `${result.notified} members told`,
    );
  }
  // Only worth saying when it did NOT happen. A rewritten or split schedule
  // is the expected outcome and needs no commentary; a schedule left behind
  // means the change will not survive the next edit to it, which the
  // operator has to know.
  if (result.recurrences_unchanged > 0) {
    parts.push(
      result.recurrences_unchanged === 1
        ? '1 repeating schedule was left as it is, because only some of its classes were picked — editing that schedule later will undo this'
        : `${result.recurrences_unchanged} repeating schedules were left as they are, because only some of their classes were picked — editing those schedules later will undo this`,
    );
  }
  return `${parts.join('. ')}.`;
}
