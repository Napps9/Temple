import { describe, expect, it } from 'vitest';

import { chainStopLine, leftoverLine, travelTogether } from './chain';

const write = { kind: 'do' as const, canApply: true, confirmable: true };
const question = { ...write, confirmable: false };
const answer = { kind: 'ask' as const, canApply: false, confirmable: false };

describe('when two things can travel together', () => {
  it('takes two writes that both have something to confirm', () => {
    expect(travelTogether([write, write], 2)).toBe(true);
    expect(travelTogether([write, write, write], 3)).toBe(true);
  });

  // The whole point of the rule. "Put him on Unlimited and tag him VIP"
  // where "him" is three people is a question, and agreeing to a question
  // in advance is agreeing to whichever answer the bar picks.
  it('refuses when any step came back as a question', () => {
    expect(travelTogether([write, question], 2)).toBe(false);
    expect(travelTogether([question, write], 2)).toBe(false);
  });

  it('refuses to chain an answer to a write — there is nothing to agree to', () => {
    expect(travelTogether([write, answer], 2)).toBe(false);
  });

  // A sanitiser that refused drops its step, so the list is shorter than
  // what was asked for. Running the rest would be doing a sentence whose
  // middle went missing.
  it('refuses when a step was dropped on the way', () => {
    expect(travelTogether([write, write], 3)).toBe(false);
  });

  it('is not a chain at all with one step', () => {
    expect(travelTogether([write], 1)).toBe(false);
    expect(travelTogether([], 0)).toBe(false);
  });
});

describe('what is said about the parts not done', () => {
  it('names the number, because one sentence to repeat is a different job', () => {
    expect(leftoverLine(1)).toBe(
      'That was one other thing too — say it again once this is settled and I will do it.',
    );
    expect(leftoverLine(2)).toContain('2 other things');
    expect(leftoverLine(2)).toContain('say them again');
    expect(leftoverLine(0)).toBeNull();
  });
});

describe('stopping', () => {
  it('says where it got to, and that it went no further', () => {
    expect(chainStopLine(1, 'They are already coaching at that time.')).toBe(
      'I stopped there. They are already coaching at that time. Nothing after that was tried.',
    );
  });

  // Nothing happened, so "I stopped there" would be describing a journey
  // that never started.
  it('just says why when nothing was done', () => {
    expect(chainStopLine(0, 'They are not at this gym.')).toBe(
      'They are not at this gym.',
    );
  });
});
