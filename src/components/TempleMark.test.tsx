// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render, screen } from '../../test/render';

import { CARD, GHOSTS_ABOVE, TempleLockup, TempleMark, TempleWordmark } from './TempleMark';

// The mark is drawn rather than loaded, so what is worth checking is the
// shape contract: one even-odd path for the front card (the column is a
// knockout, not a filled shape), the two ghost cards behind it as
// hairline rects — and that they drop below the size where they stop
// being depth and start being noise.
describe('TempleMark', () => {
  it('is the front card plus two ghost cards', () => {
    const { container } = render(<TempleMark size={44} />);
    expect(container.querySelectorAll('path').length).toBe(1);
    expect(container.querySelectorAll('rect').length).toBe(2);
  });

  it('draws the card with the column as a knockout', () => {
    const { container } = render(<TempleMark size={44} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).toBe(CARD);
    expect(path?.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('drops the ghost cards at favicon sizes', () => {
    const { container } = render(<TempleMark size={GHOSTS_ABOVE - 1} />);
    expect(container.querySelectorAll('path').length).toBe(1);
    expect(container.querySelectorAll('rect').length).toBe(0);
  });

  it('takes the scheme’s ink unless it is told otherwise', () => {
    const { container } = render(<TempleMark size={44} color="#FF0000" />);
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('#FF0000');
  });

  it('says what it is to a screen reader', () => {
    render(<TempleMark size={44} />);
    expect(screen.getByLabelText('Temple')).toBeTruthy();
  });
});

describe('TempleWordmark', () => {
  it('is lowercase, and set in the one serif the product loads', () => {
    render(<TempleWordmark size={26} />);
    expect(screen.getByText('temple').style.fontFamily).toContain('Fraunces_700Bold');
  });
});

describe('TempleLockup', () => {
  it('is the mark and the word', () => {
    const { container } = render(<TempleLockup size={28} />);
    expect(screen.getByText('temple')).toBeTruthy();
    expect(container.querySelector('path')?.getAttribute('d')).toBe(CARD);
  });

  it('draws the mark taller than the type', () => {
    // The front card is only three quarters of the box, so a mark matched
    // to the type size lands visibly short of the word.
    const { container } = render(<TempleLockup size={26} />);
    const svg = container.querySelector('svg');
    expect(Number(svg?.getAttribute('width'))).toBeGreaterThan(26);
  });
});
