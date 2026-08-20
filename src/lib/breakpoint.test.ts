import { describe, expect, it } from 'vitest';

import { LG, MD, RAIL_W, modalShape, staffContentWidth } from './breakpoint';

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

// The number the two split views branch on. The bug this pins: with the
// rail on, every screen inside it is 246px narrower than the window, so
// asking the window whether there is room for two columns says yes when
// there is room for one and a half.
describe('staffContentWidth', () => {
  it('is the window when there is no rail', () => {
    expect(staffContentWidth(390)).toBe(390);
    expect(staffContentWidth(LG - 1)).toBe(LG - 1);
  });

  it('takes the rail off once the rail is on', () => {
    expect(staffContentWidth(LG)).toBe(LG - RAIL_W);
    expect(staffContentWidth(1440)).toBe(1440 - RAIL_W);
  });

  // The reason the rail waits for 1024: at 768 the column would be 522px
  // while every `md:` class inside it still fired.
  it('never leaves the column narrower than md', () => {
    expect(staffContentWidth(LG)).toBeGreaterThanOrEqual(MD);
  });
});
