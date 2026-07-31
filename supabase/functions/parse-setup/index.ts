// Day-one setup parsing: turns the owner's free-text description of
// their week (or their prices) into a structured proposal for the /setup
// conversation to preview. This function holds no write power — the
// client sanitises the proposal (src/lib/setup-flow.ts) and nothing is
// created until the owner confirms, at which point the owner's own
// session applies it through the same RLS paths as the manual editors.
//
// Auth: the caller's JWT is forwarded and checked against
// effective_can(gym, 'can_access_staff_area'). Deliberately the weakest
// staff gate, because this function holds no write power and reveals
// nothing the caller didn't type — parsing costs tokens, that is all. The
// real authorisation is per action: the client sends only the catalogue
// this person's capabilities allow, and the write itself runs in their own
// session against RLS. Gating the parse on one feature's capability
// (it was can_edit_classes) locked staff out of actions they were
// explicitly granted, like the shop and putting a member on a plan.
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

// The Timeline's talk bar: one sentence from the owner becomes one named
// action from the app's registry, or nothing. The catalogue of actions,
// their arguments and the conventions for filling them are all sent by
// the client per call (see actionCatalogue below) — this function holds
// no list of its own, so an action added to src/lib/actions is available
// here the moment it exists. Every argument is re-validated client-side
// by the action's own sanitiser, so an invented value dies before it is
// shown, let alone applied.
const CHANGE_TOOL = {
  name: 'emit_change',
  description:
    'Emit the actions the gym owner asked for, in the order they said ' +
    'them. Usually one. Use `cannot` when the request is none of the ' +
    'actions offered.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: { args: { type: 'object' } },
        },
      },
      cannot: { type: ['string', 'null'] },
    },
  },
};

function changePrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return (
    'You parse a gym owner\'s sentence into the one action they asked for. ' +
    `Today is ${today}.\n` +
    'Emit ONLY what was described — never invent classes, prices, dates, ' +
    'names or settings. Dates are YYYY-MM-DD and resolve forward from ' +
    'today. Money is in whole currency as the owner said it — the gym\'s ' +
    'own, which may not be sterling — unless an argument says otherwise.\n' +
    // Deliberately no examples of what it cannot do. The catalogue is
    // built per call from the registry and grows every week; a list of
    // refusals written here goes stale silently and teaches the model to
    // refuse things that shipped. The actions below are the whole truth.
    'One sentence is usually one action. It is two or three when the owner ' +
    'genuinely asked for two or three things — "put Marcus on Unlimited and ' +
    'tag him VIP" is two steps, in that order. Do NOT split one request into ' +
    'steps because it has several arguments, and do not add a step they did ' +
    'not ask for. At most three.\n' +
    'If the sentence is none of the actions below, set `cannot` to one ' +
    'short plain sentence naming what they asked for, and emit no steps. Do ' +
    'not guess, and do not bend a sentence onto the nearest action that half ' +
    'fits. A sentence can do both: take the parts that are actions and name ' +
    'the rest in `cannot`.'
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
  '- monthly_price_cents is the price in minor units, so the amount they ' +
  'said times 100 whatever the currency: "89" → 8900.\n' +
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
    '\nThe actions available to this person, and the arguments each takes:\n' +
    actions
      .map(
        (a) =>
          `   ${a.name}${a.kind === 'ask' ? ' (a question, not a change)' : ''} — ${a.says}\n` +
          a.args.map(argLine).join('\n'),
      )
      .join('\n')
  );
}

// The conversation so far, already bounded by the client (src/lib/chat-memory
// enforces both how many turns and how recent). Re-checked here anyway,
// because the client is not a trust boundary and an unbounded history is a
// bill as well as a confusion.
type WireTurn = { role: 'user' | 'assistant'; content: string };

function sanitiseHistory(raw: unknown): WireTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: WireTurn[] = [];
  for (const t of raw.slice(-8)) {
    const it = t as Partial<WireTurn>;
    if (typeof it?.content !== 'string' || !it.content.trim()) continue;
    const role = it.role === 'assistant' ? 'assistant' : 'user';
    const content = it.content.trim().slice(0, 400);
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${content}`;
    else out.push({ role, content });
  }
  while (out.length > 0 && out[0].role === 'assistant') out.shift();
  return out;
}

async function parse(
  step: 'timetable' | 'plans' | 'change',
  text: string,
  actions: ActionWire[] = [],
  history: WireTurn[] = [],
): Promise<unknown | null> {
  // With no catalogue there is no `action` to name, so the tool can only
  // come back with `cannot` — which is the honest answer when the caller's
  // capabilities haven't loaded.
  const changeTool =
    actions.length === 0
      ? CHANGE_TOOL
      : {
          ...CHANGE_TOOL,
          input_schema: {
            ...CHANGE_TOOL.input_schema,
            properties: {
              ...CHANGE_TOOL.input_schema.properties,
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    action: { type: 'string', enum: actions.map((a) => a.name) },
                    args: { type: 'object' },
                  },
                },
              },
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
      messages: [...(step === 'change' ? history : []), { role: 'user', content: text }],
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
    history?: unknown;
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
    p_capability: 'can_access_staff_area',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  if (!API_KEY) return json({ error: 'unavailable' }, 503);

  try {
    // The client filters the catalogue by the caller's own capabilities
    // before sending it. That is a convenience for the model, not the
    // authorisation: the write itself still runs in the owner's session
    // against RLS, which is what actually decides.
    const proposal = await parse(
      step,
      text,
      sanitiseActions(body.actions),
      sanitiseHistory(body.history),
    );
    if (!proposal) return json({ error: 'could_not_parse' }, 422);
    return json({ proposal });
  } catch {
    return json({ error: 'could_not_parse' }, 422);
  }
});
