// Changing classes that already exist.
//
// The only action so far that has to find its own subjects before it can
// describe itself: "cap Saturdays at 20" names a rule, not a list, and
// the list is whatever is on the calendar when you ask. So the resolve
// runs in preview and again in apply — the second time is what gets
// written, because a class can be added, moved or filled between reading
// the card and tapping Yes.

import { dateRangeWindow } from '../date-range';
import {
  describeBulkEdit,
  describeBulkEditResult,
  type BulkEditResult,
} from '../bulk-class-edit';
import {
  classEditWindow,
  DEFAULT_EDIT_WEEKS,
  describeEditTarget,
  sanitiseClassEdit,
  type ClassEditRequest,
} from '../chat-lookup';

import { matchMembers } from '../chat-lookup';

import { parseWallTime, sendAtEpoch, type WallTime } from '../send-time';

import {
  ActionError,
  argInt,
  argString,
  erase,
  gymTimezone,
  type ActionContext,
  type ActionPreview,
  type ActionSpec,
  type AnyAction,
} from './types';

type SessionRow = {
  id: string;
  name: string | null;
  starts_at: string;
  capacity: number;
  duration_minutes: number;
  class_types: { name: string } | null;
};

function sessionLine(s: SessionRow): string {
  const at = new Date(s.starts_at);
  const day = at.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time} — ${s.class_types?.name ?? s.name ?? 'Class'} (cap ${s.capacity})`;
}

type Resolved = {
  window: { start: string; end: string; bounded: boolean };
  sessions: SessionRow[];
};

async function resolve(
  req: ClassEditRequest,
  ctx: ActionContext,
): Promise<Resolved | null> {
  const today = new Date().toISOString().slice(0, 10);
  const window = classEditWindow(req, today);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const range = dateRangeWindow(window.start, window.end, tz);
  if (!range) return null;
  const { data, error } = await ctx.supabase
    .from('class_sessions')
    .select('id, name, starts_at, capacity, duration_minutes, class_types(name)')
    .eq('gym_id', ctx.gymId)
    .gte('starts_at', range.startIso)
    .lt('starts_at', range.endIso)
    .order('starts_at');
  if (error) throw error;
  const rows = (data ?? []) as unknown as SessionRow[];
  return {
    window,
    sessions: rows.filter((s) => {
      const at = new Date(s.starts_at);
      if (req.days && !req.days.includes(at.getDay())) return false;
      if (req.classType) {
        const name = (s.class_types?.name ?? s.name ?? '').toLowerCase();
        if (!name.includes(req.classType.toLowerCase())) return false;
      }
      return true;
    }),
  };
}

export const editClasses: ActionSpec<{ req: ClassEditRequest }> = {
  name: 'classes.edit',
  kind: 'do',
  capability: 'can_bulk_edit_classes',
  says:
    'Change classes that ALREADY exist, in bulk — "cap Saturdays at 20", ' +
    '"move the Tuesday 6am half an hour later", "make the Friday sessions 45 ' +
    'minutes". Use gym.add_classes instead for a NEW class.',
  args: [
    {
      name: 'class_type',
      type: 'string',
      desc: 'Narrows to one kind of class by name, if they named one',
    },
    {
      name: 'days',
      type: 'list',
      desc:
        'Which weekdays, as an array of integers 0=Sunday…6=Saturday ' +
        '("Saturdays"→[6], "weekdays"→[1,2,3,4,5]). Omit for every day.',
    },
    {
      name: 'from',
      type: 'date',
      desc: 'YYYY-MM-DD. Omit when they named no dates — "cap Saturdays at 20" is ongoing.',
    },
    { name: 'to', type: 'date', desc: 'YYYY-MM-DD, the last day to change' },
    { name: 'capacity', type: 'integer', desc: 'The new cap', min: 1, max: 200 },
    {
      name: 'duration_minutes',
      type: 'integer',
      desc: 'The new length',
      min: 5,
      max: 480,
    },
    {
      name: 'shift_minutes',
      type: 'integer',
      desc:
        'Moves the start — positive is later, negative earlier ("half an hour ' +
        'later"→30, "bring it forward 15 minutes"→-15)',
      min: -720,
      max: 720,
    },
  ],
  invalidate: ['class-sessions-month', 'my-upcoming-sessions'],
  sanitise: (raw) => {
    const req = sanitiseClassEdit(raw);
    return req ? { req } : null;
  },
  preview: async (a, ctx) => {
    const found = await resolve(a.req, ctx);
    if (!found) {
      return { title: "I couldn't work out which dates you meant.", lines: [] };
    }
    const count = found.sessions.length;
    if (count === 0) {
      return {
        title:
          'Nothing on the calendar matches that — check the day and the class name.',
        lines: [],
      };
    }
    const sample = found.sessions.slice(0, 3).map(sessionLine);
    return {
      title: `Change ${describeEditTarget(a.req, count)}?`,
      lines: [
        describeBulkEdit(
          {
            capacity: a.req.capacity,
            durationMinutes: a.req.durationMinutes,
            shiftMinutes: a.req.shiftMinutes,
          },
          count,
        ),
        ...sample,
        ...(count > sample.length ? [`…and ${count - sample.length} more`] : []),
        found.window.bounded
          ? `Everything in the next ${DEFAULT_EDIT_WEEKS} weeks. Say the dates if you want a different stretch.`
          : `${found.window.start} to ${found.window.end}.`,
      ],
      yes: 'Yes, change them',
    };
  },
  apply: async (a, ctx) => {
    const found = await resolve(a.req, ctx);
    if (!found || found.sessions.length === 0) {
      return 'Nothing on the calendar matches that any more — nothing changed.';
    }
    const { data, error } = await ctx.supabase.rpc('bulk_edit_sessions', {
      p_gym_id: ctx.gymId,
      p_start: found.window.start,
      p_end: found.window.end,
      p_session_ids: found.sessions.map((s) => s.id),
      p_capacity: a.req.capacity,
      p_duration_minutes: a.req.durationMinutes,
      p_shift_minutes: a.req.shiftMinutes,
    });
    if (error) throw error;
    return describeBulkEditResult(data as unknown as BulkEditResult);
  },
};

// ============================================================================
// Finding the one class they meant
// ============================================================================
//
// "tomorrow's 6am", "Friday's 7pm spin", "tonight's class". A day and a
// time is usually enough, because a gym rarely runs two things at once —
// and when it does, that is a question rather than a guess, so the caller
// gets chips.
//
// Deliberately narrow: only classes that have not started. Everything these
// actions do to a class is refused by the database for one already running,
// so offering it would be a card that cannot be confirmed.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

type ClassRow = {
  id: string;
  name: string | null;
  starts_at: string;
  capacity: number;
  class_types: { name: string } | null;
};

export function classLabel(c: ClassRow): string {
  const at = new Date(c.starts_at);
  return (
    `${c.class_types?.name ?? c.name ?? 'Class'} — ` +
    at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) +
    ` at ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  );
}

type Found =
  | { kind: 'one'; session: ClassRow }
  | { kind: 'unresolved'; preview: ActionPreview };

async function findClass(
  a: { day: string | null; time: string | null; classType: string | null },
  carry: Record<string, unknown>,
  sessionId: string | null,
  ctx: ActionContext,
): Promise<Found> {
  const select = 'id, name, starts_at, capacity, class_types(name)';
  if (sessionId) {
    const { data } = await ctx.supabase
      .from('class_sessions')
      .select(select)
      .eq('gym_id', ctx.gymId)
      .eq('id', sessionId)
      .maybeSingle();
    const row = data as unknown as ClassRow | null;
    return row
      ? { kind: 'one', session: row }
      : { kind: 'unresolved', preview: { title: "That class isn't there any more.", lines: [] } };
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // No day named means the next fortnight, so "cancel the barbell club"
  // still lands when there is only one of them coming up.
  const today = new Date().toISOString().slice(0, 10);
  const from = a.day ?? today;
  const to = a.day ?? addDays(today, 14);
  const range = dateRangeWindow(from, to, tz);
  if (!range) {
    return { kind: 'unresolved', preview: { title: "I couldn't work out which day you meant.", lines: [] } };
  }

  const { data, error } = await ctx.supabase
    .from('class_sessions')
    .select(select)
    .eq('gym_id', ctx.gymId)
    .gte('starts_at', new Date(Math.max(Date.parse(range.startIso), Date.now())).toISOString())
    .lt('starts_at', range.endIso)
    .order('starts_at');
  if (error) throw error;

  let rows = (data ?? []) as unknown as ClassRow[];
  if (a.time) {
    rows = rows.filter(
      (r) =>
        new Date(r.starts_at).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }) === a.time,
    );
  }
  if (a.classType) {
    const q = a.classType.toLowerCase();
    rows = rows.filter((r) =>
      (r.class_types?.name ?? r.name ?? '').toLowerCase().includes(q),
    );
  }

  if (rows.length === 0) {
    return {
      kind: 'unresolved',
      preview: { title: 'Nothing on the calendar matches that.', lines: [] },
    };
  }
  if (rows.length === 1) return { kind: 'one', session: rows[0] };
  return {
    kind: 'unresolved',
    preview: {
      title: 'Which class did you mean?',
      lines: [],
      choices: rows.slice(0, 6).map((r) => ({
        label: classLabel(r),
        args: { ...carry, session_id: r.id },
      })),
    },
  };
}

function readClass(raw: Record<string, unknown>) {
  const day = argString(raw, 'day', 10);
  const time = argString(raw, 'time', 5);
  const sessionId = argString(raw, 'session_id', 64);
  return {
    day: day && ISO_DATE.test(day) ? day : null,
    time: time && CLOCK.test(time) ? time : null,
    classType: argString(raw, 'class_type', 60),
    sessionId: sessionId && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : null,
  };
}

const CLASS_ARGS = [
  {
    name: 'day',
    type: 'date' as const,
    desc: 'YYYY-MM-DD. "tomorrow" and "Friday" resolve forward from today. Omit if they named no day.',
  },
  {
    name: 'time',
    type: 'string' as const,
    desc: 'The start time as 24-hour "HH:MM" ("6am"→"06:00", "7pm"→"19:00"). Omit if they did not say.',
  },
  {
    name: 'class_type',
    type: 'string' as const,
    desc: 'The kind of class, if they named it ("spin", "the barbell club")',
  },
];

async function bookedCount(sessionId: string, ctx: ActionContext): Promise<number> {
  const { count } = await ctx.supabase
    .from('class_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('class_session_id', sessionId);
  return count ?? 0;
}

// ============================================================================
// classes.cancel
// ============================================================================

type Cancel = {
  day: string | null;
  time: string | null;
  classType: string | null;
  sessionId: string | null;
  series: boolean;
};

export const cancelClass: ActionSpec<Cancel> = {
  name: 'classes.cancel',
  kind: 'do',
  capability: 'can_edit_classes',
  says:
    'Call off a class that is already on the calendar — "cancel tomorrow\'s ' +
    '6am", "no spin on Friday", "cancel the Tuesday 7pm from now on". Use ' +
    'gym.close_dates instead when the whole gym is shut.',
  args: [
    ...CLASS_ARGS,
    {
      name: 'series',
      type: 'boolean',
      desc:
        'True only if they said every one from now on ("cancel Tuesday 7pm ' +
        'from now on", "no more Friday spin"). A single class is the default.',
    },
  ],
  invalidate: ['class-sessions-month', 'my-upcoming-sessions', 'class-bookings'],
  sanitise: (raw) => ({ ...readClass(raw), series: raw.series === true }),
  preview: async (a, ctx) => {
    const found = await findClass(a, { series: a.series }, a.sessionId, ctx);
    if (found.kind === 'unresolved') return found.preview;
    const booked = await bookedCount(found.session.id, ctx);
    return {
      title: a.series
        ? `Cancel ${classLabel(found.session)} and every one after it?`
        : `Cancel ${classLabel(found.session)}?`,
      lines: [
        booked === 0
          ? 'Nobody has booked it.'
          : `${booked} ${booked === 1 ? 'person is' : 'people are'} booked in. ` +
            'They get their credit back and a note telling them it is off.',
        // There is no cancelled state to undo — the session row goes, and
        // with it the bookings and the waitlist.
        'This cannot be undone — the class is gone rather than marked off.',
        ...(a.series
          ? ['The repeat is ended too, so it will not come back next week.']
          : []),
      ],
      yes: a.series ? 'Yes, cancel them all' : 'Yes, cancel it',
    };
  },
  apply: async (a, ctx) => {
    const found = await findClass(a, {}, a.sessionId, ctx);
    if (found.kind !== 'one') throw new ActionError('That class is no longer there.');
    const label = classLabel(found.session);
    const { data, error } = await ctx.supabase.rpc(
      a.series ? 'cancel_recurrence_from' : 'cancel_session',
      { p_session_id: found.session.id },
    );
    if (error) throw new ActionError(classErrorText(error.message));
    const told = typeof data === 'number' ? data : 0;
    return a.series
      ? `${label} and every one after it are cancelled.`
      : told > 0
        ? `${label} is cancelled. ${told} ${told === 1 ? 'person has' : 'people have'} been told and had their credit back.`
        : `${label} is cancelled. Nobody had booked it.`;
  },
};

function classErrorText(message: string): string {
  if (/already started/i.test(message)) {
    return 'That class has already started, so it is too late to cancel it.';
  }
  if (/not part of a recurrence/i.test(message)) {
    return 'That one is a one-off, so there is no repeat to cancel.';
  }
  if (/Already booked/i.test(message)) return 'They are already in that class.';
  if (/Not booked/i.test(message)) return 'They are not in that class.';
  if (/Class is full/i.test(message)) return 'That class is full.';
  if (/spare capacity/i.test(message)) {
    return 'That class has room, so book them in rather than waitlisting them.';
  }
  if (/PAR-Q/i.test(message)) {
    return 'They need to fill in the PAR-Q before they can be booked in.';
  }
  if (/Waiver/i.test(message)) {
    return 'They need to sign the waiver before they can be booked in.';
  }
  if (/over capacity/i.test(message)) {
    return 'You do not have permission to go over a class cap.';
  }
  if (/Not authorised|Not a member/i.test(message)) {
    return 'You do not have permission to do that.';
  }
  return "That didn't save — try again.";
}

// ============================================================================
// classes.book_member
// ============================================================================

type BookMember = {
  member: string;
  day: string | null;
  time: string | null;
  classType: string | null;
  sessionId: string | null;
  profileId: string | null;
  mode: 'over_capacity' | 'waitlist' | null;
};

export const bookMemberIn: ActionSpec<BookMember> = {
  name: 'classes.book_member',
  kind: 'do',
  capability: 'can_assign_plan',
  says:
    'Put one member into a class — "put Marcus in Saturday\'s 9am", "book ' +
    'Sarah into tonight\'s spin", "get Dan into tomorrow morning".',
  args: [
    { name: 'member', type: 'string', desc: 'The person, as the owner named them', required: true },
    ...CLASS_ARGS,
  ],
  invalidate: ['class-sessions-month', 'class-bookings', 'class-session-detail'],
  sanitise: (raw) => {
    const member = argString(raw, 'member', 60);
    if (!member) return null;
    const profileId = argString(raw, 'profile_id', 64);
    const mode = argString(raw, 'mode', 14);
    return {
      member,
      ...readClass(raw),
      profileId: profileId && /^[0-9a-f-]{36}$/i.test(profileId) ? profileId : null,
      mode: mode === 'over_capacity' || mode === 'waitlist' ? mode : null,
    };
  },
  preview: async (a, ctx) => {
    const carry = {
      member: a.member,
      ...(a.day ? { day: a.day } : {}),
      ...(a.time ? { time: a.time } : {}),
      ...(a.classType ? { class_type: a.classType } : {}),
      ...(a.profileId ? { profile_id: a.profileId } : {}),
    };
    const found = await findClass(a, carry, a.sessionId, ctx);
    if (found.kind === 'unresolved') return found.preview;
    const who = await resolveMember(a.member, a.profileId, { ...carry, session_id: found.session.id }, ctx);
    if (who.kind === 'unresolved') return who.preview;

    const booked = await bookedCount(found.session.id, ctx);
    const full = booked >= found.session.capacity;

    // A full class is the one moment where the useful answer is a choice.
    if (full && a.mode === null) {
      return {
        title: `${classLabel(found.session)} is full — ${booked} of ${found.session.capacity} booked.`,
        lines: [],
        choices: [
          {
            label: `Put ${who.name} in anyway`,
            args: { ...carry, member: who.name, profile_id: who.profileId, session_id: found.session.id, mode: 'over_capacity' },
          },
          {
            label: `Put ${who.name} on the waitlist`,
            args: { ...carry, member: who.name, profile_id: who.profileId, session_id: found.session.id, mode: 'waitlist' },
          },
        ],
      };
    }

    if (a.mode === 'waitlist') {
      return {
        title: `Put ${who.name} on the waitlist for ${classLabel(found.session)}?`,
        lines: ['They take the next space that opens, automatically.'],
        yes: 'Yes, waitlist them',
      };
    }
    return {
      title: `Put ${who.name} in ${classLabel(found.session)}?`,
      lines:
        a.mode === 'over_capacity'
          ? [
              `That is ${booked + 1} in a class capped at ${found.session.capacity}.`,
              'No credit is taken — a staff booking never charges them.',
            ]
          : [
              `${booked} of ${found.session.capacity} booked.`,
              'No credit is taken — a staff booking never charges them.',
            ],
      yes: a.mode === 'over_capacity' ? 'Yes, over the cap' : 'Yes, book them in',
    };
  },
  apply: async (a, ctx) => {
    const found = await findClass(a, {}, a.sessionId, ctx);
    if (found.kind !== 'one') throw new ActionError('That class is no longer there.');
    const who = await resolveMember(a.member, a.profileId, {}, ctx);
    if (who.kind !== 'one') throw new ActionError("I couldn't find them.");

    if (a.mode === 'waitlist') {
      const { data, error } = await ctx.supabase.rpc('staff_join_waitlist', {
        p_gym_id: ctx.gymId,
        p_session_id: found.session.id,
        p_profile_id: who.profileId,
      });
      if (error) throw new ActionError(classErrorText(error.message));
      const rank = typeof data === 'number' ? data : null;
      return rank
        ? `${who.name} is number ${rank} on the waitlist for ${classLabel(found.session)}.`
        : `${who.name} is on the waitlist for ${classLabel(found.session)}.`;
    }

    const { error } = await ctx.supabase.rpc('staff_book_member', {
      p_session_id: found.session.id,
      p_member_profile_id: who.profileId,
      p_entitlement_kind: null,
      p_entitlement_id: null,
      p_no_charge: true,
      p_over_capacity: a.mode === 'over_capacity',
    });
    if (error) throw new ActionError(classErrorText(error.message));
    return a.mode === 'over_capacity'
      ? `${who.name} is in ${classLabel(found.session)}, over the cap.`
      : `${who.name} is in ${classLabel(found.session)}.`;
  },
};

// ============================================================================
// classes.remove_member
// ============================================================================

type RemoveMember = {
  member: string;
  day: string | null;
  time: string | null;
  classType: string | null;
  sessionId: string | null;
  profileId: string | null;
  refund: boolean | null;
};

export const removeMemberFrom: ActionSpec<RemoveMember> = {
  name: 'classes.remove_member',
  kind: 'do',
  capability: 'can_assign_plan',
  says:
    'Take one member out of a class they are booked into — "take Sarah out ' +
    'of tonight\'s class", "Marcus can\'t make Saturday\'s 9am".',
  args: [
    { name: 'member', type: 'string', desc: 'The person, as the owner named them', required: true },
    ...CLASS_ARGS,
  ],
  invalidate: ['class-sessions-month', 'class-bookings', 'class-session-detail'],
  sanitise: (raw) => {
    const member = argString(raw, 'member', 60);
    if (!member) return null;
    const profileId = argString(raw, 'profile_id', 64);
    const refund = raw.refund;
    return {
      member,
      ...readClass(raw),
      profileId: profileId && /^[0-9a-f-]{36}$/i.test(profileId) ? profileId : null,
      refund: typeof refund === 'boolean' ? refund : null,
    };
  },
  preview: async (a, ctx) => {
    const carry = {
      member: a.member,
      ...(a.day ? { day: a.day } : {}),
      ...(a.time ? { time: a.time } : {}),
      ...(a.classType ? { class_type: a.classType } : {}),
      ...(a.profileId ? { profile_id: a.profileId } : {}),
    };
    const found = await findClass(a, carry, a.sessionId, ctx);
    if (found.kind === 'unresolved') return found.preview;
    const who = await resolveMember(a.member, a.profileId, { ...carry, session_id: found.session.id }, ctx);
    if (who.kind === 'unresolved') return who.preview;

    // Who the waitlist would hand the seat to. Worth naming: taking one
    // person out quietly puts another in.
    const { data: waiting } = await ctx.supabase
      .from('class_waitlist')
      .select('profile_id, position, profiles!profile_id(full_name)')
      .eq('class_session_id', found.session.id)
      .order('position')
      .limit(1);
    const next = ((waiting ?? []) as unknown as {
      profiles: { full_name: string | null } | null;
    }[])[0]?.profiles?.full_name?.trim();

    // "is next" rather than "takes the space": promote_from_waitlist only
    // promotes someone still ELIGIBLE, and swallows the failure if they are
    // not — so the seat can come free with the queue standing. The receipt
    // reports what actually happened; the card should not promise it.
    const context = next
      ? [`${next} is next on the waitlist and would take the space.`]
      : [];

    // The money question, asked rather than assumed: the refund trigger
    // returns the credit whatever the reason, and "she is ill" and "he did
    // not turn up" are not the same thing.
    if (a.refund === null) {
      return {
        title: `Take ${who.name} out of ${classLabel(found.session)}?`,
        lines: context,
        choices: [
          {
            label: 'Take them out, credit back',
            args: { ...carry, member: who.name, profile_id: who.profileId, session_id: found.session.id, refund: true },
          },
          {
            label: 'Take them out, keep the credit',
            args: { ...carry, member: who.name, profile_id: who.profileId, session_id: found.session.id, refund: false },
          },
        ],
      };
    }
    return {
      title: `Take ${who.name} out of ${classLabel(found.session)}?`,
      lines: [
        a.refund
          ? 'Their class credit goes back.'
          : 'Their class credit does not come back.',
        ...context,
      ],
      yes: 'Yes, take them out',
    };
  },
  apply: async (a, ctx) => {
    const found = await findClass(a, {}, a.sessionId, ctx);
    if (found.kind !== 'one') throw new ActionError('That class is no longer there.');
    const who = await resolveMember(a.member, a.profileId, {}, ctx);
    if (who.kind !== 'one') throw new ActionError("I couldn't find them.");
    const { data, error } = await ctx.supabase.rpc('remove_member_booking', {
      p_gym_id: ctx.gymId,
      p_session_id: found.session.id,
      p_profile_id: who.profileId,
      p_refund: a.refund ?? true,
    });
    if (error) throw new ActionError(classErrorText(error.message));
    const r = (data ?? {}) as { refunded: boolean; promoted_name: string | null };
    const credit = r.refunded ? 'Their credit is back.' : 'The credit stays used.';
    const promoted = r.promoted_name
      ? ` ${r.promoted_name} came off the waitlist into the space.`
      : '';
    return `${who.name} is out of ${classLabel(found.session)}. ${credit}${promoted}`;
  },
};

// ============================================================================
// A member, for these three
// ============================================================================
//
// Narrower than members.ts's resolver on purpose: booking and removal only
// ever concern someone already on the roster, so there is no pending-member
// branch to worry about here.

type Who =
  | { kind: 'one'; profileId: string; name: string }
  | { kind: 'unresolved'; preview: ActionPreview };

async function resolveMember(
  query: string,
  profileId: string | null,
  carry: Record<string, unknown>,
  ctx: ActionContext,
): Promise<Who> {
  if (profileId) {
    const { data } = await ctx.supabase
      .from('profiles')
      .select('full_name')
      .eq('id', profileId)
      .maybeSingle();
    const name = (data as { full_name: string | null } | null)?.full_name?.trim();
    return { kind: 'one', profileId, name: name || query };
  }
  const { data } = await ctx.supabase
    .from('v_member_cohort')
    .select('profile_id, profiles!profile_id(full_name)')
    .eq('gym_id', ctx.gymId);
  const named = ((data ?? []) as unknown as {
    profile_id: string;
    profiles: { full_name: string | null } | null;
  }[])
    .filter((r) => r.profiles?.full_name?.trim())
    .map((r) => ({ id: r.profile_id, name: r.profiles!.full_name!.trim() }));
  const hits = matchMembers(named, query);
  if (hits.length === 1) {
    return { kind: 'one', profileId: hits[0].id, name: hits[0].name };
  }
  if (hits.length > 1) {
    return {
      kind: 'unresolved',
      preview: {
        title: `A few people could be “${query}” — which one did you mean?`,
        lines: [],
        choices: hits.map((h) => ({
          label: h.name,
          args: { ...carry, member: h.name, profile_id: h.id },
        })),
      },
    };
  }
  return {
    kind: 'unresolved',
    preview: { title: `No one called “${query}” on your books.`, lines: [] },
  };
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ============================================================================
// classes.move and classes.set_coach
// ============================================================================
//
// The two things the calendar could show and nothing could change. Both
// went in as RPCs in 0224 — before that, a session's time could only be
// shifted by ±N minutes across a whole date range, and its coach could
// only be set by that coach volunteering through the cover flow.
//
// The new time is resolved in the gym's timezone rather than the device's,
// because the instant written is the one members see and a coach on
// holiday must not shift it. (Finding the class still reads the device's
// clock, as every class action has; that inconsistency is one sweep, named
// in docs/roadmap.md, rather than half-done here.)

type Move = {
  day: string | null;
  time: string | null;
  classType: string | null;
  sessionId: string | null;
  to: WallTime;
  minutes: number | null;
};

function newTimeLabel(at: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));
}

// The RPCs raise in words; these are the ones an owner can act on.
function classWriteFailure(message: string): string {
  if (/already run/i.test(message)) {
    return 'That class has already run — its attendance is a record of who was there.';
  }
  if (/gym is closed/i.test(message)) return message;
  if (/already a class of that series/i.test(message)) {
    return 'There is already a class of that series at that time.';
  }
  if (/already coaching/i.test(message)) {
    return 'They are already coaching something at that time.';
  }
  if (/not qualified/i.test(message)) {
    return 'They are marked as not qualified for that kind of class.';
  }
  if (/Only an owner or a coach/i.test(message)) {
    return 'Only an owner or a coach can be put in front of a class.';
  }
  if (/not at this gym/i.test(message)) return 'They are not at this gym.';
  if (/row-level security|Not authorised/i.test(message)) {
    return 'You do not have permission to change classes.';
  }
  return "That didn't save — try again.";
}

export const moveClass: ActionSpec<Move> = {
  name: 'classes.move',
  kind: 'do',
  capability: 'can_edit_classes',
  says:
    'Move one class to a different time or day — "move tomorrow\'s 6am to ' +
    '7", "Saturday\'s spin is at 10 this week not 9", "push Friday\'s ' +
    'barbell club to Thursday at 6:30". For a whole range of classes use ' +
    'classes.edit; to call one off use classes.cancel.',
  args: [
    ...CLASS_ARGS,
    {
      name: 'to_day',
      type: 'date',
      desc:
        'The day it moves to, YYYY-MM-DD. If they only changed the time, ' +
        'this is the same day it is on now.',
      required: true,
    },
    {
      name: 'to_time',
      type: 'string',
      desc: 'The new start time as 24-hour "HH:MM" ("7"→"07:00", "6:30pm"→"18:30")',
      required: true,
    },
    {
      name: 'minutes',
      type: 'integer',
      desc: 'A new length in minutes, only if they changed it',
      min: 5,
      max: 480,
    },
  ],
  invalidate: [
    'class-sessions-month',
    'class-session-detail',
    'my-upcoming-sessions',
    'my-future-bookings',
    'my-bookings',
    'agenda-booking-counts',
    'class-change-notifications',
  ],
  sanitise: (raw) => {
    const to = parseWallTime(raw.to_day, raw.to_time);
    if (!to) return null;
    const minutes = argInt(raw, 'minutes', 5, 480);
    return { ...readClass(raw), to, minutes };
  },
  preview: async (a, ctx) => {
    const found = await findClass(a, { to_day: null }, a.sessionId, ctx);
    if (found.kind === 'unresolved') return found.preview;
    const tz = await gymTimezone(ctx);
    const at = sendAtEpoch(a.to, tz, Date.now());
    if (at === null) {
      return {
        title: 'That time has already gone, or is more than a year out.',
        lines: ['Give me a day and time still ahead of us.'],
      };
    }
    const booked = await bookedCount(found.session.id, ctx);
    return {
      title: `Move ${classLabel(found.session)}?`,
      lines: [
        `It goes to ${newTimeLabel(at, tz)}${a.minutes ? `, ${a.minutes} minutes` : ''}.`,
        booked === 0
          ? 'Nobody has booked it, so nobody needs telling.'
          : `${booked} ${booked === 1 ? 'person is' : 'people are'} booked in and ` +
            'will get a note that it has changed time. Their places are kept.',
        // 0170 refuses to rewrite a pattern from a partial selection, and
        // one class is the most partial there is. An owner who edits the
        // schedule next month and finds this class back at its old slot
        // should have been told, not surprised.
        'This moves the one class. The repeating schedule still says the old slot, so editing the schedule later puts it back.',
      ],
      yes: 'Yes, move it',
    };
  },
  apply: async (a, ctx) => {
    const found = await findClass(a, { to_day: null }, a.sessionId, ctx);
    if (found.kind === 'unresolved') throw new ActionError('That class is no longer there.');
    const tz = await gymTimezone(ctx);
    const at = sendAtEpoch(a.to, tz, Date.now());
    if (at === null) throw new ActionError('That time has already gone.');
    const { error } = await ctx.supabase.rpc('reschedule_session', {
      p_session_id: found.session.id,
      p_starts_at: new Date(at).toISOString(),
      p_duration: a.minutes,
    });
    if (error) throw new ActionError(classWriteFailure(error.message));
    return `Moved. It is ${newTimeLabel(at, tz)} now, and anyone booked in has been told.`;
  },
};

type SetCoach = {
  day: string | null;
  time: string | null;
  classType: string | null;
  sessionId: string | null;
  coach: string;
};

type CoachRow = { profile_id: string; name: string };

// Owners and coaches only, which is set_session_coach's own rule and
// user_can_cover's before it: admins do not coach. Offering an admin as a
// choice would be offering a chip that fails.
async function coaches(ctx: ActionContext): Promise<CoachRow[]> {
  const { data } = await ctx.supabase
    .from('gym_memberships')
    .select('profile_id, profiles!profile_id(full_name)')
    .eq('gym_id', ctx.gymId)
    .in('role', ['owner', 'coach'])
    .is('left_at', null);
  return ((data ?? []) as unknown as {
    profile_id: string;
    profiles: { full_name: string | null } | null;
  }[])
    .filter((r) => r.profiles?.full_name?.trim())
    .map((r) => ({ profile_id: r.profile_id, name: r.profiles!.full_name!.trim() }));
}

export const setClassCoach: ActionSpec<SetCoach> = {
  name: 'classes.set_coach',
  kind: 'do',
  capability: 'can_edit_classes',
  says:
    'Put a different coach on a class — "Jo is taking Saturday\'s 9am", ' +
    '"put Marcus on tomorrow\'s 6am instead". For a coach asking somebody ' +
    'else to take theirs, that is the cover flow, not this.',
  args: [
    ...CLASS_ARGS,
    {
      name: 'coach',
      type: 'string',
      desc: 'The coach taking it, as the owner named them',
      required: true,
    },
  ],
  invalidate: [
    'class-sessions-month',
    'class-session-detail',
    'my-upcoming-sessions',
    'cover-offers',
    'coach-earnings',
  ],
  sanitise: (raw) => {
    const coach = argString(raw, 'coach', 80);
    return coach ? { ...readClass(raw), coach } : null;
  },
  preview: async (a, ctx) => {
    const found = await findClass(a, { coach: a.coach }, a.sessionId, ctx);
    if (found.kind === 'unresolved') return found.preview;
    const hits = matchMembers(await coaches(ctx), a.coach);
    if (hits.length === 0) {
      return {
        title: `No coach here called “${a.coach}”.`,
        lines: ['Only an owner or a coach can be put in front of a class.'],
      };
    }
    if (hits.length > 1) {
      return {
        title: `A few coaches could be “${a.coach}” — which one?`,
        lines: [],
        choices: hits.map((h) => ({
          label: h.name,
          args: { ...a, coach: h.name, session_id: found.session.id },
        })),
      };
    }
    return {
      title: `Put ${hits[0].name} on ${classLabel(found.session)}?`,
      lines: [
        'The class does not move and nobody loses their place.',
        // 0227. Both writers tell them now — this one and the cover
        // claim — because a coach is often why somebody booked, and a
        // swap they only discover at the door is the worst way to find
        // out.
        'Everyone booked in is told who is taking it.',
      ],
      yes: 'Yes, put them on it',
    };
  },
  apply: async (a, ctx) => {
    const found = await findClass(a, { coach: a.coach }, a.sessionId, ctx);
    if (found.kind === 'unresolved') throw new ActionError('That class is no longer there.');
    const hits = matchMembers(await coaches(ctx), a.coach);
    if (hits.length !== 1) throw new ActionError('I lost track of which coach you meant.');
    const { error } = await ctx.supabase.rpc('set_session_coach', {
      p_session_id: found.session.id,
      p_coach_id: hits[0].profile_id,
    });
    if (error) throw new ActionError(classWriteFailure(error.message));
    return `${hits[0].name} is taking ${classLabel(found.session)}.`;
  },
};

export const CLASS_ACTIONS: AnyAction[] = [
  erase(editClasses),
  erase(cancelClass),
  erase(moveClass),
  erase(setClassCoach),
  erase(bookMemberIn),
  erase(removeMemberFrom),
];
