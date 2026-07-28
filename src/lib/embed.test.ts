import { describe, expect, it } from 'vitest';

import { embedOne } from './embed';

describe('embedOne', () => {
  // The shape PostgREST actually sends for a one-to-one embed, and the one
  // the client was written against. Both have to work, because the whole
  // point is not to depend on which it is.
  it('takes the object form a one-to-one embed returns', () => {
    expect(embedOne({ invoice_url: 'https://pay' })).toEqual({
      invoice_url: 'https://pay',
    });
  });

  it('takes the first of the array form', () => {
    expect(embedOne([{ invoice_url: 'https://pay' }])).toEqual({
      invoice_url: 'https://pay',
    });
  });

  it('is null for an absent embed', () => {
    expect(embedOne(null)).toBeNull();
    expect(embedOne(undefined)).toBeNull();
  });

  // An empty array is what a to-many embed sends when there is no child;
  // reading [0] off it is undefined, and undefined is not null.
  it('is null rather than undefined for an empty array', () => {
    expect(embedOne([])).toBeNull();
  });
});
