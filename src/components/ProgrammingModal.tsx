import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from './Button';
import { Input } from './Input';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSavedFlag } from '@/lib/useSavedFlag';

type Section = { title: string; body: string };

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
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

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
      return { id: data.id, sections: (data.sections as Section[]) ?? [] };
    },
  });

  useEffect(() => {
    if (!visible) return;
    if (programming.isLoading) return;
    const loaded = programming.data?.sections ?? [];
    setSections(loaded.length > 0 ? loaded : [{ title: '', body: '' }]);
    setError(null);
  }, [visible, programming.isLoading, programming.data]);

  function close() {
    setSections([]);
    setError(null);
    onClose();
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !session || !classType || !dateStr) {
        throw new Error('Missing context');
      }
      const cleaned = sections
        .map((s) => ({ title: s.title.trim(), body: s.body.trim() }))
        .filter((s) => s.title.length > 0 || s.body.length > 0);
      for (const s of cleaned) {
        if (!s.title || !s.body) {
          throw new Error('Each section needs a title and body');
        }
      }
      if (cleaned.length === 0) {
        const { error } = await supabase
          .from('class_programming')
          .delete()
          .eq('class_type_id', classType.id)
          .eq('date', dateStr);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('class_programming')
          .upsert(
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

  function updateSection(idx: number, next: Section) {
    setSections((curr) => curr.map((s, i) => (i === idx ? next : s)));
  }

  function removeSection(idx: number) {
    setSections((curr) => curr.filter((_, i) => i !== idx));
  }

  function addSection() {
    setSections((curr) => [...curr, { title: '', body: '' }]);
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

              <ScrollView className="max-h-[60vh]" contentContainerClassName="gap-3">
                {programming.isLoading ? (
                  <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
                ) : (
                  <>
                    {sections.map((s, idx) => (
                      <View
                        key={idx}
                        className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 gap-2">
                        <Pressable
                          onPress={() => removeSection(idx)}
                          hitSlop={4}
                          className="self-end w-8 h-8 rounded-lg items-center justify-center active:bg-gray-100 dark:active:bg-gray-700">
                          <Ionicons name="close" size={18} color="#9CA3AF" />
                        </Pressable>
                        <Input
                          label="Title"
                          value={s.title}
                          onChangeText={(v) =>
                            updateSection(idx, { ...s, title: v })
                          }
                          placeholder="Strength"
                          autoCapitalize="words"
                        />
                        <Input
                          label="Body"
                          value={s.body}
                          onChangeText={(v) =>
                            updateSection(idx, { ...s, body: v })
                          }
                          placeholder="Barbell Back Squat 3 sets x 5 reps"
                          multiline
                          numberOfLines={4}
                          style={{ minHeight: 100, textAlignVertical: 'top' }}
                        />
                      </View>
                    ))}
                    <Pressable
                      onPress={addSection}
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
    </Modal>
  );
}
