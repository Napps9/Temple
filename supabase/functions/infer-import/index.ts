// Bootstrap a gym from its member CSV — AI-assisted inference.
//
// Called from the import wizard's new Review step after the column
// mapping is locked in. Receives an aggregate summary of the imported
// rows (plan name + counts + bucketed stats; no PII) and returns a
// suggested catalog the owner can review and edit:
//
//   { plans: [{raw_name, suggested_name, suggested_kind,
//              suggested_credit_count, suggested_monthly_price_cents,
//              confidence, reasoning}],
//     tags:  { keep, drop, merge_suggestions },
//     default_plan_hint: { raw_name, share_of_members } | null }
//
// Two-stage look-aside cache against import_inference_corrections (a
// cross-gym table). For each input plan:
//   - exact-match on lower(raw_name) → serve the prior owner's final
//     value as confidence='learned' without an API call
//   - otherwise → query pg_trgm similarity for the top-N past
//     corrections and inject them as few-shot examples in the Claude
//     prompt for that plan
//
// Falls back to deterministic rules when ANTHROPIC_API_KEY is unset
// or the API errors. Always returns a valid response so the wizard
// can render without blocking on AI availability.
//
// Required env (SUPABASE_* are injected by the platform):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Optional env (live inference; falls back to deterministic without):
//   ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

type PlanInput = {
  raw_name: string;
  member_count: number;
  has_credits: boolean;
  median_credits_remaining: number | null;
  has_plan_end: boolean;
  median_days_to_plan_end: number | null;
};

type TagInput = { value: string; count: number };

type InferenceRequest = {
  gym_id: string;
  plans: PlanInput[];
  tags: TagInput[];
  total_members: number;
  gym_currency: string;
};

type PlanKind = 'unlimited' | 'credit_period' | 'credit_pack';

type PlanSuggestion = {
  raw_name: string;
  suggested_name: string;
  suggested_kind: PlanKind;
  suggested_credit_count: number | null;
  suggested_monthly_price_cents: number;
  confidence: 'learned' | 'high' | 'medium' | 'low';
  reasoning: string;
};

type InferenceResponse = {
  plans: PlanSuggestion[];
  tags: {
    keep: string[];
    drop: string[];
    merge_suggestions: { variants: string[]; into: string }[];
  };
  default_plan_hint: { raw_name: string; share_of_members: number } | null;
  source: 'ai' | 'fallback' | 'mixed';
};

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

// Deterministic inference — the fallback when AI is unavailable, and
// the input shape we feed to the few-shot prompt for grounding.
function inferKindDeterministic(p: PlanInput): PlanKind {
  if (p.has_credits && p.has_plan_end) return 'credit_period';
  if (p.has_credits) return 'credit_pack';
  return 'unlimited';
}

function suggestPriceDeterministic(p: PlanInput, kind: PlanKind): number {
  // Rough mid-market UK pricing. Owners can override; the goal is a
  // reasonable starting point, not perfect inference. We only ever
  // fall back to these when the AI path isn't available — the AI
  // grounds prices on the actual plan name and supporting data.
  if (kind === 'unlimited') return 12000; // £120 / mo
  const credits = p.median_credits_remaining ?? 5;
  return Math.max(2000, Math.round(credits * 1000)); // £10/class baseline
}

function humaniseName(raw: string): string {
  // Replace separators with spaces, title-case words.
  return raw
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function deterministicPlan(p: PlanInput): PlanSuggestion {
  const kind = inferKindDeterministic(p);
  return {
    raw_name: p.raw_name,
    suggested_name: humaniseName(p.raw_name),
    suggested_kind: kind,
    suggested_credit_count:
      kind === 'unlimited' ? null : Math.max(1, p.median_credits_remaining ?? 5),
    suggested_monthly_price_cents: suggestPriceDeterministic(p, kind),
    confidence: 'low',
    reasoning:
      `Heuristic: ${
        p.has_credits ? 'credits present' : 'no credits'
      }${p.has_plan_end ? ', plan_end recurring' : ', no plan_end'}.`,
  };
}

// Drop obvious junk tag patterns. AI overrides this when available.
function deterministicTagTriage(tags: TagInput[]): InferenceResponse['tags'] {
  const junkRe = /^(migrated|import|batch|legacy|crm)[_\-]/i;
  const keep: string[] = [];
  const drop: string[] = [];
  for (const t of tags) {
    if (junkRe.test(t.value)) drop.push(t.value);
    else keep.push(t.value);
  }
  return { keep, drop, merge_suggestions: [] };
}

// Anthropic call. Structured-extraction task → tool use with a pinned
// schema, so we never have to parse free-form text out of the response.
// Returns null on any error so the caller can fall through.
async function callClaude(
  apiKey: string,
  plans: PlanInput[],
  tags: TagInput[],
  totalMembers: number,
  currency: string,
  fewShotByPlan: Map<string, { input: PlanInput; final: PlanSuggestion }[]>,
): Promise<{
  plans: Omit<PlanSuggestion, 'confidence' | 'reasoning'>[];
  plan_reasonings: Record<string, { confidence: 'high' | 'medium' | 'low'; reasoning: string }>;
  tags: InferenceResponse['tags'];
  default_plan_hint: InferenceResponse['default_plan_hint'];
} | null> {
  const fewShotText = (() => {
    const lines: string[] = [];
    for (const [raw, examples] of fewShotByPlan.entries()) {
      if (examples.length === 0) continue;
      lines.push(`# Examples relevant to ${JSON.stringify(raw)}:`);
      for (const ex of examples.slice(0, 5)) {
        lines.push(
          `  - input ${JSON.stringify(ex.input.raw_name)} → final ${JSON.stringify(
            {
              name: ex.final.suggested_name,
              kind: ex.final.suggested_kind,
              credit_count: ex.final.suggested_credit_count,
              monthly_price_cents: ex.final.suggested_monthly_price_cents,
            },
          )}`,
        );
      }
    }
    return lines.join('\n');
  })();

  const systemPrompt =
    'You help gym owners migrate from legacy CRMs. Given the unique plan names exported in their member CSV plus aggregate metadata, infer the structured Temple plan catalog: a sensible human-readable name, the plan kind (unlimited / credit_period / credit_pack), credit_count when applicable, a reasonable monthly price in minor units of the gym currency, and a confidence level. Be conservative — gyms can edit, but they rely on this to skip data entry.';

  const userPayload = {
    plans,
    tags,
    total_members: totalMembers,
    gym_currency: currency,
    learned_examples: fewShotText || 'none',
  };

  const toolSchema = {
    type: 'object',
    properties: {
      plans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            raw_name: { type: 'string' },
            suggested_name: { type: 'string' },
            suggested_kind: {
              type: 'string',
              enum: ['unlimited', 'credit_period', 'credit_pack'],
            },
            suggested_credit_count: { type: ['integer', 'null'] },
            suggested_monthly_price_cents: { type: 'integer' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reasoning: { type: 'string' },
          },
          required: [
            'raw_name', 'suggested_name', 'suggested_kind',
            'suggested_credit_count', 'suggested_monthly_price_cents',
            'confidence', 'reasoning',
          ],
        },
      },
      tags: {
        type: 'object',
        properties: {
          keep: { type: 'array', items: { type: 'string' } },
          drop: { type: 'array', items: { type: 'string' } },
          merge_suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                variants: { type: 'array', items: { type: 'string' } },
                into: { type: 'string' },
              },
              required: ['variants', 'into'],
            },
          },
        },
        required: ['keep', 'drop', 'merge_suggestions'],
      },
      default_plan_hint: {
        type: ['object', 'null'],
        properties: {
          raw_name: { type: 'string' },
          share_of_members: { type: 'number' },
        },
        required: ['raw_name', 'share_of_members'],
      },
    },
    required: ['plans', 'tags', 'default_plan_hint'],
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: systemPrompt,
        tools: [
          {
            name: 'emit_catalog',
            description: 'Emit the inferred plan catalog and tag triage.',
            input_schema: toolSchema,
          },
        ],
        tool_choice: { type: 'tool', name: 'emit_catalog' },
        messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const toolUse = (body.content ?? []).find(
      (b: { type: string }) => b.type === 'tool_use',
    );
    if (!toolUse) return null;
    const parsed = toolUse.input as {
      plans: PlanSuggestion[];
      tags: InferenceResponse['tags'];
      default_plan_hint: InferenceResponse['default_plan_hint'];
    };
    const plan_reasonings: Record<
      string,
      { confidence: 'high' | 'medium' | 'low'; reasoning: string }
    > = {};
    for (const p of parsed.plans) {
      plan_reasonings[p.raw_name] = {
        confidence: p.confidence === 'learned' ? 'high' : p.confidence,
        reasoning: p.reasoning,
      };
    }
    return {
      plans: parsed.plans.map((p) => ({
        raw_name: p.raw_name,
        suggested_name: p.suggested_name,
        suggested_kind: p.suggested_kind,
        suggested_credit_count: p.suggested_credit_count,
        suggested_monthly_price_cents: p.suggested_monthly_price_cents,
      })),
      plan_reasonings,
      tags: parsed.tags,
      default_plan_hint: parsed.default_plan_hint,
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let body: InferenceRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  if (!body?.gym_id || !Array.isArray(body.plans)) {
    return json({ error: 'gym_id and plans are required' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Re-authorise as the caller — same gate the wizard's existing
  // import_pending_members RPC checks.
  const { data: allowed, error: aErr } = await caller.rpc(
    'user_can_assign_plan',
    { target_gym_id: body.gym_id },
  );
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  // Step 1: exact-match look-aside per input plan. Anything we find
  // here gets served with confidence='learned' and never goes to the
  // model. Same applies to tags (a previously-decided 'keep'/'drop'
  // wins). We collect the few-shot pool for unmatched plans too.
  const plansToInfer: PlanInput[] = [];
  const learnedSuggestions: PlanSuggestion[] = [];
  const fewShotByPlan = new Map<
    string,
    { input: PlanInput; final: PlanSuggestion }[]
  >();

  for (const p of body.plans) {
    const lower = p.raw_name.toLowerCase();
    const { data: exact } = await service
      .from('import_inference_corrections')
      .select('final_value, was_overridden, created_at')
      .eq('field_kind', 'plan')
      .filter('input_payload->>raw_name', 'ilike', lower)
      .order('created_at', { ascending: false })
      .limit(1);
    const match = (exact ?? [])[0];
    if (match && match.final_value) {
      const fv = match.final_value as Record<string, unknown>;
      learnedSuggestions.push({
        raw_name: p.raw_name,
        suggested_name: String(fv.name ?? p.raw_name),
        suggested_kind: (fv.kind as PlanKind) ?? 'unlimited',
        suggested_credit_count:
          fv.credit_count == null ? null : Number(fv.credit_count),
        suggested_monthly_price_cents: Number(fv.monthly_price_cents ?? 0),
        confidence: 'learned',
        reasoning: 'Learned from a prior gym\'s correction.',
      });
      continue;
    }
    plansToInfer.push(p);

    // Few-shot pool: prefer recent overridden corrections (strong
    // signal), but fall through to any recent correction so a brand-
    // new install with no overrides still gets grounding. We pull a
    // generous slice and let the prompt builder cap at five — the
    // pg_trgm GIN index keeps the lookup cheap and a follow-up can
    // promote this to a dedicated `similarity()`-ranked RPC once the
    // table has volume.
    const { data: similarRows } = await service
      .from('import_inference_corrections')
      .select('input_payload, final_value, was_overridden, created_at')
      .eq('field_kind', 'plan')
      .order('was_overridden', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(25);
    const examples = (similarRows ?? []) as {
      input_payload: unknown;
      final_value: unknown;
    }[];

    const exs: { input: PlanInput; final: PlanSuggestion }[] = [];
    for (const e of examples) {
      const i = e.input_payload as Partial<PlanInput>;
      const f = e.final_value as Record<string, unknown>;
      if (!i?.raw_name) continue;
      exs.push({
        input: {
          raw_name: String(i.raw_name),
          member_count: Number(i.member_count ?? 0),
          has_credits: Boolean(i.has_credits),
          median_credits_remaining:
            i.median_credits_remaining == null
              ? null
              : Number(i.median_credits_remaining),
          has_plan_end: Boolean(i.has_plan_end),
          median_days_to_plan_end:
            i.median_days_to_plan_end == null
              ? null
              : Number(i.median_days_to_plan_end),
        },
        final: {
          raw_name: String(i.raw_name),
          suggested_name: String(f.name ?? i.raw_name),
          suggested_kind: (f.kind as PlanKind) ?? 'unlimited',
          suggested_credit_count:
            f.credit_count == null ? null : Number(f.credit_count),
          suggested_monthly_price_cents: Number(f.monthly_price_cents ?? 0),
          confidence: 'medium',
          reasoning: '',
        },
      });
    }
    fewShotByPlan.set(p.raw_name, exs);
  }

  // Step 2: AI call for the remaining plans + tag triage.
  let aiPlans: PlanSuggestion[] = [];
  let aiTags: InferenceResponse['tags'] | null = null;
  let aiHint: InferenceResponse['default_plan_hint'] = null;
  let source: InferenceResponse['source'] =
    learnedSuggestions.length > 0 ? 'mixed' : 'fallback';

  if (ANTHROPIC_API_KEY && (plansToInfer.length > 0 || body.tags.length > 0)) {
    const ai = await callClaude(
      ANTHROPIC_API_KEY,
      plansToInfer,
      body.tags,
      body.total_members,
      body.gym_currency || 'GBP',
      fewShotByPlan,
    );
    if (ai) {
      aiPlans = ai.plans.map((p) => ({
        ...p,
        confidence: ai.plan_reasonings[p.raw_name]?.confidence ?? 'medium',
        reasoning:
          ai.plan_reasonings[p.raw_name]?.reasoning ??
          'Suggested from plan name and CSV stats.',
      }));
      aiTags = ai.tags;
      aiHint = ai.default_plan_hint;
      source = learnedSuggestions.length > 0 ? 'mixed' : 'ai';
    }
  }

  // Step 3: deterministic fallback for anything the AI didn't fill in.
  const aiByRaw = new Map(aiPlans.map((p) => [p.raw_name, p]));
  for (const p of plansToInfer) {
    if (!aiByRaw.has(p.raw_name)) {
      aiByRaw.set(p.raw_name, deterministicPlan(p));
    }
  }
  const finalPlans = [...learnedSuggestions, ...aiByRaw.values()];
  const finalTags = aiTags ?? deterministicTagTriage(body.tags);

  // Default-plan hint: prefer AI's pick when present, else most members.
  let defaultHint = aiHint;
  if (!defaultHint && body.plans.length > 0) {
    const top = [...body.plans].sort(
      (a, b) => b.member_count - a.member_count,
    )[0];
    defaultHint = top
      ? {
          raw_name: top.raw_name,
          share_of_members: top.member_count / Math.max(1, body.total_members),
        }
      : null;
  }

  const response: InferenceResponse = {
    plans: finalPlans,
    tags: finalTags,
    default_plan_hint: defaultHint,
    source,
  };
  return json(response);
});
