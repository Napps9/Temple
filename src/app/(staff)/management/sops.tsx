import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { PageHead } from '@/components/PageHead';
import { FieldLabel } from '@/components/SectionLabel';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatDate } from '@/lib/format-date';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type Doc = {
  id: string;
  title: string;
  body_markdown: string;
  category: string | null;
  author_id: string;
  updated_at: string;
};

export default function SopsScreen() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftCategory, setDraftCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canEdit = useCan('can_manage_sops') ?? false;
  const canView = useCan('can_view_sops');

  const docsQuery = useQuery({
    queryKey: ['sop-docs', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sop_documents')
        .select('id, title, body_markdown, category, author_id, updated_at')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('title');
      if (error) throw error;
      return (data ?? []) as Doc[];
    },
  });

  const active = docsQuery.data?.find((d) => d.id === activeId) ?? null;

  const startEdit = (doc: Doc | null) => {
    setEditing(true);
    setDraftTitle(doc?.title ?? '');
    setDraftBody(doc?.body_markdown ?? '');
    setDraftCategory(doc?.category ?? '');
    setError(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('No gym selected');
      if (draftTitle.trim().length === 0) throw new Error('Title is required');
      const payload = {
        gym_id: membership.gymId,
        title: draftTitle.trim(),
        body_markdown: draftBody,
        category: draftCategory.trim().length > 0 ? draftCategory.trim() : null,
        author_id: session.user.id,
        updated_at: new Date().toISOString(),
      };
      if (active) {
        const { error } = await supabase
          .from('sop_documents')
          .update(payload)
          .eq('id', active.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('sop_documents').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setEditing(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['sop-docs'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save document')),
  });

  const archive = useMutation({
    mutationFn: async () => {
      if (!active) return;
      const { error } = await supabase
        .from('sop_documents')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', active.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setActiveId(null);
      queryClient.invalidateQueries({ queryKey: ['sop-docs'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not archive')),
  });

  if (canView === false) {
    return <Redirect href="/management" />;
  }

  if (active && !editing) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management" />
          <Pressable onPress={() => setActiveId(null)}>
            <Text className="text-primary">← All documents</Text>
          </Pressable>
          <View className="gap-1">
            <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
              {active.title}
            </Text>
            {active.category ? (
              <FieldLabel>
                {active.category}
              </FieldLabel>
            ) : null}
          </View>
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <Text className="text-ink dark:text-ink-dk whitespace-pre-wrap">
              {active.body_markdown || 'No content.'}
            </Text>
          </View>
          {canEdit ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" onPress={() => startEdit(active)}>
                  Edit
                </Button>
              </View>
              <View className="flex-1">
                <Button variant="ghost" onPress={() => archive.mutate()}>
                  Archive
                </Button>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  if (editing) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
          <Pressable
            onPress={() => {
              setEditing(false);
              if (!active) setActiveId(null);
            }}>
            <Text className="text-primary">← Cancel</Text>
          </Pressable>
          <Input label="Title" value={draftTitle} onChangeText={setDraftTitle} />
          <Input
            label="Category (optional)"
            value={draftCategory}
            onChangeText={setDraftCategory}
            placeholder="e.g. Intake, Emergency"
          />
          <View className="gap-1.5">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
              Body
            </Text>
            <TextInput
              value={draftBody}
              onChangeText={setDraftBody}
              multiline
              numberOfLines={12}
              placeholder="Markdown supported in a future update — plain text for now."
              placeholderTextColor="#9CA3AF"
              className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-lg px-4 py-3 text-ink dark:text-ink-dk text-base min-h-[200px]"
              style={{ textAlignVertical: 'top' }}
            />
          </View>
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          <Button onPress={() => save.mutate()} loading={save.isPending}>
            Save
          </Button>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management" />
        <PageHead
          title="SOPs"
          subtitle="How we do things here. Visible to all staff; only owners and admins can edit."
        />

        {canEdit ? (
          <Button
            onPress={() => {
              setActiveId(null);
              startEdit(null);
            }}>
            New document
          </Button>
        ) : null}

        {docsQuery.isLoading ? (
          <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
        ) : (docsQuery.data ?? []).length === 0 ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            No documents yet.
          </Text>
        ) : (
          <View className="gap-2">
            {(docsQuery.data ?? []).map((d) => (
              <Pressable
                key={d.id}
                onPress={() => setActiveId(d.id)}
                className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-1">
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  {d.title}
                </Text>
                {d.category ? (
                  <FieldLabel>
                    {d.category}
                  </FieldLabel>
                ) : null}
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Updated {formatDate(d.updated_at)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
