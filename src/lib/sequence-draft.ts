// A sequence, described in a sentence.
//
// "When someone joins, welcome them, then check in after a week" is one
// of the few things an owner says that is genuinely a *program* rather
// than a change: a trigger, a wait, and a series of emails that go out
// unattended for as long as the gym runs. The automations engine (0116
// through 0201) already does all of it — five triggers, per-email delays
// measured from the anchor, send-time windows, topic suppression, the
// whole comms suite's sending identity. What it has never had is a way
// in that isn't a form.
//
// This is the untrusted-output boundary and the pure mapping onto that
// engine's storage. It is deliberately the same shape as
// newsletter-draft.ts, and for the same reason: the model drafts, this
// module decides what survives, and the result is an ordinary row on the
// existing screen. The sequence lands **disabled** — `enabled` defaults
// false and nothing here sets it — so describing one is drafting, and
// turning it on is still a human act.
//
// The trap the engine lays, and the reason storage isn't a straight copy
// of what the owner said: for member_inactive and lead_cold the wait IS
// the trigger. knobToStorage pins delay_minutes to 0 for those two and
// puts the number in params instead, so a primary email that claims to
// go "14 days after" would silently fire at the threshold. Here the
// primary's own delay is forced to zero for those triggers and the
// number is read as the threshold, which is what the owner meant.

import {
  knobToStorage,
  type AutomationParams,
  type AutomationTrigger,
} from './email/automation-knob';

export type SequenceEmail = {
  // Days from the trigger's anchor — the join, the first class, the tag,
  // the moment they went quiet. NOT from the previous email: the engine
  // schedules every step off the anchor independently, so day 0/3/7 is
  // 0/3/7 and never 0/3/4.
  afterDays: number;
  subject: string;
  heading: string;
  body: string;
};

export type SequenceDraft = {
  name: string;
  trigger: AutomationTrigger;
  // member_tagged only — without it the automation can never fire.
  tag: string | null;
  // member_inactive / lead_cold: the threshold that IS the trigger.
  threshold: number | null;
  emails: SequenceEmail[];
};

export const SEQUENCE_TRIGGERS: AutomationTrigger[] = [
  'member_joined',
  'member_first_class',
  'member_inactive',
  'member_tagged',
  'lead_cold',
];

// The two triggers whose number is a threshold rather than a wait.
export function isThresholdTrigger(t: AutomationTrigger): boolean {
  return t === 'member_inactive' || t === 'lead_cold';
}

const MAX_EMAILS = 5;
const DEFAULT_INACTIVE_DAYS = 21;
const DEFAULT_COLD_HOURS = 24;

function cleanLine(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length >= 2 ? s.slice(0, max) : null;
}

function readDays(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 0 && r <= 365 ? r : null;
}

export function sanitiseSequence(raw: unknown): SequenceDraft | null {
  const r = raw as Record<string, unknown> | null;
  if (!r) return null;

  const name = cleanLine(r.name, 60);
  const trigger = SEQUENCE_TRIGGERS.find((t) => t === r.trigger) ?? null;
  if (!name || !trigger) return null;

  // A tag automation with no tag matches nobody, for ever. Refusing is
  // the only honest answer — an owner who saw it created would assume
  // it worked.
  const tag = trigger === 'member_tagged' ? cleanLine(r.tag, 40) : null;
  if (trigger === 'member_tagged' && !tag) return null;

  let threshold: number | null = null;
  if (isThresholdTrigger(trigger)) {
    const stated = readDays(r.threshold);
    const fallback =
      trigger === 'member_inactive' ? DEFAULT_INACTIVE_DAYS : DEFAULT_COLD_HOURS;
    threshold = stated !== null && stated > 0 ? stated : fallback;
  }

  if (!Array.isArray(r.emails)) return null;
  const emails: SequenceEmail[] = [];
  for (const item of r.emails.slice(0, MAX_EMAILS)) {
    const it = item as Record<string, unknown>;
    const subject = cleanLine(it.subject, 80);
    const heading = cleanLine(it.heading, 60);
    const body = typeof it.body === 'string' ? it.body.trim().slice(0, 600) : null;
    const afterDays = readDays(it.after_days ?? it.afterDays) ?? 0;
    if (!subject || !heading || !body || body.length < 10) continue;
    emails.push({ afterDays, subject, heading, body });
  }
  if (emails.length === 0) return null;

  // Order is the owner's meaning, not the model's array order.
  emails.sort((a, b) => a.afterDays - b.afterDays);
  return { name, trigger, tag, threshold, emails };
}

// ============================================================================
// Reading it back
// ============================================================================

export function triggerSentence(d: SequenceDraft): string {
  switch (d.trigger) {
    case 'member_joined':
      return 'Starts when someone joins the gym.';
    case 'member_first_class':
      return 'Starts after a member’s first class.';
    case 'member_tagged':
      return `Starts when a member is tagged “${d.tag}”.`;
    case 'member_inactive':
      return `Starts when a member has not trained for ${d.threshold} days.`;
    case 'lead_cold':
      return `Starts when an enquiry has gone quiet for ${d.threshold} hours.`;
  }
}

export function whenLine(days: number): string {
  if (days === 0) return 'Straight away';
  if (days === 1) return 'A day later';
  if (days === 7) return 'A week later';
  if (days % 7 === 0) return `${days / 7} weeks later`;
  return `${days} days later`;
}

export function sequenceLines(d: SequenceDraft): string[] {
  return [
    triggerSentence(d),
    ...d.emails.map((e) => `${whenLine(e.afterDays)}: “${e.subject}”`),
    // The one thing an owner must not be surprised by. Nothing here sets
    // `enabled`, and the column defaults false.
    'It goes in switched off. Read it through, then turn it on.',
  ];
}

// ============================================================================
// Onto the engine's storage
// ============================================================================

export type SequenceRowShape = {
  name: string;
  trigger_type: AutomationTrigger;
  delay_minutes: number;
  params: AutomationParams;
  subject: string;
};

// The primary email is the automation row itself (0119: "the automation
// row stays the PRIMARY email"); everything after it is a step.
export function primaryRow(d: SequenceDraft): SequenceRowShape {
  const first = d.emails[0];
  // For a threshold trigger the knob is the threshold, and the primary's
  // own wait has nowhere to live — knobToStorage pins delay_minutes to 0.
  const knob = isThresholdTrigger(d.trigger) ? (d.threshold ?? 0) : first.afterDays;
  const { delay_minutes, params } = knobToStorage(d.trigger, knob);
  return {
    name: d.name,
    trigger_type: d.trigger,
    delay_minutes,
    params: d.tag ? { ...params, tag: d.tag } : params,
    subject: first.subject,
  };
}

export function stepRows(
  d: SequenceDraft,
): { step_index: number; delay_minutes: number; subject: string }[] {
  return d.emails.slice(1).map((e, i) => ({
    step_index: i,
    delay_minutes: e.afterDays * 1440,
    subject: e.subject,
  }));
}
