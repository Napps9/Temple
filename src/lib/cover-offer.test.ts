import { describe, expect, it } from 'vitest';

import { canOfferCover } from './cover-offer';

const base = {
  can: true,
  viewerId: 'coach-1',
  coachId: 'coach-1',
  inPast: false,
  openOffer: false,
};

describe('canOfferCover', () => {
  it('offers the class to its own coach', () => {
    expect(canOfferCover(base)).toBe(true);
  });

  it('never offers a class to somebody else, owner included', () => {
    expect(canOfferCover({ ...base, viewerId: 'owner' })).toBe(false);
  });

  it('needs the capability', () => {
    expect(canOfferCover({ ...base, can: false })).toBe(false);
  });

  it('has nothing to offer once the class has started', () => {
    expect(canOfferCover({ ...base, inPast: true })).toBe(false);
  });

  it('does not ask twice while an offer is still open', () => {
    expect(canOfferCover({ ...base, openOffer: true })).toBe(false);
  });

  it('is off for a class with no coach on it', () => {
    expect(canOfferCover({ ...base, coachId: null })).toBe(false);
    expect(canOfferCover({ ...base, viewerId: undefined })).toBe(false);
  });
});
