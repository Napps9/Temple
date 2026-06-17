// Client helpers for the import wizard's Review step.
//
// Turns the already-mapped CSV rows into the aggregate summary the
// infer-import edge function expects, calls it, and shapes the
// response into editable per-plan state the UI binds to. Also builds
// the cross-gym corrections payload from the owner's final review
// state so we can record what they accepted vs overrode on commit.

import { supabase } from '@/lib/supabase';

import {
  autoDetect,
  columnHints,
  TEMPLE_FIELD_LABELS,
  type TempleField,
} from './columns';

// Prices are stored in pence but edited in pounds. centsToPounds drops a
// whole-pound ".00"; poundsToCents returns null for blank/invalid input.
export function centsToPounds(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}
export function poundsToCents(pounds: string): number | null {
  const t = pounds.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export type PlanKind = 'unlimited' | 'credit_period' | 'credit_pack';

export type PlanInput = {
  raw_name: string;
  member_count: number;
  has_credits: boolean;
  median_credits_remaining: number | null;
  has_plan_end: boolean;
  median_days_to_plan_end: number | null;
};

export type TagInput = { value: string; count: number };

export type PlanSuggestion = {
  raw_name: string;
  suggested_name: string;
  suggested_kind: PlanKind;
  suggested_credit_count: number | null;
  suggested_monthly_price_cents: number;
  confidence: 'learned' | 'high' | 'medium' | 'low';
  reasoning: string;
};

export type InferenceResponse = {
  plans: PlanSuggestion[];
  tags: {
    keep: string[];
    drop: string[];
    merge_suggestions: { variants: string[]; into: string }[];
  };
  default_plan_hint: { raw_name: string; share_of_members: number } | null;
  source: 'ai' | 'fallback' | 'mixed';
};

// Rows the wizard has mapped, in the same shape the eventual
// import_pending_members RPC will receive. Just the fields we care
// about for inference.
type MappedRow = {
  plan_name?: string;
  plan_start?: string;
  plan_end?: string;
  credits_remaining?: number;
  tags?: string[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function daysUntil(iso: string): number | null {
  const d = new Date(`${iso}T00:00:00Z`).getTime();
  if (!Number.isFinite(d)) return null;
  return Math.round((d - Date.now()) / 86_400_000);
}

// Roll the mapped rows up into the aggregate summary. Plan grouping
// is exact-string for v1; the AI can later suggest merges across
// near-duplicates (e.g. "Drop In" / "Drop-In").
export function summariseForInference(rows: MappedRow[]): {
  plans: PlanInput[];
  tags: TagInput[];
  total_members: number;
} {
  const byPlan = new Map<
    string,
    { creditValues: number[]; planEndDays: number[]; count: number }
  >();
  const tagCounts = new Map<string, number>();
  for (const r of rows) {
    const name = (r.plan_name ?? '').trim();
    if (name) {
      const bucket =
        byPlan.get(name) ??
        { creditValues: [], planEndDays: [], count: 0 };
      bucket.count += 1;
      if (typeof r.credits_remaining === 'number' && r.credits_remaining > 0) {
        bucket.creditValues.push(r.credits_remaining);
      }
      if (r.plan_end) {
        const days = daysUntil(r.plan_end);
        if (days != null) bucket.planEndDays.push(days);
      }
      byPlan.set(name, bucket);
    }
    for (const t of r.tags ?? []) {
      const trimmed = t.trim();
      if (!trimmed) continue;
      tagCounts.set(trimmed, (tagCounts.get(trimmed) ?? 0) + 1);
    }
  }
  const plans: PlanInput[] = Array.from(byPlan.entries()).map(
    ([raw_name, b]) => ({
      raw_name,
      member_count: b.count,
      has_credits: b.creditValues.length > 0,
      median_credits_remaining: median(b.creditValues),
      has_plan_end: b.planEndDays.length > 0,
      median_days_to_plan_end: median(b.planEndDays),
    }),
  );
  const tags: TagInput[] = Array.from(tagCounts.entries()).map(
    ([value, count]) => ({ value, count }),
  );
  return { plans, tags, total_members: rows.length };
}

// Hit the edge function. Falls back to a local deterministic shape if
// the function isn't reachable so the wizard always renders something
// usable.
export async function runInference(args: {
  gymId: string;
  rows: MappedRow[];
  gymCurrency: string;
}): Promise<InferenceResponse> {
  const summary = summariseForInference(args.rows);
  const payload = {
    gym_id: args.gymId,
    plans: summary.plans,
    tags: summary.tags,
    total_members: summary.total_members,
    gym_currency: args.gymCurrency,
  };
  const { data, error } = await supabase.functions.invoke('infer-import', {
    body: payload,
  });
  if (error || !data) {
    // Edge function unreachable — render with the same deterministic
    // shape the server would have fallen back to, so the wizard isn't
    // blocked.
    return {
      plans: summary.plans.map((p) => {
        const kind: PlanKind =
          p.has_credits && p.has_plan_end
            ? 'credit_period'
            : p.has_credits
              ? 'credit_pack'
              : 'unlimited';
        return {
          raw_name: p.raw_name,
          suggested_name: p.raw_name,
          suggested_kind: kind,
          suggested_credit_count:
            kind === 'unlimited' ? null : p.median_credits_remaining ?? 5,
          suggested_monthly_price_cents:
            kind === 'unlimited' ? 12000 : 6000,
          confidence: 'low',
          reasoning: 'Local fallback — edge function unreachable.',
        };
      }),
      tags: {
        keep: summary.tags.map((t) => t.value),
        drop: [],
        merge_suggestions: [],
      },
      default_plan_hint: null,
      source: 'fallback',
    };
  }
  return data as InferenceResponse;
}

export type ColumnMappingResult = {
  mapping: (TempleField | 'ignore')[];
  source: 'ai' | 'fallback';
};

const TEMPLE_FIELD_KEYS = Object.keys(TEMPLE_FIELD_LABELS) as TempleField[];
// Fields that name a single member attribute — at most one column each.
const SINGLE_USE_FIELDS: Set<TempleField> = new Set([
  'email', 'first_name', 'last_name', 'full_name', 'date_of_birth',
  'plan_start', 'plan_end', 'credits_remaining', 'imported_status',
  'unsubscribed', 'notes',
]);

function isTempleField(v: unknown): v is TempleField {
  return typeof v === 'string' && (TEMPLE_FIELD_KEYS as string[]).includes(v);
}

// AI-assisted column mapping. Sends headers + a privacy-safe per-column
// profile (no raw values) to infer-import, which asks Claude to map each
// column to a Temple field. Falls back to the alias heuristic whenever
// the AI is unavailable or returns nothing usable, so the Map step is
// always pre-filled.
export async function runColumnMapping(args: {
  gymId: string;
  headers: string[];
  rows: string[][];
}): Promise<ColumnMappingResult> {
  const baseline = (): (TempleField | 'ignore')[] =>
    autoDetect(args.headers).map((f) => f ?? 'ignore');
  try {
    const { data, error } = await supabase.functions.invoke('infer-import', {
      body: {
        mode: 'map_columns',
        gym_id: args.gymId,
        columns: columnHints(args.headers, args.rows),
        fields: TEMPLE_FIELD_KEYS.map((key) => ({
          key,
          label: TEMPLE_FIELD_LABELS[key],
        })),
      },
    });
    const assigns = (
      data as { mapping?: { header: string; field: string }[] } | null
    )?.mapping;
    if (error || !assigns) return { mapping: baseline(), source: 'fallback' };
    const byHeader = new Map(assigns.map((a) => [a.header, a.field]));
    const usedSingle = new Set<TempleField>();
    const mapping = args.headers.map((h): TempleField | 'ignore' => {
      const raw = byHeader.get(h);
      if (!isTempleField(raw)) return 'ignore';
      if (SINGLE_USE_FIELDS.has(raw)) {
        if (usedSingle.has(raw)) return 'ignore';
        usedSingle.add(raw);
      }
      return raw;
    });
    return { mapping, source: 'ai' };
  } catch {
    return { mapping: baseline(), source: 'fallback' };
  }
}

// Owner's final state per plan after they've reviewed (and possibly
// edited) the suggestions. The wizard binds editable controls to this.
export type ReviewedPlan = {
  raw_name: string;
  name: string;
  kind: PlanKind;
  credit_count: number | null;
  monthly_price: string;
  // When set, route members on this raw_name to an existing plan
  // instead of creating a new one. UI default is null = create new.
  existing_plan_id: string | null;
  drop: boolean;
};

// Build the corrections payload to post on commit. Each plan and tag
// decision is one row. was_overridden compares the final value to the
// AI suggestion field-by-field; learned suggestions count as
// not-overridden when the owner accepts them as-is.
export type CorrectionRow = {
  field_kind: 'plan' | 'tag';
  input_payload: Record<string, unknown>;
  ai_suggestion: Record<string, unknown> | null;
  final_value: Record<string, unknown>;
  was_overridden: boolean;
};

export function buildCorrectionRows(args: {
  plansInferred: PlanSuggestion[];
  plansFinal: ReviewedPlan[];
  planInputsByRaw: Map<string, PlanInput>;
  tagsKeep: Set<string>;
  tagsInferenceKeep: Set<string>;
  tagsInputs: TagInput[];
}): CorrectionRow[] {
  const out: CorrectionRow[] = [];
  const inferredByRaw = new Map(
    args.plansInferred.map((p) => [p.raw_name, p]),
  );
  for (const final of args.plansFinal) {
    const input = args.planInputsByRaw.get(final.raw_name);
    if (!input) continue;
    const ai = inferredByRaw.get(final.raw_name) ?? null;
    const finalValue = {
      name: final.name,
      kind: final.kind,
      credit_count: final.credit_count,
      monthly_price_cents: poundsToCents(final.monthly_price) ?? 0,
      dropped: final.drop,
      mapped_to_existing: !!final.existing_plan_id,
    };
    const aiValue = ai
      ? {
          name: ai.suggested_name,
          kind: ai.suggested_kind,
          credit_count: ai.suggested_credit_count,
          monthly_price_cents: ai.suggested_monthly_price_cents,
        }
      : null;
    // The AI baseline always proposes "create a new plan with these
    // fields". Dropping the plan or routing onto an existing plan is
    // an override of that baseline by definition, separate from any
    // field-level edits.
    const was_overridden =
      final.drop ||
      !!final.existing_plan_id ||
      !aiValue ||
      aiValue.name !== finalValue.name ||
      aiValue.kind !== finalValue.kind ||
      aiValue.credit_count !== finalValue.credit_count ||
      aiValue.monthly_price_cents !== finalValue.monthly_price_cents;
    out.push({
      field_kind: 'plan',
      input_payload: input as unknown as Record<string, unknown>,
      ai_suggestion: aiValue,
      final_value: finalValue,
      was_overridden,
    });
  }
  for (const tag of args.tagsInputs) {
    const finalKeep = args.tagsKeep.has(tag.value);
    const aiKeep = args.tagsInferenceKeep.has(tag.value);
    out.push({
      field_kind: 'tag',
      input_payload: { raw_name: tag.value, count: tag.count },
      ai_suggestion: { action: aiKeep ? 'keep' : 'drop' },
      final_value: { action: finalKeep ? 'keep' : 'drop' },
      was_overridden: finalKeep !== aiKeep,
    });
  }
  return out;
}
