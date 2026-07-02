import { describe, expect, it } from 'vitest';

import { estimateElsewhereMarkup } from './payment-savings';

describe('estimateElsewhereMarkup', () => {
  it('computes a 1%-3% range of the monthly volume', () => {
    expect(estimateElsewhereMarkup(500_000)).toEqual({
      lowCents: 5_000,
      highCents: 15_000,
    });
  });

  it('clamps negative volume to zero', () => {
    expect(estimateElsewhereMarkup(-100)).toEqual({ lowCents: 0, highCents: 0 });
  });

  it('handles zero volume', () => {
    expect(estimateElsewhereMarkup(0)).toEqual({ lowCents: 0, highCents: 0 });
  });
});
