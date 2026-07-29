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
            blurb: { type: 'string' },
          },
          required: ['name', 'kind', 'monthly_price_cents'],
        },
      },
    },
    required: ['plans'],
  },
};

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
  '- Never invent plans or prices that were not described.';

async function parse(
  step: 'timetable' | 'plans',
  text: string,
): Promise<unknown | null> {
  const tool = step === 'timetable' ? TIMETABLE_TOOL : PLANS_TOOL;
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
      system: step === 'timetable' ? TIMETABLE_PROMPT : PLANS_PROMPT,
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

  let body: { gym_id?: unknown; step?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const gymId = typeof body.gym_id === 'string' ? body.gym_id : null;
  const step =
    body.step === 'timetable' || body.step === 'plans' ? body.step : null;
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
    const proposal = await parse(step, text);
    if (!proposal) return json({ error: 'could_not_parse' }, 422);
    return json({ proposal });
  } catch {
    return json({ error: 'could_not_parse' }, 422);
  }
});
