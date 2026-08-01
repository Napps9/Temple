// The arithmetic of a member import: what a gym's raw plan names and tags
// look like before the inference sees them, what a price is in pence, and
// what the gym changed about the guess afterwards.
//
// Split out of infer.ts (which imports supabase at module scope, and so
// cannot be loaded by vitest) because none of this touches the network
// and all of it decides what every member in a file ends up on. It went
// untested for exactly as long as it lived next to a network call.

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


// Rows the wizard has mapped, in the same shape the eventual
// import_pending_members RPC will receive. Just the fields we care
// about for inference.
export type MappedRow = {
  plan_name?: string;
  plan_start?: string;
  plan_end?: string;
  credits_remaining?: number;
  tags?: string[];
};



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
