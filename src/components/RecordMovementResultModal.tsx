import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { Button } from './Button';
import { DatePicker } from './DatePicker';
import { Input } from './Input';
import { FieldLabel } from './SectionLabel';
import { Sheet, SheetAction } from './Sheet';
import { useGymMembership, useSession } from '@/lib/auth';
import { displayToKg, type WeightUnit } from '@/lib/weight';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import { errorMessage } from '@/lib/errors';
import {
  allSchemeOptions,
  findScheme,
  type Discipline,
  type Metric,
  type SchemeOption,
} from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { MY_REP_MAXES_KEY } from '@/lib/useOneRepMaxes';
import { useThemeColors } from '@/lib/theme';
import { defaultUnit, parseDuration } from '@/lib/track';
import { useSavedFlag } from '@/lib/useSavedFlag';

type DraftResult = {
  // The (movement, scheme) pair the user picked, or null while still
  // picking. We keep the option around so the form can render the
  // metric-specific input (weight vs. time vs. reps...) without
  // re-resolving from the catalog each render.
  option: SchemeOption | null;
  value: string;
  notes: string;
};

function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function emptyDraft(option: SchemeOption | null = null): DraftResult {
  return { option, value: '', notes: '' };
}

export function RecordMovementResultModal({
  visible,
  onClose,
  initialDate,
  initialClassSessionId,
  initialTitle,
  // When the modal is opened with a specific movement preselected
  // (e.g. from the movement detail page), seed the first draft with it.
  // initialTrackKey narrows further to a specific rep-max scheme so a
  // tap on the "5 Rep Max" card lands ready for a single number to be
  // typed in.
  initialMovementKey,
  initialTrackKey,
  // Solo mode: a gym-less athlete logging their own training. The rows
  // are written with gym_id = null (the athlete-subscription RLS path),
  // so no membership is required.
  solo = false,
  discipline = 'crossfit',
}: {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
  initialClassSessionId?: string | null;
  initialTitle?: string | null;
  initialMovementKey?: string;
  initialTrackKey?: string;
  solo?: boolean;
  discipline?: Discipline;
}) {
  const colors = useThemeColors();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const weightUnit = useGymWeightUnit();
  const queryClient = useQueryClient();

  const [date, setDate] = useState<string>(initialDate ?? todayLocalIso());
  const [title, setTitle] = useState<string>(initialTitle ?? '');
  const [notes, setNotes] = useState<string>('');
  const [drafts, setDrafts] = useState<DraftResult[]>([emptyDraft()]);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const schemeOptions = useMemo(
    () => allSchemeOptions(discipline),
    [discipline],
  );

  useEffect(() => {
    if (!visible) return;
    setDate(initialDate ?? todayLocalIso());
    setTitle(initialTitle ?? '');
    setNotes('');
    setError(null);
    setPickerOpenFor(null);
    if (initialMovementKey) {
      // Prefer an exact (movement, track) match when both supplied;
      // otherwise fall back to the first scheme on the movement.
      const exact =
        initialTrackKey != null
          ? schemeOptions.find(
              (s) =>
                s.movementKey === initialMovementKey &&
                s.schemeKey === initialTrackKey,
            )
          : undefined;
      const firstOnMovement = schemeOptions.find(
        (s) => s.movementKey === initialMovementKey,
      );
      setDrafts([emptyDraft(exact ?? firstOnMovement ?? null)]);
    } else {
      setDrafts([emptyDraft()]);
    }
  }, [
    visible,
    initialDate,
    initialTitle,
    initialMovementKey,
    initialTrackKey,
    schemeOptions,
  ]);

  function updateDraft(idx: number, next: Partial<DraftResult>) {
    setDrafts((cur) =>
      cur.map((d, i) => (i === idx ? { ...d, ...next } : d)),
    );
  }

  function addDraft() {
    setDrafts((cur) => [...cur, emptyDraft()]);
  }

  function removeDraft(idx: number) {
    setDrafts((cur) => cur.filter((_, i) => i !== idx));
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Missing context');
      if (!solo && !membership) throw new Error('Missing context');
      const gymId = solo ? null : membership!.gymId;
      if (!date) throw new Error('Pick a date');
      const filled = drafts.filter((d) => d.option && d.value.trim().length > 0);
      if (filled.length === 0) {
        throw new Error('Add at least one result');
      }
      const parsed = filled.map((d) => {
        const opt = d.option!;
        const scheme = findScheme(opt.movementKey, opt.schemeKey);
        if (!scheme) throw new Error('Unknown movement');
        const parsedValue = parseValueForMetric(d.value, scheme.metric);
        if (parsedValue == null) {
          throw new Error(
            `Could not parse "${d.value.trim()}" for ${opt.movementName} — ${opt.schemeLabel}`,
          );
        }
        return { draft: d, scheme, parsedValue };
      });

      const performedAtIso = new Date(`${date}T12:00:00`).toISOString();

      const { data: workoutRow, error: workoutError } = await supabase
        .from('tracked_workouts')
        .insert({
          gym_id: gymId,
          profile_id: session.user.id,
          class_session_id: solo ? null : (initialClassSessionId ?? null),
          performed_at: performedAtIso,
          title: title.trim() || null,
          notes: notes.trim() || null,
        })
        .select('id')
        .single();
      if (workoutError) throw workoutError;
      const workoutId = workoutRow!.id;

      const rows = parsed.map(({ draft, scheme, parsedValue }) => {
        const opt = draft.option!;
        const isTime = scheme.metric === 'time';
        return {
          gym_id: gymId,
          profile_id: session.user.id,
          workout_id: workoutId,
          movement_key: opt.movementKey,
          track_key: opt.schemeKey,
          // Storage is kilograms (0181); the member typed in whatever
          // their gym displays.
          value_numeric: isTime
            ? null
            : scheme.metric === 'weight'
              ? displayToKg(parsedValue, weightUnit)
              : parsedValue,
          value_seconds: isTime ? parsedValue : null,
          value_unit: isTime ? null : defaultUnit(scheme.metric),
          notes: draft.notes.trim() || null,
          performed_at: performedAtIso,
        };
      });
      const { error: resultsError } = await supabase
        .from('tracked_movement_results')
        .insert(rows);
      if (resultsError) throw resultsError;
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['tracked-journal'] });
      queryClient.invalidateQueries({ queryKey: ['tracked-results-by-movement'] });
      queryClient.invalidateQueries({ queryKey: ['tracked-results-by-group'] });
      queryClient.invalidateQueries({ queryKey: [MY_REP_MAXES_KEY] });
      queryClient.invalidateQueries({ queryKey: ['athlete-logged-movements'] });
      queryClient.invalidateQueries({ queryKey: ['athlete-workout-count'] });
      setTimeout(() => onClose(), 600);
    },
    onError: (e) => setError(errorMessage(e, 'Could not save workout')),
  });

  // Board 04: the movement picker was a sheet over this one. A step now.
  if (pickerOpenFor !== null) {
    return (
      <Sheet
        visible={visible}
        title="Pick a movement"
        onClose={onClose}
        onBack={() => setPickerOpenFor(null)}
        dialogWidth={620}>
        <SchemePickerStep
          visible
          options={schemeOptions}
          onPick={(opt) => {
            updateDraft(pickerOpenFor, { option: opt });
            setPickerOpenFor(null);
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      title="Record workout"
      subtitle="Log a session and any movement results."
      onClose={onClose}
      dialogWidth={620}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button
              onPress={() => save.mutate()}
              loading={save.isPending}
              success={saved}>
              Save workout
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-4 pb-1">
            <DatePicker label="Date" value={date} onChange={setDate} />
            <Input
              label="Title (optional)"
              value={title}
              onChangeText={setTitle}
              placeholder="Morning session"
              autoCapitalize="sentences"
            />

            <View className="gap-3">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                Results
              </Text>
              {drafts.map((d, idx) => (
                <DraftCard
                  key={idx}
                  draft={d}
                  index={idx}
                  total={drafts.length}
                  onPickOption={() => setPickerOpenFor(idx)}
                  onUpdate={(next) => updateDraft(idx, next)}
                  onRemove={() => removeDraft(idx)}
                />
              ))}
              <Pressable
                onPress={addDraft}
                className="flex-row items-center gap-2 self-start px-3 py-2 rounded-lg border border-dashed border-line-strong dark:border-line-strong-dk">
                <Ionicons name="add" size={16} color={colors.ink2} />
                <Text className="text-ink-2 dark:text-ink-2-dk">
                  Add result
                </Text>
              </Pressable>
            </View>

            <Input
              label="Workout notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Felt strong; warmed up with row"
              multiline
              numberOfLines={3}
              style={{ minHeight: 80, textAlignVertical: 'top' }}
              autoCapitalize="sentences"
            />
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-500 dark:text-red-400 text-[13px]">
              {error}
            </Text>
          ) : null}
      </View>

    </Sheet>
  );
}

function DraftCard({
  draft,
  index,
  total,
  onPickOption,
  onUpdate,
  onRemove,
}: {
  draft: DraftResult;
  index: number;
  total: number;
  onPickOption: () => void;
  onUpdate: (next: Partial<DraftResult>) => void;
  onRemove: () => void;
}) {
  const weightUnit = useGymWeightUnit();
  const colors = useThemeColors();
  const opt = draft.option;
  return (
    <View className="bg-raised dark:bg-raised-dk rounded-xl p-3 gap-3">
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={onPickOption}
          className="flex-1 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 flex-row items-center gap-2 active:opacity-70">
          <View className="flex-1">
            {opt ? (
              <>
                <Text className="text-ink dark:text-ink-dk font-medium text-sm">
                  {opt.movementName}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {opt.schemeLabel} · {opt.groupName}
                </Text>
              </>
            ) : (
              <Text className="text-ink-3 dark:text-ink-3-dk text-sm">
                Pick a movement
              </Text>
            )}
          </View>
          <Ionicons name="chevron-down" size={16} color={colors.ink3} />
        </Pressable>
        {total > 1 ? (
          <Pressable
            onPress={onRemove}
            hitSlop={4}
            className="w-9 h-9 rounded-lg items-center justify-center active:bg-sunken dark:active:bg-sunken-dk"
          accessibilityLabel="Close">
            <Ionicons name="close" size={18} color={colors.ink3} />
          </Pressable>
        ) : null}
      </View>
      {opt ? (
        <>
          <Input
            label={valueInputLabel(opt.metric, weightUnit)}
            value={draft.value}
            onChangeText={(v) => onUpdate({ value: v })}
            placeholder={valuePlaceholder(opt.metric)}
            keyboardType={opt.metric === 'time' ? 'default' : 'numeric'}
            inputMode={opt.metric === 'time' ? undefined : 'decimal'}
          />
          <Input
            label="Notes (optional)"
            value={draft.notes}
            onChangeText={(v) => onUpdate({ notes: v })}
            placeholder="Belt + sleeves"
            autoCapitalize="sentences"
          />
        </>
      ) : null}
      <FieldLabel>
        Result {index + 1}
      </FieldLabel>
    </View>
  );
}

function SchemePickerStep({
  visible,
  options,
  onPick,
}: {
  // Kept so the group expansions reset when the sheet leaves this step,
  // the same way they reset when it was a modal of its own.
  visible: boolean;
  options: SchemeOption[];
  onPick: (opt: SchemeOption) => void;
}) {
  const colors = useThemeColors();
  // Group the flat scheme list back by category for navigation.
  const groups = useMemo(() => {
    const byGroup = new Map<
      string,
      { groupName: string; movements: Map<string, { name: string; options: SchemeOption[] }> }
    >();
    for (const opt of options) {
      let g = byGroup.get(opt.groupKey);
      if (!g) {
        g = { groupName: opt.groupName, movements: new Map() };
        byGroup.set(opt.groupKey, g);
      }
      let m = g.movements.get(opt.movementKey);
      if (!m) {
        m = { name: opt.movementName, options: [] };
        g.movements.set(opt.movementKey, m);
      }
      m.options.push(opt);
    }
    return Array.from(byGroup.entries()).map(([key, g]) => ({
      key,
      name: g.groupName,
      movements: Array.from(g.movements.entries()).map(([mk, m]) => ({
        key: mk,
        name: m.name,
        options: m.options,
      })),
    }));
  }, [options]);

  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedMovement, setExpandedMovement] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setExpandedGroup(null);
      setExpandedMovement(null);
    }
  }, [visible]);

  return (
    <View className="gap-2 pb-1">
            {groups.map((g) => (
              <View key={g.key}>
                <Pressable
                  onPress={() =>
                    setExpandedGroup((cur) => (cur === g.key ? null : g.key))
                  }
                  accessibilityRole="button"
                  accessibilityState={{ expanded: expandedGroup === g.key }}
                  className="bg-raised dark:bg-raised-dk rounded-lg px-3 py-2.5 flex-row items-center gap-2 active:opacity-70">
                  <Text className="flex-1 text-ink dark:text-ink-dk font-medium">
                    {g.name}
                  </Text>
                  <Ionicons
                    name={expandedGroup === g.key ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.ink3}
                  />
                </Pressable>
                {expandedGroup === g.key ? (
                  <View className="pt-2 pl-3 gap-2">
                    {g.movements.map((m) => (
                      <View key={m.key}>
                        <Pressable
                          onPress={() =>
                            setExpandedMovement((cur) =>
                              cur === m.key ? null : m.key,
                            )
                          }
                          accessibilityRole="button"
                          accessibilityState={{ expanded: expandedMovement === m.key }}
                          className="rounded-lg px-3 py-2 flex-row items-center gap-2 active:opacity-70">
                          <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm">
                            {m.name}
                          </Text>
                          <Ionicons
                            name={
                              expandedMovement === m.key
                                ? 'chevron-up'
                                : 'chevron-down'
                            }
                            size={14}
                            color={colors.ink3}
                          />
                        </Pressable>
                        {expandedMovement === m.key ? (
                          <View className="pl-3 gap-1">
                            {m.options.map((opt) => (
                              <Pressable
                                key={`${opt.movementKey}-${opt.schemeKey}`}
                                onPress={() => onPick(opt)}
                                className="rounded-lg px-3 py-2 active:bg-raised dark:active:bg-raised-dk">
                                <Text className="text-ink dark:text-ink-dk text-sm">
                                  {opt.schemeLabel}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
      ))}
    </View>
  );
}

function valueInputLabel(metric: Metric, weightUnit: WeightUnit): string {
  switch (metric) {
    case 'weight':
      return `Weight (${weightUnit})`;
    case 'time':
      return 'Time (MM:SS or HH:MM:SS)';
    case 'reps':
      return 'Reps';
    case 'calories':
      return 'Calories';
    case 'distance':
      return 'Distance (m)';
  }
}

function valuePlaceholder(metric: Metric): string {
  switch (metric) {
    case 'weight':
      return '100';
    case 'time':
      return '4:32';
    case 'reps':
      return '20';
    case 'calories':
      return '85';
    case 'distance':
      return '120';
  }
}

function parseValueForMetric(input: string, metric: Metric): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (metric === 'time') return parseDuration(trimmed);
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  if (metric === 'reps') return Math.round(n);
  return n;
}
