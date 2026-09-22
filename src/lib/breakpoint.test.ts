import { describe, expect, it } from 'vitest';

import { MD, modalShape } from './breakpoint';

// One rule, and it is worth pinning because getting it wrong is invisible
// in code review and obvious to a member holding a phone.
describe('modalShape', () => {
  it('gives a phone a sheet', () => {
    expect(modalShape(390)).toBe('sheet');
    expect(modalShape(430)).toBe('sheet');
  });

  it('gives a desktop a dialog', () => {
    expect(modalShape(1280)).toBe('dialog');
  });

  it('switches at md, and md itself is a dialog', () => {
    expect(modalShape(MD - 1)).toBe('sheet');
    expect(modalShape(MD)).toBe('dialog');
  });

  // A tablet in portrait is 768 and lands on dialog; the same tablet is
  // still a dialog rotated. The boundary is deliberately not "phone" vs
  // "everything else".
  it('keeps a tablet on the dialog in both orientations', () => {
    expect(modalShape(768)).toBe('dialog');
    expect(modalShape(1024)).toBe('dialog');
  });
});
