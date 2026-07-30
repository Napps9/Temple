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

import { erase, type ActionContext, type ActionSpec, type AnyAction } from './types';

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
  invalidate: ['class-sessions', 'today-classes'],
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

export const CLASS_ACTIONS: AnyAction[] = [erase(editClasses)];
