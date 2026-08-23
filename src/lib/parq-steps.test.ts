import { describe, expect, it } from 'vitest';

import {
  canAdvance,
  firstUnanswered,
  initialStep,
  isReview,
  progressFraction,
  progressLabel,
} from './parq-steps';

const answered = { answeredYes: false as boolean | null };
const yes = { answeredYes: true as boolean | null };
const blank = { answeredYes: null };

describe('parq steps', () => {
  it('labels question steps in words and the last step as review', () => {
    expect(progressLabel(0, 7)).toBe('1 of 7');
    expect(progressLabel(6, 7)).toBe('7 of 7');
    expect(progressLabel(7, 7)).toBe('Check your answers');
    expect(isReview(7, 7)).toBe(true);
    expect(isReview(6, 7)).toBe(false);
  });

  it('fills the bar across questions and review', () => {
    expect(progressFraction(0, 7)).toBeCloseTo(1 / 8);
    expect(progressFraction(7, 7)).toBe(1);
    expect(progressFraction(0, 0)).toBe(0);
  });

  it('only advances past an answered question', () => {
    expect(canAdvance(0, [blank, blank])).toBe(false);
    expect(canAdvance(0, [answered, blank])).toBe(true);
    expect(canAdvance(2, [answered, answered])).toBe(false);
  });

  it('finds the first unanswered question', () => {
    expect(firstUnanswered([answered, blank, yes])).toBe(1);
    expect(firstUnanswered([answered, yes])).toBeNull();
  });

  it('opens at the first gap, or the review when complete', () => {
    expect(initialStep([answered, blank])).toBe(1);
    expect(initialStep([answered, yes])).toBe(2);
  });
});
