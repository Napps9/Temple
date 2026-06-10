import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from './Button';
import { ColorSwatchPicker, PALETTE } from './ColorSwatchPicker';
import { Input } from './Input';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useClassTypes } from '@/lib/useClassCatalog';

export type ClassType = { id: string; name: string; color: string };

export function ClassTypePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(PALETTE[0].hex);
  const [error, setError] = useState<string | null>(null);

  // Shared canonical query (see useClassCatalog). Archived types are
  // excluded — they shouldn't be assignable to new classes.
  const allTypes = useClassTypes();
  const types = {
    ...allTypes,
    data: allTypes.data?.filter((t) => t.archived_at === null),
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      const name = newName.trim();
      if (!name) throw new Error('Name is required');
      const { data, error } = await supabase
        .from('class_types')
        .insert({ gym_id: membership.gymId, name, color: newColor })
        .select('id, name, color')
        .single();
      if (error) throw error;
      return data as ClassType;
    },
    onSuccess: (created) => {
      setNewName('');
      setNewColor(PALETTE[0].hex);
      setCreating(false);
      setError(null);
      queryClient.setQueryData<ClassType[]>(
        ['class-types', membership?.gymId],
        (prev) => {
          const merged = [...(prev ?? []).filter((t) => t.id !== created.id), created];
          merged.sort((a, b) => a.name.localeCompare(b.name));
          return merged;
        },
      );
      onChange(created.id);
    },
    onError: (e) => setError(errorMessage(e, 'Could not create type')),
  });

  return (
    <View className="gap-2">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        Class type
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2 pr-2">
          {types.data?.map((t) => {
            const selected = value === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => onChange(t.id)}
                className={`flex-row items-center gap-2 px-3 py-2 rounded-full border ${
                  selected
                    ? 'border-primary bg-primary/10'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                }`}>
                <View
                  style={{ backgroundColor: t.color }}
                  className="w-2.5 h-2.5 rounded-full"
                />
                <Text
                  className={
                    selected
                      ? 'text-primary text-sm font-medium'
                      : 'text-gray-900 dark:text-gray-50 text-sm'
                  }>
                  {t.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setCreating(!creating)}
            className="flex-row items-center gap-1 px-3 py-2 rounded-full border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900">
            <Ionicons name="add" size={14} color="#6B7280" />
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              New type
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {creating ? (
        <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-3">
          <Input
            label="Type name"
            value={newName}
            onChangeText={setNewName}
            placeholder="CrossFit"
            autoCapitalize="words"
          />
          <View className="gap-1.5">
            <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
              Colour
            </Text>
            <ColorSwatchPicker value={newColor} onChange={setNewColor} />
          </View>
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                variant="secondary"
                onPress={() => {
                  setCreating(false);
                  setNewName('');
                  setError(null);
                }}>
                Cancel
              </Button>
            </View>
            <View className="flex-1">
              <Button onPress={() => create.mutate()} loading={create.isPending}>
                Create type
              </Button>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
