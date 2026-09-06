import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { PageScroll } from '@/components/PageScroll';
import { AIMark } from '@/components/AIMark';
import { Text, TextInput } from '@/components/Text';
import QRCode from 'react-native-qrcode-svg';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { FieldLabel, SectionLabel } from '@/components/SectionLabel';
import { useGymMembership, useSession } from '@/lib/auth';
import { joinUrl } from '@/lib/brand';
import { errorMessage, functionErrorMessage } from '@/lib/errors';
import {
  autoDetect,
  buildImportRow,
  TEMPLE_FIELD_LABELS,
  type TempleField,
} from '@/lib/import/columns';
import { parseCsv } from '@/lib/import/csv';
import { isLikelyDuplicate } from '@/lib/import/dedup';
import {
  runColumnMapping,
  runInference,
  type InferenceResponse,
} from '@/lib/import/infer';
import {
  buildCorrectionRows,
  centsToPounds,
  poundsToCents,
  summariseForInference,
  type PlanKind,
  type ReviewedPlan,
} from '@/lib/import/plan-mapping';
import type { StripePreview } from '@/lib/import/stripe';
import { supabase } from '@/lib/supabase';
import { currencySymbol } from '@/lib/setup-flow';
import { useThemePreference, useThemeColors } from '@/lib/theme';
import { useGymCurrency } from '@/lib/useGymCurrency';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import { webSelectStyle } from '@/lib/webSelect';
import type { Json } from '@/types/database';

// Single-file import wizard. Three local phases:
//   1. upload  — drop / paste a CSV
//   2. map     — auto-detect columns, owner adjusts misses
//   3. preview — sample rows + counts, commit calls
//                import_pending_members and lands on the handover
//                screen embedded below.
//
// Self-serve is the default: after import we show the gym's join URL
// + QR + a per-member CSV the owner can mail-merge from their own
// tool. The opt-in "Send the welcome email from Temple" button
// creates a campaign with audience.kind='pending_members' and lands
// the owner in the campaign editor so they can preview before send.

type Phase = 'upload' | 'map' | 'review' | 'preview' | 'handover';

type ImportResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

// A CSV row that fuzzy-matches an existing person under a different email
// — either a live Stripe subscriber (double-bill risk) or an
// already-staged pending member (duplicate row).
type FuzzyMatch = {
  rowEmail: string;
  rowName: string;
  reason: 'stripe' | 'existing-import';
  matchedName: string;
  matchedEmail: string;
  confidence: 'name' | 'name+dob';
};

const FIELD_OPTIONS: { key: TempleField | 'ignore'; label: string }[] = [
  { key: 'ignore', label: 'Ignore' },
  ...(Object.entries(TEMPLE_FIELD_LABELS).map(([key, label]) => ({
    key: key as TempleField,
    label,
  }))),
];

// Element-wise equality on a mapping array — lets the async AI result
// swap in only while the auto-mapping is still untouched, so it never
// clobbers edits the owner has already made.
function sameMapping(
  a: readonly (TempleField | 'ignore' | null)[],
  b: readonly (TempleField | 'ignore' | null)[],
): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export default function ImportMembersScreen() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const canManageStaff = useCan('can_manage_staff');
  const brand = useGymBrand();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>('upload');
  const [csvText, setCsvText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mapping, setMapping] = useState<(TempleField | 'ignore' | null)[]>([]);
  const [inference, setInference] = useState<InferenceResponse | null>(null);
  const [inferenceLoading, setInferenceLoading] = useState(false);
  const [reviewedPlans, setReviewedPlans] = useState<Map<string, ReviewedPlan>>(
    new Map(),
  );
  const [tagsKeep, setTagsKeep] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [excludeStripeOverlap, setExcludeStripeOverlap] = useState(true);
  // Emails the owner has chosen to skip after reviewing a fuzzy (name /
  // name+DOB) duplicate hit. Keyed by the CSV row's own email, which is
  // the commit filter's join key. Default off — a name match alone can be
  // two different people, so we surface for review rather than auto-drop.
  const [excludedFuzzyEmails, setExcludedFuzzyEmails] = useState<Set<string>>(
    new Set(),
  );
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingSource, setMappingSource] = useState<'ai' | 'fallback' | null>(
    null,
  );

  const fileInput = useRef<HTMLInputElement | null>(null);
  // Signature of the inputs the last successful loadInference ran with.
  // Skip re-running on a back-and-forth Map → Review trip when nothing
  // changed in the mapping or the underlying rows.
  const lastInferenceKey = useRef<string | null>(null);

  // Existing plans the gym already has — feeds the "Map to an existing
  // plan" picker in PlanReviewCard. First-import gyms see an empty list
  // and only get the "Create new" option, which is the right default.
  const existingPlans = useQuery({
    queryKey: ['membership-plans', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('membership_plans')
        .select('plan_id, name, kind')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('name');
      if (e) throw e;
      return (data ?? []) as { plan_id: string; name: string; kind: string }[];
    },
  });

  // Surfaces unlinked rows from a PRIOR import session — the "Linking
  // progress" panel only exists while the wizard's local phase state is
  // still 'handover', so a staffer who navigates away and comes back
  // days later previously had no way to see who never signed up.
  const unclaimedStats = useQuery({
    queryKey: ['pending-members-stats', membership?.gymId],
    enabled: !!membership?.gymId && phase === 'upload',
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('pending_members_stats', {
        p_gym_id: membership!.gymId,
      });
      if (e) throw e;
      const row = (data ?? [])[0] as
        | { pending: number; invited: number; linked: number; skipped: number; total: number }
        | undefined;
      return row ?? { pending: 0, invited: 0, linked: 0, skipped: 0, total: 0 };
    },
  });

  const parsed = useMemo(() => (csvText ? parseCsv(csvText) : []), [csvText]);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).filter((r) => r.some((c) => c.length > 0));

  // Enter the Map step: fill from the alias heuristic immediately, then
  // kick off the AI mapping and swap it in when it lands — but only while
  // the owner hasn't started editing, so we never clobber their work.
  function startMapping(hs: string[], rs: string[][]) {
    const auto = autoDetect(hs).map((f) => f ?? 'ignore');
    setMapping(auto);
    setMappingSource(null);
    setPhase('map');
    if (!membership) return;
    setMappingLoading(true);
    runColumnMapping({ gymId: membership.gymId, headers: hs, rows: rs })
      .then((res) => {
        setMapping((curr) => (sameMapping(curr, auto) ? res.mapping : curr));
        setMappingSource(res.source);
      })
      .catch(() => setMappingSource('fallback'))
      .finally(() => setMappingLoading(false));
  }

  function onFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      const p = parseCsv(text);
      const hs = p[0] ?? [];
      const rs = p.slice(1).filter((r) => r.some((c) => c.length > 0));
      startMapping(hs, rs);
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  }

  // Rows as raw mapped objects (used by both the preview list and the
  // inference summary). Skips rows with no email — the RPC would skip
  // them too. No planMap / tagsDrop applied yet; the commit path adds
  // those after the Review step.
  const importRows = useMemo(() => {
    if (phase === 'upload') return [];
    return rows
      .map((cells) =>
        buildImportRow(
          headers,
          mapping.map((m) => (m === 'ignore' ? null : m)) as (TempleField | null)[],
          cells,
        ),
      )
      .filter((r) => typeof r.email === 'string' && (r.email as string).length > 0);
  }, [rows, headers, mapping, phase]);

  // Overlap guard. Members who already subscribe on the gym's connected
  // Stripe account must come across via the Stripe importer (which adopts
  // their live subscription) — not this CSV path, which would stage them
  // as unbilled "legacy" and set up a double charge if they later add a
  // card. We pull the connected account's subscribers and skip any CSV row
  // whose email matches, unless the owner overrides.
  const stripeConnected = useQuery({
    queryKey: ['gym-stripe-account', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<boolean> => {
      const { data, error: e } = await supabase
        .from('gym_stripe_accounts')
        .select('stripe_account_id')
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (e) throw e;
      return !!data?.stripe_account_id;
    },
  });

  const stripePreview = useQuery({
    queryKey: ['stripe-import-preview', membership?.gymId],
    enabled:
      !!membership?.gymId &&
      stripeConnected.data === true &&
      (phase === 'review' || phase === 'preview'),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<StripePreview | null> => {
      const { data, error: e } = await supabase.functions.invoke('stripe-import', {
        body: { gym_id: membership!.gymId },
      });
      if (e) return null; // can't check (not owner / transient) → fail open
      return data as StripePreview;
    },
  });

  const stripeSubscriberEmails = useMemo(
    () =>
      new Set(
        (stripePreview.data?.members ?? []).map((m) => m.email.trim().toLowerCase()),
      ),
    [stripePreview.data],
  );

  const overlapEmails = useMemo(() => {
    if (stripeSubscriberEmails.size === 0) return new Set<string>();
    const set = new Set<string>();
    for (const r of importRows) {
      const e = String(r.email ?? '').trim().toLowerCase();
      if (e && stripeSubscriberEmails.has(e)) set.add(e);
    }
    return set;
  }, [importRows, stripeSubscriberEmails]);

  const overlapCount = overlapEmails.size;

  // Cross-email duplicate guard. The Stripe overlap above joins on email;
  // a member whose Stripe/CSV emails differ slips past it. We fetch the
  // gym's already-staged pending members (which carry DOB from earlier
  // imports) and fuzzy-match every CSV row by name — and by DOB where both
  // sides have one — against them and against the Stripe subscribers.
  // Rows already caught by the exact-email overlap are excluded so we don't
  // flag the same person twice.
  const pendingMembers = useQuery({
    queryKey: ['pending-members-dedup', membership?.gymId],
    enabled:
      !!membership?.gymId && (phase === 'review' || phase === 'preview'),
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('pending_members')
        .select('email, full_name, date_of_birth, status')
        .eq('gym_id', membership!.gymId)
        .in('status', ['pending', 'invited', 'linked']);
      if (e) throw e;
      return (data ?? []) as {
        email: string;
        full_name: string | null;
        date_of_birth: string | null;
        status: string;
      }[];
    },
  });

  const fuzzyMatches = useMemo<FuzzyMatch[]>(() => {
    const stripeMembers = stripePreview.data?.members ?? [];
    const pending = pendingMembers.data ?? [];
    if (stripeMembers.length === 0 && pending.length === 0) return [];
    const out: FuzzyMatch[] = [];
    for (const r of importRows) {
      const rowEmail = String(r.email ?? '').trim().toLowerCase();
      if (!rowEmail || overlapEmails.has(rowEmail)) continue;
      const rowName = r.full_name ? String(r.full_name) : '';
      if (!rowName) continue;
      const rowDob =
        typeof r.date_of_birth === 'string' ? r.date_of_birth : null;
      const person = { name: rowName, dob: rowDob };

      // Stripe subscribers have a name but no DOB → name-only match, which
      // flags a possible double-bill under a different email.
      let hit: FuzzyMatch | null = null;
      for (const s of stripeMembers) {
        const sEmail = s.email.trim().toLowerCase();
        if (sEmail === rowEmail) continue;
        if (isLikelyDuplicate(person, { name: s.name }).match) {
          hit = {
            rowEmail,
            rowName,
            reason: 'stripe',
            matchedName: s.name ?? '',
            matchedEmail: sEmail,
            confidence: 'name',
          };
          break;
        }
      }
      // Already-staged members carry DOB, so this match is stronger: a hit
      // means a second pending row for someone already imported.
      if (!hit) {
        for (const p of pending) {
          const pEmail = (p.email ?? '').trim().toLowerCase();
          if (pEmail === rowEmail) continue;
          const res = isLikelyDuplicate(person, {
            name: p.full_name,
            dob: p.date_of_birth,
          });
          if (res.match) {
            hit = {
              rowEmail,
              rowName,
              reason: 'existing-import',
              matchedName: p.full_name ?? '',
              matchedEmail: pEmail,
              confidence: res.confidence,
            };
            break;
          }
        }
      }
      if (hit) out.push(hit);
    }
    return out;
  }, [importRows, stripePreview.data, pendingMembers.data, overlapEmails]);

  const excludedCount = excludeStripeOverlap
    ? importRows.filter((r) =>
        overlapEmails.has(String(r.email ?? '').trim().toLowerCase()),
      ).length
    : 0;
  const fuzzyExcludedCount = importRows.filter((r) =>
    excludedFuzzyEmails.has(String(r.email ?? '').trim().toLowerCase()),
  ).length;
  const stagedCount = importRows.length - excludedCount - fuzzyExcludedCount;

  // Trigger inference on entering the Review step. We memoise on the
  // mapped rows + the column mapping so a back-and-forth between Map
  // and Review doesn't burn another Anthropic round-trip when nothing
  // has changed — the owner's edits to reviewedPlans/tagsKeep persist
  // across the trip.
  async function loadInference() {
    if (!membership) return;
    const key = JSON.stringify({
      mapping,
      rowCount: importRows.length,
      planNames: Array.from(
        new Set(importRows.map((r) => String(r.plan_name ?? '')).filter(Boolean)),
      ).sort(),
    });
    if (lastInferenceKey.current === key && inference) return;
    setInferenceLoading(true);
    setInference(null);
    try {
      const r = await runInference({
        gymId: membership.gymId,
        rows: importRows as Parameters<typeof runInference>[0]['rows'],
        // Sourcing the actual gyms.currency value is a small later
        // tweak — for v1 the inference is grounded in £-denominated
        // training data; the worst case is the owner edits the
        // suggested price, which is a one-tap fix.
        gymCurrency: 'GBP',
      });
      setInference(r);
      lastInferenceKey.current = key;
      // Seed the editable per-plan state from the suggestions. A CSV plan
      // name that exactly matches (case-insensitively) a plan the gym
      // already has defaults to "Map to existing" instead of "Create
      // new" — otherwise a re-import, or a CSV whose "Unlimited Monthly"
      // already exists as a Temple plan, silently creates a duplicate
      // unless the owner happens to notice and flips the toggle by hand.
      const existingByName = new Map(
        existingPlans.data?.map((ep) => [ep.name.trim().toLowerCase(), ep.plan_id]) ?? [],
      );
      const seed = new Map<string, ReviewedPlan>();
      for (const p of r.plans) {
        const match = existingByName.get(p.raw_name.trim().toLowerCase());
        seed.set(p.raw_name, {
          raw_name: p.raw_name,
          name: p.suggested_name,
          kind: p.suggested_kind,
          credit_count: p.suggested_credit_count,
          monthly_price: centsToPounds(p.suggested_monthly_price_cents),
          existing_plan_id: match ?? null,
          drop: false,
        });
      }
      setReviewedPlans(seed);
      setTagsKeep(new Set(r.tags.keep));
    } catch (e) {
      setError(errorMessage(e, 'Could not analyse the CSV'));
    } finally {
      setInferenceLoading(false);
    }
  }

  function updatePlan(rawName: string, patch: Partial<ReviewedPlan>) {
    setReviewedPlans((curr) => {
      const next = new Map(curr);
      const existing = next.get(rawName);
      if (existing) next.set(rawName, { ...existing, ...patch });
      return next;
    });
  }

  function toggleTagKeep(value: string) {
    setTagsKeep((curr) => {
      const next = new Set(curr);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleFuzzyExclude(email: string) {
    setExcludedFuzzyEmails((curr) => {
      const next = new Set(curr);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  // Commit: insert new membership_plans, stamp linked_membership_plan_id
  // onto every row that mapped to a plan, call import_pending_members,
  // and finally record the corrections (accepted + overridden) into
  // the cross-gym learning store.
  const commit = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('Missing context');

      // 0. Pre-flight: the membership_plans CHECK rejects credit_pack /
      //    credit_period with a null credit_count. Catch it here so we
      //    don't half-commit some plans before erroring on a later one.
      for (const p of reviewedPlans.values()) {
        if (p.drop || p.existing_plan_id) continue;
        if (
          p.kind !== 'unlimited' &&
          (p.credit_count == null || p.credit_count <= 0)
        ) {
          throw new Error(
            `"${p.name || p.raw_name}" needs a credit count — set "credits per period" before importing.`,
          );
        }
        if (!p.name.trim()) {
          throw new Error(
            `Set a name for the plan staged from "${p.raw_name}" before importing.`,
          );
        }
      }

      // 1. Insert each non-dropped, non-existing-mapped plan. A plan whose
      //    name already matches an active plan is reused, not re-created —
      //    so a re-import (or importing after the Stripe import made the
      //    plan) maps to it instead of hitting the name-unique index
      //    (0131). Mirrors the Stripe importer's reuse-by-name.
      const existingByName = new Map(
        (existingPlans.data ?? []).map((ep) => [
          ep.name.trim().toLowerCase(),
          ep.plan_id,
        ]),
      );
      const planNameToId = new Map<string, string>();
      for (const p of reviewedPlans.values()) {
        if (p.drop) continue;
        if (p.existing_plan_id) {
          planNameToId.set(p.raw_name, p.existing_plan_id);
          continue;
        }
        const nameKey = p.name.trim().toLowerCase();
        const byName = existingByName.get(nameKey);
        if (byName) {
          planNameToId.set(p.raw_name, byName);
          continue;
        }
        const { data: inserted, error: planErr } = await supabase
          .from('membership_plans')
          .insert({
            gym_id: membership.gymId,
            name: p.name.trim(),
            kind: p.kind,
            credit_count: p.kind === 'unlimited' ? null : p.credit_count,
            monthly_price_cents: poundsToCents(p.monthly_price) ?? 0,
            ...(p.kind === 'credit_period' ? { period_length: '30 days' } : {}),
          })
          .select('plan_id')
          .single();
        if (planErr) throw planErr;
        const newId = (inserted as { plan_id: string }).plan_id;
        planNameToId.set(p.raw_name, newId);
        // A later reviewed plan with the same final name reuses this one.
        existingByName.set(nameKey, newId);
      }

      // 2. Re-build the import rows with the plan map + tag drops.
      const tagsDrop = new Set(
        (inference?.tags.keep ?? [])
          .concat(inference?.tags.drop ?? [])
          .filter((t) => !tagsKeep.has(t)),
      );
      const finalRows = rows
        .map((cells) =>
          buildImportRow(
            headers,
            mapping.map((m) => (m === 'ignore' ? null : m)) as (TempleField | null)[],
            cells,
            { planMap: planNameToId, tagsDrop },
          ),
        )
        .filter(
          (r) => typeof r.email === 'string' && (r.email as string).length > 0,
        )
        .filter(
          (r) =>
            !excludeStripeOverlap ||
            !overlapEmails.has(String(r.email).trim().toLowerCase()),
        )
        .filter(
          (r) =>
            !excludedFuzzyEmails.has(String(r.email).trim().toLowerCase()),
        );

      // 3. Stage the rows.
      const { data, error: e } = await supabase.rpc('import_pending_members', {
        p_gym_id: membership.gymId,
        p_rows: finalRows as unknown as Json,
      });
      if (e) throw e;
      const row = (data ?? [])[0] as ImportResult | undefined;

      // 4. Record corrections (fire-and-forget — non-blocking).
      if (inference) {
        const planInputsByRaw = new Map(
          summariseForInference(importRows as Parameters<typeof summariseForInference>[0])
            .plans.map((p) => [p.raw_name, p]),
        );
        const aiTagsKeepSet = new Set(inference.tags.keep);
        const tagsInputs = summariseForInference(
          importRows as Parameters<typeof summariseForInference>[0],
        ).tags;
        const corrections = buildCorrectionRows({
          plansInferred: inference.plans,
          plansFinal: Array.from(reviewedPlans.values()),
          planInputsByRaw,
          tagsKeep,
          tagsInferenceKeep: aiTagsKeepSet,
          tagsInputs,
        });
        if (corrections.length > 0) {
          // Don't block the user on the learning-loop write — but do
          // surface real failures (auth, payload shape) to the console
          // so we notice if the corrections store stops accepting input.
          const { error: corrErr } = await supabase.rpc(
            'record_import_corrections',
            {
              p_gym_id: membership.gymId,
              p_rows: corrections as unknown as Json,
            },
          );
          if (corrErr) console.warn('record_import_corrections failed', corrErr);
        }
      }

      return row ?? { inserted: 0, updated: 0, skipped: 0 };
    },
    onSuccess: (r) => {
      setImportResult(r);
      setPhase('handover');
      queryClient.invalidateQueries({ queryKey: ['pending-members-stats'] });
      queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not import the file')),
  });

  if (canManageStaff === false) return <Redirect href="/management" />;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <PageScroll contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management" coveredByNav />

        <PageHead
          title="Import members"
          subtitle="Drop in a CSV from your previous platform (Mindbody, PushPress, Glofox, Wodify, a spreadsheet…). We stage the rows; members link to their data when they sign up at your join link."
        />

        {stripeConnected.data === true &&
        (phase === 'upload' || phase === 'map' || phase === 'review') ? (
          <View className="bg-primary/5 border border-primary/20 rounded-card p-4 gap-2">
            <View className="flex-row items-center gap-2">
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={colors.primary}
              />
              <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
                Already charging members on Stripe? Import them from Stripe first
              </Text>
            </View>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Members with a live Stripe subscription should come across via the
              Stripe importer — their subscription is adopted, with no
              re-entering cards and no double-billing. This CSV import is for
              everyone else; we'll flag any overlap before you commit.
            </Text>
            <ChipButton
              className="self-start"
              label="Import from Stripe"
              icon="cloud-download-outline"
              tone="primary"
              onPress={() =>
                router.push('/management/members/import-stripe' as never)
              }
            />
          </View>
        ) : null}

        {phase === 'upload' &&
        unclaimedStats.data &&
        unclaimedStats.data.pending + unclaimedStats.data.invited > 0 ? (
          <UnclaimedImportsBanner
            gymId={membership?.gymId ?? null}
            stats={unclaimedStats.data}
            onSent={() =>
              queryClient.invalidateQueries({ queryKey: ['pending-members-stats'] })
            }
          />
        ) : null}

        {phase === 'upload' ? (
          <View className="gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            {Platform.OS === 'web' ? (
              <>
                {/* A real <div> rather than <Pressable> so the standard
                    HTML drag events fire — React Native Web's Pressable
                    swallows onDragOver / onDrop. */}
                <div
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                    if (!dragOver) setDragOver(true);
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(false);
                    const f = e.dataTransfer?.files?.[0];
                    if (f) onFile(f);
                  }}
                  className={`border-2 border-dashed rounded-ctl p-8 items-center gap-2 cursor-pointer transition-colors ${
                    dragOver
                      ? 'border-transparent bg-raised dark:bg-raised-dk'
                      : 'border-line-strong dark:border-line-dk hover:bg-raised dark:hover:bg-raised-dk/40'
                  }`}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Ionicons name="cloud-upload-outline" size={24} color={colors.ink2} />
                  <Text className="text-ink-2 dark:text-ink-2-dk font-medium">
                    {dragOver ? 'Drop to upload' : 'Drop a CSV here or tap to choose a file'}
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    .csv exports from Mindbody, PushPress, Glofox, Wodify or a
                    spreadsheet. Headers in row 1.
                  </Text>
                </div>
                {/* Hidden file input for the click-to-choose path. */}
                <input
                  ref={(el) => {
                    fileInput.current = el;
                  }}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.target.value = '';
                  }}
                />
              </>
            ) : null}

            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Or paste the CSV content here:
            </Text>
            <TextInput
              value={csvText}
              onChangeText={setCsvText}
              multiline
              numberOfLines={6}
              placeholder="Email,First Name,Last Name,Plan,Start Date..."
              placeholderTextColor={colors.ink3}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ minHeight: 140, textAlignVertical: 'top' }}
              className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2 text-ink dark:text-ink-dk text-sm font-mono"
            />

            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
            <Button
              onPress={() => {
                if (parsed.length < 2) {
                  setError('Need at least a header row + one data row.');
                  return;
                }
                startMapping(headers, rows);
              }}
              disabled={!csvText.trim()}>
              Continue
            </Button>
          </View>
        ) : null}

        {phase === 'map' ? (
          <View className="gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <View className="gap-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-ink dark:text-ink-dk font-semibold flex-1">
                  Map your columns
                </Text>
                {mappingLoading ? (
                  <View className="flex-row items-center gap-1.5">
                    <ActivityIndicator size="small" color={colors.primary} />
                    <FieldLabel>
                      Matching
                    </FieldLabel>
                  </View>
                ) : mappingSource === 'ai' ? (
                  <View className="flex-row items-center gap-1 rounded-full bg-raised dark:bg-raised-dk px-2 py-0.5">
                    <AIMark size={12} />
                    <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] font-semibold uppercase tracking-widest">
                      AI-matched
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                {mappingSource === 'ai'
                  ? 'Matched with AI — adjust anything that\'s off. Columns set to "Ignore" are dropped.'
                  : 'We auto-detected what we could. Adjust anything that\'s wrong. Columns set to "Ignore" are dropped.'}
              </Text>
            </View>
            <View className="gap-2">
              {headers.map((h, i) => (
                <View
                  key={`${h}-${i}`}
                  className="flex-row items-center gap-2 bg-raised dark:bg-raised-dk rounded-ctl px-3 py-2">
                  <Text
                    className="flex-1 text-ink dark:text-ink-dk text-sm"
                    numberOfLines={1}>
                    {h || `(column ${i + 1})`}
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.ink3} />
                  <FieldPicker
                    value={mapping[i] ?? 'ignore'}
                    onChange={(v) =>
                      setMapping((m) => m.map((x, idx) => (idx === i ? v : x)))
                    }
                  />
                </View>
              ))}
            </View>
            <View className="flex-row gap-2 pt-2">
              <Button variant="secondary" onPress={() => setPhase('upload')}>
                Back
              </Button>
              <View className="flex-1" />
              <Button
                onPress={() => {
                  if (!mapping.includes('email')) {
                    setError('Map one column to Email — we need it to link signups.');
                    return;
                  }
                  setError(null);
                  setPhase('review');
                  void loadInference();
                }}>
                Continue
              </Button>
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'review' ? (
          <ReviewPanel
            loading={inferenceLoading}
            inference={inference}
            reviewedPlans={reviewedPlans}
            tagsKeep={tagsKeep}
            totalRows={importRows.length}
            existingPlans={existingPlans.data ?? []}
            onUpdatePlan={updatePlan}
            onToggleTagKeep={toggleTagKeep}
            onBack={() => setPhase('map')}
            onContinue={() => setPhase('preview')}
            error={error}
          />
        ) : null}

        {phase === 'preview' ? (
          <View className="gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Preview
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              {stagedCount} ready to stage · {rows.length - importRows.length}{' '}
              skipped (missing email)
              {excludedCount > 0 ? ` · ${excludedCount} skipped (already on Stripe)` : ''}
              {fuzzyExcludedCount > 0
                ? ` · ${fuzzyExcludedCount} skipped (possible duplicate)`
                : ''}
            </Text>

            {overlapCount > 0 ? (
              <View className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-ctl p-3 gap-2">
                <Text className="text-amber-800 dark:text-amber-200 font-semibold text-sm">
                  {overlapCount} {overlapCount === 1 ? 'member' : 'members'} already
                  subscribe through your Stripe account
                </Text>
                <Text className="text-amber-700 dark:text-amber-300 text-xs">
                  Importing them here stages them as unbilled legacy members — and
                  if they add a card later, they'd be charged twice. Import them
                  from Stripe instead so their live subscription is adopted.
                </Text>
                <View className="flex-row items-center gap-2 flex-wrap">
                  <ChipButton
                    label={
                      excludeStripeOverlap
                        ? `Skipping these ${overlapCount}`
                        : `Include these ${overlapCount}`
                    }
                    icon={excludeStripeOverlap ? 'checkmark-circle' : 'alert-circle-outline'}
                    tone={excludeStripeOverlap ? 'primary' : 'amber'}
                    onPress={() => setExcludeStripeOverlap((v) => !v)}
                  />
                  <ChipButton
                    label="Import from Stripe"
                    icon="cloud-download-outline"
                    tone="neutral"
                    onPress={() =>
                      router.push('/management/members/import-stripe' as never)
                    }
                  />
                </View>
              </View>
            ) : null}

            {fuzzyMatches.length > 0 ? (
              <FuzzyDuplicatesCallout
                matches={fuzzyMatches}
                excluded={excludedFuzzyEmails}
                onToggle={toggleFuzzyExclude}
              />
            ) : null}
            <View className="gap-1.5 bg-raised dark:bg-raised-dk rounded-ctl p-3">
              {importRows.slice(0, 5).map((r, i) => (
                <View key={i} className="border-t border-line dark:border-line-dk pt-1.5 first:border-t-0 first:pt-0">
                  <Text className="text-ink dark:text-ink-dk text-sm">
                    {String(r.full_name ?? '(no name)')} · {String(r.email)}
                  </Text>
                  {r.plan_name ? (
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      Plan: {String(r.plan_name)}
                      {r.plan_end ? ` (ends ${r.plan_end})` : ''}
                    </Text>
                  ) : null}
                </View>
              ))}
              {importRows.length > 5 ? (
                <Text className="text-ink-3 dark:text-ink-3-dk text-xs pt-1">
                  …and {importRows.length - 5} more.
                </Text>
              ) : null}
            </View>

            <View className="flex-row gap-2 pt-2">
              <Button variant="secondary" onPress={() => setPhase('review')}>
                Back
              </Button>
              <View className="flex-1" />
              <Button
                onPress={() => commit.mutate()}
                loading={commit.isPending}
                disabled={
                  stagedCount === 0 ||
                  (stripeConnected.data === true && stripePreview.isLoading)
                }>
                {stripeConnected.data === true && stripePreview.isLoading
                  ? 'Checking Stripe…'
                  : `Import ${stagedCount} members`}
              </Button>
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'handover' && importResult ? (
          <HandoverPanel
            gymId={membership?.gymId ?? null}
            gymName={brand.gymName}
            primaryColor={colors.primary}
            slug={brand.slug}
            result={importResult}
          />
        ) : null}
      </PageScroll>
    </Screen>
  );
}

function ReviewPanel({
  loading,
  inference,
  reviewedPlans,
  tagsKeep,
  totalRows,
  existingPlans,
  onUpdatePlan,
  onToggleTagKeep,
  onBack,
  onContinue,
  error,
}: {
  loading: boolean;
  inference: InferenceResponse | null;
  reviewedPlans: Map<string, ReviewedPlan>;
  tagsKeep: Set<string>;
  totalRows: number;
  existingPlans: { plan_id: string; name: string; kind: string }[];
  onUpdatePlan: (rawName: string, patch: Partial<ReviewedPlan>) => void;
  onToggleTagKeep: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
  error: string | null;
}) {
  const colors = useThemeColors();
  const planEntries = inference?.plans ?? [];
  const fallback = inference?.source === 'fallback';
  return (
    <View className="gap-4">
      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
        <View className="flex-row items-center gap-2">
          <AIMark size={18} />
          <Text className="text-ink dark:text-ink-dk font-semibold flex-1">
            What we found in your CSV
          </Text>
          {inference ? (
            <View className="px-2 py-0.5 rounded-full bg-raised dark:bg-raised-dk">
              <FieldLabel>
                {inference.source === 'ai'
                  ? 'AI suggestions'
                  : inference.source === 'mixed'
                    ? 'AI + learned'
                    : 'Heuristic'}
              </FieldLabel>
            </View>
          ) : null}
        </View>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {loading
            ? 'Reading your rows and inferring plans…'
            : fallback
              ? 'Suggestions based on your CSV. Edit anything that looks off — we\'ll create the plans and link members on commit.'
              : 'Edit anything that looks off. We\'ll create the plans and link members on commit.'}
        </Text>
      </View>

      {/* Plans */}
      <View className="gap-3">
        <SectionLabel>{`Plans found (${planEntries.length})`}</SectionLabel>
        {loading && planEntries.length === 0 ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Reading the rows and inferring plans…
            </Text>
          </View>
        ) : planEntries.length === 0 ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              No plan_name column was mapped. Members will be staged without a
              linked plan — staff can attach one later.
            </Text>
          </View>
        ) : (
          planEntries.map((p) => {
            const r = reviewedPlans.get(p.raw_name);
            if (!r) return null;
            return (
              <PlanReviewCard
                key={p.raw_name}
                suggestion={p}
                final={r}
                hint={
                  inference?.default_plan_hint?.raw_name === p.raw_name
                    ? inference.default_plan_hint
                    : null
                }
                existingPlans={existingPlans}
                onChange={(patch) => onUpdatePlan(p.raw_name, patch)}
              />
            );
          })
        )}
      </View>

      {/* Tags */}
      <View className="gap-2">
        <SectionLabel>
          Tags found
        </SectionLabel>
        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
          {(inference?.tags.keep.length ?? 0) +
            (inference?.tags.drop.length ?? 0) >
          0 ? (
            <>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Greyed-out chips will be dropped on commit. Tap any chip to flip
                the decision.
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {[
                  ...(inference?.tags.keep ?? []),
                  ...(inference?.tags.drop ?? []),
                ].map((value) => {
                  const on = tagsKeep.has(value);
                  return (
                    <Pressable
                      key={value}
                      onPress={() => onToggleTagKeep(value)}
                      className={`px-3 py-1.5 rounded-full border ${
                        on
                          ? 'border-transparent bg-raised dark:bg-raised-dk/30'
                          : 'bg-raised dark:bg-raised-dk border-line dark:border-line-dk opacity-50'
                      }`}>
                      <Text
                        className={`text-xs ${
                          on
                            ? 'text-ink dark:text-ink-dk font-semibold'
                            : 'text-ink-2 dark:text-ink-2-dk'
                        }`}>
                        {value}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              No tags column was mapped. You can add tags to members later from
              their profile.
            </Text>
          )}
        </View>
      </View>

      {/* Cohort summary */}
      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-1">
        <Text className="text-ink dark:text-ink-dk font-semibold">
          What you're bringing across
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {totalRows} members ready to stage.
        </Text>
      </View>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      <View className="flex-row gap-2 pt-1">
        <Button variant="secondary" onPress={onBack}>
          Back
        </Button>
        <View className="flex-1" />
        <Button onPress={onContinue} disabled={loading}>
          Preview
        </Button>
      </View>
    </View>
  );
}

function PlanReviewCard({
  suggestion,
  final,
  hint,
  existingPlans,
  onChange,
}: {
  suggestion: InferenceResponse['plans'][number];
  final: ReviewedPlan;
  hint: { raw_name: string; share_of_members: number } | null;
  existingPlans: { plan_id: string; name: string; kind: string }[];
  onChange: (patch: Partial<ReviewedPlan>) => void;
}) {
  const colors = useThemeColors();
  const { scheme } = useThemePreference();
  const currency = useGymCurrency();
  const nameMatch = existingPlans.find(
    (ep) => ep.name.trim().toLowerCase() === suggestion.raw_name.trim().toLowerCase(),
  );
  const confidence = suggestion.confidence;
  const confidenceColor =
    confidence === 'learned'
      ? '#10B981'
      : confidence === 'high'
        ? '#10B981'
        : confidence === 'medium'
          ? '#F59E0B'
          : '#9CA3AF';
  const usingExisting = !!final.existing_plan_id;
  // Drop / existing → de-emphasise the editable plan body since none of
  // its fields will be used. Keep the header (raw_name, mode toggles,
  // confidence) at full opacity so the controls stay visible.
  const bodyDimmed = final.drop || usingExisting;
  return (
    <View
      className={`bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3 ${
        final.drop ? 'opacity-60' : ''
      }`}>
      <View className="flex-row items-center gap-2">
        <View
          style={{ backgroundColor: confidenceColor }}
          className="w-2 h-2 rounded-full"
        />
        <FieldLabel className="font-mono flex-1">
          From "{suggestion.raw_name}"
        </FieldLabel>
        {hint ? (
          <Text className="text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-widest">
            Most common
          </Text>
        ) : null}
      </View>

      {/* Routing toggle — three mutually exclusive modes. Default is
          "Create new"; the picker for existing plans only renders when
          the gym already has some, otherwise the third option is
          omitted (first-import gyms see two buttons). */}
      <View className="flex-row gap-2 flex-wrap">
        <PlanModeChip
          label="Create new"
          on={!final.drop && !usingExisting}
          onPress={() => onChange({ drop: false, existing_plan_id: null })}
        />
        {existingPlans.length > 0 ? (
          <PlanModeChip
            label="Map to existing"
            on={usingExisting && !final.drop}
            onPress={() =>
              onChange({
                drop: false,
                existing_plan_id:
                  final.existing_plan_id ?? existingPlans[0].plan_id,
              })
            }
          />
        ) : null}
        <PlanModeChip
          label="Don't create"
          on={final.drop}
          onPress={() => onChange({ drop: true })}
          tone="warn"
        />
      </View>

      {usingExisting && !final.drop ? (
        <View className="gap-1.5">
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Existing plan
          </Text>
          {Platform.OS === 'web' ? (
            // eslint-disable-next-line jsx-a11y/no-onchange
            <select
              value={final.existing_plan_id ?? ''}
              onChange={(e) =>
                onChange({ existing_plan_id: e.target.value || null })
              }
              style={webSelectStyle(scheme === 'dark', {
                fontSize: 14,
                padding: '8px 10px',
              })}>
              {existingPlans.map((ep) => (
                <option key={ep.plan_id} value={ep.plan_id}>
                  {ep.name} ({ep.kind.replace('_', ' ')})
                </option>
              ))}
            </select>
          ) : (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {existingPlans.find((ep) => ep.plan_id === final.existing_plan_id)
                ?.name ?? '(pick on web)'}
            </Text>
          )}
          <Text className="text-ink-3 dark:text-ink-3-dk text-[11px]">
            Members on "{suggestion.raw_name}" will be subscribed to this
            existing plan instead of creating a new one.
          </Text>
          {nameMatch && nameMatch.plan_id === final.existing_plan_id ? (
            <Text className="text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
              Matched by name — check this is the right plan.
            </Text>
          ) : null}
        </View>
      ) : null}

      {final.drop ? (
        <Text className="text-amber-700 dark:text-amber-400 text-xs">
          This plan won't be created. Members on "{suggestion.raw_name}" will
          still be imported but without a linked plan or subscription — staff
          can attach one later from the member profile.
        </Text>
      ) : null}

      <View className={bodyDimmed ? 'opacity-40 gap-3' : 'gap-3'} pointerEvents={bodyDimmed ? 'none' : 'auto'}>
        <View className="gap-1.5">
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Plan name
          </Text>
          <TextInput
            editable={!bodyDimmed}
            value={final.name}
            onChangeText={(v) => onChange({ name: v })}
            placeholderTextColor={colors.ink3}
            className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2 text-ink dark:text-ink-dk text-base"
          />
        </View>
        <View className="gap-1.5">
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">Kind</Text>
          <View className="flex-row gap-2 flex-wrap">
            {(['unlimited', 'credit_period', 'credit_pack'] as PlanKind[]).map(
              (k) => (
                <Pressable
                  key={k}
                  onPress={() => !bodyDimmed && onChange({ kind: k })}
                  className={`px-3 py-1.5 rounded-md border ${
                    final.kind === k
                      ? 'border-transparent bg-raised dark:bg-raised-dk'
                      : 'border-line dark:border-line-dk'
                  }`}>
                  <Text
                    className={
                      final.kind === k
                        ? 'text-ink dark:text-ink-dk text-[11px] font-semibold uppercase tracking-[1px]'
                        : 'text-ink-2 dark:text-ink-2-dk text-xs uppercase tracking-widest'
                    }>
                    {k.replace('_', ' ')}
                  </Text>
                </Pressable>
              ),
            )}
          </View>
        </View>
        {final.kind !== 'unlimited' ? (
          <View className="gap-1.5">
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Credits per period
            </Text>
            <TextInput
              editable={!bodyDimmed}
              value={String(final.credit_count ?? '')}
              onChangeText={(v) =>
                onChange({ credit_count: v === '' ? null : parseInt(v, 10) })
              }
              keyboardType="number-pad"
              placeholderTextColor={colors.ink3}
              className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2 text-ink dark:text-ink-dk text-base"
            />
          </View>
        ) : null}
        <View className="gap-1.5">
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Monthly price ({currencySymbol(currency)})
          </Text>
          <TextInput
            editable={!bodyDimmed}
            value={final.monthly_price}
            onChangeText={(v) => onChange({ monthly_price: v })}
            keyboardType="decimal-pad"
            placeholderTextColor={colors.ink3}
            className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2 text-ink dark:text-ink-dk text-base"
          />
        </View>
      </View>
      {suggestion.reasoning ? (
        <Text className="text-ink-3 dark:text-ink-3-dk text-[10px]">
          {suggestion.reasoning}
        </Text>
      ) : null}
    </View>
  );
}

function PlanModeChip({
  label,
  on,
  onPress,
  tone = 'primary',
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  tone?: 'primary' | 'warn';
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-1.5 rounded-md border ${
        on
          ? tone === 'warn'
            ? 'bg-amber-500/10 border-amber-500/40'
            : 'border-transparent bg-raised dark:bg-raised-dk'
          : 'bg-transparent border-line dark:border-line-dk'
      }`}>
      <Text
        className={`text-xs uppercase tracking-widest ${
          on
            ? tone === 'warn'
              ? 'text-amber-700 dark:text-amber-400 font-semibold'
              : 'text-ink dark:text-ink-dk font-semibold'
            : 'text-ink-2 dark:text-ink-2-dk'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

function FieldPicker({
  value,
  onChange,
}: {
  value: TempleField | 'ignore';
  onChange: (v: TempleField | 'ignore') => void;
}) {
  // Native-feeling picker that works on web (<select>) and skips
  // native, where we ship as a chip-of-chips horizontal scroll.
  const { scheme } = useThemePreference();
  if (Platform.OS === 'web') {
    return (
      // eslint-disable-next-line jsx-a11y/no-onchange
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TempleField | 'ignore')}
        style={webSelectStyle(scheme === 'dark', {
          fontSize: 13,
          padding: '4px 8px',
        })}>
        {FIELD_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
      {FIELD_OPTIONS.find((o) => o.key === value)?.label ?? '?'}
    </Text>
  );
}

// Reviewable list of cross-email fuzzy hits shown at preview. Each row is
// individually toggleable (default keep) — a name-only match can be a
// coincidence, so we never auto-drop; the owner ticks the ones to skip.
function FuzzyDuplicatesCallout({
  matches,
  excluded,
  onToggle,
}: {
  matches: FuzzyMatch[];
  excluded: Set<string>;
  onToggle: (email: string) => void;
}) {
  const stripeCount = matches.filter((m) => m.reason === 'stripe').length;
  return (
    <View className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-ctl p-3 gap-2">
      <Text className="text-amber-800 dark:text-amber-200 font-semibold text-sm">
        {matches.length} possible{' '}
        {matches.length === 1 ? 'duplicate' : 'duplicates'} under a different
        email
      </Text>
      <Text className="text-amber-700 dark:text-amber-300 text-xs">
        These rows share a name with someone you already have — likely the same
        person with a second email that slipped past the email match.
        {stripeCount > 0
          ? ' The ones already on Stripe would be double-billed if staged here.'
          : ''}{' '}
        A name match alone can be a coincidence, so review each before skipping.
      </Text>
      <View className="gap-1.5">
        {matches.map((m) => {
          const off = excluded.has(m.rowEmail);
          return (
            <Pressable
              key={m.rowEmail}
              onPress={() => onToggle(m.rowEmail)}
              className="flex-row items-start gap-2 rounded-ctl border border-amber-200 dark:border-amber-800/60 bg-white/60 dark:bg-black/10 px-2.5 py-2">
              <Ionicons
                name={off ? 'checkbox' : 'square-outline'}
                size={18}
                color={off ? '#B45309' : '#D97706'}
              />
              <View className="flex-1">
                <Text className="text-amber-900 dark:text-amber-100 text-sm">
                  {m.rowName || '(no name)'} · {m.rowEmail}
                </Text>
                <Text className="text-amber-700 dark:text-amber-300 text-[11px]">
                  {m.reason === 'stripe'
                    ? `Matches a Stripe subscriber (${m.matchedEmail})`
                    : `Matches an imported member (${m.matchedEmail})`}
                  {m.confidence === 'name+dob'
                    ? ' — same name and date of birth'
                    : ' — same name'}
                </Text>
              </View>
              <Text className="text-amber-700 dark:text-amber-300 text-[11px] font-semibold uppercase tracking-wide pt-0.5">
                {off ? 'Skipping' : 'Keep'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Persistent nudge for members left over from an earlier import who
// still haven't signed up — visible any time the owner reopens this
// screen, not just right after a fresh import.
function UnclaimedImportsBanner({
  gymId,
  stats,
  onSent,
}: {
  gymId: string | null;
  stats: { pending: number; invited: number; linked: number; total: number };
  onSent: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: async () => {
      if (!gymId) throw new Error('Missing context');
      const { data, error: e } = await supabase.functions.invoke(
        'send-member-join-invites',
        {
          body: {
            gym_id: gymId,
            origin: Platform.OS === 'web' ? window.location.origin : undefined,
          },
        },
      );
      if (e) throw new Error(await functionErrorMessage(e));
      return data as { sent: number; failed: number };
    },
    onSuccess: () => {
      setError(null);
      onSent();
    },
    onError: (e) => setError(errorMessage(e, 'Could not send invites')),
  });

  return (
    <View className="bg-amber-500/10 border border-amber-500/30 rounded-card p-4 gap-2">
      <Text className="text-amber-800 dark:text-amber-300 text-sm font-medium">
        {stats.pending + stats.invited} member
        {stats.pending + stats.invited === 1 ? '' : 's'} from a previous
        import {stats.pending + stats.invited === 1 ? "hasn't" : "haven't"}{' '}
        signed up yet
      </Text>
      <Text className="text-amber-700/80 dark:text-amber-300/80 text-xs">
        {stats.pending} never invited, {stats.invited} invited and still
        waiting.
      </Text>
      <Button
        variant="secondary"
        onPress={() => send.mutate()}
        loading={send.isPending}>
        Send join invites
      </Button>
      {send.data ? (
        <Text className="text-amber-700/80 dark:text-amber-300/80 text-xs">
          Sent {send.data.sent}
          {send.data.failed > 0 ? `, ${send.data.failed} failed` : ''}.
        </Text>
      ) : null}
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
    </View>
  );
}

function HandoverPanel({
  gymId,
  gymName,
  primaryColor,
  slug,
  result,
}: {
  gymId: string | null;
  gymName: string;
  primaryColor: string;
  slug: string | null;
  result: ImportResult;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.temple';
  const url = slug ? joinUrl(origin, slug) : null;

  const stats = useQuery({
    queryKey: ['pending-members-stats', gymId],
    enabled: !!gymId,
    refetchInterval: 8000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pending_members_stats', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      const row = (data ?? [])[0] as
        | { pending: number; invited: number; linked: number; skipped: number; total: number }
        | undefined;
      return row ?? { pending: 0, invited: 0, linked: 0, skipped: 0, total: 0 };
    },
  });

  // Two paths to a campaign for the just-imported members. Welcome is
  // pre-filled and quickest to send; blank is for owners who want to
  // build their own message from scratch — both pre-set the audience
  // to `pending_members` so the campaign already targets the right
  // people, and land in the same editor.
  const sendFromTemple = useMutation({
    mutationFn: async () => {
      if (!gymId || !session) throw new Error('Missing context');
      const { data, error } = await supabase
        .from('email_campaigns')
        .insert({
          gym_id: gymId,
          // RLS requires created_by = auth.uid() on insert; omitting it
          // silently fails the WITH CHECK.
          created_by: session.user.id,
          title: `Welcome to ${gymName}`,
          subject: `Welcome to ${gymName} — your new home for booking`,
          preheader: 'Sign in to claim your account and keep your membership.',
          design: welcomeStarter(gymName, url ?? '#', primaryColor),
          audience: { kind: 'pending_members' },
        })
        .select('id')
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      setCampaignError(null);
      queryClient.invalidateQueries({ queryKey: ['email-campaigns'] });
      router.push(`/management/communications/${id}` as never);
    },
    onError: (e) =>
      setCampaignError(errorMessage(e, 'Could not open the welcome campaign')),
  });

  const createBlank = useMutation({
    mutationFn: async () => {
      if (!gymId || !session) throw new Error('Missing context');
      const { data, error } = await supabase
        .from('email_campaigns')
        .insert({
          gym_id: gymId,
          created_by: session.user.id,
          title: 'Untitled campaign',
          subject: '',
          preheader: '',
          design: { version: 1, blocks: [] },
          audience: { kind: 'pending_members' },
        })
        .select('id')
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      setCampaignError(null);
      queryClient.invalidateQueries({ queryKey: ['email-campaigns'] });
      router.push(`/management/communications/${id}` as never);
    },
    onError: (e) =>
      setCampaignError(errorMessage(e, 'Could not create the campaign')),
  });

  const [inviteError, setInviteError] = useState<string | null>(null);
  const sendJoinInvites = useMutation({
    mutationFn: async () => {
      if (!gymId) throw new Error('Missing context');
      const { data, error } = await supabase.functions.invoke(
        'send-member-join-invites',
        {
          body: {
            gym_id: gymId,
            origin: Platform.OS === 'web' ? window.location.origin : undefined,
          },
        },
      );
      if (error) {
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json();
            if (body?.error) msg = String(body.error);
          } catch {
            // not JSON — keep the generic message
          }
        }
        throw new Error(msg);
      }
      return data as { sent: number; failed: number };
    },
    onSuccess: () => {
      setInviteError(null);
      queryClient.invalidateQueries({ queryKey: ['pending-members-stats'] });
    },
    onError: (e) => setInviteError(errorMessage(e, 'Could not send invites')),
  });

  function downloadPerMemberCsv() {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !url) return;
    // Pull the pending rows server-side so the CSV reflects exactly
    // what's staged for this gym right now.
    supabase
      .from('pending_members')
      .select('email, full_name')
      .eq('gym_id', gymId!)
      .in('status', ['pending', 'invited'])
      .then(({ data }) => {
        const rows = data ?? [];
        const lines = ['email,name,join_url'];
        for (const r of rows) {
          const safe = (s: string) => `"${s.replace(/"/g, '""')}"`;
          lines.push(
            `${safe(String((r as { email: string }).email))},${safe(String((r as { full_name: string | null }).full_name ?? ''))},${safe(url)}`,
          );
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${gymName.replace(/\s+/g, '-').toLowerCase()}-invite-list.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  return (
    <View className="gap-4">
      <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-card p-4 gap-1">
        <Text className="text-ink dark:text-ink-dk font-semibold">
          Imported {result.inserted + result.updated} members
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {result.inserted} new · {result.updated} updated · {result.skipped} skipped
          (no email)
        </Text>
      </View>

      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
        <View className="gap-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Hand the join link to your members
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            They sign up with the same email you imported. Their plan, tags
            and history come along automatically.
          </Text>
        </View>
        {url ? (
          <View className="flex-row items-center gap-3">
            <View className="bg-white p-2 rounded-ctl border border-line">
              <QRCode value={url} size={96} />
            </View>
            <View className="flex-1 gap-2">
              <View className="bg-raised dark:bg-raised-dk rounded-ctl px-3 py-2">
                <Text
                  className="text-ink-2 dark:text-ink-2-dk text-sm font-mono"
                  numberOfLines={1}>
                  {url}
                </Text>
              </View>
              <ChipButton
                label="Download per-member invite CSV"
                icon="download-outline"
                onPress={downloadPerMemberCsv}
              />
            </View>
          </View>
        ) : (
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Set a public join slug on the Branding page first.
          </Text>
        )}
      </View>

      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
        <View className="gap-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Or, let Temple send the welcome
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Both options pre-set the audience to the members you just
            imported — pick the pre-filled welcome if you want to send in a
            few clicks, or start from a blank canvas if you'd rather write
            your own.
          </Text>
        </View>
        <Button
          variant="secondary"
          onPress={() => sendFromTemple.mutate()}
          loading={sendFromTemple.isPending}>
          Open welcome campaign
        </Button>
        <Button
          variant="ghost"
          onPress={() => createBlank.mutate()}
          loading={createBlank.isPending}>
          Create campaign from scratch
        </Button>
        {campaignError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {campaignError}
          </Text>
        ) : null}
      </View>

      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
        <View className="gap-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Or just send the join link now
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            One click, no campaign editor — a short email with their join
            link goes out immediately to everyone still waiting to sign up.
          </Text>
        </View>
        <Button
          variant="secondary"
          onPress={() => sendJoinInvites.mutate()}
          loading={sendJoinInvites.isPending}>
          Send join invites
        </Button>
        {sendJoinInvites.data ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Sent {sendJoinInvites.data.sent}
            {sendJoinInvites.data.failed > 0
              ? `, ${sendJoinInvites.data.failed} failed`
              : ''}
            .
          </Text>
        ) : null}
        {inviteError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {inviteError}
          </Text>
        ) : null}
      </View>

      {stats.data ? (
        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Linking progress
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Refreshes every few seconds — keep this page open while your
            members sign up.
          </Text>
          <View className="flex-row gap-4 pt-1">
            <Stat label="Linked" value={stats.data.linked} accent={primaryColor} />
            <Stat label="Pending" value={stats.data.pending + stats.data.invited} />
            <Stat label="Total" value={stats.data.total} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <View className="flex-1">
      <FieldLabel>
        {label}
      </FieldLabel>
      <Text
        style={accent ? { color: accent } : undefined}
        className="text-ink dark:text-ink-dk text-2xl font-semibold">
        {value}
      </Text>
    </View>
  );
}

// Starter "Welcome to <gym>" block document so the campaign editor
// lands the owner on something usable. Brand-coloured CTA button
// points at the join URL.
function welcomeStarter(
  gymName: string,
  joinHref: string,
  primary: string,
): Json {
  return {
    version: 1,
    blocks: [
      {
        type: 'heading',
        text: `Welcome to ${gymName}`,
        level: 1,
        align: 'center',
        color: '#0F172A',
      },
      {
        type: 'text',
        text:
          `Hi {{first_name}},\n\nWe've moved our member portal to Temple — and your account is already set up. Sign in with the email this message arrived at, set a password, and you're done. Your plan, your tags, and your history follow you over.`,
        align: 'left',
        color: '#334155',
      },
      {
        type: 'button',
        text: 'Sign in to Temple',
        href: joinHref,
        align: 'center',
        backgroundColor: primary,
        textColor: '#FFFFFF',
        radius: 8,
      },
      {
        type: 'text',
        text: 'See you soon at the gym.',
        align: 'left',
        color: '#475569',
      },
    ],
    settings: {
      backgroundColor: '#F1F5F9',
      contentBackgroundColor: '#FFFFFF',
      contentWidth: 600,
      fontFamily:
        '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    },
  } as unknown as Json;
}
