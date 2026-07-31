import { describe, expect, it } from 'vitest';

import {
  buildAgentJobs,
  countWaiting,
  demoMoney,
  type JobsInput,
} from './jobs';

const NOW = new Date('2026-07-31T00:00:00Z');

function input(over: Partial<JobsInput> = {}): JobsInput {
  return {
    gymId: 'gym-1',
    ownerId: 'owner-1',
    now: NOW,
    currency: 'GBP',
    cast: {
      urgentDunning: { id: 'p-urgent', name: 'Ben Brown' },
      softDunning: { id: 'p-soft', name: 'Ella Evans' },
      packHeavy: { id: 'p-heavy', name: 'Mia Murray' },
      packLow: { id: 'p-low', name: 'Finn Foster' },
      quiet: { id: 'p-quiet', name: 'Grace Green' },
      justJoined: { id: 'p-new', name: 'Harry Hughes' },
      coverCoach: 'Priya Sharma',
    },
    prices: {
      unlimitedCents: 7500,
      creditPeriodCents: 5500,
      packCents: 9000,
      packCredits: 10,
      unlimitedName: 'Unlimited',
      creditPeriodName: '8 Classes / Month',
      packName: '10-Class Pack',
    },
    ...over,
  };
}

describe('what the demo gym has taken on', () => {
  // No authority row means no proposal, ever — the whole reason a demo
  // gym without these shows an empty Timeline.
  it('takes on every job that ships', () => {
    const { authority } = buildAgentJobs(input());
    expect(authority.map((a) => a.action_kind).sort()).toEqual([
      'chase_message',
      'cover_ask',
      'credits_low_message',
      'first_week_message',
      'plan_adjustment_offer',
      'plan_upgrade_offer',
      'retention_message',
    ]);
  });

  // A demo that quietly ran the jobs autonomously would be showing a
  // product nobody has agreed to: every set_*_job RPC ships at approval.
  it('at the rope every job actually ships with', () => {
    const { authority } = buildAgentJobs(input());
    expect(authority.every((a) => a.level === 'approval')).toBe(true);
  });

  // Approving a live proposal in a demo has to queue a message rather
  // than raise "No approved template", so every mailing kind needs one.
  // cover_ask is the exception by design — it re-asks through the cover
  // plumbing and never mails a member.
  it('has an approved template for every kind that mails somebody', () => {
    const { authority, templates } = buildAgentJobs(input());
    const mailing = authority
      .map((a) => a.action_kind)
      .filter((k) => k !== 'cover_ask')
      .sort();
    expect(templates.map((t) => t.kind).sort()).toEqual(mailing);
  });
});

describe('a morning, not a to-do list', () => {
  it('leaves a few questions waiting and the rest decided', () => {
    const { actions } = buildAgentJobs(input());
    expect(countWaiting(actions)).toBe(3);
    expect(actions.length).toBeGreaterThan(6);
  });

  // An owner who said yes to everything does not show that no is a real
  // answer, and "you said leave it, so I did" is the line that makes the
  // rope believable.
  it('includes one the owner turned down', () => {
    const { actions } = buildAgentJobs(input());
    expect(actions.some((a) => a.status === 'rejected')).toBe(true);
  });

  it('spreads the history back over a week, none of it in the future', () => {
    const { actions } = buildAgentJobs(input());
    const days = actions.map(
      (a) => (NOW.getTime() - new Date(a.proposed_at).getTime()) / 86_400_000,
    );
    expect(Math.min(...days)).toBeGreaterThan(-1);
    expect(Math.max(...days)).toBeLessThan(7);
  });

  // A decided row with no decided_at, or an executed one with no
  // executed_at, renders as a receipt for something that never happened.
  it('stamps every decision it claims to have made', () => {
    const { actions } = buildAgentJobs(input());
    for (const a of actions) {
      if (a.status === 'proposed') {
        expect(a.decided_at).toBeNull();
        expect(a.executed_at).toBeNull();
      } else {
        expect(a.decided_at).not.toBeNull();
        expect(a.executed_at === null).toBe(a.status === 'rejected');
      }
    }
  });
});

describe('the sums a viewer could check', () => {
  // The upgrade card is the one whose whole content is arithmetic, so a
  // demo where the numbers do not add up is worse than no demo.
  it('computes the upgrade saving from the catalogue rather than asserting it', () => {
    const { actions } = buildAgentJobs(input());
    const upgrade = actions.find((a) => a.action_kind === 'plan_upgrade_offer')!;
    // £90 / 10 = £9 a class, 14 a month = £126, against Unlimited at £75.
    expect(upgrade.payload.upgrade_saving).toBe('£51');
    expect(upgrade.evidence.join(' ')).toContain('£126');
  });

  it('follows the catalogue when the catalogue moves', () => {
    const { actions } = buildAgentJobs(
      input({
        prices: {
          ...input().prices,
          packCents: 12000,
          unlimitedCents: 8000,
        },
      }),
    );
    const upgrade = actions.find((a) => a.action_kind === 'plan_upgrade_offer')!;
    // £120 / 10 = £12 a class, 14 a month = £168, against £80.
    expect(upgrade.payload.upgrade_saving).toBe('£88');
  });

  // Matches public.money_text rather than Intl, which resolves against the
  // runtime locale and would make the seeder's output machine-dependent.
  it('formats money the way the ticks do', () => {
    expect(demoMoney(7500, 'GBP')).toBe('£75');
    expect(demoMoney(5550, 'GBP')).toBe('£55.50');
    expect(demoMoney(7500, 'USD')).toBe('$75');
    expect(demoMoney(7500, 'SEK')).toBe('75 SEK');
  });
});
