import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { joinUrl } from '@/lib/brand';
import { errorMessage } from '@/lib/errors';
import {
  autoDetect,
  buildImportRow,
  TEMPLE_FIELD_LABELS,
  type TempleField,
} from '@/lib/import/columns';
import { parseCsv } from '@/lib/import/csv';
import {
  buildCorrectionRows,
  runInference,
  summariseForInference,
  type InferenceResponse,
  type PlanKind,
  type ReviewedPlan,
} from '@/lib/import/infer';
import { supabase } from '@/lib/supabase';
import { useGymBrand } from '@/lib/useGymBrand';
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

const FIELD_OPTIONS: { key: TempleField | 'ignore'; label: string }[] = [
  { key: 'ignore', label: 'Ignore' },
  ...(Object.entries(TEMPLE_FIELD_LABELS).map(([key, label]) => ({
    key: key as TempleField,
    label,
  }))),
];

export default function ImportMembersScreen() {
  const { data: membership } = useGymMembership();
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

  const fileInput = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(() => (csvText ? parseCsv(csvText) : []), [csvText]);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).filter((r) => r.some((c) => c.length > 0));

  function onFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      const auto = autoDetect((parseCsv(text)[0] ?? []));
      setMapping(auto.map((f) => f ?? 'ignore'));
      setPhase('map');
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

  // Trigger inference on entering the Review step. Only once per
  // distinct mapping+rows combination.
  async function loadInference() {
    if (!membership) return;
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
      // Seed the editable per-plan state from the suggestions.
      const seed = new Map<string, ReviewedPlan>();
      for (const p of r.plans) {
        seed.set(p.raw_name, {
          raw_name: p.raw_name,
          name: p.suggested_name,
          kind: p.suggested_kind,
          credit_count: p.suggested_credit_count,
          monthly_price_cents: p.suggested_monthly_price_cents,
          existing_plan_id: null,
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

  // Commit: insert new membership_plans, stamp linked_membership_plan_id
  // onto every row that mapped to a plan, call import_pending_members,
  // and finally record the corrections (accepted + overridden) into
  // the cross-gym learning store.
  const commit = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('Missing context');

      // 1. Insert each non-dropped, non-existing-mapped plan.
      const planNameToId = new Map<string, string>();
      for (const p of reviewedPlans.values()) {
        if (p.drop) continue;
        if (p.existing_plan_id) {
          planNameToId.set(p.raw_name, p.existing_plan_id);
          continue;
        }
        const { data: inserted, error: planErr } = await supabase
          .from('membership_plans')
          .insert({
            gym_id: membership.gymId,
            name: p.name.trim(),
            kind: p.kind,
            credit_count: p.kind === 'unlimited' ? null : p.credit_count,
            monthly_price_cents: p.monthly_price_cents,
            ...(p.kind === 'credit_period' ? { period_length: '30 days' } : {}),
          })
          .select('plan_id')
          .single();
        if (planErr) throw planErr;
        planNameToId.set(p.raw_name, (inserted as { plan_id: string }).plan_id);
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
          supabase
            .rpc('record_import_corrections', {
              p_gym_id: membership.gymId,
              p_rows: corrections as unknown as Json,
            })
            .then(() => undefined);
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

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" />

        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Import members
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Drop in a CSV from your previous platform (Mindbody, PushPress,
            Glofox, Wodify, a spreadsheet…). We stage the rows; members
            link to their data when they sign up at your join link.
          </Text>
        </View>

        {phase === 'upload' ? (
          <View className="gap-3 bg-white dark:bg-gray-900 rounded-xl p-4">
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
                  className={`border-2 border-dashed rounded-xl p-8 items-center gap-2 cursor-pointer transition-colors ${
                    dragOver
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  }`}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Ionicons name="cloud-upload-outline" size={24} color="#6B7280" />
                  <Text className="text-gray-700 dark:text-gray-200 font-medium">
                    {dragOver ? 'Drop to upload' : 'Drop a CSV here or tap to choose a file'}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
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

            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Or paste the CSV content here:
            </Text>
            <TextInput
              value={csvText}
              onChangeText={setCsvText}
              multiline
              numberOfLines={6}
              placeholder="Email,First Name,Last Name,Plan,Start Date..."
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ minHeight: 140, textAlignVertical: 'top' }}
              className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-50 text-sm font-mono"
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
                setMapping(autoDetect(headers).map((f) => f ?? 'ignore'));
                setPhase('map');
              }}
              disabled={!csvText.trim()}>
              Continue
            </Button>
          </View>
        ) : null}

        {phase === 'map' ? (
          <View className="gap-3 bg-white dark:bg-gray-900 rounded-xl p-4">
            <View className="gap-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Map your columns
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                We auto-detected what we could. Adjust anything that's wrong.
                Columns set to "Ignore" are dropped.
              </Text>
            </View>
            <View className="gap-2">
              {headers.map((h, i) => (
                <View
                  key={`${h}-${i}`}
                  className="flex-row items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                  <Text
                    className="flex-1 text-gray-900 dark:text-gray-50 text-sm"
                    numberOfLines={1}>
                    {h || `(column ${i + 1})`}
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color="#9CA3AF" />
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
            onUpdatePlan={updatePlan}
            onToggleTagKeep={toggleTagKeep}
            onBack={() => setPhase('map')}
            onContinue={() => setPhase('preview')}
            error={error}
          />
        ) : null}

        {phase === 'preview' ? (
          <View className="gap-3 bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Preview
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              {importRows.length} ready to stage · {rows.length - importRows.length}{' '}
              skipped (missing email)
            </Text>
            <View className="gap-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              {importRows.slice(0, 5).map((r, i) => (
                <View key={i} className="border-t border-gray-100 dark:border-gray-700 pt-1.5 first:border-t-0 first:pt-0">
                  <Text className="text-gray-900 dark:text-gray-50 text-sm">
                    {String(r.full_name ?? '(no name)')} · {String(r.email)}
                  </Text>
                  {r.plan_name ? (
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">
                      Plan: {String(r.plan_name)}
                      {r.plan_end ? ` (ends ${r.plan_end})` : ''}
                    </Text>
                  ) : null}
                </View>
              ))}
              {importRows.length > 5 ? (
                <Text className="text-gray-400 dark:text-gray-500 text-xs pt-1">
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
                disabled={importRows.length === 0}>
                Import {importRows.length} members
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
            primaryColor={brand.primaryColor}
            slug={brand.slug}
            result={importResult}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ReviewPanel({
  loading,
  inference,
  reviewedPlans,
  tagsKeep,
  totalRows,
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
  onUpdatePlan: (rawName: string, patch: Partial<ReviewedPlan>) => void;
  onToggleTagKeep: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
  error: string | null;
}) {
  const planEntries = inference?.plans ?? [];
  return (
    <View className="gap-4">
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
        <View className="flex-row items-center gap-2">
          <Ionicons name="sparkles-outline" size={18} color="#6B7280" />
          <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
            What we found in your CSV
          </Text>
          {inference ? (
            <View className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
              <Text className="text-gray-500 dark:text-gray-400 text-[10px] uppercase tracking-widest">
                {inference.source === 'ai'
                  ? 'AI suggestions'
                  : inference.source === 'mixed'
                    ? 'AI + learned'
                    : 'Heuristic'}
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {loading
            ? 'AI is sharpening these suggestions…'
            : 'Edit anything that looks off. We\'ll create the plans and link members on commit.'}
        </Text>
      </View>

      {/* Plans */}
      <View className="gap-3">
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest px-1">
          Plans found ({planEntries.length})
        </Text>
        {loading && planEntries.length === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Reading the rows and inferring plans…
            </Text>
          </View>
        ) : planEntries.length === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
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
                onChange={(patch) => onUpdatePlan(p.raw_name, patch)}
              />
            );
          })
        )}
      </View>

      {/* Tags */}
      {(inference?.tags.keep.length ?? 0) +
        (inference?.tags.drop.length ?? 0) >
      0 ? (
        <View className="gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest px-1">
            Tags found
          </Text>
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
                        ? 'bg-primary/10 border-primary/30'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-50'
                    }`}>
                    <Text
                      className={`text-xs ${
                        on
                          ? 'text-primary font-medium'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}>
                      {value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      ) : null}

      {/* Cohort summary */}
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">
          What you're bringing across
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
  onChange,
}: {
  suggestion: InferenceResponse['plans'][number];
  final: ReviewedPlan;
  hint: { raw_name: string; share_of_members: number } | null;
  onChange: (patch: Partial<ReviewedPlan>) => void;
}) {
  const confidence = suggestion.confidence;
  const confidenceColor =
    confidence === 'learned'
      ? '#10B981'
      : confidence === 'high'
        ? '#10B981'
        : confidence === 'medium'
          ? '#F59E0B'
          : '#9CA3AF';
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <View
          style={{ backgroundColor: confidenceColor }}
          className="w-2 h-2 rounded-full"
        />
        <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest font-mono">
          From "{suggestion.raw_name}"
        </Text>
        {hint ? (
          <Text className="text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-widest">
            · Most common
          </Text>
        ) : null}
      </View>
      <View className="gap-1.5">
        <Text className="text-gray-700 dark:text-gray-200 text-xs">
          Plan name
        </Text>
        <TextInput
          value={final.name}
          onChangeText={(v) => onChange({ name: v })}
          placeholderTextColor="#9CA3AF"
          className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-50 text-base"
        />
      </View>
      <View className="gap-1.5">
        <Text className="text-gray-700 dark:text-gray-200 text-xs">Kind</Text>
        <View className="flex-row gap-2 flex-wrap">
          {(['unlimited', 'credit_period', 'credit_pack'] as PlanKind[]).map(
            (k) => (
              <Pressable
                key={k}
                onPress={() => onChange({ kind: k })}
                className={`px-3 py-1.5 rounded-md border ${
                  final.kind === k
                    ? 'border-primary bg-primary/10'
                    : 'border-gray-200 dark:border-gray-700'
                }`}>
                <Text
                  className={
                    final.kind === k
                      ? 'text-primary text-xs uppercase tracking-widest'
                      : 'text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest'
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
          <Text className="text-gray-700 dark:text-gray-200 text-xs">
            Credits per period
          </Text>
          <TextInput
            value={String(final.credit_count ?? '')}
            onChangeText={(v) =>
              onChange({ credit_count: v === '' ? null : parseInt(v, 10) })
            }
            keyboardType="number-pad"
            placeholderTextColor="#9CA3AF"
            className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-50 text-base"
          />
        </View>
      ) : null}
      <View className="gap-1.5">
        <Text className="text-gray-700 dark:text-gray-200 text-xs">
          Monthly price (pence)
        </Text>
        <TextInput
          value={String(final.monthly_price_cents)}
          onChangeText={(v) => {
            const n = parseInt(v, 10);
            onChange({ monthly_price_cents: Number.isFinite(n) ? n : 0 });
          }}
          keyboardType="number-pad"
          placeholderTextColor="#9CA3AF"
          className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-50 text-base"
        />
      </View>
      {suggestion.reasoning ? (
        <Text className="text-gray-400 dark:text-gray-500 text-[10px]">
          {suggestion.reasoning}
        </Text>
      ) : null}
    </View>
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
  if (Platform.OS === 'web') {
    return (
      // eslint-disable-next-line jsx-a11y/no-onchange
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TempleField | 'ignore')}
        style={{
          fontSize: 13,
          padding: '4px 8px',
          borderRadius: 8,
          border: '1px solid #D1D5DB',
          background: 'transparent',
          color: 'inherit',
        }}>
        {FIELD_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Text className="text-gray-700 dark:text-gray-200 text-xs">
      {FIELD_OPTIONS.find((o) => o.key === value)?.label ?? '?'}
    </Text>
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
      if (!gymId) throw new Error('Missing context');
      const { data, error } = await supabase
        .from('email_campaigns')
        .insert({
          gym_id: gymId,
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
      queryClient.invalidateQueries({ queryKey: ['email-campaigns'] });
      router.push(`/management/communications/${id}` as never);
    },
  });

  const createBlank = useMutation({
    mutationFn: async () => {
      if (!gymId) throw new Error('Missing context');
      const { data, error } = await supabase
        .from('email_campaigns')
        .insert({
          gym_id: gymId,
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
      queryClient.invalidateQueries({ queryKey: ['email-campaigns'] });
      router.push(`/management/communications/${id}` as never);
    },
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
      <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 gap-1">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">
          Imported {result.inserted + result.updated} members
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {result.inserted} new · {result.updated} updated · {result.skipped} skipped
          (no email)
        </Text>
      </View>

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Hand the join link to your members
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            They sign up with the same email you imported. Their plan, tags
            and history come along automatically.
          </Text>
        </View>
        {url ? (
          <View className="flex-row items-center gap-3">
            <View className="bg-white p-2 rounded-lg border border-gray-200">
              <QRCode value={url} size={96} />
            </View>
            <View className="flex-1 gap-2">
              <View className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                <Text
                  className="text-gray-700 dark:text-gray-200 text-sm font-mono"
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
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Set a public join slug on the Branding page first.
          </Text>
        )}
      </View>

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Or, let Temple send the welcome
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
      </View>

      {stats.data ? (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Linking progress
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
      <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
        {label}
      </Text>
      <Text
        style={accent ? { color: accent } : undefined}
        className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
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
