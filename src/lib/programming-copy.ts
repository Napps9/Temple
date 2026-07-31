// Moving programming about, and showing what that costs.
//
// Everything else the bar does to programming works on the scaffolding:
// blocks, access, which plans carry it. Nothing writes a workout, and the
// line held because writing one is craft. Copying a week and clearing a
// day are the two that had to cross it, and they are dangerous in a way
// "put Marcus on Unlimited" is not: both are a wholesale replace of a
// `sections` array somebody wrote by hand, and a coach who says "copy
// last week onto next week" and silently loses a session they had already
// written into Thursday has been robbed by a sentence.
//
// So the preview is not a summary, it is the content. This module builds
// what the card renders: for every day, what arrives and what it lands
// on, with the coach's own titles in their own words. An argument list
// could not have said it — that is the whole reason this was left until
// there was a card renderer to say it with.

import { categoryLabel, type Section } from './programming';

export type ProgrammedDay = {
  date: string;
  classTypeId: string;
  sections: Section[];
};

export type ProgrammingRow = {
  date: string;
  // "Monday 3 Aug"
  day: string;
  classType: string;
  // What lands there. Empty for a clear.
  incoming: string[];
  // What is there now and will not survive. Empty when the day is blank,
  // which is the difference between a copy and an overwrite.
  replacing: string[];
};

export type ProgrammingChangeCard = {
  heading: string;
  rows: ProgrammingRow[];
  // Counted rather than derived at the surface, because the sentence
  // above the card depends on it and the two must not drift.
  replacedDays: number;
};

export function shiftDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}

// Weeks run Monday to Sunday, which is what every timetable in this
// codebase already assumes.
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  const dow = at.getUTCDay();
  return shiftDays(day, dow === 0 ? -6 : 1 - dow);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDays(monday, i));
}

export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function weekLabel(monday: string): string {
  const [y, m, d] = monday.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// One line per section, in the coach's own words where they wrote any.
// The title is what they recognise; the category is the fallback and
// never the whole answer, because "Conditioning" describes half a gym's
// programming and identifies none of it.
export function sectionLine(s: Section): string {
  const title = s.title.trim();
  const head = title || categoryLabel(s.section_category);
  const body = s.body.trim().split('\n')[0]?.trim() ?? '';
  if (!body) return head;
  const snippet = body.length > 60 ? `${body.slice(0, 57)}…` : body;
  return `${head} — ${snippet}`;
}

function linesFor(day: ProgrammedDay | undefined): string[] {
  return (day?.sections ?? []).map(sectionLine);
}

function keyOf(date: string, classTypeId: string): string {
  return `${date}\n${classTypeId}`;
}

function index(days: ProgrammedDay[]): Map<string, ProgrammedDay> {
  return new Map(days.map((d) => [keyOf(d.date, d.classTypeId), d]));
}

export function copyPlan(input: {
  fromMonday: string;
  toMonday: string;
  classTypes: { id: string; name: string }[];
  source: ProgrammedDay[];
  destination: ProgrammedDay[];
}): ProgrammingChangeCard {
  const { fromMonday, toMonday, classTypes, source, destination } = input;
  const src = index(source);
  const dst = index(destination);
  const rows: ProgrammingRow[] = [];

  weekDays(fromMonday).forEach((fromDate, offset) => {
    const toDate = shiftDays(toMonday, offset);
    for (const type of classTypes) {
      const incoming = linesFor(src.get(keyOf(fromDate, type.id)));
      // A blank source day is not a change. Copying nothing onto
      // something would be a delete wearing a copy's clothes, and
      // nobody who says "copy last week" means that.
      if (incoming.length === 0) continue;
      rows.push({
        date: toDate,
        day: dayLabel(toDate),
        classType: type.name,
        incoming,
        replacing: linesFor(dst.get(keyOf(toDate, type.id))),
      });
    }
  });

  return {
    heading: `The week of ${weekLabel(fromMonday)} onto the week of ${weekLabel(toMonday)}`,
    rows,
    replacedDays: rows.filter((r) => r.replacing.length > 0).length,
  };
}

export function clearPlan(input: {
  date: string;
  classTypes: { id: string; name: string }[];
  existing: ProgrammedDay[];
}): ProgrammingChangeCard {
  const { date, classTypes, existing } = input;
  const have = index(existing);
  const rows: ProgrammingRow[] = [];

  for (const type of classTypes) {
    const replacing = linesFor(have.get(keyOf(date, type.id)));
    if (replacing.length === 0) continue;
    rows.push({
      date,
      day: dayLabel(date),
      classType: type.name,
      incoming: [],
      replacing,
    });
  }

  return {
    heading: dayLabel(date),
    rows,
    replacedDays: rows.length,
  };
}

// The sentence above the card. Separate from the card so the count and
// the wording cannot disagree, and so the dangerous case reads as
// dangerous: an overwrite is named before it is agreed to.
export function copySentence(card: ProgrammingChangeCard): string {
  if (card.rows.length === 0) return 'There is nothing programmed that week to copy.';
  const days = new Set(card.rows.map((r) => r.date)).size;
  const written = `${card.rows.length} session${card.rows.length === 1 ? '' : 's'} across ${days} day${days === 1 ? '' : 's'}`;
  if (card.replacedDays === 0) return `${written}, onto days with nothing on them.`;
  return `${written}. ${card.replacedDays} ${
    card.replacedDays === 1 ? 'already has programming and it' : 'already have programming and they'
  } will be replaced.`;
}

export function clearSentence(card: ProgrammingChangeCard): string {
  if (card.rows.length === 0) return 'There is nothing programmed that day.';
  return `${card.rows.length} session${card.rows.length === 1 ? '' : 's'} ${
    card.rows.length === 1 ? 'is' : 'are'
  } deleted. There is no undo.`;
}
