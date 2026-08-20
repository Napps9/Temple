// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render, screen } from '../../test/render';

import { TempleLockup, TempleMark, TempleWordmark } from './TempleMark';

// The mark is drawn rather than loaded, so the things worth checking are
// the two decisions inside the drawing: what it does at small sizes, and
// that the lockup gives the mark enough room to keep its silhouette.
describe('TempleMark', () => {
  const rects = (container: HTMLElement) =>
    container.querySelectorAll('rect').length;

  it('keeps the two cards behind it at a normal size', () => {
    const { container } = render(<TempleMark size={44} />);
    expect(rects(container)).toBe(2);
  });

  it('drops them at favicon sizes, where they are two grey smudges', () => {
    const { container } = render(<TempleMark size={16} />);
    expect(rects(container)).toBe(0);
  });

  it('tightens the viewBox when the cards are gone, so the front one fills it', () => {
    const { container } = render(<TempleMark size={16} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(
      '-2 -2 76 76',
    );
  });

  it('draws the doorway as a hole rather than a filled shape', () => {
    const { container } = render(<TempleMark size={44} />);
    // Even-odd is what makes the doorway show the surface behind it, which
    // is the only version that is right on light, on dark and on a brand
    // colour. A filled shape would need to know its background.
    expect(container.querySelector('path')?.getAttribute('fill-rule')).toBe(
      'evenodd',
    );
  });

  it('says what it is to a screen reader', () => {
    render(<TempleMark size={44} />);
    expect(screen.getByLabelText('Temple')).toBeTruthy();
  });
});

describe('TempleWordmark', () => {
  it('is lowercase, and set in the one serif the product loads', () => {
    render(<TempleWordmark size={26} />);
    const node = screen.getByText('temple');
    expect(node.style.fontFamily).toContain('Fraunces_700Bold');
  });
});

describe('TempleLockup', () => {
  it('gives the mark enough size to keep its cards', () => {
    // 24px would fall under the threshold and render as a bare square —
    // the silhouette lost in the one place the mark is most seen.
    const { container } = render(<TempleLockup size={22} />);
    expect(container.querySelectorAll('rect').length).toBe(2);
  });

  it('is the mark and the word, named once between them', () => {
    render(<TempleLockup size={28} />);
    expect(screen.getByText('temple')).toBeTruthy();
    expect(screen.getAllByLabelText('Temple').length).toBeGreaterThan(0);
  });
});
