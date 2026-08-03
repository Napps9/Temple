// Free-form questions about one Timeline event (day-pager build),
// answered only from the event's own records. The story page shows the
// standard answers; this is for the question the page didn't predict —
// "did he ever pay?", "what did we say to her exactly?".
//
// The caller must hold can_see_money for the gym — the same capability
// every row read here has carried since 0204/0206 — so this function
// can never reveal more than the page it sits on. The model is fenced
// to a deterministic fact block built from those rows; the question
// rides as a user turn and never touches the system prompt.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { requireGymCapability } from '../_shared/caller.ts';
import { buildFacts, buildSystem, type FactsMessage } from './facts.ts';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_CHARS = 2000;
const MODEL = 'claude-sonnet-5';
const CANNOT = "I can't answer that from this record.";

type Turn = { role: 'owner' | 'temple'; text: string };

function sanitiseTurns(raw: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const turns = raw
    .filter(
      (t): t is Turn =>
        !!t &&
        ((t as Turn).role === 'owner' || (t as Turn).role === 'temple') &&
        typeof (t as Turn).text === 'string' &&
        (t as Turn).text.trim().length > 0,
    )
    .slice(-6)
    .map((t) => ({
      role: t.role === 'owner' ? ('user' as const) : ('assistant' as const),
      content: t.text.trim().slice(0, MAX_TEXT_CHARS),
    }));
  while (turns.length > 0 && turns[0].role === 'assistant') turns.shift();
  return turns;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let body: {
    gym_id?: string;
    action_id?: string;
    question?: string;
    turns?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id ?? '';
  const actionId = body.action_id ?? '';
  const question = (body.question ?? '').trim().slice(0, MAX_TEXT_CHARS);
  if (!UUID.test(gymId) || !UUID.test(actionId) || !question) {
    return json({ error: 'gym_id, action_id and question are required' }, 400);
  }

  const who = await requireGymCapability(
    req, gymId, 'can_see_money', SUPABASE_URL, ANON_KEY, SERVICE_KEY);
  if (!who.ok) return json({ error: who.error }, who.status);

  if (!API_KEY) return json({ error: 'unavailable' }, 503);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  // The same rows the story page reads, scoped to the caller's gym. A
  // foreign or unknown id gets the same 404 — a caller must not be able
  // to tell "no such event" from "not your event".
  const { data: action } = await service
    .from('agent_actions')
    .select(
      'id, gym_id, action_kind, status, payload, evidence, proposed_at, decided_by, decided_at, subject_profile, case_id',
    )
    .eq('id', actionId)
    .eq('gym_id', gymId)
    .maybeSingle();
  if (!action) return json({ error: 'Not found' }, 404);

  const [msgs, kase, subjectProfile, deciderProfile] = await Promise.all([
    service
      .from('agent_outbound_messages')
      .select('recipient_profile_id, subject, body, status, error, sent_at')
      .eq('action_id', actionId)
      .order('created_at', { ascending: true }),
    action.case_id
      ? service
          .from('agent_cases')
          .select('stage, outcome, closed_at')
          .eq('id', action.case_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    action.subject_profile
      ? service
          .from('profiles')
          .select('full_name')
          .eq('id', action.subject_profile)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    action.decided_by
      ? service
          .from('profiles')
          .select('full_name')
          .eq('id', action.decided_by)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const facts = buildFacts(
    {
      action_kind: action.action_kind,
      status: action.status,
      proposed_at: action.proposed_at,
      decided_at: action.decided_at,
      payload: (action.payload ?? {}) as Record<string, unknown>,
      evidence: action.evidence,
    },
    ((msgs.data ?? []) as FactsMessage[]),
    (kase.data ?? null) as { stage: string; outcome: string | null; closed_at: string | null } | null,
    {
      subject:
        (subjectProfile.data as { full_name: string | null } | null)?.full_name ??
        null,
      decider:
        (deciderProfile.data as { full_name: string | null } | null)?.full_name ??
        null,
    },
  );

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: buildSystem(facts),
        messages: [...sanitiseTurns(body.turns), { role: 'user', content: question }],
      }),
    });
    if (!res.ok) return json({ error: 'failed' }, 502);
    const out = await res.json();
    if (out.stop_reason === 'refusal') return json({ answer: CANNOT });
    const answer = ((out.content ?? []) as { type: string; text?: string }[])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    return json({ answer: answer || CANNOT });
  } catch {
    return json({ error: 'failed' }, 502);
  }
});
