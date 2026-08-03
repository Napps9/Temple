import { describe, expect, it } from 'vitest';

import { actionsFor } from '../../src/lib/actions';
import { CASES, isCannot, scoreCase } from './cases';

describe('the fixture set', () => {
  // The guard that keeps the eval honest as the registry moves: every
  // action a case expects must exist, under the owner's full vocabulary.
  // A renamed or retired action fails here, in CI, rather than in an
  // eval run three weeks later that quietly scores it as a parser miss.
  it('only expects actions that exist in the registry', () => {
    const known = new Set(actionsFor(() => true, 'owner').map((a) => a.name));
    for (const c of CASES) {
      if (isCannot(c)) continue;
      for (const step of c.expect) {
        expect(known, `"${c.say}" expects unknown action ${step.action}`).toContain(step.action);
      }
    }
  });

  it('has no duplicate sentences', () => {
    const seen = new Set(CASES.map((c) => c.say));
    expect(seen.size).toBe(CASES.length);
  });

  it('carries both halves: mappings and refusals', () => {
    const refusals = CASES.filter(isCannot);
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(refusals.length).toBeGreaterThanOrEqual(5);
  });
});

describe('scoreCase', () => {
  const expectOne = { say: 'x', expect: [{ action: 'members.find' }] };

  it('passes an exact mapping and fails a near miss', () => {
    expect(scoreCase(expectOne, [{ action: 'members.find', args: {} }], null).pass).toBe(true);
    expect(scoreCase(expectOne, [{ action: 'members.quiet', args: {} }], null).pass).toBe(false);
    expect(scoreCase(expectOne, [], 'cannot do that').pass).toBe(false);
  });

  it('compares only the pinned args, as JSON values', () => {
    const c = { say: 'x', expect: [{ action: 'classes.edit', args: { capacity: 16 } }] };
    const extra = { action: 'classes.edit', args: { capacity: 16, name: 'CrossFit' } };
    expect(scoreCase(c, [extra], null).pass).toBe(true);
    const wrong = { action: 'classes.edit', args: { capacity: 12 } };
    expect(scoreCase(c, [wrong], null).pass).toBe(false);
  });

  it('holds a chain to its order', () => {
    const c = {
      say: 'x',
      expect: [{ action: 'classes.cancel' }, { action: 'members.message' }],
    };
    const forward = [
      { action: 'classes.cancel', args: {} },
      { action: 'members.message', args: {} },
    ];
    expect(scoreCase(c, forward, null).pass).toBe(true);
    expect(scoreCase(c, [...forward].reverse(), null).pass).toBe(false);
  });

  // The refusal cases are the ones a lenient scorer would quietly break:
  // an action emitted for "cancel Marcus's membership" must FAIL even
  // though the parser answered confidently.
  it('a refusal case fails on any emitted action and passes only on cannot', () => {
    const trap = { say: 'x', cannot: true as const };
    expect(scoreCase(trap, [{ action: 'money.refund', args: {} }], null).pass).toBe(false);
    expect(scoreCase(trap, [], 'That needs a person.').pass).toBe(true);
    expect(scoreCase(trap, [], null).pass).toBe(false);
  });
});
