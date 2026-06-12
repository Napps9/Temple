import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from './Button';
import { Input } from './Input';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
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
import { useSavedFlag } from '@/lib/useSavedFlag';
import { useThemeColors } from '@/lib/theme';

// Draft state allows category and format to be unpicked while the
// coach is still adding a section. On save, drafts with any content
// must have both picked or validation rejects them.
type SectionDraft = {
  section_category: SectionCategoryKey | null;
  section_format: SectionFormatKey | null;
  title: string;
  body: string;
  leaderboard_enabled: boolean;
};

type ProgrammingRow = {
  id: string;
  sections: Section[];
};

function fmtDateLocal(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function fmtLongDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function emptyDraft(): SectionDraft {
  return {
    section_category: null,
    section_format: null,
    title: '',
    body: '',
    leaderboard_enabled: false,
  };
}

function sectionToDraft(s: Section): SectionDraft {
  return {
    section_category: s.section_category as SectionCategoryKey,
    section_format: s.section_format as SectionFormatKey,
    title: s.title,
    body: s.body,
    leaderboard_enabled: s.leaderboard_enabled,
  };
}

export function ProgrammingModal({
  visible,
  classType,
  date,
  onClose,
}: {
  visible: boolean;
  classType: { id: string; name: string; color: string } | null;
  date: Date | null;
  onClose: () => void;
}) {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<SectionDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();
  const [pickerOpenFor, setPickerOpenFor] = useState<
    { idx: number; kind: 'category' | 'format' } | null
  >(null);

  const dateStr = date ? fmtDateLocal(date) : null;

  const programming = useQuery({
    queryKey: ['class-programming', membership?.gymId, classType?.id, dateStr],
    enabled: !!membership?.gymId && !!classType?.id && !!dateStr && visible,
    queryFn: async (): Promise<ProgrammingRow | null> => {
      const { data, error } = await supabase
        .from('class_programming')
        .select('id, sections')
        .eq('class_type_id', classType!.id)
        .eq('date', dateStr!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { id: data.id, sections: parseSections(data.sections) };
    },
  });

  useEffect(() => {
    if (!visible) return;
    if (programming.isLoading) return;
    const loaded = programming.data?.sections ?? [];
    setDrafts(loaded.length > 0 ? loaded.map(sectionToDraft) : [emptyDraft()]);
    setError(null);
    setPickerOpenFor(null);
  }, [visible, programming.isLoading, programming.data]);

  function close() {
    setDrafts([]);
    setError(null);
    setPickerOpenFor(null);
    onClose();
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !session || !classType || !dateStr) {
        throw new Error('Missing context');
      }
      // Drop fully empty drafts (no category, no body) silently.
      const meaningful = drafts.filter(
        (d) =>
          d.section_category !== null ||
          d.section_format !== null ||
          d.title.trim().length > 0 ||
          d.body.trim().length > 0,
      );
      const cleaned: Section[] = [];
      for (const d of meaningful) {
        if (!d.section_category) {
          throw new Error('Each section needs a category');
        }
        if (!d.section_format) {
          throw new Error('Each section needs a scoring format');
        }
        const body = d.body.trim();
        if (!body) {
          throw new Error('Each section needs a description');
        }
        const title = d.title.trim() || categoryToTitle(d.section_category);
        cleaned.push({
          section_category: d.section_category,
          section_format: d.section_format,
          title,
          body,
          leaderboard_enabled: d.leaderboard_enabled,
        });
      }
      if (cleaned.length === 0) {
        const { error } = await supabase
          .from('class_programming')
          .delete()
          .eq('class_type_id', classType.id)
          .eq('date', dateStr);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('class_programming').upsert(
          {
            gym_id: membership.gymId,
            class_type_id: classType.id,
            date: dateStr,
            sections: cleaned,
            author_id: session.user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'class_type_id,date' },
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['class-programming'] });
      queryClient.invalidateQueries({ queryKey: ['class-programming-month'] });
      setTimeout(() => close(), 600);
    },
    onError: (e) => setError(errorMessage(e, 'Could not save programming')),
  });

  function updateDraft(idx: number, next: Partial<SectionDraft>) {
    setDrafts((cur) =>
      cur.map((d, i) => (i === idx ? { ...d, ...next } : d)),
    );
  }

  function pickCategory(idx: number, key: SectionCategoryKey) {
    setDrafts((cur) =>
      cur.map((d, i) => {
        if (i !== idx) return d;
        // Overwrite the title only when it still matches a category
        // label (or is empty) — so "Primer — shoulders" survives a
        // category re-pick.
        const title = titleMatchesAnyCategory(d.title)
          ? categoryToTitle(key)
          : d.title;
        return { ...d, section_category: key, title };
      }),
    );
  }

  function pickFormat(idx: number, key: SectionFormatKey) {
    updateDraft(idx, { section_format: key });
  }

  function removeDraft(idx: number) {
    setDrafts((curr) => curr.filter((_, i) => i !== idx));
  }

  function addDraft() {
    setDrafts((curr) => [...curr, emptyDraft()]);
  }

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
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-5 max-h-[90vh]">
          {!classType || !date ? (
            <View className="py-6 items-center">
              <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
            </View>
          ) : (
            <>
              <View className="gap-2">
                <View
                  style={{ backgroundColor: classType.color }}
                  className="self-start rounded-full px-3 py-1">
                  <Text className="text-white text-xs font-semibold">
                    {classType.name}
                  </Text>
                </View>
                <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
                  {fmtLongDate(date)}
                </Text>
              </View>

              <ScrollView
                className="max-h-[60vh]"
                contentContainerClassName="gap-3">
                {programming.isLoading ? (
                  <Text className="text-gray-500 dark:text-gray-400">
                    Loading…
                  </Text>
                ) : (
                  <>
                    {drafts.map((d, idx) => (
                      <DraftCard
                        key={idx}
                        draft={d}
                        onUpdate={(next) => updateDraft(idx, next)}
                        onPickCategory={() =>
                          setPickerOpenFor({ idx, kind: 'category' })
                        }
                        onPickFormat={() =>
                          setPickerOpenFor({ idx, kind: 'format' })
                        }
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
                  </>
                )}
              </ScrollView>

              {error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">
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
                    Save changes
                  </Button>
                </View>
              </View>
            </>
          )}
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
    </Modal>
  );
}

function DraftCard({
  draft,
  onUpdate,
  onPickCategory,
  onPickFormat,
  onRemove,
}: {
  draft: SectionDraft;
  onUpdate: (next: Partial<SectionDraft>) => void;
  onPickCategory: () => void;
  onPickFormat: () => void;
  onRemove: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 gap-3">
      <Pressable
        onPress={onRemove}
        hitSlop={4}
        className="self-end w-8 h-8 rounded-lg items-center justify-center active:bg-gray-100 dark:active:bg-gray-700"
          accessibilityLabel="Close">
        <Ionicons name="close" size={18} color="#9CA3AF" />
      </Pressable>

      <PickerButton
        label="Category"
        value={
          draft.section_category
            ? categoryLabel(draft.section_category)
            : null
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

      <Input
        label="Description"
        value={draft.body}
        onChangeText={(v) => onUpdate({ body: v })}
        placeholder="Back squat 5×5 @ 75%"
        multiline
        numberOfLines={4}
        style={{ minHeight: 100, textAlignVertical: 'top' }}
        autoCapitalize="sentences"
      />

      <Pressable
        onPress={() =>
          onUpdate({ leaderboard_enabled: !draft.leaderboard_enabled })
        }
        className="flex-row items-center gap-3 active:opacity-70">
        <Ionicons
          name={draft.leaderboard_enabled ? 'checkbox' : 'square-outline'}
          size={20}
          color={draft.leaderboard_enabled ? colors.primary : '#9CA3AF'}
        />
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
            Add to leaderboard
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Members who log this section will be ranked against each other.
          </Text>
        </View>
      </Pressable>
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
