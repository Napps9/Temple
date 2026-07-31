// Answers about the back office itself: where a thing lives, and what
// nobody opens. Pure, so the shaping is testable without a database — the
// same split comms-report.ts and attendance-answer.ts use.

import {
  CATEGORY_LABELS,
  type BackOfficeEntry,
  searchBackOffice,
} from './back-office';

export type ScreenAnswer = {
  title: string;
  lines: string[];
  // The way through, when exactly one surface matched. Offered to the
  // owner as a chip; the bar never navigates on its own.
  offer?: { label: string; href: string };
  // More than one matched: chips that re-ask with the ambiguity settled.
  choices?: { label: string; args: Record<string, unknown> }[];
};

// A surface that lives inside the Manage screen has no route of its own,
// so the way through names the section. Nothing else in the app builds
// this URL — the Manage screen's own tiles set state instead — but a chip
// in the Timeline is genuinely arriving from elsewhere.
export function entryDestination(e: BackOfficeEntry): string {
  return e.section ? `${e.href}?section=${e.section}` : e.href;
}

export function findScreenAnswer(
  query: string,
  entries: BackOfficeEntry[],
): ScreenAnswer {
  const asked = query.trim();
  const hits = searchBackOffice(asked, entries);

  if (hits.length === 0) {
    return {
      title: `Nothing behind Manage matches “${asked}”.`,
      lines: [
        'It may be something you can just say — tell me what you want to change and I will do it rather than send you to a screen.',
      ],
    };
  }

  if (hits.length > 1) {
    return {
      title: 'Which one?',
      lines: [],
      choices: hits.slice(0, 5).map((e) => ({
        label: e.title,
        args: { what: e.title },
      })),
    };
  }

  const e = hits[0];
  const lines = [e.blurb, `Under ${CATEGORY_LABELS[e.category]}.`];
  // The best outcome of somebody asking where a screen is, is finding out
  // they did not need it.
  if (e.saidInstead) lines.push(`Or just say “${e.saidInstead}”.`);
  return {
    title: e.title,
    lines,
    offer: { label: `Open ${e.title}`, href: entryDestination(e) },
  };
}

export type RouteUsageRow = { route: string; opens: number; last_opened: string };

// Which surfaces get opened, and which never have. Only entries with a
// route of their own can be answered for: seven surfaces are sections of
// the Manage screen and every one of them records as /management, so
// "nobody opens Branding" is not a thing this table can know.
export function usageAnswer(
  rows: RouteUsageRow[],
  entries: BackOfficeEntry[],
  days: number,
): { title: string; lines: string[] } {
  const window = `the last ${days} days`;

  // Not recorded and zero are different facts, and only one of them says
  // anything about the screen. Counting started when 0233 shipped, so an
  // empty table means nobody has been in yet — not that nobody wants any
  // of this.
  if (rows.length === 0) {
    return {
      title: `No screen has been opened in ${window}.`,
      lines: [
        'Nothing has been recorded, which is not the same as everything being unused — counting only started recently, and it only counts staff screens.',
      ],
    };
  }

  const opened = new Set(rows.map((r) => r.route));
  const withRoutes = entries.filter((e) => !e.section && !e.categoryOnly);
  const never = withRoutes.filter((e) => !opened.has(e.href));

  const busiest = [...rows]
    .sort((a, b) => b.opens - a.opens)
    .slice(0, 5)
    .map((r) => `${r.route} — ${r.opens} ${r.opens === 1 ? 'open' : 'opens'}`);

  const lines = [`Most opened: ${busiest.join('; ')}.`];

  if (never.length === 0) {
    lines.push('Every screen with a route of its own has been opened at least once.');
  } else {
    lines.push(
      `Nobody has opened ${never.length === 1 ? 'this' : 'these'} in ${window}: ${never
        .map((e) => e.title)
        .join(', ')}.`,
    );
  }

  // Said rather than left to be inferred: the sections cannot be counted
  // separately, so a reader must not take their absence as silence.
  lines.push(
    'The Settings sections are not in this — they all record as the Manage screen, so nothing here says whether any one of them is used.',
  );

  return { title: `What gets opened, over ${window}.`, lines };
}
