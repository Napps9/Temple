// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render, screen } from '../../test/render';

import { AnswerFigures } from './AnswerFigures';
import { toSeries, weighRows } from '@/lib/answer';

// The renderer every `ask` in the bar draws through. Its logic is already
// covered in answer.test.ts — bucketing, peaks, bar heights — but nothing
// has ever checked that the component puts those numbers on a screen, or
// that it stays quiet when there is nothing to draw.
//
// The branching is the point: a figure, a series and a list are three
// independent slots, and an answer supplies any combination of them. Six
// possible shapes, and the one that has to be right is the empty one —
// a card that renders an empty container is a card with a gap in it.
describe('AnswerFigures', () => {
  it('draws nothing at all when the answer carries no numbers', () => {
    const { container } = render(<AnswerFigures answer={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('leads with the figure and its label', () => {
    render(
      <AnswerFigures answer={{ figure: { value: '£4,210', label: 'taken in July' } }} />,
    );
    expect(screen.getByText('£4,210')).toBeTruthy();
    expect(screen.getByText('taken in July')).toBeTruthy();
  });

  it('draws a point per day and names the run', () => {
    const series = toSeries(
      [
        { day: '2026-07-27', attended: 4 },
        { day: '2026-07-28', attended: 9 },
        { day: '2026-07-29', attended: 12 },
      ],
      'the last three days',
    )!;
    render(<AnswerFigures answer={{ series }} />);
    expect(screen.getByText('the last three days')).toBeTruthy();
    // Weekday letters, not dates: the run is the shape, and a date under
    // every bar is the label nobody reads.
    expect(series.points.map((p) => p.label)).toEqual(['M', 'T', 'W']);
  });

  it('names every row of a list and what each one is worth', () => {
    const rows = weighRows([
      { name: 'Memberships', detail: '£3,600', value: 3600 },
      { name: 'The shop', detail: '£610', value: 610 },
    ]);
    render(<AnswerFigures answer={{ list: { label: 'Where from', rows } }} />);
    expect(screen.getByText('Where from')).toBeTruthy();
    expect(screen.getByText('Memberships')).toBeTruthy();
    expect(screen.getByText('£3,600')).toBeTruthy();
    expect(screen.getByText('The shop')).toBeTruthy();
    expect(screen.getByText('£610')).toBeTruthy();
  });

  it('draws all three together when an answer has all three', () => {
    const series = toSeries(
      [
        { day: '2026-07-27', attended: 4 },
        { day: '2026-07-28', attended: 6 },
      ],
      'two days',
    )!;
    const rows = weighRows([{ name: 'Only', detail: '4', value: 4 }]);
    render(
      <AnswerFigures
        answer={{
          figure: { value: '10', label: 'in total' },
          series,
          list: { label: 'Split', rows },
        }}
      />,
    );
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('Split')).toBeTruthy();
    expect(screen.getByText('Only')).toBeTruthy();
  });
});
