import { describe, expect, it } from 'vitest';

import { EDITABLE_FIELDS, isFieldEditable, parseFieldPath } from './canvas-sync';

describe('parseFieldPath', () => {
  it('parses a scalar field path', () => {
    expect(parseFieldPath('b_abc123:text')).toEqual({
      blockId: 'b_abc123',
      field: 'text',
    });
  });

  it('rejects malformed or unrecognised shapes', () => {
    expect(parseFieldPath('')).toBeNull();
    expect(parseFieldPath('no-colon')).toBeNull();
    expect(parseFieldPath('a:')).toBeNull();
    expect(parseFieldPath(':field')).toBeNull();
    expect(parseFieldPath('a:b:c')).toBeNull();
  });
});

describe('isFieldEditable', () => {
  it('allows whitelisted fields per block type', () => {
    for (const [type, fields] of Object.entries(EDITABLE_FIELDS)) {
      for (const field of fields) {
        expect(isFieldEditable(type as keyof typeof EDITABLE_FIELDS, field)).toBe(true);
      }
    }
  });

  it('rejects a field not in the whitelist for its block type', () => {
    expect(isFieldEditable('button', 'href')).toBe(false);
    expect(isFieldEditable('heading', 'color')).toBe(false);
  });

  it('rejects every field on blocks with no editable text at all', () => {
    expect(isFieldEditable('image', 'src')).toBe(false);
    expect(isFieldEditable('divider', 'color')).toBe(false);
    expect(isFieldEditable('spacer', 'height')).toBe(false);
  });
});
