import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ColorSwatchPicker, PALETTE } from '@/components/ColorSwatchPicker';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSavedFlag } from '@/lib/useSavedFlag';

type ServerType = { id: string; name: string; color: string };
type EditableType = {
  id: string | null;
  name: string;
  color: string;
  deleted?: boolean;
};

export default function ClassTypesScreen() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditableType[]>([]);
  const [openPickerIdx, setOpenPickerIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const types = useQuery({
    queryKey: ['class-types', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_types')
        .select('id, name, color')
        .order('name');
      if (error) throw error;
      return data as ServerType[];
    },
  });

  useEffect(() => {
    if (!types.data) return;
    setRows(types.data.map((t) => ({ id: t.id, name: t.name, color: t.color })));
  }, [types.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      const server = types.data ?? [];
      const serverById = new Map(server.map((t) => [t.id, t]));

      const inserts: { gym_id: string; name: string; color: string }[] = [];
      const updates: { id: string; name: string; color: string }[] = [];
      const deletes: string[] = [];

      for (const r of rows) {
        const name = r.name.trim();
        if (r.id === null) {
          if (r.deleted) continue;
          if (!name) throw new Error('Each type needs a name');
          inserts.push({ gym_id: membership.gymId, name, color: r.color });
          continue;
        }
        if (r.deleted) {
          deletes.push(r.id);
          continue;
        }
        if (!name) throw new Error('Each type needs a name');
        const sv = serverById.get(r.id);
        if (sv && (sv.name !== name || sv.color !== r.color)) {
          updates.push({ id: r.id, name, color: r.color });
        }
      }

      if (inserts.length > 0) {
        const { error } = await supabase.from('class_types').insert(inserts);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase
          .from('class_types')
          .update({ name: u.name, color: u.color })
          .eq('id', u.id);
        if (error) throw error;
      }
      if (deletes.length > 0) {
        const { error } = await supabase.from('class_types').delete().in('id', deletes);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setError(null);
      setOpenPickerIdx(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['class-types'] });
      queryClient.invalidateQueries({ queryKey: ['class-sessions-month'] });
    },
    onError: (e) => setError(errorMessage(e, 'Save failed')),
  });

  function addRow() {
    const usedColors = new Set(rows.map((r) => r.color.toUpperCase()));
    const next =
      PALETTE.find((c) => !usedColors.has(c.hex.toUpperCase())) ?? PALETTE[0];
    setRows([...rows, { id: null, name: '', color: next.hex }]);
  }

  const visibleRows = rows.map((r, idx) => ({ row: r, idx })).filter((r) => !r.row.deleted);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6">
        <View className="gap-2">
          <Text className="text-gray-900 text-2xl font-semibold">Class types</Text>
          <Text className="text-gray-500">
            Name and colour the kinds of class you run. The colour shows up
            wherever a class appears on the calendar.
          </Text>
        </View>

        <View className="gap-2">
          {visibleRows.length === 0 ? (
            <Text className="text-gray-500">No types yet — add one below.</Text>
          ) : null}
          {visibleRows.map(({ row: r, idx }) => (
            <View key={r.id ?? `new-${idx}`} className="bg-white rounded-xl p-3 gap-2">
              <View className="flex-row items-center gap-3">
                <Pressable
                  onPress={() =>
                    setOpenPickerIdx(openPickerIdx === idx ? null : idx)
                  }
                  hitSlop={4}
                  style={{ backgroundColor: r.color }}
                  className="w-10 h-10 rounded-full border-2 border-white"
                />
                <View className="flex-1">
                  <Input
                    label=""
                    value={r.name}
                    onChangeText={(v) => {
                      const next = [...rows];
                      next[idx] = { ...r, name: v };
                      setRows(next);
                    }}
                    placeholder="CrossFit"
                    autoCapitalize="words"
                  />
                </View>
                <Pressable
                  onPress={() => {
                    if (r.id === null) {
                      setRows(rows.filter((_, i) => i !== idx));
                    } else {
                      const next = [...rows];
                      next[idx] = { ...r, deleted: true };
                      setRows(next);
                    }
                    if (openPickerIdx === idx) setOpenPickerIdx(null);
                  }}
                  hitSlop={4}
                  className="w-10 h-10 rounded-lg items-center justify-center active:bg-gray-100">
                  <Ionicons name="close" size={18} color="#9CA3AF" />
                </Pressable>
              </View>
              {openPickerIdx === idx ? (
                <View className="bg-gray-50 rounded-lg p-3">
                  <ColorSwatchPicker
                    value={r.color}
                    onChange={(c) => {
                      const next = [...rows];
                      next[idx] = { ...r, color: c };
                      setRows(next);
                    }}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>

        <Pressable
          onPress={addRow}
          className="flex-row items-center gap-2 self-start px-3 py-2 rounded-lg border border-dashed border-gray-300">
          <Ionicons name="add" size={16} color="#6B7280" />
          <Text className="text-gray-500">Add type</Text>
        </Pressable>

        {error ? <Text className="text-red-500">{error}</Text> : null}

        <Button onPress={() => save.mutate()} loading={save.isPending} success={saved}>
          Save changes
        </Button>
      </ScrollView>
    </Screen>
  );
}
