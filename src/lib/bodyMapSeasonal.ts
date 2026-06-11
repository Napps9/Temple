// Seasonal "skins" for the BodyMap — an easter-egg auto-themed
// decoration that overlays the regular silhouette during specific
// date windows. Purely decorative: hit areas, highlight tints and
// region selection are untouched, so the injury tracker / programming
// analysis still works identically during a themed window.
//
// All windows are defined in local time of the device — the precision
// we need is "today is roughly Halloween", not minute-by-minute.

export type SeasonalSkin =
  | 'halloween'
  | 'pride'
  | 'christmas'
  | 'valentine'
  | 'newyear'
  | 'stpatricks';

type Window = {
  skin: SeasonalSkin;
  // Months are 1-12. Inclusive on both ends.
  start: { month: number; day: number };
  end: { month: number; day: number };
};

// Order matters when windows overlap (e.g. New Year inside the
// Christmas-tail). We pick the *latest* defined window that matches,
// so winter cascade: Christmas (20–26 Dec) then New Year (31 Dec – 2
// Jan). For now no overlaps, but the convention is here for later.
const WINDOWS: Window[] = [
  // Northern hemisphere calendar — adjust dates if you ever globalise.
  {
    skin: 'newyear',
    start: { month: 12, day: 31 },
    end: { month: 1, day: 2 },
  },
  {
    skin: 'valentine',
    start: { month: 2, day: 13 },
    end: { month: 2, day: 15 },
  },
  {
    skin: 'stpatricks',
    start: { month: 3, day: 16 },
    end: { month: 3, day: 18 },
  },
  { skin: 'pride', start: { month: 6, day: 1 }, end: { month: 6, day: 30 } },
  {
    skin: 'halloween',
    start: { month: 10, day: 28 },
    end: { month: 11, day: 1 },
  },
  {
    skin: 'christmas',
    start: { month: 12, day: 20 },
    end: { month: 12, day: 26 },
  },
];

function dayOfYear(month: number, day: number): number {
  // Use a constant non-leap year so the day-of-year arithmetic is
  // stable across calendar years (we only care about month+day).
  return new Date(Date.UTC(2001, month - 1, day)).getUTCDate() +
    monthOffsets[month - 1];
}

// Sum of days in non-leap months 1..i-1.
const monthOffsets = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function getSeasonalSkin(
  date: Date = new Date(),
): SeasonalSkin | null {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const today = dayOfYear(m, d);

  for (const w of WINDOWS) {
    const start = dayOfYear(w.start.month, w.start.day);
    const end = dayOfYear(w.end.month, w.end.day);
    // Window wraps the year-end (start > end means the period crosses
    // December into January).
    const inWindow =
      start <= end ? today >= start && today <= end : today >= start || today <= end;
    if (inWindow) return w.skin;
  }
  return null;
}
