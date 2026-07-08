import { describe, expect, it } from 'vitest';

import {
  buildTasteProfile,
  hourAffinity,
  scoreSession,
  type AttendedRow,
} from './recommend';

const NOW = new Date('2026-07-08T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

function attended(typeId: string, daysAgo: number, hour: number): AttendedRow {
  const at = new Date(NOW - daysAgo * DAY);
  const started = new Date(at);
  started.setHours(hour, 0, 0, 0);
  return {
    typeId,
    startedAt: started.toISOString(),
    attendedAt: at.toISOString(),
  };
}

describe('buildTasteProfile', () => {
  it('weights recent attendance more than old attendance', () => {
    const profile = buildTasteProfile(
      [attended('crossfit', 0, 6), attended('engine', 42, 6)],
      NOW,
    );
    // engine was two half-lives (42d) ago → ~0.25 weight; crossfit today → 1.
    expect(profile.affinity.get('crossfit')!).toBeGreaterThan(
      profile.affinity.get('engine')! * 3,
    );
  });

  it('records attended hours per type', () => {
    const profile = buildTasteProfile(
      [attended('crossfit', 1, 6), attended('crossfit', 2, 6)],
      NOW,
    );
    expect(profile.hoursByType.get('crossfit')!.has(6)).toBe(true);
  });

  it('ignores rows with no type or start', () => {
    const profile = buildTasteProfile(
      [{ typeId: null, startedAt: null, attendedAt: new Date(NOW).toISOString() }],
      NOW,
    );
    expect(profile.affinity.size).toBe(0);
  });
});

describe('hourAffinity', () => {
  it('scores an exact-hour match highest', () => {
    const hist = new Map([[6, 1]]);
    expect(hourAffinity(hist, 6)).toBeGreaterThan(hourAffinity(hist, 9));
    expect(hourAffinity(hist, 9)).toBeGreaterThan(hourAffinity(hist, 18));
  });

  it('wraps around midnight', () => {
    const hist = new Map([[23, 1]]);
    // 01:00 is 2h from 23:00 across midnight, not 22h.
    expect(hourAffinity(hist, 1)).toBeGreaterThan(hourAffinity(hist, 12));
  });

  it('is zero with no history', () => {
    expect(hourAffinity(undefined, 6)).toBe(0);
    expect(hourAffinity(new Map(), 6)).toBe(0);
  });
});

describe('scoreSession', () => {
  it('prefers the more-attended class type', () => {
    const rows = [
      attended('crossfit', 1, 6),
      attended('crossfit', 2, 6),
      attended('engine', 3, 6),
    ];
    const profile = buildTasteProfile(rows, NOW);
    const max = Math.max(...profile.affinity.values());
    const soon = new Date(NOW + DAY).toISOString();
    const cf = scoreSession(profile, max, { class_type_id: 'crossfit', starts_at: soon }, NOW);
    const en = scoreSession(profile, max, { class_type_id: 'engine', starts_at: soon }, NOW);
    expect(cf).toBeGreaterThan(en);
  });

  it('prefers the session near the member usual training hour', () => {
    const rows = [attended('crossfit', 1, 6), attended('crossfit', 2, 6)];
    const profile = buildTasteProfile(rows, NOW);
    const max = Math.max(...profile.affinity.values());
    const morning = new Date(NOW + DAY);
    morning.setHours(6, 0, 0, 0);
    const evening = new Date(NOW + DAY);
    evening.setHours(18, 0, 0, 0);
    const am = scoreSession(
      profile,
      max,
      { class_type_id: 'crossfit', starts_at: morning.toISOString() },
      NOW,
    );
    const pm = scoreSession(
      profile,
      max,
      { class_type_id: 'crossfit', starts_at: evening.toISOString() },
      NOW,
    );
    expect(am).toBeGreaterThan(pm);
  });

  it('nudges toward sooner sessions, all else equal', () => {
    const rows = [attended('crossfit', 1, 6), attended('crossfit', 2, 6)];
    const profile = buildTasteProfile(rows, NOW);
    const max = Math.max(...profile.affinity.values());
    const mk = (days: number) => {
      const d = new Date(NOW + days * DAY);
      d.setHours(6, 0, 0, 0);
      return d.toISOString();
    };
    const tomorrow = scoreSession(profile, max, { class_type_id: 'crossfit', starts_at: mk(1) }, NOW);
    const nextWeek = scoreSession(profile, max, { class_type_id: 'crossfit', starts_at: mk(8) }, NOW);
    expect(tomorrow).toBeGreaterThan(nextWeek);
  });

  it('scores an unseen type on time-of-day and soonness only', () => {
    const profile = buildTasteProfile([attended('crossfit', 1, 6)], NOW);
    const max = Math.max(...profile.affinity.values());
    const soon = new Date(NOW + DAY).toISOString();
    const score = scoreSession(profile, max, { class_type_id: 'yoga', starts_at: soon }, NOW);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(1);
  });
});
