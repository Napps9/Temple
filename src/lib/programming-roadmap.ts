// The programming roadmap's pure arithmetic: which block a date sits in,
// how far through it is, and where blocks land on the Year band. The
// fetch lives with the components; everything here is testable maths.

export type ProgrammingBlock = {
  id: string;
  gym_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  color: string;
  note: string | null;
  created_by: string;
  created_at: string;
};

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY_MS);
}

// The block a date falls inside. Overlaps resolve to the latest-starting
// block — the one the coach most recently laid down wins the strip.
export function blockForDate(
  blocks: ProgrammingBlock[],
  isoDate: string,
): ProgrammingBlock | null {
  const active = blocks.filter(
    (b) => b.starts_on <= isoDate && isoDate <= b.ends_on,
  );
  if (active.length === 0) return null;
  return active.reduce((best, b) => (b.starts_on > best.starts_on ? b : best));
}

export function blockWeekInfo(
  block: ProgrammingBlock,
  isoDate: string,
): { week: number; weeks: number } {
  const week = Math.floor(daysBetween(block.starts_on, isoDate) / 7) + 1;
  const weeks = Math.ceil((daysBetween(block.starts_on, block.ends_on) + 1) / 7);
  return { week, weeks };
}

// "Squat strength · week 3 of 8" — the strip above the week being
// written. Single-week blocks skip the counter.
export function blockStripText(
  block: ProgrammingBlock,
  isoDate: string,
): string {
  const { week, weeks } = blockWeekInfo(block, isoDate);
  return weeks > 1 ? `${block.name} · week ${week} of ${weeks}` : block.name;
}

export type YearLane = {
  block: ProgrammingBlock;
  // Percent offsets across the year band, clipped to the year.
  leftPct: number;
  widthPct: number;
};

function dayOfYear(iso: string, year: number): number {
  const d = parseISO(iso);
  if (d.getFullYear() < year) return 0;
  if (d.getFullYear() > year) return isLeap(year) ? 366 : 365;
  return Math.round(
    (d.getTime() - new Date(year, 0, 1).getTime()) / DAY_MS,
  );
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function yearLanes(
  blocks: ProgrammingBlock[],
  year: number,
): YearLane[] {
  const total = isLeap(year) ? 366 : 365;
  return blocks
    .filter(
      (b) =>
        parseISO(b.starts_on).getFullYear() <= year &&
        parseISO(b.ends_on).getFullYear() >= year,
    )
    .sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1))
    .map((block) => {
      const start = dayOfYear(block.starts_on, year);
      const end = dayOfYear(block.ends_on, year) + 1;
      return {
        block,
        leftPct: (start / total) * 100,
        widthPct: Math.max(((end - start) / total) * 100, 1.5),
      };
    });
}

// "6 Jan – 28 Feb · 8 weeks" for the Year view's block list.
export function blockRangeText(block: ProgrammingBlock): string {
  const opts = { day: 'numeric', month: 'short' } as const;
  const from = parseISO(block.starts_on).toLocaleDateString('en-GB', opts);
  const to = parseISO(block.ends_on).toLocaleDateString('en-GB', opts);
  const weeks = Math.ceil((daysBetween(block.starts_on, block.ends_on) + 1) / 7);
  const weeksText = weeks === 1 ? '1 week' : `${weeks} weeks`;
  return `${from} – ${to} · ${weeksText}`;
}
