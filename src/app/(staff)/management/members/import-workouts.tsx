import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { parseCsv } from '@/lib/import/csv';
import {
  autoDetect,
  buildWorkoutRows,
  WORKOUT_FIELD_LABELS,
  type WorkoutField,
} from '@/lib/import/workout-columns';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

type Phase = 'upload' | 'map' | 'preview' | 'done';

type Result = {
  inserted_workouts: number;
  inserted_results: number;
  skipped_no_member: number;
  skipped_no_movement: number;
};

const FIELD_OPTIONS: { key: WorkoutField | 'ignore'; label: string }[] = [
  { key: 'ignore', label: 'Ignore' },
  ...(Object.entries(WORKOUT_FIELD_LABELS).map(([key, label]) => ({
    key: key as WorkoutField,
    label,
  }))),
];

export default function ImportWorkoutsScreen() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('upload');
  const [csvText, setCsvText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<(WorkoutField | 'ignore' | null)[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(() => (csvText ? parseCsv(csvText) : []), [csvText]);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).filter((r) => r.some((c) => c.length > 0));

  const built = useMemo(() => {
    if (phase !== 'preview' && phase !== 'map') {
      return { ready: [], misses: [], skippedNoEmail: 0, skippedNoDate: 0 };
    }
    return buildWorkoutRows(
      headers,
      mapping.map((m) => (m === 'ignore' ? null : m)) as (WorkoutField | null)[],
      rows,
    );
  }, [rows, headers, mapping, phase]);

  function onFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      const auto = autoDetect(parseCsv(text)[0] ?? []);
      setMapping(auto.map((f) => f ?? 'ignore'));
      setPhase('map');
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  }

  const commit = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('Missing context');
      const { data, error: e } = await supabase.rpc('import_member_workouts', {
        p_gym_id: membership.gymId,
        p_rows: built.ready as unknown as Json,
      });
      if (e) throw e;
      const row = (data ?? [])[0] as Result | undefined;
      return row ?? {
        inserted_workouts: 0,
        inserted_results: 0,
        skipped_no_member: 0,
        skipped_no_movement: 0,
      };
    },
    onSuccess: (r) => {
      setResult(r);
      setPhase('done');
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not import workouts')),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Import workout history
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Drop in a CSV of past workouts: one row per set. We match each
            row's email to an existing member and group sets on the same date
            into one workout. Movements are matched against the built-in
            vocab — unknowns show up below so you can rename them in the CSV.
          </Text>
        </View>

        {phase === 'upload' ? (
          <View className="gap-3 bg-white dark:bg-gray-900 rounded-xl p-4">
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
                      : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  }`}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Ionicons name="cloud-upload-outline" size={24} color="#6B7280" />
                  <Text className="text-gray-700 dark:text-gray-200 font-medium">
                    {dragOver ? 'Drop to upload' : 'Drop a CSV here or tap to choose a file'}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    Columns we look for: email, date, movement, weight, reps, unit.
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

            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Or paste the CSV here:
            </Text>
            <TextInput
              value={csvText}
              onChangeText={setCsvText}
              multiline
              numberOfLines={6}
              placeholder="email,date,movement,weight,reps,unit"
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
                Email, date and movement are required. Reps + weight + unit are
                strongly recommended.
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
          <View className="gap-3 bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Preview
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              {built.ready.length} row{built.ready.length === 1 ? '' : 's'} ready
              {built.misses.length > 0
                ? ` · ${built.misses.length} unknown movement${built.misses.length === 1 ? '' : 's'}`
                : ''}
              {built.skippedNoEmail + built.skippedNoDate > 0
                ? ` · ${built.skippedNoEmail + built.skippedNoDate} missing email/date`
                : ''}
            </Text>

            {built.ready.length > 0 ? (
              <View className="gap-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                {built.ready.slice(0, 6).map((r, i) => (
                  <View key={i} className="border-t border-gray-100 dark:border-gray-700 pt-1.5 first:border-t-0 first:pt-0">
                    <Text className="text-gray-900 dark:text-gray-50 text-sm">
                      {r.email} · {r.date} · {r.movement_key}
                    </Text>
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">
                      {r.weight !== null ? `${r.weight} ${r.unit} × ${r.reps}` : `bodyweight × ${r.reps}`}
                    </Text>
                  </View>
                ))}
                {built.ready.length > 6 ? (
                  <Text className="text-gray-400 dark:text-gray-500 text-xs pt-1">
                    …and {built.ready.length - 6} more.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {built.misses.length > 0 ? (
              <View className="gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <Text className="text-amber-700 dark:text-amber-300 text-sm font-medium">
                  Unknown movements (dropped)
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {dedupeMisses(built.misses.map((m) => m.value)).join(', ')}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  Rename these in the CSV to match the vocab (e.g. "back squat",
                  "deadlift", "overhead squat") and re-import.
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
                disabled={built.ready.length === 0}>
                Import {built.ready.length} result{built.ready.length === 1 ? '' : 's'}
              </Button>
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'done' && result ? (
          <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 gap-2">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Imported {result.inserted_results} result
              {result.inserted_results === 1 ? '' : 's'} across {result.inserted_workouts}{' '}
              workout{result.inserted_workouts === 1 ? '' : 's'}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              {result.skipped_no_member} skipped (email not in this gym yet) ·{' '}
              {result.skipped_no_movement} skipped (unknown movement)
            </Text>
            <View className="flex-row gap-2 pt-2">
              <Button
                variant="secondary"
                onPress={() => {
                  setPhase('upload');
                  setCsvText('');
                  setResult(null);
                  setMapping([]);
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
  if (Platform.OS === 'web') {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as WorkoutField | 'ignore')}
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
