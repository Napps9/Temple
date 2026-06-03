import { describe, expect, it } from 'vitest';

import {
  hasEverPaid,
  isActiveRelationship,
  isBookingEligible,
  selectDefaultEntitlement,
} from './booking-picker';
import {
  ACTIVITY_FIXTURES,
  PAID_FIXTURES,
  PICKER_FIXTURES,
} from './booking-picker.fixtures';

describe('booking-picker (TS half of SQL ↔ TS parity)', () => {
  describe('isBookingEligible + selectDefaultEntitlement', () => {
    for (const f of PICKER_FIXTURES) {
      it(f.name, () => {
        expect(isBookingEligible(f.input)).toBe(f.expected_eligible);
        expect(selectDefaultEntitlement(f.input)).toStrictEqual(f.expected_default);
      });
    }
  });

  describe('isActiveRelationship', () => {
    for (const f of ACTIVITY_FIXTURES) {
      it(f.name, () => {
        expect(isActiveRelationship(f.input)).toBe(f.expected);
      });
    }
  });

  describe('hasEverPaid', () => {
    for (const f of PAID_FIXTURES) {
      it(f.name, () => {
        expect(hasEverPaid(f.input)).toBe(f.expected);
      });
    }
  });
});
