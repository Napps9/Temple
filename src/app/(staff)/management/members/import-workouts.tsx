import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { parseCsv } from '@/lib/import/csv';
import {
  autoDetect,
  buildResults,
  looksLikeScoredResults,
  movementVocab,
  WORKOUT_FIELD_LABELS,
  type WorkoutField,
} from '@/lib/import/workout-columns';
import {
  overridesFrom,
  resolveMovements,
  type MovementResolution,
} from '@/lib/import/resolve-movements';
import { supabase } from '@/lib/supabase';
import { useThemePreference, useThemeColors } from '@/lib/theme';
import { useCan } from '@/lib/useCan';
import { webSelectStyle } from '@/lib/webSelect';
import type { Json } from '@/types/database';

type Phase = 'upload' | 'map' | 'preview' | 'done';

type WorkoutRpcResult = {
  inserted_workouts: number;
  inserted_results: number;
  skipped_no_member: number;
  skipped_no_movement: number;
  staged: number;
};

type SectionRpcResult = {
  inserted_workouts: number;
  inserted_sections: number;
  skipped_no_member: number;
  skipped_duplicate: number;
  staged: number;
};

type HyroxRpcResult = {
  inserted_workouts: number;
  inserted_results: number;
  skipped_no_member: number;
  skipped_duplicate: number;
  staged: number;
};

// Combined across the three RPCs (weighted movements + scored sections +
// Hyrox/time results).
type Result = {
  workouts: number;
  results: number; // weighted movement results
  sections: number; // scored benchmark sections
  hyrox: number; // Hyrox station splits + official times
  staged: number; // queued for pending members, applied on signup
  skipped_no_member: number;
  skipped_no_movement: number;
  skipped_duplicate: number;
};

const FIELD_OPTIONS: { key: WorkoutField | 'ignore'; label: string }[] = [
  { key: 'ignore', label: 'Ignore' },
  ...(Object.entries(WORKOUT_FIELD_LABELS).map(([key, label]) => ({
    key: key as WorkoutField,
    label,
  }))),
];

const MOVEMENT_NAME_BY_KEY = new Map(
  movementVocab().map((v) => [v.key, v.name]),
);

export default function ImportWorkoutsScreen() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const canManageStaff = useCan('can_manage_staff');
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('upload');
  const [csvText, setCsvText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<(WorkoutField | 'ignore' | null)[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // AI movement resolution: suggestions returned, which the owner has
  // accepted, and the applied override map buildResults re-resolves with.
  const [aiResolutions, setAiResolutions] = useState<MovementResolution[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());

  const parsed = useMemo(() => (csvText ? parseCsv(csvText) : []), [csvText]);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).filter((r) => r.some((c) => c.length > 0));

  const built = useMemo(() => {
    if (phase !== 'preview' && phase !== 'map') {
      return {
        weighted: [],
        sections: [],
        hyrox: [],
        misses: [],
        deferred: 0,
        skippedNoEmail: 0,
        skippedNoDate: 0,
        skippedUnscored: 0,
      };
    }
    return buildResults(
      headers,
      mapping.map((m) => (m === 'ignore' ? null : m)) as (WorkoutField | null)[],
      rows,
      overrides,
    );
  }, [rows, headers, mapping, phase, overrides]);

  const readyCount =
    built.weighted.length + built.sections.length + built.hyrox.length;
  const insertedCount = result
    ? result.results + result.sections + result.hyrox
    : 0;

  const scoredShape = useMemo(() => looksLikeScoredResults(rows), [rows]);

  function onFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      const p = parseCsv(text);
      const auto = autoDetect(p[0] ?? [], p.slice(1));
      setMapping(auto.map((f) => f ?? 'ignore'));
      setOverrides(new Map());
      setAiResolutions([]);
      setAccepted(new Set());
      setPhase('map');
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  }

  const resolve = useMutation({
    mutationFn: async (): Promise<MovementResolution[]> => {
      if (!membership) return [];
      return resolveMovements(
        membership.gymId,
        built.misses.map((m) => m.value),
      );
    },
    onSuccess: (res) => {
      setAiResolutions(res);
      setAccepted(new Set(res.map((r) => r.name)));
    },
  });

  function applyMatches() {
    const chosen = aiResolutions.filter((r) => accepted.has(r.name));
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const [k, v] of overridesFrom(chosen)) next.set(k, v);
      return next;
    });
    setAiResolutions([]);
    setAccepted(new Set());
  }

  const commit = useMutation({
    mutationFn: async (): Promise<Result> => {
      if (!membership) throw new Error('Missing context');
      const acc: Result = {
        workouts: 0,
        results: 0,
        sections: 0,
        hyrox: 0,
        staged: 0,
        skipped_no_member: 0,
        skipped_no_movement: 0,
        skipped_duplicate: 0,
      };
      if (built.weighted.length > 0) {
        const { data, error: e } = await supabase.rpc('import_member_workouts', {
          p_gym_id: membership.gymId,
          p_rows: built.weighted as unknown as Json,
        });
        if (e) throw e;
        const row = (data ?? [])[0] as WorkoutRpcResult | undefined;
        if (row) {
          acc.workouts += row.inserted_workouts;
          acc.results += row.inserted_results;
          acc.skipped_no_member += row.skipped_no_member;
          acc.skipped_no_movement += row.skipped_no_movement;
          acc.staged += row.staged;
        }
      }
      if (built.sections.length > 0) {
        const { data, error: e } = await supabase.rpc('import_member_results', {
          p_gym_id: membership.gymId,
          p_rows: built.sections as unknown as Json,
        });
        if (e) throw e;
        const row = (data ?? [])[0] as SectionRpcResult | undefined;
        if (row) {
          acc.workouts += row.inserted_workouts;
          acc.sections += row.inserted_sections;
          acc.skipped_no_member += row.skipped_no_member;
          acc.skipped_duplicate += row.skipped_duplicate;
          acc.staged += row.staged;
        }
      }
      if (built.hyrox.length > 0) {
        const { data, error: e } = await supabase.rpc(
          'import_member_hyrox_results',
          { p_gym_id: membership.gymId, p_rows: built.hyrox as unknown as Json },
        );
        if (e) throw e;
        const row = (data ?? [])[0] as HyroxRpcResult | undefined;
        if (row) {
          acc.workouts += row.inserted_workouts;
          acc.hyrox += row.inserted_results;
          acc.skipped_no_member += row.skipped_no_member;
          acc.skipped_duplicate += row.skipped_duplicate;
          acc.staged += row.staged;
        }
      }
      return acc;
    },
    onSuccess: (r) => {
      setResult(r);
      setPhase('done');
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not import workouts')),
  });

  if (canManageStaff === false) return <Redirect href="/management" />;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management" />
        <PageHead
          title="Import workout history"
          subtitle="Drop in a CSV of past workouts: one row per result. Weighted lifts (movement + weight + reps), benchmark WODs scored For Time or AMRAP, and Hyrox station splits + race times all import. We match each row's email to an existing member and group results on the same date into one workout. Movements are matched against the built-in vocab — unknowns show up below, where AI can match them for you."
        />

        {phase === 'upload' ? (
          <View className="gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            {Platform.OS === 'web' ? (
              <>
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
                      : 'border-line-strong dark:border-line-dk hover:bg-raised dark:hover:bg-raised-dk/40'
                  }`}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Ionicons name="cloud-upload-outline" size={24} color={colors.ink2} />
                  <Text className="text-ink-2 dark:text-ink-2-dk font-medium">
                    {dragOver ? 'Drop to upload' : 'Drop a CSV here or tap to choose a file'}
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    Columns we look for: email, date, movement, weight, reps,
                    unit, score type, score.
                  </Text>
                </div>
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
              Or paste the CSV here:
            </Text>
            <TextInput
              value={csvText}
              onChangeText={setCsvText}
              multiline
              numberOfLines={6}
              placeholder="email,date,movement,weight,reps,unit,score type,score"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ minHeight: 140, textAlignVertical: 'top' }}
              className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-lg px-3 py-2 text-ink dark:text-ink-dk text-sm font-mono"
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
                setMapping(autoDetect(headers, rows).map((f) => f ?? 'ignore'));
                setPhase('map');
              }}
              disabled={!csvText.trim()}>
              Continue
            </Button>
          </View>
        ) : null}

        {phase === 'map' ? (
          <View className="gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <View className="gap-1">
              <Text className="text-ink dark:text-ink-dk font-semibold">
                Map your columns
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Email, date and movement are required. Reps + weight + unit are
                strongly recommended.
              </Text>
            </View>
            {scoredShape ? <ScoredResultsNotice /> : null}
            <View className="gap-2">
              {headers.map((h, i) => (
                <View
                  key={`${h}-${i}`}
                  className="flex-row items-center gap-2 bg-raised dark:bg-raised-dk rounded-lg px-3 py-2">
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
                    setError('Map a column to Member email.');
                    return;
                  }
                  if (!mapping.includes('date')) {
                    setError('Map a column to Date.');
                    return;
                  }
                  if (!mapping.includes('movement')) {
                    setError('Map a column to Movement.');
                    return;
                  }
                  setError(null);
                  setPhase('preview');
                }}>
                Preview
              </Button>
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'preview' ? (
          <View className="gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Preview
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              {built.weighted.length} lift{built.weighted.length === 1 ? '' : 's'}
              {' · '}
              {built.sections.length} benchmark
              {built.sections.length === 1 ? '' : 's'}
              {' · '}
              {built.hyrox.length} Hyrox ready
              {built.misses.length > 0
                ? ` · ${built.misses.length} unknown movement${built.misses.length === 1 ? '' : 's'}`
                : ''}
              {built.deferred > 0
                ? ` · ${built.deferred} race split${built.deferred === 1 ? '' : 's'} skipped`
                : ''}
              {built.skippedNoEmail + built.skippedNoDate > 0
                ? ` · ${built.skippedNoEmail + built.skippedNoDate} missing email/date`
                : ''}
            </Text>

            {built.sections.length > 0 ? (
              <View className="gap-1.5 bg-raised dark:bg-raised-dk rounded-lg p-3">
                {built.sections.slice(0, 6).map((s, i) => (
                  <View key={`s${i}`} className="border-t border-line dark:border-line-dk pt-1.5 first:border-t-0 first:pt-0">
                    <Text className="text-ink dark:text-ink-dk text-sm">
                      {s.email} · {s.date} · {s.title}
                    </Text>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      {s.section_format === 'for_time'
                        ? `For time — ${clock(s.total_time_seconds)}`
                        : `AMRAP — ${s.total_rounds ?? 0} + ${s.total_extra_reps ?? 0}`}
                    </Text>
                  </View>
                ))}
                {built.sections.length > 6 ? (
                  <Text className="text-ink-3 dark:text-ink-3-dk text-xs pt-1">
                    …and {built.sections.length - 6} more benchmark
                    {built.sections.length - 6 === 1 ? '' : 's'}.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {built.hyrox.length > 0 ? (
              <View className="gap-1.5 bg-raised dark:bg-raised-dk rounded-lg p-3">
                {built.hyrox.slice(0, 6).map((h, i) => (
                  <View key={`h${i}`} className="border-t border-line dark:border-line-dk pt-1.5 first:border-t-0 first:pt-0">
                    <Text className="text-ink dark:text-ink-dk text-sm">
                      {h.email} · {h.date} · {hyroxLabel(h.movement_key)}
                    </Text>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      {clock(h.value_seconds)}
                    </Text>
                  </View>
                ))}
                {built.hyrox.length > 6 ? (
                  <Text className="text-ink-3 dark:text-ink-3-dk text-xs pt-1">
                    …and {built.hyrox.length - 6} more Hyrox result
                    {built.hyrox.length - 6 === 1 ? '' : 's'}.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {built.weighted.length > 0 ? (
              <View className="gap-1.5 bg-raised dark:bg-raised-dk rounded-lg p-3">
                {built.weighted.slice(0, 6).map((r, i) => (
                  <View key={`w${i}`} className="border-t border-line dark:border-line-dk pt-1.5 first:border-t-0 first:pt-0">
                    <Text className="text-ink dark:text-ink-dk text-sm">
                      {r.email} · {r.date} · {r.movement_key}
                    </Text>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      {r.weight !== null ? `${r.weight} ${r.unit} × ${r.reps}` : `bodyweight × ${r.reps}`}
                    </Text>
                  </View>
                ))}
                {built.weighted.length > 6 ? (
                  <Text className="text-ink-3 dark:text-ink-3-dk text-xs pt-1">
                    …and {built.weighted.length - 6} more lift
                    {built.weighted.length - 6 === 1 ? '' : 's'}.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {built.misses.length > 0 ? (
              <View className="gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <Text className="text-amber-700 dark:text-amber-300 text-sm font-medium">
                  Unknown movements (dropped)
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {dedupeMisses(built.misses.map((m) => m.value)).join(', ')}
                </Text>
                {resolve.isSuccess && (resolve.data?.length ?? 0) === 0 ? (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    AI couldn’t confidently match these — rename them in the CSV
                    (e.g. “back squat”) and re-import.
                  </Text>
                ) : aiResolutions.length === 0 ? (
                  <>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      Rename these in the CSV to match the vocab, or let AI match
                      them for you.
                    </Text>
                    <Button
                      variant="secondary"
                      onPress={() => resolve.mutate()}
                      loading={resolve.isPending}>
                      Match with AI
                    </Button>
                  </>
                ) : null}
              </View>
            ) : null}

            {aiResolutions.length > 0 ? (
              <View className="gap-2 bg-surface dark:bg-surface-dk border border-primary/30 rounded-lg p-3">
                <Text className="text-ink dark:text-ink-dk text-sm font-medium">
                  AI matches — tick the ones to apply
                </Text>
                {aiResolutions.map((r) => {
                  const on = accepted.has(r.name);
                  return (
                    <Pressable
                      key={r.name}
                      onPress={() =>
                        setAccepted((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.name)) next.delete(r.name);
                          else next.add(r.name);
                          return next;
                        })
                      }
                      className="flex-row items-center gap-2 active:opacity-70">
                      <Ionicons
                        name={on ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={on ? colors.primary : colors.ink3}
                      />
                      <Text className="flex-1 text-ink dark:text-ink-dk text-sm">
                        {r.name} → {MOVEMENT_NAME_BY_KEY.get(r.key) ?? r.key}
                        <Text className="text-ink-3 dark:text-ink-3-dk">
                          {'  '}
                          ({r.confidence})
                        </Text>
                      </Text>
                    </Pressable>
                  );
                })}
                <Button onPress={applyMatches} disabled={accepted.size === 0}>
                  Apply {accepted.size} match{accepted.size === 1 ? '' : 'es'}
                </Button>
              </View>
            ) : null}

            {built.deferred > 0 ? (
              <View className="gap-1 bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-lg p-3">
                <Text className="text-ink dark:text-ink-dk text-sm font-medium">
                  {built.deferred} aggregate row{built.deferred === 1 ? '' : 's'}{' '}
                  skipped
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Hyrox total-run and roxzone rows are 8-segment aggregates with
                  no single-station PB — the station splits and race time above
                  import; these don’t.
                </Text>
              </View>
            ) : null}

            <View className="flex-row gap-2 pt-2">
              <Button variant="secondary" onPress={() => setPhase('map')}>
                Back
              </Button>
              <View className="flex-1" />
              <Button
                onPress={() => commit.mutate()}
                loading={commit.isPending}
                disabled={readyCount === 0}>
                Import {readyCount} result{readyCount === 1 ? '' : 's'}
              </Button>
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'done' && result ? (
          <View
            className={`border rounded-xl p-4 gap-2 ${
              insertedCount > 0
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : result.staged > 0
                  ? 'bg-primary/10 border-primary/30'
                  : 'bg-amber-500/10 border-amber-500/30'
            }`}>
            {insertedCount > 0 ? (
              <>
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  Imported {insertedCount} result{insertedCount === 1 ? '' : 's'}{' '}
                  across {result.workouts} workout
                  {result.workouts === 1 ? '' : 's'}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {result.results} lift{result.results === 1 ? '' : 's'} ·{' '}
                  {result.sections} benchmark{result.sections === 1 ? '' : 's'} ·{' '}
                  {result.hyrox} Hyrox
                  {result.staged > 0
                    ? ` · ${result.staged} staged for pending members`
                    : ''}
                  {result.skipped_no_member > 0
                    ? ` · ${result.skipped_no_member} skipped (no matching member)`
                    : ''}
                  {result.skipped_no_movement > 0
                    ? ` · ${result.skipped_no_movement} unknown movement`
                    : ''}
                  {result.skipped_duplicate > 0
                    ? ` · ${result.skipped_duplicate} already imported`
                    : ''}
                </Text>
              </>
            ) : result.staged > 0 ? (
              <>
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  Staged {result.staged} result{result.staged === 1 ? '' : 's'} for
                  members who haven’t signed up yet
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  These emails match imported (pending) members. Each member’s
                  history lands on their Track the moment they sign up at your join
                  link — nothing else to do.
                  {result.skipped_no_member > 0
                    ? ` ${result.skipped_no_member} row${result.skipped_no_member === 1 ? '' : 's'} matched no member at all.`
                    : ''}
                </Text>
              </>
            ) : (
              <>
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  Nothing imported — no matching members
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {result.skipped_no_member} row
                  {result.skipped_no_member === 1 ? '' : 's'} had an email that isn’t
                  a member of this gym. Import your members first (Manage → Members →
                  Import), then re-run — results for imported members are staged and
                  appear when they sign up.
                </Text>
              </>
            )}
            <View className="flex-row gap-2 pt-2">
              <Button
                variant="secondary"
                onPress={() => {
                  setPhase('upload');
                  setCsvText('');
                  setResult(null);
                  setMapping([]);
                  setOverrides(new Map());
                  setAiResolutions([]);
                  setAccepted(new Set());
                }}>
                Import another file
              </Button>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ScoredResultsNotice() {
  return (
    <View className="gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
      <Text className="text-amber-700 dark:text-amber-300 text-sm font-medium">
        This looks like scored results
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        Map the workout name to Movement, plus the Score type and Score columns
        (and Segment for Hyrox). Benchmark WODs (For Time, AMRAP) and Hyrox
        station splits + race times import; weighted lifts need a movement
        Temple recognises, which AI can match below.
      </Text>
    </View>
  );
}

// Readable label for an imported Hyrox result key.
function hyroxLabel(key: string): string {
  if (key === 'hyrox_time') return 'Official race time';
  return key.replace(/^hyrox_/, '').replace(/_/g, ' ');
}

// mm:ss for a benchmark time; a bare em-dash when unset.
function clock(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function dedupeMisses(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= 10) break;
  }
  return out;
}

function FieldPicker({
  value,
  onChange,
}: {
  value: WorkoutField | 'ignore';
  onChange: (v: WorkoutField | 'ignore') => void;
}) {
  const { scheme } = useThemePreference();
  if (Platform.OS === 'web') {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as WorkoutField | 'ignore')}
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
