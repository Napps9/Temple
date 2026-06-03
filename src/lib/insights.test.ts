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
});
