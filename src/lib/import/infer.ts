// Client helpers for the import wizard's Review step.
//
// Turns the already-mapped CSV rows into the aggregate summary the
// infer-import edge function expects, calls it, and shapes the
// response into editable per-plan state the UI binds to. Also builds
// the cross-gym corrections payload from the owner's final review
// state so we can record what they accepted vs overrode on commit.

import { supabase } from '@/lib/supabase';

import {
  type MappedRow,
  type PlanKind,
  type PlanSuggestion,
  summariseForInference,
} from './plan-mapping';

import {
  autoDetect,
  columnHints,
  TEMPLE_FIELD_LABELS,
  type TempleField,
} from './columns';

// Hit the edge function. Falls back to a local deterministic shape if
// the function isn't reachable so the wizard always renders something
// usable.
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
// emergency_contact is deliberately excluded: a source export sometimes
// splits it into separate name/number columns, and buildImportRow
// concatenates both when the owner maps them there.
const SINGLE_USE_FIELDS: Set<TempleField> = new Set([
  'email', 'first_name', 'last_name', 'full_name', 'phone', 'date_of_birth',
  'plan_start', 'plan_end', 'next_bill_date', 'credits_remaining',
  'imported_status', 'unsubscribed', 'notes',
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

// Build the corrections payload to post on commit. Each plan and tag
// decision is one row. was_overridden compares the final value to the
// AI suggestion field-by-field; learned suggestions count as
// not-overridden when the owner accepts them as-is.
