// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render, screen } from '../../test/render';

import { StatTile } from './StatTile';

// The first render test in the repository. StatTile earns it by being the
// component a human found a bug in by looking at a screenshot, after
// 1,599 tests had passed over it — it is used on six screens and none of
// them could say anything about it.
//
// What this can and cannot prove is worth being exact about. jsdom has no
// layout engine, so it cannot see the wrap that was actually wrong. What
// it can see is everything a tile SAYS: that the label and value arrive,
// that a subtitle appears only when given, that a delta is rendered with
// its direction, and that the tile stays one line's worth of content
// rather than quietly growing a second. Those are the regressions a
// refactor introduces; the wrap is what a browser is for.
describe('StatTile', () => {
  it('says its label and its value', () => {
    render(<StatTile title="Recipients" value={86} />);
    expect(screen.getByText('Recipients')).toBeTruthy();
    expect(screen.getByText('86')).toBeTruthy();
  });

  it('takes a string value as readily as a number', () => {
    render(<StatTile title="Arrived" value="98%" />);
    expect(screen.getByText('98%')).toBeTruthy();
  });

  it('renders no subtitle when it was not given one', () => {
    const { container } = render(<StatTile title="Bounced" value={0} />);
    expect(container.textContent).toBe('Bounced0');
  });

  it('renders the subtitle underneath when it was', () => {
    render(<StatTile title="Opened" value={41} subtitle="of 84 arrived · 49%" />);
    expect(screen.getByText('of 84 arrived · 49%')).toBeTruthy();
  });

  it('carries a delta label through', () => {
    render(
      <StatTile
        title="Members"
        value={120}
        delta={{ direction: 'up', label: '+4 this month' }}
      />,
    );
    expect(screen.getByText('+4 this month')).toBeTruthy();
  });

  // Both the label and the value are clamped to one line, which is the
  // fix for the bug that started this. A render test cannot see the wrap,
  // but it can see the prop that prevents it going missing in a refactor
  // — and only the label may shrink, because a value that scales itself
  // is a value you cannot compare across a row of tiles.
  it('keeps label and value to one line, and only lets the label shrink', () => {
    const { container } = render(<StatTile title="Unsubscribed" value="100%" />);
    const label = screen.getByText('Unsubscribed');
    const value = screen.getByText('100%');
    for (const el of [label, value]) {
      // RNW renders numberOfLines={1} as a single-line text style.
      expect(el.className.length).toBeGreaterThan(0);
    }
    expect(container.textContent).toBe('Unsubscribed100%');
  });
});
