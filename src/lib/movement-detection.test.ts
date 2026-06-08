import { describe, expect, it } from 'vitest';

import {
  detectMovementsInText,
  inferTrackKey,
} from './movement-detection';

function detect(body: string) {
  return detectMovementsInText(body);
}

function keys(tags: ReturnType<typeof detect>) {
  return tags.map((t) => t.movement_key).sort();
}

describe('detectMovementsInText — specific aliases', () => {
  it('detects "back squat"', () => {
    const tags = detect('Back squat 5×5 @ 75%');
    expect(keys(tags)).toEqual(['back_squat']);
    expect(tags[0].track_key).toBe('5rm');
  });

  it('detects "front squat"', () => {
    expect(keys(detect('Front squat 3x3'))).toEqual(['front_squat']);
  });

  it('detects "overhead squat" via "ohs"', () => {
    expect(keys(detect('OHS 5x1 @ 60%'))).toEqual(['overhead_squat']);
  });

  it('detects deadlift', () => {
    expect(keys(detect('Deadlift 5x5'))).toEqual(['deadlift']);
  });

  it('detects shoulder-to-overhead via "push jerk"', () => {
    expect(keys(detect('Push jerk 5x3'))).toEqual(['shoulder_to_overhead']);
  });

  it('detects bench press', () => {
    expect(keys(detect('Bench press 3x5'))).toEqual(['bench_press']);
  });

  it('detects thrusters', () => {
    expect(keys(detect('21-15-9 thrusters and pull ups'))).toContain('thruster');
  });
});

describe('detectMovementsInText — bare-ambiguous words are skipped', () => {
  it('does NOT tag bare "squat"', () => {
    expect(detect('Squats for 3 sets')).toEqual([]);
  });
  it('does NOT tag bare "press"', () => {
    expect(detect('Press 5x5')).toEqual([]);
  });
  it('does NOT tag bare "snatch"', () => {
    expect(detect('Snatch progression at 60%')).toEqual([]);
  });
  it('does NOT tag bare "clean"', () => {
    expect(detect('Clean from blocks')).toEqual([]);
  });
  it('does NOT tag bare "jerk"', () => {
    expect(detect('Jerk recovery drill')).toEqual([]);
  });
});

describe('detectMovementsInText — longest-match-wins', () => {
  it('"strict pull ups" wins over "pull ups"', () => {
    const tags = detect('5 strict pull ups + 10 push press');
    expect(keys(tags)).toEqual(['push_press', 'strict_pull_ups']);
  });

  it('"strict handstand push ups" wins over the bare kipping form', () => {
    const tags = detect('AMRAP: strict handstand push ups');
    expect(keys(tags)).toEqual(['strict_hspu']);
  });

  it('"squat clean" (specific) does not also tag bare "clean"', () => {
    const tags = detect('Squat clean 1x1');
    expect(keys(tags)).toEqual(['squat_clean']);
  });

  it('"hang snatch" does not also tag bare "snatch"', () => {
    const tags = detect('Hang snatch 3 sets of 2');
    expect(keys(tags)).toEqual(['hang_snatch']);
  });
});

describe('detectMovementsInText — convention defaults', () => {
  it('bare "pull ups" defaults to kipping (CrossFit convention)', () => {
    expect(keys(detect('5 pull ups in the WOD'))).toEqual([
      'kipping_pull_up',
    ]);
  });

  it('bare "t2b" defaults to kipping toes-to-bar', () => {
    expect(keys(detect('Round: 10 t2b'))).toEqual(['kipping_toes_to_bar']);
  });

  it('bare "hspu" defaults to kipping handstand push ups', () => {
    expect(keys(detect('5 HSPU per round'))).toEqual(['kipping_hspu']);
  });
});

describe('detectMovementsInText — multi-movement bodies', () => {
  it('catches Fran (thrusters + pull ups)', () => {
    const tags = detect('21-15-9 of thrusters and pull ups');
    expect(keys(tags)).toEqual(['kipping_pull_up', 'thruster']);
  });

  it('handles a complex body without false positives', () => {
    const body =
      'EMOM 10: 3 squat cleans + 1 split jerk, then 5 minute row';
    expect(keys(detect(body))).toEqual([
      'rowing',
      'split_jerk',
      'squat_clean',
    ]);
  });
});

describe('detectMovementsInText — word boundaries', () => {
  it('does not match inside a longer word', () => {
    // "rowing" should not be detected from "borrowing"; we test the
    // single-word "row" alias here.
    expect(keys(detect('Borrowing time before the WOD'))).toEqual([]);
  });

  it('handles trailing punctuation', () => {
    expect(keys(detect('Back squat, then deadlift!'))).toEqual([
      'back_squat',
      'deadlift',
    ]);
  });
});

describe('inferTrackKey', () => {
  const all = new Set(['1rm', '3rm', '5rm', '10rm']);

  it('infers 5RM from "5×5"', () => {
    expect(inferTrackKey('Back squat 5×5', all)).toBe('5rm');
  });

  it('infers 3RM from "5x3"', () => {
    expect(inferTrackKey('5x3 @ 80%', all)).toBe('3rm');
  });

  it('infers 1RM from "1RM"', () => {
    expect(inferTrackKey('Build to 1RM', all)).toBe('1rm');
  });

  it('infers 1RM from "1 rep max"', () => {
    expect(inferTrackKey('Find a 1 rep max', all)).toBe('1rm');
  });

  it('returns null when the rep target isn\'t a rep-max scheme', () => {
    expect(inferTrackKey('5x4 @ 70%', all)).toBe(null);
  });

  it('returns null when there is no clear pattern', () => {
    expect(inferTrackKey('Back squat work', all)).toBe(null);
  });

  it('respects the movement\'s available schemes', () => {
    // Split jerk only has 1RM and 3RM; "5×5" should not pick 5RM
    // because split_jerk doesn't have a 5RM scheme.
    expect(inferTrackKey('5x5', new Set(['1rm', '3rm']))).toBe(null);
  });
});
