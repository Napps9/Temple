import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Button } from './Button';
import { DatePicker } from './DatePicker';
import { Input } from './Input';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { findMovement, MOVEMENT_GROUPS } from '@/lib/movements';
import {
  categoryLabel,
  categoryToTitle,
  formatLabel,
  parseSections,
  SECTION_CATEGORIES,
  SECTION_FORMATS,
  titleMatchesAnyCategory,
  type Section,
  type SectionCategoryKey,
  type SectionFormatKey,
} from '@/lib/programming';
import { supabase } from '@/lib/supabase';
import {
  emptyEntryDraft,
  entryDraftIsEmpty,
  entryLabelFor,
  FORMAT_SHAPES,
  type EntryMetric,
  type SectionEntryDraft,
} from '@/lib/track-sections';
import { parseDuration } from '@/lib/track';
import { useSavedFlag } from '@/lib/useSavedFlag';

type MovementTagDraft = {
  movement_key: string;
  track_key: string | null;
};

type SectionDraft = {
  section_category: SectionCategoryKey | null;
  section_format: SectionFormatKey | null;
  title: string;
  body: string;
  notes: string;
  // Aggregate fields — only meaningful when the format is aggregate-first.
  total_time_seconds: string;
  total_rounds: string;
  total_extra_reps: string;
  did_not_finish: boolean;
  free_text_result: string;
  // Entries — for entries-only formats and optional expand on aggregate-first.
  entries: SectionEntryDraft[];
  // PR 3 additions:
  source_programming_id: string | null;
  movement_tags: MovementTagDraft[];
};

function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function emptyDraft(): SectionDraft {
  return {
    section_category: null,
    section_format: null,
    title: '',
    body: '',
    notes: '',
    total_time_seconds: '',
    total_rounds: '',
    total_extra_reps: '',
    did_not_finish: false,
    free_text_result: '',
    entries: [],
    source_programming_id: null,
    movement_tags: [],
  };
}

function draftFromProgrammedSection(args: {
  section: Section;
  format: SectionFormatKey;
  programmingId: string;
}): SectionDraft {
  const { section, format, programmingId } = args;
  const shape = FORMAT_SHAPES[format];
  const entries =
    shape.kind === 'entries_only'
      ? Array.from({ length: shape.defaultEntries }, () => emptyEntryDraft())
      : [];
  return {
    section_category: section.section_category,
    section_format: format,
    title: section.title,
    body: section.body,
    notes: '',
    total_time_seconds: '',
    total_rounds: '',
    total_extra_reps: '',
    did_not_finish: false,
    free_text_result: '',
    entries,
    source_programming_id: programmingId,
    movement_tags: [],
  };
}

type ProgrammedSectionForDay = {
  programming_id: string;
  class_type_id: string;
  class_type_name: string;
  class_type_color: string;
  section: Section;
};

function isEmptyDraft(d: SectionDraft): boolean {
  return (
    d.section_category === null &&
    d.section_format === null &&
    d.title.trim() === '' &&
    d.body.trim() === '' &&
    d.notes.trim() === '' &&
    d.movement_tags.length === 0
  );
}

export function RecordWorkoutModal({
  visible,
  onClose,
  initialDate,
  initialClassSessionId,
  initialTitle,
}: {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
  initialClassSessionId?: string | null;
  initialTitle?: string | null;
}) {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();

  const [date, setDate] = useState<string>(initialDate ?? todayLocalIso());
  const [workoutTitle, setWorkoutTitle] = useState<string>(initialTitle ?? '');
  const [workoutNotes, setWorkoutNotes] = useState<string>('');
  const [drafts, setDrafts] = useState<SectionDraft[]>([emptyDraft()]);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<
    { idx: number; kind: 'category' | 'format' } | null
  >(null);
  const [movementPickerForIdx, setMovementPickerForIdx] = useState<
    number | null
  >(null);
  const [saved, markSaved] = useSavedFlag();

  useEffect(() => {
    if (!visible) return;
    setDate(initialDate ?? todayLocalIso());
    setWorkoutTitle(initialTitle ?? '');
    setWorkoutNotes('');
    setDrafts([emptyDraft()]);
    setError(null);
    setPickerOpenFor(null);
    setMovementPickerForIdx(null);
  }, [visible, initialDate, initialTitle]);

  // Pre-fill source: any programming on this date for class types the
  // member is permitted to see. RLS on class_programming already gates
  // on user_belongs_to, so we fetch the date directly. Multi-class-type
  // days are grouped client-side and presented as separate pre-fill
  // chips.
  const programmingQuery = useQuery({
    queryKey: ['record-workout-programming', membership?.gymId, date],
    enabled: !!membership?.gymId && !!date && visible,
    queryFn: async (): Promise<ProgrammedSectionForDay[]> => {
      const { data, error: err } = await supabase
        .from('class_programming')
        .select('id, class_type_id, sections, class_types(name, color)')
        .eq('date', date);
      if (err) throw err;
      const out: ProgrammedSectionForDay[] = [];
      for (const row of (data ?? []) as unknown as {
        id: string;
        class_type_id: string;
        sections: unknown;
        class_types: { name: string; color: string } | null;
      }[]) {
        const sections = parseSections(row.sections);
        for (const s of sections) {
          out.push({
            programming_id: row.id,
            class_type_id: row.class_type_id,
            class_type_name: row.class_types?.name ?? 'Class',
            class_type_color: row.class_types?.color ?? '#2563EB',
            section: s,
          });
        }
      }
      return out;
    },
  });

  const programmingByClassType = useMemo(() => {
    const map = new Map<
      string,
      {
        class_type_id: string;
        class_type_name: string;
        class_type_color: string;
        sections: ProgrammedSectionForDay[];
      }
    >();
    for (const row of programmingQuery.data ?? []) {
      const existing = map.get(row.class_type_id);
      if (existing) {
        existing.sections.push(row);
      } else {
        map.set(row.class_type_id, {
          class_type_id: row.class_type_id,
          class_type_name: row.class_type_name,
          class_type_color: row.class_type_color,
          sections: [row],
        });
      }
    }
    return Array.from(map.values());
  }, [programmingQuery.data]);

  function prefillFromClassType(classTypeId: string) {
    const group = programmingByClassType.find(
      (g) => g.class_type_id === classTypeId,
    );
    if (!group) return;
    const newDrafts: SectionDraft[] = group.sections.map((row) =>
      draftFromProgrammedSection({
        section: row.section,
        format: row.section.section_format,
        programmingId: row.programming_id,
      }),
    );
    if (newDrafts.length === 0) return;
    setDrafts((cur) => {
      // If the user hasn't touched anything yet (single empty draft),
      // replace it; otherwise append the pre-filled sections.
      if (cur.length === 1 && isEmptyDraft(cur[0])) return newDrafts;
      return [...cur, ...newDrafts];
    });
  }

  function updateDraft(idx: number, next: Partial<SectionDraft>) {
    setDrafts((cur) =>
      cur.map((d, i) => (i === idx ? { ...d, ...next } : d)),
    );
  }

  function pickCategory(idx: number, key: SectionCategoryKey) {
    setDrafts((cur) =>
      cur.map((d, i) => {
        if (i !== idx) return d;
        const title = titleMatchesAnyCategory(d.title)
          ? categoryToTitle(key)
          : d.title;
        return { ...d, section_category: key, title };
      }),
    );
  }

  function pickFormat(idx: number, key: SectionFormatKey) {
    setDrafts((cur) =>
      cur.map((d, i) => {
        if (i !== idx) return d;
        const shape = FORMAT_SHAPES[key];
        // Seed entries with the default count for entries-only
        // formats so the member sees rows to fill immediately.
        const entries =
          shape.kind === 'entries_only' && d.entries.length === 0
            ? Array.from({ length: shape.defaultEntries }, () =>
                emptyEntryDraft(),
              )
            : d.entries;
        return { ...d, section_format: key, entries };
      }),
    );
  }

  function addDraft() {
    setDrafts((cur) => [...cur, emptyDraft()]);
  }

  function removeDraft(idx: number) {
    setDrafts((cur) => cur.filter((_, i) => i !== idx));
  }

  function updateEntry(
    draftIdx: number,
    entryIdx: number,
    next: Partial<SectionEntryDraft>,
  ) {
    setDrafts((cur) =>
      cur.map((d, i) => {
        if (i !== draftIdx) return d;
        return {
          ...d,
          entries: d.entries.map((e, j) =>
            j === entryIdx ? { ...e, ...next } : e,
          ),
        };
      }),
    );
  }

  function addEntry(draftIdx: number) {
    setDrafts((cur) =>
      cur.map((d, i) =>
        i === draftIdx ? { ...d, entries: [...d.entries, emptyEntryDraft()] } : d,
      ),
    );
  }

  function removeEntry(draftIdx: number, entryIdx: number) {
    setDrafts((cur) =>
      cur.map((d, i) =>
        i === draftIdx
          ? { ...d, entries: d.entries.filter((_, j) => j !== entryIdx) }
          : d,
      ),
    );
  }

  function addTag(draftIdx: number, tag: MovementTagDraft) {
    setDrafts((cur) =>
      cur.map((d, i) => {
        if (i !== draftIdx) return d;
        // De-dup: same movement_key + track_key won't double up.
        const exists = d.movement_tags.some(
          (t) => t.movement_key === tag.movement_key && t.track_key === tag.track_key,
        );
        if (exists) return d;
        return { ...d, movement_tags: [...d.movement_tags, tag] };
      }),
    );
  }

  function removeTag(draftIdx: number, tagIdx: number) {
    setDrafts((cur) =>
      cur.map((d, i) =>
        i === draftIdx
          ? {
              ...d,
              movement_tags: d.movement_tags.filter((_, j) => j !== tagIdx),
            }
          : d,
      ),
    );
  }

  function close() {
    setError(null);
    setPickerOpenFor(null);
    onClose();
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !session) throw new Error('Missing context');
      if (!date) throw new Error('Pick a date');

      // Drop fully empty drafts silently.
      const meaningful = drafts.filter(
        (d) =>
          d.section_category !== null ||
          d.section_format !== null ||
          d.title.trim().length > 0 ||
          d.body.trim().length > 0 ||
          d.notes.trim().length > 0,
      );
      if (meaningful.length === 0) {
        throw new Error('Add at least one section');
      }
      for (const d of meaningful) {
        if (!d.section_category) {
          throw new Error('Each section needs a category');
        }
        if (!d.section_format) {
          throw new Error('Each section needs a format');
        }
      }

      const performedAtIso = new Date(`${date}T12:00:00`).toISOString();

      // 1. Insert the workout header.
      const { data: workoutRow, error: workoutError } = await supabase
        .from('tracked_workouts')
        .insert({
          gym_id: membership.gymId,
          profile_id: session.user.id,
          class_session_id: initialClassSessionId ?? null,
          performed_at: performedAtIso,
          title: workoutTitle.trim() || null,
          notes: workoutNotes.trim() || null,
        })
        .select('id')
        .single();
      if (workoutError) throw workoutError;
      const workoutId = workoutRow!.id;

      // 2. Insert sections (preserve order via sort_order).
      const sectionInserts = meaningful.map((d, i) => buildSectionInsert({
        gymId: membership.gymId,
        profileId: session.user.id,
        workoutId,
        draft: d,
        sortOrder: i,
      }));
      const { data: insertedSections, error: sectionsError } = await supabase
        .from('tracked_workout_sections')
        .insert(sectionInserts)
        .select('id, sort_order');
      if (sectionsError) throw sectionsError;

      // 3. Insert entries for each section that has any.
      const sortedSections = (insertedSections ?? []).slice().sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      const entryRows: ReturnType<typeof buildEntryInsert>[] = [];
      meaningful.forEach((d, i) => {
        const sectionId = sortedSections[i]?.id;
        if (!sectionId) return;
        const format = d.section_format!;
        d.entries.forEach((e, j) => {
          if (entryDraftIsEmpty(e, format)) return;
          entryRows.push(
            buildEntryInsert({
              gymId: membership.gymId,
              profileId: session.user.id,
              sectionId,
              entryIdx: j,
              draft: e,
              format,
            }),
          );
        });
      });
      if (entryRows.length > 0) {
        const { error: entriesError } = await supabase
          .from('tracked_section_entries')
          .insert(entryRows);
        if (entriesError) throw entriesError;
      }

      // 4. Insert movement tags for sections that have any.
      const tagRows: {
        gym_id: string;
        profile_id: string;
        section_id: string;
        movement_key: string;
        track_key: string | null;
        performed_at: string;
      }[] = [];
      meaningful.forEach((d, i) => {
        const sectionId = sortedSections[i]?.id;
        if (!sectionId) return;
        for (const tag of d.movement_tags) {
          tagRows.push({
            gym_id: membership.gymId,
            profile_id: session.user.id,
            section_id: sectionId,
            movement_key: tag.movement_key,
            track_key: tag.track_key,
            performed_at: performedAtIso,
          });
        }
      });
      if (tagRows.length > 0) {
        const { error: tagsError } = await supabase
          .from('tracked_section_movement_tags')
          .insert(tagRows);
        if (tagsError) throw tagsError;
      }
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['tracked-journal'] });
      queryClient.invalidateQueries({ queryKey: ['tracked-results-by-movement'] });
      queryClient.invalidateQueries({ queryKey: ['tracked-results-by-group'] });
      setTimeout(() => close(), 600);
    },
    onError: (e) => setError(errorMessage(e, 'Could not save workout')),
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}>
      <Pressable
        onPress={close}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-5 max-h-[92vh]">
          <View className="gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
              Record workout
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Add sections from today's session and log your results.
            </Text>
          </View>

          <ScrollView className="max-h-[62vh]" contentContainerClassName="gap-4">
            <DatePicker label="Date" value={date} onChange={setDate} />
            <Input
              label="Workout title (optional)"
              value={workoutTitle}
              onChangeText={setWorkoutTitle}
              placeholder="Morning session"
              autoCapitalize="sentences"
            />
            {programmingByClassType.length > 0 ? (
              <View className="gap-2 bg-primary/5 border border-primary/20 rounded-xl p-3">
                <Text className="text-gray-700 dark:text-gray-200 text-xs font-semibold uppercase tracking-widest">
                  Pre-fill from today's programming
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {programmingByClassType.map((g) => (
                    <Pressable
                      key={g.class_type_id}
                      onPress={() => prefillFromClassType(g.class_type_id)}
                      className="flex-row items-center gap-2 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-1.5 active:opacity-70">
                      <View
                        style={{ backgroundColor: g.class_type_color }}
                        className="w-2 h-2 rounded-full"
                      />
                      <Text className="text-gray-900 dark:text-gray-50 text-xs font-medium">
                        {g.class_type_name}
                      </Text>
                      <Text className="text-gray-500 dark:text-gray-400 text-[10px]">
                        {g.sections.length}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            <View className="gap-3">
              {drafts.map((d, idx) => (
                <SectionDraftCard
                  key={idx}
                  draft={d}
                  removable={drafts.length > 1}
                  onPickCategory={() =>
                    setPickerOpenFor({ idx, kind: 'category' })
                  }
                  onPickFormat={() =>
                    setPickerOpenFor({ idx, kind: 'format' })
                  }
                  onUpdate={(next) => updateDraft(idx, next)}
                  onUpdateEntry={(entryIdx, next) =>
                    updateEntry(idx, entryIdx, next)
                  }
                  onAddEntry={() => addEntry(idx)}
                  onRemoveEntry={(entryIdx) => removeEntry(idx, entryIdx)}
                  onAddTag={() => setMovementPickerForIdx(idx)}
                  onRemoveTag={(tagIdx) => removeTag(idx, tagIdx)}
                  onRemove={() => removeDraft(idx)}
                />
              ))}
              <Pressable
                onPress={addDraft}
                className="flex-row items-center gap-2 self-start px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                <Ionicons name="add" size={16} color="#6B7280" />
                <Text className="text-gray-500 dark:text-gray-400">
                  Add section
                </Text>
              </Pressable>
            </View>
            <Input
              label="Workout notes (optional)"
              value={workoutNotes}
              onChangeText={setWorkoutNotes}
              placeholder="Felt strong; warmed up with row"
              multiline
              numberOfLines={3}
              style={{ minHeight: 80, textAlignVertical: 'top' }}
              autoCapitalize="sentences"
            />
          </ScrollView>

          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="secondary" onPress={close}>
                Cancel
              </Button>
            </View>
            <View className="flex-1">
              <Button
                onPress={() => save.mutate()}
                loading={save.isPending}
                success={saved}>
                Save workout
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>

      <PickerModal
        visible={pickerOpenFor !== null}
        kind={pickerOpenFor?.kind ?? 'category'}
        onPick={(key) => {
          if (!pickerOpenFor) return;
          if (pickerOpenFor.kind === 'category') {
            pickCategory(pickerOpenFor.idx, key as SectionCategoryKey);
          } else {
            pickFormat(pickerOpenFor.idx, key as SectionFormatKey);
          }
          setPickerOpenFor(null);
        }}
        onClose={() => setPickerOpenFor(null)}
      />

      <MovementTagPickerModal
        visible={movementPickerForIdx !== null}
        onPick={(tag) => {
          if (movementPickerForIdx !== null) addTag(movementPickerForIdx, tag);
          setMovementPickerForIdx(null);
        }}
        onClose={() => setMovementPickerForIdx(null)}
      />
    </Modal>
  );
}

function SectionDraftCard({
  draft,
  removable,
  onPickCategory,
  onPickFormat,
  onUpdate,
  onUpdateEntry,
  onAddEntry,
  onRemoveEntry,
  onAddTag,
  onRemoveTag,
  onRemove,
}: {
  draft: SectionDraft;
  removable: boolean;
  onPickCategory: () => void;
  onPickFormat: () => void;
  onUpdate: (next: Partial<SectionDraft>) => void;
  onUpdateEntry: (entryIdx: number, next: Partial<SectionEntryDraft>) => void;
  onAddEntry: () => void;
  onRemoveEntry: (entryIdx: number) => void;
  onAddTag: () => void;
  onRemoveTag: (tagIdx: number) => void;
  onRemove: () => void;
}) {
  return (
    <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
          Section
        </Text>
        {removable ? (
          <Pressable
            onPress={onRemove}
            hitSlop={4}
            className="w-8 h-8 rounded-lg items-center justify-center active:bg-gray-100 dark:active:bg-gray-700">
            <Ionicons name="close" size={18} color="#9CA3AF" />
          </Pressable>
        ) : null}
      </View>

      <PickerButton
        label="Category"
        value={
          draft.section_category ? categoryLabel(draft.section_category) : null
        }
        placeholder="Pick a category"
        onPress={onPickCategory}
      />

      <Input
        label="Title"
        value={draft.title}
        onChangeText={(v) => onUpdate({ title: v })}
        placeholder={
          draft.section_category
            ? categoryToTitle(draft.section_category)
            : 'Auto-filled from category'
        }
        autoCapitalize="words"
      />

      <PickerButton
        label="Scoring format"
        value={
          draft.section_format ? formatLabel(draft.section_format) : null
        }
        placeholder="Pick a scoring format"
        onPress={onPickFormat}
      />

      {draft.section_format ? (
        <FormatInputs
          draft={draft}
          format={draft.section_format}
          onUpdate={onUpdate}
          onUpdateEntry={onUpdateEntry}
          onAddEntry={onAddEntry}
          onRemoveEntry={onRemoveEntry}
        />
      ) : null}

      <MovementTagList
        tags={draft.movement_tags}
        onAdd={onAddTag}
        onRemove={onRemoveTag}
      />

      <Input
        label="Notes (optional)"
        value={draft.notes}
        onChangeText={(v) => onUpdate({ notes: v })}
        placeholder="Felt heavy; belt + sleeves"
        autoCapitalize="sentences"
      />
    </View>
  );
}

function MovementTagList({
  tags,
  onAdd,
  onRemove,
}: {
  tags: MovementTagDraft[];
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        Tag movements (optional)
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {tags.map((t, j) => {
          const meta = findMovement(t.movement_key);
          const label = meta
            ? `${meta.movement.name}${t.track_key ? ` · ${trackKeyLabel(t.movement_key, t.track_key)}` : ''}`
            : t.movement_key;
          return (
            <Pressable
              key={j}
              onPress={() => onRemove(j)}
              className="flex-row items-center gap-1 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2.5 py-1 active:opacity-70">
              <Text className="text-gray-900 dark:text-gray-50 text-xs">
                {label}
              </Text>
              <Ionicons name="close" size={12} color="#9CA3AF" />
            </Pressable>
          );
        })}
        <Pressable
          onPress={onAdd}
          className="flex-row items-center gap-1 rounded-full border border-dashed border-gray-300 dark:border-gray-600 px-2.5 py-1 active:opacity-70">
          <Ionicons name="add" size={12} color="#6B7280" />
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Add tag
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function trackKeyLabel(movementKey: string, trackKey: string): string {
  const meta = findMovement(movementKey);
  return meta?.movement.schemes.find((s) => s.key === trackKey)?.label ?? trackKey;
}

function FormatInputs({
  draft,
  format,
  onUpdate,
  onUpdateEntry,
  onAddEntry,
  onRemoveEntry,
}: {
  draft: SectionDraft;
  format: SectionFormatKey;
  onUpdate: (next: Partial<SectionDraft>) => void;
  onUpdateEntry: (entryIdx: number, next: Partial<SectionEntryDraft>) => void;
  onAddEntry: () => void;
  onRemoveEntry: (entryIdx: number) => void;
}) {
  const shape = FORMAT_SHAPES[format];

  if (shape.kind === 'notes_only') {
    if (shape.freeText) {
      return (
        <Input
          label="Result"
          value={draft.free_text_result}
          onChangeText={(v) => onUpdate({ free_text_result: v })}
          placeholder="3 rounds, scaled to 5kg DBs"
          autoCapitalize="sentences"
        />
      );
    }
    return null;
  }

  return (
    <View className="gap-3">
      {shape.kind === 'aggregate_first' ? (
        <AggregateInputs draft={draft} format={format} onUpdate={onUpdate} />
      ) : null}
      <EntriesTable
        format={format}
        entries={draft.entries}
        onUpdateEntry={onUpdateEntry}
        onAddEntry={onAddEntry}
        onRemoveEntry={onRemoveEntry}
        collapsible={shape.kind === 'aggregate_first'}
        entryMetrics={
          shape.kind === 'entries_only'
            ? shape.entryMetrics
            : (shape.entryMetrics ?? ['weight', 'reps'])
        }
      />
    </View>
  );
}

function AggregateInputs({
  draft,
  format,
  onUpdate,
}: {
  draft: SectionDraft;
  format: SectionFormatKey;
  onUpdate: (next: Partial<SectionDraft>) => void;
}) {
  const shape = FORMAT_SHAPES[format];
  if (shape.kind !== 'aggregate_first') return null;
  return (
    <View className="gap-3">
      {shape.aggregateFields.includes('total_time_seconds') ? (
        <Input
          label="Total time (MM:SS or HH:MM:SS)"
          value={draft.total_time_seconds}
          onChangeText={(v) => onUpdate({ total_time_seconds: v })}
          placeholder="8:42"
        />
      ) : null}
      {shape.aggregateFields.includes('total_rounds') ? (
        <Input
          label="Rounds"
          value={draft.total_rounds}
          onChangeText={(v) => onUpdate({ total_rounds: v })}
          placeholder="7"
          keyboardType="numeric"
          inputMode="numeric"
        />
      ) : null}
      {shape.aggregateFields.includes('total_extra_reps') ? (
        <Input
          label="Extra reps"
          value={draft.total_extra_reps}
          onChangeText={(v) => onUpdate({ total_extra_reps: v })}
          placeholder="5"
          keyboardType="numeric"
          inputMode="numeric"
        />
      ) : null}
      {shape.aggregateFields.includes('did_not_finish') ? (
        <View className="flex-row items-center gap-3">
          <Switch
            value={draft.did_not_finish}
            onValueChange={(v) => onUpdate({ did_not_finish: v })}
          />
          <Text className="text-gray-700 dark:text-gray-200 text-sm">
            Did not finish (capped)
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function EntriesTable({
  format,
  entries,
  entryMetrics,
  onUpdateEntry,
  onAddEntry,
  onRemoveEntry,
  collapsible,
}: {
  format: SectionFormatKey;
  entries: SectionEntryDraft[];
  entryMetrics: EntryMetric[];
  onUpdateEntry: (entryIdx: number, next: Partial<SectionEntryDraft>) => void;
  onAddEntry: () => void;
  onRemoveEntry: (entryIdx: number) => void;
  collapsible: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsible);
  if (collapsible && !expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        className="flex-row items-center gap-2 self-start px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
        <Ionicons name="add" size={14} color="#6B7280" />
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Add per-set details
        </Text>
      </Pressable>
    );
  }
  return (
    <View className="gap-2">
      {entries.map((e, j) => (
        <View
          key={j}
          className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-gray-700 dark:text-gray-200 text-xs font-semibold uppercase tracking-wider">
              {entryLabelFor(format, j + 1)}
            </Text>
            <Pressable
              onPress={() => onRemoveEntry(j)}
              hitSlop={4}
              className="w-7 h-7 rounded items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
              <Ionicons name="close" size={14} color="#9CA3AF" />
            </Pressable>
          </View>
          <EntryFields
            entry={e}
            metrics={entryMetrics}
            onUpdate={(next) => onUpdateEntry(j, next)}
          />
        </View>
      ))}
      <Pressable
        onPress={onAddEntry}
        className="flex-row items-center gap-2 self-start px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
        <Ionicons name="add" size={14} color="#6B7280" />
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Add row
        </Text>
      </Pressable>
    </View>
  );
}

function EntryFields({
  entry,
  metrics,
  onUpdate,
}: {
  entry: SectionEntryDraft;
  metrics: EntryMetric[];
  onUpdate: (next: Partial<SectionEntryDraft>) => void;
}) {
  return (
    <View className="gap-2">
      {metrics.includes('weight') ? (
        <Input
          label="Weight (kg)"
          value={entry.weight}
          onChangeText={(v) => onUpdate({ weight: v })}
          placeholder="100"
          keyboardType="numeric"
          inputMode="decimal"
        />
      ) : null}
      {metrics.includes('reps') ? (
        <Input
          label="Reps"
          value={entry.reps}
          onChangeText={(v) => onUpdate({ reps: v })}
          placeholder="5"
          keyboardType="numeric"
          inputMode="numeric"
        />
      ) : null}
      {metrics.includes('time') ? (
        <Input
          label="Time (MM:SS)"
          value={entry.time}
          onChangeText={(v) => onUpdate({ time: v })}
          placeholder="1:30"
        />
      ) : null}
      {metrics.includes('distance') ? (
        <Input
          label="Distance (m)"
          value={entry.distance}
          onChangeText={(v) => onUpdate({ distance: v })}
          placeholder="500"
          keyboardType="numeric"
          inputMode="decimal"
        />
      ) : null}
      {metrics.includes('calories') ? (
        <Input
          label="Calories"
          value={entry.calories}
          onChangeText={(v) => onUpdate({ calories: v })}
          placeholder="15"
          keyboardType="numeric"
          inputMode="numeric"
        />
      ) : null}
      {metrics.includes('done') ? (
        <View className="flex-row items-center gap-2">
          <Switch
            value={entry.done}
            onValueChange={(v) => onUpdate({ done: v })}
          />
          <Text className="text-gray-700 dark:text-gray-200 text-sm">Done</Text>
        </View>
      ) : null}
    </View>
  );
}

function PickerButton({
  label,
  value,
  placeholder,
  onPress,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onPress: () => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label}
      </Text>
      <Pressable
        onPress={onPress}
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 flex-row items-center gap-2 active:opacity-70">
        <Text
          className={
            value
              ? 'flex-1 text-gray-900 dark:text-gray-50 text-base'
              : 'flex-1 text-gray-400 dark:text-gray-500 text-base'
          }>
          {value ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
      </Pressable>
    </View>
  );
}

function MovementTagPickerModal({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (tag: MovementTagDraft) => void;
  onClose: () => void;
}) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedMovement, setExpandedMovement] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setExpandedGroup(null);
      setExpandedMovement(null);
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-md gap-3 max-h-[80vh]">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Tag a movement
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Tag the movement (optionally with a rep scheme) so it lands
            in your per-movement Journal.
          </Text>
          <ScrollView className="max-h-[60vh]" contentContainerClassName="gap-2">
            {MOVEMENT_GROUPS.map((g) => (
              <View key={g.key}>
                <Pressable
                  onPress={() =>
                    setExpandedGroup((cur) => (cur === g.key ? null : g.key))
                  }
                  className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2.5 flex-row items-center gap-2 active:opacity-70">
                  <Text className="flex-1 text-gray-900 dark:text-gray-50 font-medium">
                    {g.name}
                  </Text>
                  <Ionicons
                    name={expandedGroup === g.key ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="#9CA3AF"
                  />
                </Pressable>
                {expandedGroup === g.key ? (
                  <View className="pt-2 pl-3 gap-2">
                    {g.movements.map((m) => (
                      <View key={m.key}>
                        <View className="flex-row items-center gap-2">
                          <Pressable
                            onPress={() =>
                              onPick({ movement_key: m.key, track_key: null })
                            }
                            className="flex-1 rounded-lg px-3 py-2 active:bg-gray-100 dark:active:bg-gray-800">
                            <Text className="text-gray-900 dark:text-gray-50 text-sm">
                              {m.name}
                            </Text>
                            <Text className="text-gray-400 dark:text-gray-500 text-[10px]">
                              No rep scheme
                            </Text>
                          </Pressable>
                          {m.schemes.length > 0 ? (
                            <Pressable
                              onPress={() =>
                                setExpandedMovement((cur) =>
                                  cur === m.key ? null : m.key,
                                )
                              }
                              hitSlop={4}
                              className="w-8 h-8 rounded items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
                              <Ionicons
                                name={
                                  expandedMovement === m.key
                                    ? 'chevron-up'
                                    : 'chevron-down'
                                }
                                size={14}
                                color="#9CA3AF"
                              />
                            </Pressable>
                          ) : null}
                        </View>
                        {expandedMovement === m.key ? (
                          <View className="pl-3 gap-1">
                            {m.schemes.map((s) => (
                              <Pressable
                                key={s.key}
                                onPress={() =>
                                  onPick({
                                    movement_key: m.key,
                                    track_key: s.key,
                                  })
                                }
                                className="rounded-lg px-3 py-2 active:bg-gray-100 dark:active:bg-gray-800">
                                <Text className="text-primary text-xs">
                                  {s.label}
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
          </ScrollView>
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PickerModal({
  visible,
  kind,
  onPick,
  onClose,
}: {
  visible: boolean;
  kind: 'category' | 'format';
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const items = kind === 'category' ? SECTION_CATEGORIES : SECTION_FORMATS;
  const title = kind === 'category' ? 'Pick a category' : 'Pick a scoring format';
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-md gap-3 max-h-[80vh]">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            {title}
          </Text>
          <ScrollView className="max-h-[60vh]" contentContainerClassName="gap-1">
            {items.map((it) => (
              <Pressable
                key={it.key}
                onPress={() => onPick(it.key)}
                className="rounded-lg px-3 py-3 active:bg-gray-100 dark:active:bg-gray-800">
                <Text className="text-gray-900 dark:text-gray-50">
                  {it.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// =================================================================
// Save helpers — pure functions; honour the aggregate invariant.
// =================================================================

function buildSectionInsert(args: {
  gymId: string;
  profileId: string;
  workoutId: string;
  draft: SectionDraft;
  sortOrder: number;
}) {
  const { gymId, profileId, workoutId, draft, sortOrder } = args;
  const format = draft.section_format!;
  const shape = FORMAT_SHAPES[format];
  const title = draft.title.trim() || categoryToTitle(draft.section_category!);
  const base = {
    gym_id: gymId,
    profile_id: profileId,
    workout_id: workoutId,
    source_programming_id: draft.source_programming_id,
    section_category: draft.section_category!,
    section_format: format,
    title: title || null,
    body: draft.body.trim() || null,
    notes: draft.notes.trim() || null,
    sort_order: sortOrder,
    total_time_seconds: null as number | null,
    total_rounds: null as number | null,
    total_extra_reps: null as number | null,
    did_not_finish: null as boolean | null,
    free_text_result: null as string | null,
  };
  if (shape.kind === 'aggregate_first') {
    if (shape.aggregateFields.includes('total_time_seconds')) {
      const parsed = parseDuration(draft.total_time_seconds);
      if (parsed != null) base.total_time_seconds = parsed;
    }
    if (shape.aggregateFields.includes('total_rounds')) {
      const n = parseInt(draft.total_rounds.trim(), 10);
      if (Number.isFinite(n)) base.total_rounds = n;
    }
    if (shape.aggregateFields.includes('total_extra_reps')) {
      const n = parseInt(draft.total_extra_reps.trim(), 10);
      if (Number.isFinite(n)) base.total_extra_reps = n;
    }
    if (shape.aggregateFields.includes('did_not_finish')) {
      base.did_not_finish = draft.did_not_finish;
    }
  } else if (shape.kind === 'notes_only' && shape.freeText) {
    const t = draft.free_text_result.trim();
    if (t) base.free_text_result = t;
  }
  return base;
}

function buildEntryInsert(args: {
  gymId: string;
  profileId: string;
  sectionId: string;
  entryIdx: number;
  draft: SectionEntryDraft;
  format: SectionFormatKey;
}) {
  const { gymId, profileId, sectionId, entryIdx, draft, format } = args;
  const shape = FORMAT_SHAPES[format];
  // Round-keyed formats use round_index; set-keyed formats leave it null.
  const isRoundKeyed =
    format === 'emom' || format === 'intervals' || format === 'amrap';
  const row = {
    gym_id: gymId,
    profile_id: profileId,
    section_id: sectionId,
    entry_index: entryIdx + 1,
    round_index: isRoundKeyed ? entryIdx + 1 : null,
    weight_numeric: parseNumber(draft.weight),
    weight_unit: draft.weight.trim() ? 'kg' : null,
    reps: parseInt2(draft.reps),
    time_seconds: parseDuration(draft.time.trim()) ?? null,
    distance_numeric: parseNumber(draft.distance),
    distance_unit: draft.distance.trim() ? 'm' : null,
    calories: parseInt2(draft.calories),
    done: shape.kind !== 'notes_only' && draft.done ? true : null,
    notes: draft.notes.trim() || null,
  };
  return row;
}

function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseInt2(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}
