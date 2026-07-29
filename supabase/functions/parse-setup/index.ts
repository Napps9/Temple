// Day-one setup parsing: turns the owner's free-text description of
// their week (or their prices) into a structured proposal for the /setup
// conversation to preview. This function holds no write power — the
// client sanitises the proposal (src/lib/setup-flow.ts) and nothing is
// created until the owner confirms, at which point the owner's own
// session applies it through the same RLS paths as the manual editors.
//
// Auth mirrors classify-programming: the caller's JWT is forwarded and
// checked against effective_can(gym, 'can_edit_classes') — parsing costs
// tokens but reveals nothing the caller didn't type.
//
// Env:
//   ANTHROPIC_API_KEY — absent means 503; the setup screen then offers
//   the manual editors instead of pretending to parse.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

// Sonnet, not Haiku: this parse runs once per gym and the whole flow's
// credibility rests on it hearing "6, 7 and 9:30 weekday mornings"
// correctly.
const MODEL = 'claude-sonnet-5';
const MAX_TEXT_CHARS = 2000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

const TIMETABLE_TOOL = {
  name: 'emit_timetable',
  description: "Emit the gym's weekly class schedule.",
  input_schema: {
    type: 'object',
    properties: {
      schedules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            class_type: { type: 'string' },
            days: { type: 'array', items: { type: 'integer' } },
            times: { type: 'array', items: { type: 'string' } },
            duration_minutes: { type: 'integer' },
            capacity: { type: 'integer' },
          },
          required: ['class_type', 'days', 'times'],
        },
      },
    },
    required: ['schedules'],
  },
};

const PLANS_TOOL = {
  name: 'emit_plans',
  description: "Emit the gym's membership plans.",
  input_schema: {
    type: 'object',
    properties: {
      plans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            kind: {
              type: 'string',
              enum: [
                'unlimited',
                'credit_period',
                'credit_pack',
                'programming_only',
              ],
            },
            monthly_price_cents: { type: ['integer', 'null'] },
            credit_count: { type: ['integer', 'null'] },
            notice_period_days: { type: ['integer', 'null'] },
            blurb: { type: 'string' },
          },
          required: ['name', 'kind', 'monthly_price_cents'],
        },
      },
    },
    required: ['plans'],
  },
};

// The Timeline's talk bar: one sentence from the owner becomes rule
// changes, new classes, new plans, or a closure — never anything else.
// Values are validated client-side against the same option table the
// rule sheet renders (sanitiseRuleChanges), so an invented enum dies
// before it is shown, let alone applied.
const RULE_FIELDS = [
  'booking_window_hours_ahead',
  'late_cancel',
  'booking_cutoff_minutes_before',
  'require_membership_to_book',
  'week_starts_on',
  'allow_minors',
  'weight_unit',
  'dm_scope',
  'leaderboards_on',
  'public_signup',
  'public_lead_capture',
  'expiring_within_days',
  'parq_expiry_days',
  'health_retention_months',
  'cover_warning_hours',
  'lead_conversion_window_days',
];

const CHANGE_TOOL = {
  name: 'emit_change',
  description:
    "Emit the change the gym owner asked for. Fill only the parts they described; use `cannot` when the request is none of these.",
  input_schema: {
    type: 'object',
    properties: {
      rule_changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: RULE_FIELDS },
            value: { type: ['string', 'integer', 'boolean', 'null'] },
          },
          required: ['field', 'value'],
        },
      },
      add_classes: (TIMETABLE_TOOL.input_schema.properties as {
        schedules: unknown;
      }).schedules,
      add_plans: (PLANS_TOOL.input_schema.properties as { plans: unknown })
        .plans,
      closure: {
        type: 'object',
        properties: {
          starts_on: { type: 'string' },
          ends_on: { type: 'string' },
          reason: { type: ['string', 'null'] },
        },
        required: ['starts_on', 'ends_on'],
      },
      newsletter: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                heading: { type: 'string' },
                body: { type: 'string' },
              },
              required: ['heading', 'body'],
            },
          },
        },
        required: ['subject', 'sections'],
      },
      edit_classes: {
        type: 'object',
        properties: {
          class_type: { type: ['string', 'null'] },
          days: { type: ['array', 'null'], items: { type: 'integer' } },
          from: { type: ['string', 'null'] },
          to: { type: ['string', 'null'] },
          capacity: { type: ['integer', 'null'] },
          duration_minutes: { type: ['integer', 'null'] },
          shift_minutes: { type: ['integer', 'null'] },
        },
      },
      find_member: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      cannot: { type: ['string', 'null'] },
    },
  },
};

function changePrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return (
    'You parse a gym owner\'s sentence into the change they asked for. ' +
    `Today is ${today}.\n` +
    'Emit ONLY what was described — never invent classes, prices, dates ' +
    'or settings. Kinds of change:\n' +
    '1. rule_changes — settings. Fields and values:\n' +
    '   booking_window_hours_ahead: hours as integer ("2 weeks"→336, ' +
    '"5 days"→120), or null for no limit.\n' +
    '   late_cancel: "day_before_21" (9pm night before) | "two_hours" | ' +
    '"never".\n' +
    '   booking_cutoff_minutes_before: minutes as integer, 0 = up to ' +
    'the start.\n' +
    '   require_membership_to_book / allow_minors / leaderboards_on / ' +
    'public_signup / public_lead_capture: boolean.\n' +
    '   week_starts_on: "mon" | "sun". weight_unit: "kg" | "lb".\n' +
    '   dm_scope: "full_gym" | "member_coach_only".\n' +
    '   expiring_within_days / lead_conversion_window_days / ' +
    'parq_expiry_days: days as integer. health_retention_months: months. ' +
    'cover_warning_hours: hours, 0 = off.\n' +
    '   Enum and boolean fields must land on one of the listed values ' +
    'exactly. If the owner names something else — a different time, or a ' +
    'rule that varies by class, day or member — do NOT round to the ' +
    'nearest value: leave that field out and name it in `cannot`. A ' +
    'sentence can do both: take the parts that fit and name the rest.\n' +
    '2. add_classes — NEW classes on the timetable. Same conventions as ' +
    'a timetable: days 0=Sunday…6=Saturday, times 24-hour "HH:MM", ' +
    'duration_minutes default 60, capacity default 16.\n' +
    '3. add_plans — NEW membership plans. monthly_price_cents in pence ' +
    '("£89"→8900); N-classes-a-month is credit_period with credit_count.\n' +
    '4. closure — the gym shutting for a date range. starts_on/ends_on ' +
    'as YYYY-MM-DD, resolved forward from today ("22 Dec to 3 Jan" is ' +
    'the next December). reason is the owner\'s stated reason or null.\n' +
    '5. newsletter — the owner asking to send/write a newsletter or ' +
    'email to members ("send a newsletter this week — Christmas hours, ' +
    'the new barbell club"). DRAFT it for them: a short subject line and ' +
    '2-4 sections, each a heading plus 1-3 sentences of warm, plain ' +
    'British English written from the owner\'s brief. Use ONLY facts the ' +
    'owner stated — never invent dates, times, prices or names; if the ' +
    'brief only names a topic, write copy that introduces the topic and ' +
    'tells members to watch this space or ask at the gym.\n' +
    '6. edit_classes — changing classes that ALREADY exist, in bulk: ' +
    'capacity, length, or moving the start time. days 0=Sunday…6=Saturday ' +
    'picks which weekdays ("Saturdays"→[6], "weekdays"→[1,2,3,4,5]); ' +
    'class_type narrows to one kind by name; from/to are YYYY-MM-DD and ' +
    'stay null when the owner named no dates ("cap Saturdays at 20" is ' +
    'ongoing). shift_minutes moves the start — positive is later, ' +
    'negative earlier ("move the 6am half an hour later"→30, "bring ' +
    'Tuesday forward 15 minutes"→-15). Set only the fields they changed; ' +
    'leave the rest null. Use add_classes, not this, for a NEW class.\n' +
    '7. find_member — the owner asking about a person ("show me Marcus", ' +
    '"what\'s Sarah Jones on", "is Dan still paying"). query is just the ' +
    'name as they said it. Use this whenever the sentence is a question ' +
    'about one member rather than an instruction.\n' +
    'Anything else — changing an existing plan\'s price, adding or ' +
    'cancelling one person\'s membership, refunds — set `cannot` to one ' +
    'short plain sentence naming what they asked for. Do not guess.'
  );
}

const TIMETABLE_PROMPT =
  'You parse a gym owner\'s description of their weekly class timetable ' +
  'into structured schedules. Rules:\n' +
  '- days use 0=Sunday … 6=Saturday. "Weekdays" means [1,2,3,4,5].\n' +
  '- times are 24-hour "HH:MM" local. "6am" → "06:00", "6pm" → "18:00".\n' +
  '- Group into as few schedules as faithfully possible: one schedule ' +
  'per class type per repeating pattern (same days + times).\n' +
  '- If no class name is given, use the discipline or "Classes".\n' +
  '- duration_minutes defaults to 60 when unstated; capacity to the ' +
  'stated cap, else 16.\n' +
  '- Never invent classes, days or times that were not described.';

const PLANS_PROMPT =
  'You parse a gym owner\'s description of their membership prices into ' +
  'structured plans. Rules:\n' +
  '- monthly_price_cents is the price in pence/cents: "£89" → 8900.\n' +
  '- A plan limited to N classes per month is kind "credit_period" with ' +
  'credit_count N. An everything plan is "unlimited".\n' +
  '- blurb is a short plain-English line a member would read, e.g. ' +
  '"every class, every week" or "off-peak classes only". Put any ' +
  'restriction the owner stated (student, off-peak) in the blurb.\n' +
  '- If the owner states a cancellation notice ("30 days notice to ' +
  'cancel"), set notice_period_days; otherwise null.\n' +
  '- Never invent plans, prices or notice periods that were not described.';

// The registry's half of the vocabulary. The client sends the actions
// this particular person is allowed to use, so the tool's action list and
// the prompt's catalogue are built per call — an action nobody can
// perform is never described, and adding one to the app's registry is the
// whole of adding it here.
type ActionArg = {
  name: string;
  type: string;
  desc: string;
  required?: boolean;
  values?: string[];
  min?: number;
  max?: number;
};
type ActionWire = {
  name: string;
  kind: 'do' | 'ask';
  says: string;
  args: ActionArg[];
};

function sanitiseActions(raw: unknown): ActionWire[] {
  if (!Array.isArray(raw)) return [];
  const out: ActionWire[] = [];
  for (const a of raw.slice(0, 200)) {
    const it = a as Partial<ActionWire>;
    if (
      typeof it?.name !== 'string' ||
      typeof it?.says !== 'string' ||
      !Array.isArray(it?.args)
    ) {
      continue;
    }
    out.push({
      name: it.name,
      kind: it.kind === 'ask' ? 'ask' : 'do',
      says: it.says,
      args: it.args as ActionArg[],
    });
  }
  return out;
}

function argLine(a: ActionArg): string {
  const bits = [`${a.name} (${a.type}`];
  if (a.values) bits.push(`: ${a.values.join(' | ')}`);
  if (a.min !== undefined || a.max !== undefined) {
    bits.push(`, ${a.min ?? ''}–${a.max ?? ''}`);
  }
  bits.push(a.required ? ', required)' : ')');
  return `     ${bits.join('')} — ${a.desc}`;
}

function actionCatalogue(actions: ActionWire[]): string {
  return (
    '\nNamed actions. If the sentence is one of these, set `action` to its ' +
    'name and `args` to the arguments it names — nothing else, and never ' +
    'an argument they did not state. Prefer a named action over the ' +
    'general kinds above when both would fit.\n' +
    actions
      .map(
        (a) =>
          `   ${a.name}${a.kind === 'ask' ? ' (a question, not a change)' : ''} — ${a.says}\n` +
          a.args.map(argLine).join('\n'),
      )
      .join('\n')
  );
}

async function parse(
  step: 'timetable' | 'plans' | 'change',
  text: string,
  actions: ActionWire[] = [],
): Promise<unknown | null> {
  const changeTool =
    actions.length === 0
      ? CHANGE_TOOL
      : {
          ...CHANGE_TOOL,
          input_schema: {
            ...CHANGE_TOOL.input_schema,
            properties: {
              ...CHANGE_TOOL.input_schema.properties,
              action: { type: 'string', enum: actions.map((a) => a.name) },
              args: { type: 'object' },
            },
          },
        };
  const tool =
    step === 'timetable'
      ? TIMETABLE_TOOL
      : step === 'plans'
        ? PLANS_TOOL
        : changeTool;
  const system =
    step === 'timetable'
      ? TIMETABLE_PROMPT
      : step === 'plans'
        ? PLANS_PROMPT
        : changePrompt() + (actions.length ? actionCatalogue(actions) : '');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const toolUse = (body.content ?? []).find(
    (b: { type: string }) => b.type === 'tool_use',
  );
  return toolUse ? toolUse.input : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: {
    gym_id?: unknown;
    step?: unknown;
    text?: unknown;
    actions?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const gymId = typeof body.gym_id === 'string' ? body.gym_id : null;
  const step =
    body.step === 'timetable' || body.step === 'plans' || body.step === 'change'
      ? body.step
      : null;
  const text =
    typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT_CHARS) : '';
  if (!gymId || !step || text.length < 4) {
    return json({ error: 'gym_id, step and text are required' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
    p_gym_id: gymId,
    p_capability: 'can_edit_classes',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  if (!API_KEY) return json({ error: 'unavailable' }, 503);

  try {
    // The client filters the catalogue by the caller's own capabilities
    // before sending it. That is a convenience for the model, not the
    // authorisation: the write itself still runs in the owner's session
    // against RLS, which is what actually decides.
    const proposal = await parse(step, text, sanitiseActions(body.actions));
    if (!proposal) return json({ error: 'could_not_parse' }, 422);
    return json({ proposal });
  } catch {
    return json({ error: 'could_not_parse' }, 422);
  }
});
