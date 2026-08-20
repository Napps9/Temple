// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render, screen } from '../../test/render';

import { PORTICO, TempleLockup, TempleMark, TempleWordmark } from './TempleMark';

// The mark is drawn rather than loaded, so what is worth checking is that
// it is one path with no enclosing shape — the property that keeps it from
// reading as a letter beside a lowercase wordmark — and that the flat
// assets are cut from the same path.
describe('TempleMark', () => {
  it('is a single path, with no box around it', () => {
    const { container } = render(<TempleMark size={44} />);
    expect(container.querySelectorAll('path').length).toBe(1);
    expect(container.querySelectorAll('rect').length).toBe(0);
    expect(container.querySelectorAll('circle,ellipse').length).toBe(0);
  });

  it('draws the portico', () => {
    const { container } = render(<TempleMark size={44} />);
    expect(container.querySelector('path')?.getAttribute('d')).toBe(PORTICO);
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
    expect(container.querySelector('path')?.getAttribute('d')).toBe(PORTICO);
  });

  it('draws the mark taller than the type', () => {
    // The portico is drawn across about three quarters of its box, so a
    // mark matched to the type size lands visibly short of the word.
    const { container } = render(<TempleLockup size={26} />);
    const svg = container.querySelector('svg');
    expect(Number(svg?.getAttribute('width'))).toBeGreaterThan(26);
  });
});
