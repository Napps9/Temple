// The single timing "knob" each automation trigger exposes in the editor,
// and how it round-trips to storage. Extracted from the editor screen so the
// invariant that broke can be tested directly: a wait of 0 is a real,
// meaningful value — "mail them the instant they attend / the moment they
// join" — and it has to survive a save/reopen unchanged.
//
// It did not. `email_automations.delay_minutes` is `not null default 0`
// (0116), so a brand-new automation and a deliberately-zero one are the
// same stored value. The editor faked the intended 3-day default on READ
// with `Math.round(delay_minutes / 1440) || 3`, and because 0 is falsy in
// JavaScript that turned a saved 0 into 3 on reopen — a "send immediately"
// silently became "wait three days". The default now lives at CREATION (the
// inserted row carries DEFAULT_AUTOMATION_WAIT_DAYS), so read-back can be
// faithful and stored value and shown value never disagree.

export type AutomationTrigger =
  | 'member_joined'
  | 'member_first_class'
  | 'member_inactive'
  | 'lead_cold'
  | 'member_tagged';

// tag is member_tagged's target label — not a timing knob, so the editor
// merges it into params alongside what knobToStorage returns.
export type AutomationParams = {
  inactive_days?: number;
  cold_hours?: number;
  tag?: string;
};

// The wait a freshly created delay-based automation (member_joined /
// member_first_class) is born with. Written into the inserted row rather
// than synthesised on read.
export const DEFAULT_AUTOMATION_WAIT_DAYS = 3;

const MINUTES_PER_DAY = 1440;

export function knobToStorage(
  trigger: AutomationTrigger,
  knob: number,
): { delay_minutes: number; params: AutomationParams } {
  switch (trigger) {
    case 'member_joined':
    case 'member_first_class':
    case 'member_tagged':
      return {
        delay_minutes: Math.max(0, Math.round(knob)) * MINUTES_PER_DAY,
        params: {},
      };
    case 'member_inactive':
      return { delay_minutes: 0, params: { inactive_days: Math.max(1, Math.round(knob)) } };
    case 'lead_cold':
      return { delay_minutes: 0, params: { cold_hours: Math.max(1, Math.round(knob)) } };
  }
}

export function storageToKnob(row: {
  trigger_type: AutomationTrigger;
  delay_minutes: number;
  params: AutomationParams | null;
}): number {
  switch (row.trigger_type) {
    case 'member_joined':
    case 'member_first_class':
    case 'member_tagged':
      // delay_minutes is `not null`, so this is always a real number,
      // including 0 ("as soon as it happens"). No `|| 3` — that swallowed a
      // deliberate 0 because 0 is falsy, which is the whole bug.
      return Math.max(0, Math.round(row.delay_minutes / MINUTES_PER_DAY));
    case 'member_inactive':
      return row.params?.inactive_days ?? 21;
    case 'lead_cold':
      return row.params?.cold_hours ?? 24;
  }
}
