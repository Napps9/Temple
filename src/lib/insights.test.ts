import { describe, expect, it } from 'vitest';

import { classifyMember } from './insights';
import { COHORT_FIXTURES } from './insights.fixtures';

describe('insights (TS half of SQL ↔ TS parity)', () => {
  describe('classifyMember', () => {
    for (const f of COHORT_FIXTURES) {
      it(f.name, () => {
        expect(classifyMember(f.input)).toStrictEqual(f.expected);
      });
    }
  });

  // A failing renewal (past_due) is an at-risk relationship, not a
  // departure: is_active stays true so the member never falls into the
  // is_expired cohort. Mirrors is_active_relationship's status set (0118)
  // and pgTAP membership_past_due.sql.
  describe('past_due is active, not expired', () => {
    it('keeps a past_due member active and out of the expired cohort', () => {
      const flags = classifyMember({
        now: '2026-06-03T12:00:00Z',
        joined_at: '2026-05-01T10:00:00Z',
        plan_subscriptions: [
          { status: 'past_due', paid_period_end: '2026-05-30T00:00:00Z' },
        ],
        comp_grants: [],
        billing_events: [{ kind: 'invoice.paid' }],
      });
      expect(flags.is_active).toBe(true);
      expect(flags.is_expired).toBe(false);
    });
  });
});
