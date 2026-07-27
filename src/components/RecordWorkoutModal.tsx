import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from './Button';
import { DatePicker } from './DatePicker';
import { Input } from './Input';
import { useGymMembership, useSession } from '@/lib/auth';
import { displayToKg, type WeightUnit } from '@/lib/weight';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import { errorMessage } from '@/lib/errors';
import { detectMovementsInText } from '@/lib/movement-detection';
import {
  allGroupsDisciplineFirst,
  findMovement,
  type Discipline,
  type Movement,
  type MovementGroup,
} from '@/lib/movements';
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
import { MY_REP_MAXES_KEY } from '@/lib/useOneRepMaxes';
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
import { useThemeColors } from '@/lib/theme';

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
  total_distance_m: string;
  total_calories: string;
  did_not_finish: boolean;
  free_text_result: string;
  // Entries — for entries-only formats and optional expand on aggregate-first.
  entries: SectionEntryDraft[];
  // PR 3 additions:
  source_programming_id: string | null;
  source_member_programming_id: string | null;
  source_section_index: number | null;
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
    total_distance_m: '',
    total_calories: '',
    did_not_finish: false,
    free_text_result: '',
    entries: [],
    source_programming_id: null,
    source_member_programming_id: null,
    source_section_index: null,
    movement_tags: [],
  };
}

function draftFromProgrammedSection(args: {
  section: Section;
  format: SectionFormatKey;
  programmingId: string | null;
  memberProgrammingId?: string | null;
  sectionIndex: number;
}): SectionDraft {
  const { section, format, programmingId, memberProgrammingId, sectionIndex } =
    args;
  const shape = FORMAT_SHAPES[format];
  const entries =
    shape.kind === 'entries_only'
      ? Array.from({ length: shape.defaultEntries }, () => emptyEntryDraft())
      : [];
  // Auto-tag: scan the programmed title + body for movement aliases
  // and seed the section's tags. Member can edit/remove any before
  // saving.
  const detected = detectMovementsInText(
    `${section.title}\n${section.body}`,
  );
  return {
    section_category: section.section_category,
    section_format: format,
    title: section.title,
    body: section.body,
    notes: '',
    total_time_seconds: '',
    total_rounds: '',
    total_extra_reps: '',
    total_distance_m: '',
    total_calories: '',
    did_not_finish: false,
    free_text_result: '',
    entries,
    source_programming_id: programmingId,
    source_member_programming_id: memberProgrammingId ?? null,
    source_section_index: sectionIndex,
    movement_tags: detected,
  };
}

type ProgrammedSectionForDay = {
  programming_id: string;
  class_type_id: string;
  class_type_name: string;
  class_type_color: string;
  section_index: number;
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
  initialClassTypeId,
  initialTitle,
  discipline = 'crossfit',
}: {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
  initialClassSessionId?: string | null;
  // When the caller already knows which class the member attended (e.g.
  // the post-class nudge on Book), pre-fill that class type's
  // programming automatically instead of making them tap the chip
  // themselves. Omitted by the open-ended entry points (Track, the
  // Programming page's own prompt) where no specific class is known.
  initialClassTypeId?: string | null;
  initialTitle?: string | null;
  discipline?: Discipline;
}) {
  const colors = useThemeColors();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const weightUnit = useGymWeightUnit();
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
  const [editingTag, setEditingTag] = useState<
    { sectionIdx: number; tagIdx: number } | null
  >(null);
  const [saved, markSaved] = useSavedFlag();
  const autoPrefilledRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setDate(initialDate ?? todayLocalIso());
    setWorkoutTitle(initialTitle ?? '');
    setWorkoutNotes('');
    setDrafts([emptyDraft()]);
    setError(null);
    setPickerOpenFor(null);
    setMovementPickerForIdx(null);
    setEditingTag(null);
    autoPrefilledRef.current = false;
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
        for (let i = 0; i < sections.length; i += 1) {
          out.push({
            programming_id: row.id,
            class_type_id: row.class_type_id,
            class_type_name: row.class_types?.name ?? 'Class',
            class_type_color: row.class_types?.color ?? colors.primary,
            section_index: i,
            section: sections[i],
          });
        }
      }
      return out;
    },
  });

  // The member's own individual programming for the date. The profile
  // filter is load-bearing, not an optimisation: a coach recording
  // their own workout passes the staff RLS policy, which would
  // otherwise hand them every member's rows for the day. For members,
  // RLS additionally hides rows when paid access isn't active — an
  // unentitled member simply gets no chip.
  const memberProgrammingQuery = useQuery({
    queryKey: ['record-workout-member-programming', membership?.gymId, date],
    enabled: !!membership?.gymId && !!session?.user.id && !!date && visible,
    queryFn: async (): Promise<{ id: string; sections: Section[] } | null> => {
      const { data, error: err } = await supabase
        .from('member_programming')
        .select('id, sections')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', session!.user.id)
        .eq('date', date)
        .maybeSingle();
      if (err) throw err;
      if (!data) return null;
      return { id: data.id, sections: parseSections(data.sections) };
    },
  });
  const myProgramme = memberProgrammingQuery.data ?? null;

  function prefillFromMemberProgramming() {
    if (!myProgramme || myProgramme.sections.length === 0) return;
    const newDrafts: SectionDraft[] = myProgramme.sections.map(
      (section, i) =>
        draftFromProgrammedSection({
          section,
          format: section.section_format,
          programmingId: null,
          memberProgrammingId: myProgramme.id,
          sectionIndex: i,
        }),
    );
    setDrafts((cur) => {
      if (cur.length === 1 && isEmptyDraft(cur[0])) return newDrafts;
      return [...cur, ...newDrafts];
    });
  }

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
        sectionIndex: row.section_index,
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

  // The system already knows which class the member attended — do the
  // chip tap for them the moment that class type's programming shows
  // up, rather than making them find and press it themselves. Runs
  // once per modal open (autoPrefilledRef reset alongside the other
  // per-open state above); a plain effect rather than folding into the
  // reset effect because programmingQuery resolves asynchronously,
  // after the reset has already run.
  useEffect(() => {
    if (!visible || !initialClassTypeId || autoPrefilledRef.current) return;
    const group = programmingByClassType.find(
      (g) => g.class_type_id === initialClassTypeId,
    );
    if (!group) return;
    autoPrefilledRef.current = true;
    prefillFromClassType(initialClassTypeId);
  }, [visible, initialClassTypeId, programmingByClassType]);

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

  function updateTagTrackKey(
    draftIdx: number,
    tagIdx: number,
    track_key: string | null,
  ) {
    setDrafts((cur) =>
      cur.map((d, i) =>
        i === draftIdx
          ? {
              ...d,
              movement_tags: d.movement_tags.map((t, j) =>
                j === tagIdx ? { ...t, track_key } : t,
              ),
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
              weightUnit,
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
      queryClient.invalidateQueries({ queryKey: ['tracked-journal-count'] });
      queryClient.invalidateQueries({ queryKey: ['tracked-results-by-movement'] });
      queryClient.invalidateQueries({ queryKey: ['tracked-results-by-group'] });
      queryClient.invalidateQueries({ queryKey: [MY_REP_MAXES_KEY] });
      // Feeds the streak tiles + 12-week heatmap, and gates whether that
      // rail shows at all — so the first log makes it appear, not just
      // update.
      queryClient.invalidateQueries({ queryKey: ['workout-streak-days'] });
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
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          role="dialog"
          aria-modal
          accessibilityLabel="Record workout"
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md md:max-w-2xl gap-5 max-h-[92vh]">
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
            {programmingByClassType.length > 0 ||
            (myProgramme?.sections.length ?? 0) > 0 ? (
              <View className="gap-2 bg-primary/5 border border-primary/20 rounded-xl p-3">
                <Text className="text-gray-700 dark:text-gray-200 text-xs font-semibold uppercase tracking-widest">
                  Pre-fill from today's programming
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {(myProgramme?.sections.length ?? 0) > 0 ? (
                    <Pressable
                      onPress={prefillFromMemberProgramming}
                      className="flex-row items-center gap-2 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-1.5 active:opacity-70">
                      <Ionicons name="person" size={10} color={colors.primary} />
                      <Text className="text-gray-900 dark:text-gray-50 text-xs font-medium">
                        Your programme
                      </Text>
                      <Text className="text-gray-500 dark:text-gray-400 text-[10px]">
                        {myProgramme!.sections.length}
                      </Text>
                    </Pressable>
                  ) : null}
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
                  onEditTag={(tagIdx) =>
                    setEditingTag({ sectionIdx: idx, tagIdx })
                  }
                  onRemove={() => removeDraft(idx)}
                />
              ))}
              <Pressable
                onPress={addDraft}
                className="flex-row items-center gap-2 self-start px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                <Ionicons name="add" size={16} color={colors.iconSecondary} />
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
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </Text>
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
        groups={allGroupsDisciplineFirst(discipline)}
        onPick={(tag) => {
          if (movementPickerForIdx !== null) addTag(movementPickerForIdx, tag);
          setMovementPickerForIdx(null);
        }}
        onClose={() => setMovementPickerForIdx(null)}
      />

      <TagEditModal
        visible={editingTag !== null}
        tag={
          editingTag
            ? drafts[editingTag.sectionIdx]?.movement_tags[editingTag.tagIdx] ??
              null
            : null
        }
        onPickScheme={(trackKey) => {
          if (editingTag) {
            updateTagTrackKey(
              editingTag.sectionIdx,
              editingTag.tagIdx,
              trackKey,
            );
          }
          setEditingTag(null);
        }}
        onRemove={() => {
          if (editingTag) {
            removeTag(editingTag.sectionIdx, editingTag.tagIdx);
          }
          setEditingTag(null);
        }}
        onClose={() => setEditingTag(null)}
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
  onEditTag,
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
  onEditTag: (tagIdx: number) => void;
  onRemove: () => void;
}) {
  const colors = useThemeColors();
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
            className="w-8 h-8 rounded-lg items-center justify-center active:bg-gray-100 dark:active:bg-gray-700"
          accessibilityLabel="Close">
            <Ionicons name="close" size={18} color={colors.iconTertiary} />
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

      {draft.body.trim() ? (
        <View className="gap-1">
          <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
            The work
          </Text>
          <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5">
            <Text className="text-gray-700 dark:text-gray-200 text-sm">
              {draft.body}
            </Text>
          </View>
        </View>
      ) : null}

      <MovementTagList
        tags={draft.movement_tags}
        onAdd={onAddTag}
        onEdit={onEditTag}
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
  onEdit,
}: {
  tags: MovementTagDraft[];
  onAdd: () => void;
  onEdit: (idx: number) => void;
}) {
  const colors = useThemeColors();
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
              onPress={() => onEdit(j)}
              className="flex-row items-center gap-1 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2.5 py-1 active:opacity-70">
              <Text className="text-gray-900 dark:text-gray-50 text-xs">
                {label}
              </Text>
              <Ionicons name="chevron-down" size={12} color={colors.iconTertiary} />
            </Pressable>
          );
        })}
        <Pressable
          onPress={onAdd}
          className="flex-row items-center gap-1 rounded-full border border-dashed border-gray-300 dark:border-gray-600 px-2.5 py-1 active:opacity-70">
          <Ionicons name="add" size={12} color={colors.iconSecondary} />
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
      {shape.aggregateFields.includes('total_distance_m') ? (
        <Input
          label="Distance (m)"
          value={draft.total_distance_m}
          onChangeText={(v) => onUpdate({ total_distance_m: v })}
          placeholder="5000"
          keyboardType="numeric"
          inputMode="decimal"
        />
      ) : null}
      {shape.aggregateFields.includes('total_calories') ? (
        <Input
          label="Calories"
          value={draft.total_calories}
          onChangeText={(v) => onUpdate({ total_calories: v })}
          placeholder="120"
          keyboardType="numeric"
          inputMode="numeric"
        />
      ) : null}
      {shape.aggregateFields.includes('total_time_seconds') ? (
        <Input
          label="Total time (MM:SS or HH:MM:SS)"
          value={draft.total_time_seconds}
          onChangeText={(v) => onUpdate({ total_time_seconds: v })}
          placeholder="8:42"
        />
      ) : null}
      {shape.aggregateFields.includes('total_rounds') ||
      shape.aggregateFields.includes('total_extra_reps') ? (
        <View className="flex-row gap-3">
          {shape.aggregateFields.includes('total_rounds') ? (
            <View className="flex-1">
              <Input
                label="Rounds"
                value={draft.total_rounds}
                onChangeText={(v) => onUpdate({ total_rounds: v })}
                placeholder="7"
                keyboardType="numeric"
                inputMode="numeric"
              />
            </View>
          ) : null}
          {shape.aggregateFields.includes('total_extra_reps') ? (
            <View className="flex-1">
              <Input
                label="Extra reps"
                value={draft.total_extra_reps}
                onChangeText={(v) => onUpdate({ total_extra_reps: v })}
                placeholder="5"
                keyboardType="numeric"
                inputMode="numeric"
              />
            </View>
          ) : null}
        </View>
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
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(!collapsible);
  if (collapsible && !expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        className="flex-row items-center gap-2 self-start px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
        <Ionicons name="add" size={14} color={colors.iconSecondary} />
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Add per-set details
        </Text>
      </Pressable>
    );
  }
  return (
    <View className="gap-2">
      {entries.length >= 3 ? (
        <QuickFillBar
          format={format}
          metrics={entryMetrics}
          count={entries.length}
          onApply={(range, values) => {
            for (let i = range.from - 1; i <= range.to - 1; i += 1) {
              if (i < 0 || i >= entries.length) continue;
              onUpdateEntry(i, values);
            }
          }}
        />
      ) : null}
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
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove entry"
              className="w-7 h-7 rounded items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
              <Ionicons name="close" size={14} color={colors.iconTertiary} />
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
        <Ionicons name="add" size={14} color={colors.iconSecondary} />
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Add row
        </Text>
      </Pressable>
    </View>
  );
}

function QuickFillBar({
  format,
  metrics,
  count,
  onApply,
}: {
  format: SectionFormatKey;
  metrics: EntryMetric[];
  count: number;
  onApply: (
    range: { from: number; to: number },
    values: Partial<SectionEntryDraft>,
  ) => void;
}) {
  const colors = useThemeColors();
  const weightUnit = useGymWeightUnit();
  const [expanded, setExpanded] = useState(false);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [time, setTime] = useState('');
  const [distance, setDistance] = useState('');
  const [calories, setCalories] = useState('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState(String(count));

  // Re-seed the upper bound when the row count changes (member added /
  // removed entries) — only when the field still matches the prior
  // count so a manual edit survives.
  useEffect(() => {
    setTo((cur) => {
      const n = parseInt(cur, 10);
      return Number.isFinite(n) && n > count ? String(count) : cur;
    });
  }, [count]);

  const rowLabel =
    format === 'emom'
      ? 'minutes'
      : format === 'intervals'
        ? 'intervals'
        : 'sets';

  if (!expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        className="flex-row items-center gap-2 self-start px-3 py-1.5 rounded-full bg-primary/10 active:opacity-70">
        <Ionicons name="flash-outline" size={14} color={colors.primary} />
        <Text className="text-primary text-xs font-medium">
          Quick fill {rowLabel}
        </Text>
      </Pressable>
    );
  }

  function apply() {
    const fromN = Math.max(1, parseInt(from, 10) || 1);
    const toN = Math.max(fromN, Math.min(count, parseInt(to, 10) || count));
    const values: Partial<SectionEntryDraft> = {};
    if (metrics.includes('weight') && weight.trim()) values.weight = weight.trim();
    if (metrics.includes('reps') && reps.trim()) values.reps = reps.trim();
    if (metrics.includes('time') && time.trim()) values.time = time.trim();
    if (metrics.includes('distance') && distance.trim()) values.distance = distance.trim();
    if (metrics.includes('calories') && calories.trim()) values.calories = calories.trim();
    if (Object.keys(values).length === 0) return;
    onApply({ from: fromN, to: toN }, values);
  }

  return (
    <View className="bg-primary/5 border border-primary/20 rounded-lg p-3 gap-3">
      <View className="flex-row items-center gap-2">
        <Ionicons name="flash-outline" size={14} color={colors.primary} />
        <Text className="flex-1 text-primary text-xs font-semibold uppercase tracking-wider">
          Quick fill {rowLabel}
        </Text>
        <Pressable
          onPress={() => setExpanded(false)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close quick fill"
          className="w-6 h-6 rounded items-center justify-center active:opacity-70">
          <Ionicons name="close" size={14} color={colors.iconTertiary} />
        </Pressable>
      </View>

      <View className="flex-row items-end gap-2">
        <View className="flex-1">
          <Input
            label="From"
            value={from}
            onChangeText={setFrom}
            keyboardType="numeric"
            inputMode="numeric"
          />
        </View>
        <View className="flex-1">
          <Input
            label="To"
            value={to}
            onChangeText={setTo}
            keyboardType="numeric"
            inputMode="numeric"
          />
        </View>
      </View>

      <View className="gap-2">
        {metrics.includes('weight') ? (
          <Input
            label={`Weight (${weightUnit})`}
            value={weight}
            onChangeText={setWeight}
            placeholder="100"
            keyboardType="numeric"
            inputMode="decimal"
          />
        ) : null}
        {metrics.includes('reps') ? (
          <Input
            label="Reps"
            value={reps}
            onChangeText={setReps}
            placeholder="5"
            keyboardType="numeric"
            inputMode="numeric"
          />
        ) : null}
        {metrics.includes('time') ? (
          <Input
            label="Time (MM:SS)"
            value={time}
            onChangeText={setTime}
            placeholder="1:00"
          />
        ) : null}
        {metrics.includes('distance') ? (
          <Input
            label="Distance (m)"
            value={distance}
            onChangeText={setDistance}
            placeholder="500"
            keyboardType="numeric"
            inputMode="decimal"
          />
        ) : null}
        {metrics.includes('calories') ? (
          <Input
            label="Calories"
            value={calories}
            onChangeText={setCalories}
            placeholder="15"
            keyboardType="numeric"
            inputMode="numeric"
          />
        ) : null}
      </View>

      <Button onPress={apply}>Apply</Button>
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
  const weightUnit = useGymWeightUnit();
  return (
    <View className="gap-2">
      {metrics.includes('weight') ? (
        <Input
          label={`Weight (${weightUnit})`}
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
  const colors = useThemeColors();
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
        <Ionicons name="chevron-down" size={16} color={colors.iconTertiary} />
      </Pressable>
    </View>
  );
}

function TagEditModal({
  visible,
  tag,
  onPickScheme,
  onRemove,
  onClose,
}: {
  visible: boolean;
  tag: MovementTagDraft | null;
  onPickScheme: (trackKey: string | null) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const meta = tag ? findMovement(tag.movement_key) : undefined;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          role="dialog"
          aria-modal
          accessibilityLabel="Edit tag"
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-sm md:max-w-md gap-3">
          <View className="gap-1">
            <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
              Edit tag
            </Text>
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              {meta?.movement.name ?? tag?.movement_key ?? '—'}
            </Text>
            {meta ? (
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {meta.group.name}
              </Text>
            ) : null}
          </View>

          {meta && meta.movement.schemes.length > 0 ? (
            <View className="gap-1">
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                Rep scheme
              </Text>
              <View className="gap-1">
                <SchemeRow
                  label="No scheme"
                  selected={!tag?.track_key}
                  onPress={() => onPickScheme(null)}
                />
                {meta.movement.schemes.map((s) => (
                  <SchemeRow
                    key={s.key}
                    label={s.label}
                    selected={tag?.track_key === s.key}
                    onPress={() => onPickScheme(s.key)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="destructive" onPress={onRemove}>
                Remove
              </Button>
            </View>
            <View className="flex-1">
              <Button variant="secondary" onPress={onClose}>
                Done
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SchemeRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-2 rounded-lg px-3 py-2 active:opacity-70 ${
        selected
          ? 'bg-primary/10 border border-primary/30'
          : 'bg-gray-50 dark:bg-gray-800 border border-transparent'
      }`}>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={16}
        color={selected ? colors.primary : colors.iconTertiary}
      />
      <Text
        className={
          selected
            ? 'text-primary text-sm font-medium'
            : 'text-gray-700 dark:text-gray-200 text-sm'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

function MovementTagPickerModal({
  visible,
  groups,
  onPick,
  onClose,
}: {
  visible: boolean;
  groups: MovementGroup[];
  onPick: (tag: MovementTagDraft) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedMovement, setExpandedMovement] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) {
      setExpandedGroup(null);
      setExpandedMovement(null);
      setSearch('');
    }
  }, [visible]);

  const q = search.trim().toLowerCase();
  // Search spans the full catalog passed in (name + aliases), so a member
  // can tag any movement — including ones outside their gym's discipline.
  const matches = useMemo(() => {
    if (!q) return [] as Movement[];
    const out: Movement[] = [];
    for (const g of groups) {
      for (const m of g.movements) {
        const hay = [m.name, ...(m.aliases ?? [])].join(' ').toLowerCase();
        if (hay.includes(q)) out.push(m);
      }
    }
    return out;
  }, [groups, q]);

  // One movement row, shared by the browse accordion and the search
  // results: tap the name to tag with no scheme, or expand to pick one.
  const renderMovement = (m: Movement) => (
    <View key={m.key}>
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={() => onPick({ movement_key: m.key, track_key: null })}
          className="flex-1 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 active:bg-gray-100 dark:active:bg-gray-800">
          <Text className="text-gray-900 dark:text-gray-50 text-sm">{m.name}</Text>
          <Text className="text-gray-400 dark:text-gray-500 text-[10px]">
            No rep scheme
          </Text>
        </Pressable>
        {m.schemes.length > 0 ? (
          <Pressable
            onPress={() =>
              setExpandedMovement((cur) => (cur === m.key ? null : m.key))
            }
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${m.name} rep schemes`}
            accessibilityState={{ expanded: expandedMovement === m.key }}
            className="w-8 h-8 rounded items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-800">
            <Ionicons
              name={expandedMovement === m.key ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.iconTertiary}
            />
          </Pressable>
        ) : null}
      </View>
      {expandedMovement === m.key ? (
        <View className="pl-3 gap-1">
          {m.schemes.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => onPick({ movement_key: m.key, track_key: s.key })}
              className="rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 active:bg-gray-100 dark:active:bg-gray-800">
              <Text className="text-primary text-xs">{s.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          role="dialog"
          aria-modal
          accessibilityLabel="Tag a movement"
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-md md:max-w-lg gap-3 max-h-[80vh]">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Tag a movement
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Tag the movement (optionally with a rep scheme) so it lands
            in your per-movement Journal.
          </Text>
          <View className="flex-row items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3">
            <Ionicons name="search" size={16} color={colors.iconTertiary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search all movements"
              accessibilityLabel="Search all movements"
              placeholderTextColor="#9CA3AF"
              autoCorrect={false}
              className="flex-1 py-2.5 text-gray-900 dark:text-gray-50 text-sm"
            />
            {q ? (
              <Pressable
                onPress={() => setSearch('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={colors.iconTertiary} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView className="max-h-[60vh]" contentContainerClassName="gap-2">
            {q ? (
              matches.length === 0 ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm py-2">
                  No movements match “{search.trim()}”.
                </Text>
              ) : (
                matches.map((m) => renderMovement(m))
              )
            ) : (
              groups.map((g) => (
                <View key={g.key}>
                  <Pressable
                    onPress={() =>
                      setExpandedGroup((cur) => (cur === g.key ? null : g.key))
                    }
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandedGroup === g.key }}
                    className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2.5 flex-row items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 active:opacity-70">
                    <Text className="flex-1 text-gray-900 dark:text-gray-50 font-medium">
                      {g.name}
                    </Text>
                    <Ionicons
                      name={expandedGroup === g.key ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.iconTertiary}
                    />
                  </Pressable>
                  {expandedGroup === g.key ? (
                    <View className="pt-2 pl-3 gap-2">
                      {g.movements.map((m) => renderMovement(m))}
                    </View>
                  ) : null}
                </View>
              ))
            )}
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
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          role="dialog"
          aria-modal
          accessibilityLabel={title}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-md md:max-w-lg gap-3 max-h-[80vh]">
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
    source_member_programming_id: draft.source_member_programming_id,
    source_section_index: draft.source_section_index,
    section_category: draft.section_category!,
    section_format: format,
    title: title || null,
    body: draft.body.trim() || null,
    notes: draft.notes.trim() || null,
    sort_order: sortOrder,
    total_time_seconds: null as number | null,
    total_rounds: null as number | null,
    total_extra_reps: null as number | null,
    total_distance_m: null as number | null,
    total_calories: null as number | null,
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
    if (shape.aggregateFields.includes('total_distance_m')) {
      const n = Number(draft.total_distance_m.trim());
      if (draft.total_distance_m.trim() && Number.isFinite(n)) {
        base.total_distance_m = n;
      }
    }
    if (shape.aggregateFields.includes('total_calories')) {
      const n = parseInt(draft.total_calories.trim(), 10);
      if (Number.isFinite(n)) base.total_calories = n;
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
  weightUnit: WeightUnit;
}) {
  const { gymId, profileId, sectionId, entryIdx, draft, format, weightUnit } =
    args;
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
    // Always stored in kilograms (0181), whatever the gym displays.
    weight_numeric: (() => {
      const v = parseNumber(draft.weight);
      return v == null ? null : displayToKg(v, weightUnit);
    })(),
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
