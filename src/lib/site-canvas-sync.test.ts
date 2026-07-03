import { describe, expect, it } from 'vitest';

import { EDITABLE_FIELDS, isFieldEditable, parseFieldPath } from './site-canvas-sync';

describe('parseFieldPath', () => {
  it('parses a scalar field path', () => {
    expect(parseFieldPath('sb_abc123:headline')).toEqual({
      kind: 'scalar',
      blockId: 'sb_abc123',
      field: 'headline',
    });
  });

  it('parses a testimonial array-item field path', () => {
    expect(parseFieldPath('sb_abc123:quotes:q_xyz:quote')).toEqual({
      kind: 'array-item',
      blockId: 'sb_abc123',
      arrayKey: 'quotes',
      itemId: 'q_xyz',
      field: 'quote',
    });
  });

  it('rejects malformed or unrecognised shapes', () => {
    expect(parseFieldPath('')).toBeNull();
    expect(parseFieldPath('no-colon')).toBeNull();
    expect(parseFieldPath('a:')).toBeNull();
    expect(parseFieldPath(':field')).toBeNull();
    expect(parseFieldPath('a:images:g1:alt')).toBeNull();
    expect(parseFieldPath('a:quotes:q1:extra:more')).toBeNull();
  });
});

describe('isFieldEditable', () => {
  it('allows whitelisted scalar fields per block type', () => {
    for (const [type, fields] of Object.entries(EDITABLE_FIELDS)) {
      for (const field of fields) {
        expect(
          isFieldEditable(type as keyof typeof EDITABLE_FIELDS, {
            kind: 'scalar',
            blockId: 'b1',
            field,
          }),
        ).toBe(true);
      }
    }
  });

  it('rejects a field not in the whitelist for its block type', () => {
    expect(
      isFieldEditable('hero', { kind: 'scalar', blockId: 'b1', field: 'imageUrl' }),
    ).toBe(false);
    expect(
      isFieldEditable('schedule', { kind: 'scalar', blockId: 'b1', field: 'body' }),
    ).toBe(false);
  });

  it('allows testimonial quote/name array-item fields only on testimonials blocks', () => {
    expect(
      isFieldEditable('testimonials', {
        kind: 'array-item',
        blockId: 'b1',
        arrayKey: 'quotes',
        itemId: 'q1',
        field: 'quote',
      }),
    ).toBe(true);
    expect(
      isFieldEditable('gallery', {
        kind: 'array-item',
        blockId: 'b1',
        arrayKey: 'quotes',
        itemId: 'q1',
        field: 'quote',
      }),
    ).toBe(false);
    expect(
      isFieldEditable('testimonials', {
        kind: 'array-item',
        blockId: 'b1',
        arrayKey: 'quotes',
        itemId: 'q1',
        field: 'unknown',
      }),
    ).toBe(false);
  });
});
