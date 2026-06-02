import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ColorSwatchPicker, PALETTE } from './ColorSwatchPicker';
import { Input } from './Input';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

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

  const types = useQuery({
    queryKey: ['class-types', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_types')
        .select('id, name, color')
        .order('name');
      if (error) throw error;
      return data as ClassType[];
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ['class-types'] });
      onChange(created.id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create type'),
  });

  return (
    <View className="gap-2">
      <Text className="text-gray-700 text-sm font-medium">Class type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2 pr-2">
          {types.data?.map((t) => {
            const selected = value === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => onChange(t.id)}
                className={`flex-row items-center gap-2 px-3 py-2 rounded-full border ${
                  selected ? 'border-gray-900 bg-gray-100' : 'border-gray-200 bg-white'
                }`}>
                <View
                  style={{ backgroundColor: t.color }}
                  className="w-2.5 h-2.5 rounded-full"
                />
                <Text className="text-gray-900 text-sm">{t.name}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setCreating(!creating)}
            className="flex-row items-center gap-1 px-3 py-2 rounded-full border border-dashed border-gray-300 bg-white">
            <Ionicons name="add" size={14} color="#6B7280" />
            <Text className="text-gray-500 text-sm">New type</Text>
          </Pressable>
        </View>
      </ScrollView>

      {creating ? (
        <View className="bg-gray-50 rounded-lg p-3 gap-3">
          <Input
            label="Type name"
            value={newName}
            onChangeText={setNewName}
            placeholder="CrossFit"
            autoCapitalize="words"
          />
          <View className="gap-1.5">
            <Text className="text-gray-700 text-sm font-medium">Colour</Text>
            <ColorSwatchPicker value={newColor} onChange={setNewColor} />
          </View>
          {error ? <Text className="text-red-500 text-xs">{error}</Text> : null}
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => {
                setCreating(false);
                setNewName('');
                setError(null);
              }}
              className="flex-1 py-2 rounded-lg bg-white border border-gray-200 items-center">
              <Text className="text-gray-700 text-sm font-medium">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => create.mutate()}
              disabled={create.isPending}
              className="flex-1 py-2 rounded-lg bg-primary items-center active:bg-primary-dark">
              <Text className="text-white text-sm font-semibold">
                {create.isPending ? 'Creating…' : 'Create type'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
