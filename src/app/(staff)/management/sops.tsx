import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Sop = {
  sop_id: string;
  title: string;
  category: string | null;
  body_markdown: string;
  updated_at: string;
};

export default function StaffSOPs() {
  const session = useSession();
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();

  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Sop | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['sops', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<Sop[]> => {
      const { data, error } = await supabase
        .from('sop_documents')
        .select('sop_id, title, category, body_markdown, updated_at')
        .eq('gym_id', gym!.gymId)
        .is('archived_at', null)
        .order('category', { ascending: true, nullsFirst: false })
        .order('title');
      if (error) throw error;
      return (data ?? []) as unknown as Sop[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!session || !gym) throw new Error('Not ready');
      if (!title.trim()) throw new Error('Title required');
      const payload = {
        gym_id: gym.gymId,
        title: title.trim(),
        category: category.trim() || null,
        body_markdown: body,
        updated_by: session.user.id,
        updated_at: new Date().toISOString(),
      };
      if (editing) {
        const { error } = await supabase
          .from('sop_documents')
          .update(payload)
          .eq('sop_id', editing.sop_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('sop_documents').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setComposing(false);
      setEditing(null);
      setTitle('');
      setCategory('');
      setBody('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['sops', gym?.gymId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('sop_documents')
        .update({ archived_at: new Date().toISOString() })
        .eq('sop_id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops', gym?.gymId] });
    },
  });

  function startEdit(s: Sop) {
    setEditing(s);
    setComposing(true);
    setTitle(s.title);
    setCategory(s.category ?? '');
    setBody(s.body_markdown);
    setError(null);
  }

  function cancelCompose() {
    setComposing(false);
    setEditing(null);
    setTitle('');
    setCategory('');
    setBody('');
    setError(null);
  }

  // Group by category for display.
  const grouped = (listQuery.data ?? []).reduce<Record<string, Sop[]>>((acc, s) => {
    const k = s.category ?? 'General';
    (acc[k] ??= []).push(s);
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort();

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              SOPs
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              How the coaching team runs the gym.
            </Text>
          </View>
          {!composing ? (
            <Button onPress={() => setComposing(true)}>New SOP</Button>
          ) : null}
        </View>

        {composing ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              {editing ? 'Edit SOP' : 'New SOP'}
            </Text>
            <Input
              label="Title"
              value={title}
              onChangeText={setTitle}
              autoCapitalize="sentences"
              placeholder="e.g. Running an intro session"
            />
            <Input
              label="Category"
              value={category}
              onChangeText={setCategory}
              placeholder="e.g. Intros, Operations, Coaching"
            />
            <View className="gap-1.5">
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                Body (Markdown)
              </Text>
              <TextInput
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
                placeholderTextColor="#9CA3AF"
                value={body}
                onChangeText={setBody}
                multiline
                numberOfLines={8}
                style={{ minHeight: 180, textAlignVertical: 'top' }}
                placeholder="Steps, gotchas, links…"
              />
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" onPress={cancelCompose}>
                  Cancel
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  onPress={() => saveMutation.mutate()}
                  loading={saveMutation.isPending}
                  disabled={!title.trim()}>
                  {editing ? 'Save' : 'Create'}
                </Button>
              </View>
            </View>
          </View>
        ) : null}

        {categories.map((cat) => (
          <View key={cat} className="gap-2">
            <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
              {cat}
            </Text>
            {grouped[cat].map((s) => (
              <SOPCard
                key={s.sop_id}
                sop={s}
                onEdit={() => startEdit(s)}
                onArchive={() => archiveMutation.mutate(s.sop_id)}
              />
            ))}
          </View>
        ))}

        {categories.length === 0 && !composing ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400">
              No SOPs yet — start with how a typical class runs.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function SOPCard({
  sop,
  onEdit,
  onArchive,
}: {
  sop: Sop;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
      <Pressable
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center gap-2">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
          {sop.title}
        </Text>
        <Pressable onPress={onEdit} hitSlop={8}>
          <Ionicons name="create-outline" size={18} color="#6B7280" />
        </Pressable>
        <Pressable onPress={onArchive} hitSlop={8}>
          <Ionicons name="archive-outline" size={18} color="#6B7280" />
        </Pressable>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#6B7280"
        />
      </Pressable>
      {expanded ? (
        <Text className="text-gray-700 dark:text-gray-200 text-sm">
          {sop.body_markdown || '(empty)'}
        </Text>
      ) : null}
    </View>
  );
}
