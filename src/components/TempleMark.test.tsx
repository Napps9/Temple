// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render, screen } from '../../test/render';

import { STAR } from './AIMark';
import { TempleLockup, TempleMark, TempleWordmark } from './TempleMark';
import { BRAND } from '@/lib/theme';

// The mark is drawn rather than loaded, so what is worth checking is the
// contract: the brand star is the AI star's silhouette in the brand
// magenta, and the lockup is the word plus that star — not the word plus
// whatever colour the scheme happens to be in.
describe('TempleMark', () => {
  it('is the star in the brand magenta', () => {
    const { container } = render(<TempleMark size={44} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).toBe(STAR);
    expect(path?.getAttribute('fill')).toBe(BRAND);
  });

  it('takes a colour override for surfaces that need one', () => {
    const { container } = render(<TempleMark size={44} color="#FFFFFF" />);
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('#FFFFFF');
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
  it('is the word and the star', () => {
    const { container } = render(<TempleLockup size={28} />);
    expect(screen.getByText('temple')).toBeTruthy();
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).toBe(STAR);
    expect(path?.getAttribute('fill')).toBe(BRAND);
  });
});
