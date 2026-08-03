// A future day's thread (day-pager build): what is already on the books
// for a day that hasn't happened yet — classes and who's booked, cover
// still unclaimed, closures in effect, sends scheduled, renewals and
// tasks falling due. Pure module in the Timeline's register: one idea
// per line, no system vocabulary; the screen fetches rows and hands
// them here.

import { formatClock, formatDay } from './timeline';

export type FutureLineKind = 'closure' | 'class' | 'campaign' | 'renewal' | 'task';

export type FutureLine = {
  key: string;
  // The component maps kind to an icon — this module stays RN-free.
  kind: FutureLineKind;
  text: string;
  tone: 'neutral' | 'amber';
  // Bold prefix, same contract as TimelineLine.lead: always a prefix of
  // text so the renderer can slice rather than re-derive.
  lead?: string;
  // Drives the clock column and the within-day sort.
  at?: string;
  href?: string;
};

export type FutureClass = {
  id: string;
  name: string;
  startsAt: string;
  capacity: number | null;
  booked: number;
  uncovered: boolean;
};

export type FutureClosure = {
  id: string;
  startsOn: string;
  endsOn: string;
};

export type FutureCampaign = { id: string; title: string; scheduledFor: string };
export type FutureRenewal = { profileId: string; name: string; planName: string };
export type FutureTask = { id: string; title: string; assigneeName: string | null };

export function classLine(c: FutureClass): FutureLine {
  const booked =
    c.capacity !== null && c.booked >= c.capacity
      ? 'full'
      : c.booked === 0
        ? 'nobody booked yet'
        : c.capacity !== null
          ? `${c.booked} of ${c.capacity} booked`
          : `${c.booked} booked`;
  const base = `${c.name} at ${formatClock(c.startsAt)} — ${booked}.`;
  return {
    key: `class:${c.id}`,
    kind: 'class',
    text: c.uncovered ? `${base} Still needs a coach.` : base,
    tone: c.uncovered ? 'amber' : 'neutral',
    lead: c.name,
    at: c.startsAt,
    href: '/classes',
  };
}

export function closureLine(c: FutureClosure): FutureLine {
  const range =
    c.startsOn === c.endsOn
      ? ''
      : ` — closed from ${formatDay(c.startsOn)} to ${formatDay(c.endsOn)}`;
  return {
    key: `closure:${c.id}`,
    kind: 'closure',
    text: `The gym is closed this day${range}.`,
    tone: 'neutral',
  };
}

export function campaignLine(c: FutureCampaign): FutureLine {
  const title = `“${c.title}”`;
  return {
    key: `campaign:${c.id}`,
    kind: 'campaign',
    text: `${title} goes out at ${formatClock(c.scheduledFor)}.`,
    tone: 'neutral',
    lead: title,
    at: c.scheduledFor,
    href: `/management/communications/${c.id}`,
  };
}

export function renewalLine(r: FutureRenewal): FutureLine {
  return {
    key: `renewal:${r.profileId}`,
    kind: 'renewal',
    text: `${r.name}'s ${r.planName} renews.`,
    tone: 'neutral',
    lead: r.name,
    href: `/management/members/${r.profileId}`,
  };
}

export function taskLine(t: FutureTask): FutureLine {
  return {
    key: `task:${t.id}`,
    kind: 'task',
    text: t.assigneeName
      ? `Task due: ${t.title} — ${t.assigneeName}'s.`
      : `Task due: ${t.title}.`,
    tone: 'neutral',
    href: '/management/tasks',
  };
}

// The day's shape: whether the gym is even open comes first, then the
// day as it will run (classes in time order, the send when it fires),
// then the money and the chores that fall due whenever during the day.
export function composeFutureDay(s: {
  closures: FutureClosure[];
  classes: FutureClass[];
  campaigns: FutureCampaign[];
  renewals: FutureRenewal[];
  tasks: FutureTask[];
}): FutureLine[] {
  const byTime = (a: FutureLine, b: FutureLine) =>
    (a.at ?? '') < (b.at ?? '') ? -1 : 1;
  return [
    ...s.closures.map(closureLine),
    ...s.classes.map(classLine).sort(byTime),
    ...s.campaigns.map(campaignLine).sort(byTime),
    ...s.renewals.map(renewalLine),
    ...s.tasks.map(taskLine),
  ];
}
