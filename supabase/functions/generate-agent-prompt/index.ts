// Draft the AI sales agent's operating brief from the gym's real data plus a
// few owner answers (class levels, where beginners start, onboarding notes,
// location). Claude synthesises a clean brief the agent then works from; the
// owner edits it before saving. Falls back to a deterministic template when
// ANTHROPIC_API_KEY is unset (same philosophy as infer-import).
//
// Signed-in owner/admin caller — re-checks effective_can(can_review_ai_calls)
// as the caller, then reads gym data under the service role.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Optional: ANTHROPIC_API_KEY, AGENT_PROMPT_MODEL (default claude-sonnet-5)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let body: {
    gym_id?: string;
    answers?: {
      intro_offer?: string;
      levels?: string;
      beginner_start?: string;
      onboarding?: string;
      location?: string;
      faq?: string;
      tone?: string;
      extra?: string;
    };
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  if (!gymId) return json({ error: 'gym_id is required' }, 400);
  const answers = body.answers ?? {};

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
    p_gym_id: gymId,
    p_capability: 'can_review_ai_calls',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const [gymRes, plansRes, typesRes, sessionsRes, coachesRes, waiverRes] = await Promise.all([
    service.from('gyms').select('name, slug, currency, timezone').eq('id', gymId).single(),
    service
      .from('membership_plans')
      .select('name, kind, credit_count, period_length, monthly_price_cents')
      .eq('gym_id', gymId)
      .is('archived_at', null)
      .order('monthly_price_cents', { ascending: true }),
    service.from('class_types').select('name').eq('gym_id', gymId),
    service
      .from('class_sessions')
      .select('name, starts_at')
      .eq('gym_id', gymId)
      .gte('starts_at', now.toISOString())
      .lte('starts_at', weekOut.toISOString())
      .order('starts_at', { ascending: true })
      .limit(60),
    service
      .from('gym_memberships')
      .select('role, profiles!profile_id(full_name)')
      .eq('gym_id', gymId)
      .is('left_at', null)
      .in('role', ['owner', 'coach']),
    service.from('waiver_documents').select('title').eq('gym_id', gymId).limit(3),
  ]);

  const gym = gymRes.data as {
    name: string;
    slug: string;
    currency: string | null;
    timezone: string | null;
  } | null;
  if (!gym) return json({ error: 'Gym not found' }, 404);
  const currency = gym.currency ?? 'GBP';
  const timezone = gym.timezone ?? 'Europe/London';

  const plans = ((plansRes.data ?? []) as {
    name: string;
    kind: string;
    credit_count: number | null;
    period_length: string | null;
    monthly_price_cents: number | null;
  }[])
    .map((p) => {
      const price = p.monthly_price_cents ?? 0;
      if (p.kind === 'unlimited') return `- ${p.name}: unlimited classes, ${money(price, currency)}/month`;
      if (p.kind === 'credit_period') return `- ${p.name}: ${p.credit_count} classes / period, ${money(price, currency)}/month`;
      return `- ${p.name}: pack of ${p.credit_count} credits, ${money(price, currency)} one-off`;
    })
    .join('\n');

  const classTypes = ((typesRes.data ?? []) as { name: string }[]).map((t) => t.name).join(', ');

  const byDay = new Map<string, string[]>();
  for (const s of (sessionsRes.data ?? []) as { name: string; starts_at: string }[]) {
    const d = new Date(s.starts_at);
    const day = d.toLocaleDateString('en-GB', { timeZone: timezone, weekday: 'short' });
    const time = d.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
    const list = byDay.get(day) ?? [];
    list.push(`${time} ${s.name}`);
    byDay.set(day, list);
  }
  const schedule = [...byDay.entries()].map(([day, list]) => `- ${day}: ${list.join(', ')}`).join('\n');

  const coaches = ((coachesRes.data ?? []) as {
    role: string;
    profiles: { full_name: string | null } | null;
  }[])
    .map((c) => c.profiles?.full_name)
    .filter(Boolean)
    .join(', ');

  const waivers = ((waiverRes.data ?? []) as { title: string }[]).map((w) => w.title).join(', ');

  const dataBlock = [
    `Gym name: ${gym.name}`,
    `Currency: ${currency}`,
    plans ? `Membership plans:\n${plans}` : 'Membership plans: (none set up yet)',
    classTypes ? `Class types: ${classTypes}` : '',
    schedule ? `Class schedule (next 7 days):\n${schedule}` : '',
    coaches ? `Coaches: ${coaches}` : '',
    waivers ? `Waivers on file: ${waivers}` : '',
    answers.intro_offer ? `Intro offer (owner): ${answers.intro_offer}` : '',
    answers.levels ? `Class levels (owner): ${answers.levels}` : '',
    answers.beginner_start ? `Where beginners should start (owner): ${answers.beginner_start}` : '',
    answers.onboarding ? `Onboarding / waivers (owner): ${answers.onboarding}` : '',
    answers.location ? `Location & parking (owner): ${answers.location}` : '',
    answers.faq ? `Frequently asked questions, with the owner's answers:\n${answers.faq}` : '',
    answers.extra ? `Other notes (owner): ${answers.extra}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json({ prompt: templateFallback(gym.name, dataBlock), mode: 'template' });
  }

  const toneLine =
    answers.tone === 'professional'
      ? 'Register: polished and professional — courteous, precise, no slang.'
      : answers.tone === 'high_energy'
        ? 'Register: high-energy and upbeat — enthusiastic, punchy sentences, big on encouragement.'
        : 'Register: warm and friendly — like the best front-desk person on their best day.';

  const system = [
    "You write the operating brief for a gym's AI front-desk sales agent — the instructions it follows on calls and texts with prospective members.",
    'Write it as direct second-person instructions ("You are the front desk for …"). Concise, plainspoken. No markdown headings, no preamble — just the brief, in short paragraphs and simple bullet lines.',
    toneLine,
    'Cover, using ONLY the facts provided (never invent prices, classes, or details):',
    '- How to greet (use the gym name).',
    '- The intro offer, and to lead with it when someone is deciding — offered once, concretely, never repeated as pressure.',
    '- The membership options and prices, and which plan a first-timer should start on.',
    '- The class schedule and which classes suit beginners vs intermediate vs advanced.',
    "- The frequently asked questions and the owner's answers to them, if provided.",
    '- That joining is fully self-serve from a link: sign up, sign the waiver and a short health form, pay — the agent closes by sending it, never by taking payment itself.',
    "- That it should capture the prospect's name and number early, and agree a concrete next step (a class to try, a day to come in) before the conversation ends.",
    '- The coaches and the style of programming; the location and parking.',
    "- Guardrails: don't be pushy; never give medical or injury advice — take their number and say a coach will call back.",
    'If a fact is missing, leave a short bracketed placeholder like [add your intro offer] rather than inventing it.',
  ].join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: Deno.env.get('AGENT_PROMPT_MODEL') ?? 'claude-sonnet-5',
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: `Here is the gym's data and the owner's notes:\n\n${dataBlock}` }],
      }),
    });
    if (!res.ok) {
      console.error('anthropic error', res.status, (await res.text()).slice(0, 300));
      return json({ prompt: templateFallback(gym.name, dataBlock), mode: 'template' });
    }
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    const text = ((data?.content ?? []) as any[])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return json({ prompt: text || templateFallback(gym.name, dataBlock), mode: text ? 'ai' : 'template' });
  } catch (e) {
    console.error('generate-agent-prompt failed', e);
    return json({ prompt: templateFallback(gym.name, dataBlock), mode: 'template' });
  }
});

function templateFallback(gymName: string, dataBlock: string): string {
  return (
    `You are the friendly front desk for ${gymName}. Answer prospective members warmly, ` +
    `capture their name and number, offer to text them a signup link to join, and hand off to a ` +
    `coach for anything medical. Here is what you know:\n\n${dataBlock}\n\n` +
    `Rules: quote only the prices and classes listed above; offer the intro once; never give ` +
    `injury or medical advice — take their number and say a coach will call back.`
  );
}
