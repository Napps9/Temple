import { describe, expect, it } from 'vitest';

import { BACK_OFFICE, visibleEntries } from './back-office';
import {
  entryDestination,
  findScreenAnswer,
  usageAnswer,
  type RouteUsageRow,
} from './back-office-answers';

const owner = visibleEntries(() => true, 'owner');

describe('where a screen lives', () => {
  it('names the one that matched, and how to get there', () => {
    const a = findScreenAnswer('coach earnings', owner);
    expect(a.title).toBe('Coach earnings');
    expect(a.offer).toEqual({
      label: 'Open Coach earnings',
      href: '/management/coach-earnings',
    });
    expect(a.choices).toBeUndefined();
  });

  // A surface folded into the Settings tab has no route, so the door has
  // to name the section. This is the one place in the app that builds that
  // URL — the Manage screen's own tiles set state instead, because a link
  // back to the screen you are standing on is not navigation.
  it('sends you to the section for a surface with no route', () => {
    const a = findScreenAnswer('leaderboards', owner);
    expect(a.offer?.href).toBe('/management?section=leaderboards');
  });

  it('tells you the sentence instead, where there is one', () => {
    const a = findScreenAnswer('coach pay', owner);
    expect(a.lines.join(' ')).not.toMatch(/Or just say/);
    const store = findScreenAnswer('stock', owner);
    expect(store.lines.join(' ')).toMatch(/Or just say “how is the shop doing”/);
  });

  it('asks which one rather than guessing', () => {
    const a = findScreenAnswer('members', owner);
    expect(a.choices!.length).toBeGreaterThan(1);
    expect(a.offer).toBeUndefined();
    // Each chip re-asks the same action with the ambiguity settled.
    for (const c of a.choices!) expect(c.args).toEqual({ what: c.label });
  });

  it('says so rather than inventing a door', () => {
    const a = findScreenAnswer('kettlebell juggling', owner);
    expect(a.title).toMatch(/Nothing behind Manage matches/);
    expect(a.offer).toBeUndefined();
    expect(a.choices).toBeUndefined();
  });

  // The whole point of filtering by capability inside the answer: the
  // vocabulary filter cannot help here, because the action is allowed and
  // only its RESULTS are privileged.
  it('never names a screen the asker cannot open', () => {
    const coach = visibleEntries((c) => c === 'can_view_sops', 'coach');
    expect(findScreenAnswer('billing', coach).offer).toBeUndefined();
    expect(findScreenAnswer('stripe', coach).title).toMatch(/Nothing behind/);
    expect(findScreenAnswer('sops', coach).title).toBe('SOPs');
  });

  // Billing and Setup are gated on being the owner and on no capability at
  // all, so an answer built from capabilities alone would have told the one
  // person who can connect Stripe that there is nowhere to do it.
  it('finds the two surfaces gated on role rather than capability', () => {
    const ownerNoCaps = visibleEntries(() => false, 'owner');
    expect(findScreenAnswer('stripe', ownerNoCaps).title).toBe('Billing & payments');
    expect(findScreenAnswer('onboarding', ownerNoCaps).title).toBe('Set up your gym');
    const adminNoCaps = visibleEntries(() => false, 'admin');
    expect(findScreenAnswer('stripe', adminNoCaps).title).toMatch(/Nothing behind/);
  });

  it('builds a section destination only for a folded surface', () => {
    for (const e of BACK_OFFICE) {
      const dest = entryDestination(e);
      expect(dest.includes('?section=')).toBe(!!e.section);
    }
  });
});

describe('what gets opened', () => {
  const rows: RouteUsageRow[] = [
    { route: '/management', opens: 41, last_opened: '2026-07-30' },
    { route: '/management/members', opens: 12, last_opened: '2026-07-29' },
  ];

  // Not recorded and zero are different facts. Only one of them is a
  // reason to delete something, and with no gyms on the platform the
  // honest answer is the other one.
  it('says nothing is recorded rather than reporting a zero', () => {
    const a = usageAnswer([], BACK_OFFICE, 90);
    expect(a.title).toMatch(/No screen has been opened/);
    expect(a.lines.join(' ')).toMatch(/not the same as everything being unused/);
  });

  it('ranks what was opened', () => {
    const a = usageAnswer(rows, BACK_OFFICE, 30);
    expect(a.title).toMatch(/the last 30 days/);
    expect(a.lines[0]).toMatch(/\/management — 41 opens/);
    expect(a.lines[0]).toMatch(/\/management\/members — 12 opens/);
  });

  it('names the ones nobody opened', () => {
    const a = usageAnswer(rows, BACK_OFFICE, 90);
    const said = a.lines.join(' ');
    expect(said).toMatch(/Nobody has opened these/);
    expect(said).toMatch(/Coach earnings/);
    // Opened, so it must not be in the never list.
    expect(said).not.toMatch(/opened these in the last 90 days:[^.]*Members,/);
  });

  // The folded surfaces all record as /management, so their absence from
  // the table says nothing at all. Left unsaid, a reader would take it as
  // silence and delete something.
  it('says out loud what it cannot answer for', () => {
    const a = usageAnswer(rows, BACK_OFFICE, 90);
    expect(a.lines.join(' ')).toMatch(/Settings sections are not in this/);
    for (const e of BACK_OFFICE.filter((x) => x.section)) {
      expect(a.lines.join(' ')).not.toMatch(
        new RegExp(`Nobody has opened[^.]*${e.title}`),
      );
    }
  });

  it('singular reads as a sentence', () => {
    const one: RouteUsageRow[] = [
      { route: '/management/goals', opens: 1, last_opened: '2026-07-30' },
    ];
    expect(usageAnswer(one, BACK_OFFICE, 7).lines[0]).toMatch(/1 open\b/);
  });
});
