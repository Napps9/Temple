// The shape of an answer: a number, a list, and a short series.
//
// Phase 4 shipped the answers themselves — how busy we have been, who has
// gone quiet, what we took — and left them all rendering as prose. A
// sentence is right for the judgement ("too few to read a trend from")
// and wrong for the quantity: "Busiest was Saturday with 31" makes an
// owner reconstruct the shape of their own week in their head, from data
// the action already computed and then threw away.
//
// This is one vocabulary for every `ask` action rather than a renderer
// per question, which is the whole thing phase 4 said it would not do.
// Three shapes and no more:
//
//   figure  a single value with an optional change — a stat tile, not a
//           one-bar chart
//   series  a short run of counts over time — bars, one hue, the extreme
//           labelled and nothing else
//   list    ranked rows, with a magnitude rail when the numbers compare
//           and without one when they are just names
//
// The prose stays. It carries what the numbers must not claim on their
// own, and a chart that replaced it would be a chart that lies more
// confidently.

export type AnswerDelta = {
  direction: 'up' | 'down' | 'level';
  // Already written out — "12% on the week before". The action knows
  // whether a comparison is worth making at all; this only draws it.
  text: string;
};

export type AnswerFigure = {
  value: string;
  label: string;
  delta?: AnswerDelta;
};

export type AnswerPoint = { label: string; value: number };

export type AnswerSeries = {
  label: string;
  points: AnswerPoint[];
};

export type AnswerRow = {
  name: string;
  // Right-hand text: a count, a date, "4 weeks away".
  detail: string;
  // 0..1 of the row's magnitude against the largest. Omitted when the
  // rows are names rather than quantities — a rail under a list of
  // people invites a comparison that is not being made.
  weight?: number;
};

export type AnswerList = {
  label: string;
  rows: AnswerRow[];
  // Rows not shown, so the card can say "and 6 more" instead of
  // pretending the list is complete.
  more?: number;
};

export type ActionAnswer = {
  figure?: AnswerFigure;
  series?: AnswerSeries;
  list?: AnswerList;
};

// Bars past this stop being readable in a chat card on a phone: they get
// thinner than the gap between them. Longer runs widen their buckets.
export const MAX_POINTS = 14;

// A day's count, keyed YYYY-MM-DD.
export type DayCount = { day: string; attended: number };

function weekdayLetter(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return '';
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// Days as they came, or wider buckets when there are too many days to
// draw. The bucket WIDTH is derived from the period rather than fixed at
// a week, so the whole period always fits in the bars: a fixed week
// would make a year 53 buckets, and dropping the tail to fit would draw
// the last quarter under a label that says the last year — a chart
// disagreeing with the number above it.
//
// Buckets are filled backwards from the most recent day, so any short
// one lands at the start rather than where the eye finishes.
export function toSeries(days: DayCount[], label: string): AnswerSeries | null {
  if (days.length === 0) return null;
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length <= MAX_POINTS) {
    return {
      label,
      points: sorted.map((d) => ({ label: weekdayLetter(d.day), value: d.attended })),
    };
  }
  const width = Math.ceil(sorted.length / MAX_POINTS);
  const points: AnswerPoint[] = [];
  for (let end = sorted.length; end > 0; end -= width) {
    const chunk = sorted.slice(Math.max(0, end - width), end);
    points.unshift({
      label: shortDay(chunk[0].day),
      value: chunk.reduce((n, d) => n + d.attended, 0),
    });
  }
  return { label, points };
}

// Which bar gets the only label. Selective on purpose: a number over
// every bar is chaos and goes unread, and the one an owner is looking
// for is the biggest. Ties go to the earliest, so the answer is stable.
export function peakIndex(points: AnswerPoint[]): number {
  let best = -1;
  let bestValue = -1;
  points.forEach((p, i) => {
    if (p.value > bestValue) {
      best = i;
      bestValue = p.value;
    }
  });
  // A run of zeroes has no peak worth pointing at.
  return bestValue > 0 ? best : -1;
}

// Bar heights as a fraction of the tallest. A day with nobody in returns
// 0 and draws as the empty rail rather than vanishing: "nobody came on
// Tuesday" is an answer, and a missing bar reads as a missing day.
export function barHeights(points: AnswerPoint[]): number[] {
  const max = points.reduce((n, p) => Math.max(n, p.value), 0);
  if (max <= 0) return points.map(() => 0);
  return points.map((p) => p.value / max);
}

// Row rails against the largest row, for lists where the numbers compare.
export function weighRows(
  rows: { name: string; detail: string; value: number }[],
): AnswerRow[] {
  const max = rows.reduce((n, r) => Math.max(n, r.value), 0);
  return rows.map((r) => ({
    name: r.name,
    detail: r.detail,
    weight: max > 0 ? r.value / max : 0,
  }));
}
