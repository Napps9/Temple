import { describe, expect, it } from 'vitest';

import { coerceDocument, documentWarnings, type SiteDocument } from '../../src/lib/site-blocks';
import { LEFT_MEMBER_COUNT, buildDemoPlan, type DemoConfig } from './plan';

const CONFIG: DemoConfig = {
  slug: 'demo-ironworks',
  gymName: 'Ironworks Strength Club',
  members: 40,
  weeksBack: 4,
  weeksForward: 2,
  historyWeeks: 10,
  tz: 'Europe/London',
  seed: 42,
  now: new Date('2026-07-06T10:00:00.000Z'),
};

const plan = buildDemoPlan(CONFIG);

describe('buildDemoPlan', () => {
  it('is deterministic: same config → deep-equal plan', () => {
    expect(buildDemoPlan(CONFIG)).toEqual(plan);
  });

  it('rejects non-demo slugs and out-of-range member counts', () => {
    expect(() => buildDemoPlan({ ...CONFIG, slug: 'ironworks' })).toThrow(/demo-/);
    expect(() => buildDemoPlan({ ...CONFIG, slug: 'demo-UPPER' })).toThrow(/demo-/);
    expect(() => buildDemoPlan({ ...CONFIG, members: 5 })).toThrow(/members/);
  });

  it('creates owner + 2 coaches + N members, all on the reserved demo domain', () => {
    expect(plan.users).toHaveLength(1 + 2 + CONFIG.members);
    for (const u of plan.users) {
      expect(u.email.endsWith('@demo-ironworks.temple.test')).toBe(true);
    }
    expect(new Set(plan.users.map((u) => u.email)).size).toBe(plan.users.length);
  });

  it('keeps pending-member emails disjoint from real member emails', () => {
    const userEmails = new Set(plan.users.map((u) => u.email));
    for (const p of plan.pendingMembers) {
      expect(userEmails.has(p.email)).toBe(false);
      expect(p.email.endsWith('@demo-ironworks.temple.test')).toBe(true);
    }
  });

  it('memberships cover every user; consents cover exactly the non-left users', () => {
    expect(plan.memberships).toHaveLength(plan.users.length);
    const left = plan.memberships.filter((m) => m.left_at != null);
    expect(left).toHaveLength(LEFT_MEMBER_COUNT);
    expect(plan.consents).toHaveLength(plan.users.length - LEFT_MEMBER_COUNT);
    const leftIds = new Set(left.map((m) => m.profile_id));
    for (const c of plan.consents) expect(leftIds.has(c.profile_id)).toBe(false);
  });

  it('every subscription matches its parent membership gym+profile (the 0008 trigger invariant)', () => {
    const membershipById = new Map(plan.memberships.map((m) => [m.id!, m]));
    expect(plan.subscriptions).toHaveLength(CONFIG.members);
    for (const sub of plan.subscriptions) {
      const parent = membershipById.get(sub.gym_membership_id);
      expect(parent).toBeTruthy();
      expect(parent!.profile_id).toBe(sub.profile_id);
      expect(parent!.gym_id).toBe(sub.gym_id);
    }
    const lapsed = plan.subscriptions.filter((s) => s.status === 'lapsed');
    expect(lapsed).toHaveLength(LEFT_MEMBER_COUNT);
  });

  it('FK closure: every child row references an id that exists in the plan', () => {
    const profileIds = new Set(plan.users.map((u) => u.id));
    const sessionIds = new Set(plan.sessions.map((s) => s.id!));
    const workoutIds = new Set(plan.workouts.map((w) => w.id!));
    const raceIds = new Set(plan.hyroxRaces.map((r) => r.id!));
    const typeIds = new Set(plan.classTypes.map((t) => t.id!));
    const recurrenceIds = new Set(plan.recurrences.map((r) => r.id!));
    const sourceIds = new Set(plan.leadSources.map((s) => s.id!));
    const injuryIds = new Set(plan.injuries.map((i) => i.id!));

    for (const s of plan.sessions) {
      expect(typeIds.has(s.class_type_id!)).toBe(true);
      expect(recurrenceIds.has(s.recurrence_id!)).toBe(true);
      expect(profileIds.has(s.created_by)).toBe(true);
      expect(profileIds.has(s.coach_id!)).toBe(true);
    }
    for (const b of plan.bookings) {
      expect(sessionIds.has(b.class_session_id)).toBe(true);
      expect(profileIds.has(b.profile_id)).toBe(true);
    }
    for (const w of plan.waitlist) {
      expect(sessionIds.has(w.class_session_id)).toBe(true);
      expect(profileIds.has(w.profile_id)).toBe(true);
    }
    for (const r of plan.movementResults) {
      expect(workoutIds.has(r.workout_id)).toBe(true);
      expect(profileIds.has(r.profile_id)).toBe(true);
    }
    for (const r of plan.hyroxRaces) expect(workoutIds.has(r.workout_id)).toBe(true);
    for (const s of plan.hyroxSplits) expect(raceIds.has(s.race_id)).toBe(true);
    for (const l of plan.leads) expect(sourceIds.has(l.source_id!)).toBe(true);
    for (const a of plan.staffAlerts) expect(injuryIds.has(a.related_id!)).toBe(true);
  });

  it('bookings are unique per (session, profile) and never exceed capacity', () => {
    const seen = new Set<string>();
    const perSession = new Map<string, number>();
    for (const b of plan.bookings) {
      const key = `${b.class_session_id}:${b.profile_id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      perSession.set(b.class_session_id, (perSession.get(b.class_session_id) ?? 0) + 1);
    }
    const capacityById = new Map(plan.sessions.map((s) => [s.id!, s.capacity ?? 12]));
    for (const [sessionId, count] of perSession) {
      expect(count).toBeLessThanOrEqual(capacityById.get(sessionId)!);
    }
  });

  it('waitlist queues behind a genuinely full future session', () => {
    expect(plan.waitlist).toHaveLength(3);
    expect(plan.waitlist.map((w) => w.position)).toEqual([1, 2, 3]);
    const sessionId = plan.waitlist[0].class_session_id;
    const session = plan.sessions.find((s) => s.id === sessionId)!;
    expect(session.starts_at > CONFIG.now.toISOString()).toBe(true);
    const booked = plan.bookings.filter((b) => b.class_session_id === sessionId);
    expect(booked).toHaveLength(session.capacity!);
    const bookedIds = new Set(booked.map((b) => b.profile_id));
    for (const w of plan.waitlist) expect(bookedIds.has(w.profile_id)).toBe(false);
  });

  it('attendance marks exist only on past sessions', () => {
    const nowISO = CONFIG.now.toISOString();
    const sessionById = new Map(plan.sessions.map((s) => [s.id!, s]));
    let attended = 0;
    for (const b of plan.bookings) {
      const session = sessionById.get(b.class_session_id)!;
      if (b.attended_at || b.no_show) {
        expect(session.starts_at <= nowISO).toBe(true);
        expect(b.marked_by).toBeTruthy();
      }
      if (b.attended_at) attended++;
      expect(b.attended_at && b.no_show).toBeFalsy();
    }
    expect(attended).toBeGreaterThan(100);
  });

  it('movement results carry exactly one value matching the metric', () => {
    for (const r of plan.movementResults) {
      const hasNumeric = r.value_numeric != null;
      const hasSeconds = r.value_seconds != null;
      expect(hasNumeric !== hasSeconds).toBe(true);
      if (hasNumeric) expect(r.value_unit).toBe('kg');
    }
    expect(plan.movementResults.length).toBeGreaterThan(200);
  });

  it('hyrox race totals satisfy the 0096 CHECKs against their splits', () => {
    expect(plan.hyroxRaces).toHaveLength(2);
    for (const race of plan.hyroxRaces) {
      const splits = plan.hyroxSplits.filter((s) => s.race_id === race.id);
      expect(splits).toHaveLength(24);
      const sum = (t: string) =>
        splits.filter((s) => s.segment_type === t).reduce((a, s) => a + s.time_seconds, 0);
      expect(race.run_total_seconds).toBe(sum('run'));
      expect(race.station_total_seconds).toBe(sum('station'));
      expect(race.roxzone_total_seconds).toBe(sum('roxzone'));
      expect(race.total_seconds).toBe(sum('run') + sum('station') + sum('roxzone'));
    }
  });

  it('leads cover all six statuses and the conversion points at a real member', () => {
    const statuses = new Set(plan.leads.map((l) => l.status));
    expect(statuses).toEqual(new Set(['cold', 'contacted', 'intro_booked', 'trial_attended', 'converted', 'lost']));
    const converted = plan.leads.find((l) => l.status === 'converted')!;
    expect(plan.users.some((u) => u.id === converted.converted_profile_id)).toBe(true);
  });

  it('site design round-trips coerceDocument unchanged and has no publish blockers', () => {
    const design = plan.website.design as unknown as SiteDocument;
    expect(coerceDocument(JSON.parse(JSON.stringify(design)))).toEqual(design);
    expect(documentWarnings(design)).toEqual([]);
    expect(plan.website.published).toBe(true);
  });

  it('sessions land inside the configured window with the recurrence horizon set', () => {
    expect(plan.sessions.length).toBeGreaterThan(80);
    for (const r of plan.recurrences) {
      expect(r.materialized_until).toBeTruthy();
    }
    const starts = plan.sessions.map((s) => s.starts_at).sort();
    const lo = new Date(CONFIG.now.getTime() - (CONFIG.weeksBack * 7 + 1) * 86_400_000).toISOString();
    const hi = new Date(CONFIG.now.getTime() + (CONFIG.weeksForward * 7 + 1) * 86_400_000).toISOString();
    expect(starts[0] >= lo).toBe(true);
    expect(starts[starts.length - 1] <= hi).toBe(true);
  });

  it('direct messages leave exactly one unread inbound line per thread', () => {
    expect(plan.directMessages.length).toBeGreaterThanOrEqual(8);
    const unread = plan.directMessages.filter((m) => m.read_at == null);
    expect(unread).toHaveLength(3);
  });
});
