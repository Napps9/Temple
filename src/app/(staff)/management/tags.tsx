import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ColorSwatchPicker, PALETTE } from '@/components/ColorSwatchPicker';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Tag = {
  tag_id: string;
  name: string;
  color: string | null;
};

export default function ManageTags() {
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PALETTE[0].hex);
  const [error, setError] = useState<string | null>(null);

  const tagsQuery = useQuery({
    queryKey: ['tags', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<Tag[]> => {
      const { data, error } = await supabase
        .from('tags')
        .select('tag_id, name, color')
        .eq('gym_id', gym!.gymId)
        .order('name');
      if (error) throw error;
      return (data ?? []) as unknown as Tag[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!gym) throw new Error('No gym');
      if (!name.trim()) throw new Error('Name required');
      const { error } = await supabase.from('tags').insert({
        gym_id: gym.gymId,
        name: name.trim(),
        color,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setName('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['tags', gym?.gymId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tags').delete().eq('tag_id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags', gym?.gymId] });
    },
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Tags
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Tag members for segmentation and automation.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            New tag
          </Text>
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. intro, founder, on-hold"
            autoCapitalize="none"
          />
          <View className="gap-1.5">
            <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
              Colour
            </Text>
            <ColorSwatchPicker value={color} onChange={setColor} />
          </View>
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          <Button
            onPress={() => createMutation.mutate()}
            loading={createMutation.isPending}
            disabled={!name.trim()}>
            Create tag
          </Button>
        </View>

        <View className="gap-2">
          <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
            All tags
          </Text>
          {tagsQuery.data?.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No tags yet.
            </Text>
          ) : null}
          {tagsQuery.data?.map((t) => (
            <View
              key={t.tag_id}
              className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3">
              <View
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: t.color ?? '#9CA3AF' }}
              />
              <Text className="text-gray-900 dark:text-gray-50 flex-1">{t.name}</Text>
              <Pressable
                onPress={() => deleteMutation.mutate(t.tag_id)}
                hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
