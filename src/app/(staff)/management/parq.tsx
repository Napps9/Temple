import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useSavedFlag } from '@/lib/useSavedFlag';

type Questionnaire = {
  id: string;
  version: number;
  is_active: boolean;
  published_at: string;
};

type Question = {
  id: string;
  sort_order: number;
  prompt: string;
  flag_on_yes: boolean;
};

type DraftQuestion = {
  serverId: string | null;
  localId: string;
  prompt: string;
  flag_on_yes: boolean;
};

function makeDraft(q: Question): DraftQuestion {
  return {
    serverId: q.id,
    localId: q.id,
    prompt: q.prompt,
    flag_on_yes: q.flag_on_yes,
  };
}

function makeBlank(): DraftQuestion {
  return {
    serverId: null,
    localId: `new-${Math.random().toString(36).slice(2, 8)}`,
    prompt: '',
    flag_on_yes: true,
  };
}

export function ParqPanel() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const canManage = useCan('can_manage_parq');
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<DraftQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const active = useQuery({
    queryKey: ['parq-active', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Questionnaire | null> => {
      const { data, error } = await supabase
        .from('parq_questionnaires')
        .select('id, version, is_active, published_at')
        .eq('gym_id', membership!.gymId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return data as Questionnaire | null;
    },
  });

  const questions = useQuery({
    queryKey: ['parq-questions', active.data?.id],
    enabled: !!active.data?.id,
    queryFn: async (): Promise<Question[]> => {
      const { data, error } = await supabase
        .from('parq_questions')
        .select('id, sort_order, prompt, flag_on_yes')
        .eq('questionnaire_id', active.data!.id)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as Question[];
    },
  });

  useEffect(() => {
    if (questions.data) setRows(questions.data.map(makeDraft));
  }, [questions.data]);

  // Publishing creates a NEW questionnaire version and switches it
  // active. Older versions are preserved so historical responses
  // keep pointing at the wording the member saw.
  const publish = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('Missing context');
      const cleaned = rows
        .map((r) => ({ ...r, prompt: r.prompt.trim() }))
        .filter((r) => r.prompt.length > 0);
      if (cleaned.length === 0) {
        throw new Error('Add at least one question before publishing');
      }
      const nextVersion = (active.data?.version ?? 0) + 1;

      // Flip prior active off (the partial unique index enforces it
      // but we do it explicitly so the transaction order is obvious).
      if (active.data?.id) {
        const { error: e1 } = await supabase
          .from('parq_questionnaires')
          .update({ is_active: false })
          .eq('id', active.data.id);
        if (e1) throw e1;
      }

      const { data: inserted, error: e2 } = await supabase
        .from('parq_questionnaires')
        .insert({
          gym_id: membership.gymId,
          version: nextVersion,
          is_active: true,
          published_by: session.user.id,
        })
        .select('id')
        .single();
      if (e2) throw e2;

      const newId = (inserted as { id: string }).id;
      const { error: e3 } = await supabase.from('parq_questions').insert(
        cleaned.map((r, i) => ({
          questionnaire_id: newId,
          sort_order: i + 1,
          prompt: r.prompt,
          flag_on_yes: r.flag_on_yes,
        })),
      );
      if (e3) throw e3;
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['parq-active'] });
      queryClient.invalidateQueries({ queryKey: ['parq-questions'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not publish')),
  });

  if (canManage === false) {
    return (
      <Text className="text-gray-500 dark:text-gray-400">
        Only owners and admins can edit the PAR-Q.
      </Text>
    );
  }

  function update(idx: number, patch: Partial<DraftQuestion>) {
    setRows((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }
  function add() {
    setRows((r) => [...r, makeBlank()]);
  }
  function remove(idx: number) {
    setRows((r) => r.filter((_, i) => i !== idx));
  }

  return (
    <View className="gap-4">
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        Members fill this in at signup and again every 12 months. A "yes"
        answer on any flagged question raises a health alert that staff
        with the see-health-flag capability will see.
      </Text>

      {active.data ? (
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          Current version: v{active.data.version}
        </Text>
      ) : (
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          No PAR-Q published yet
        </Text>
      )}

      <View className="gap-3">
        {rows.length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400">
            Add questions below. Drag-handles in v2; for now they stay in
            the order shown.
          </Text>
        ) : null}
        {rows.map((r, idx) => (
          <View
            key={r.localId}
            className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <Input
              label={`Question ${idx + 1}`}
              value={r.prompt}
              onChangeText={(v) => update(idx, { prompt: v })}
              placeholder="Do you have a heart condition?"
              multiline
              numberOfLines={2}
              autoCapitalize="sentences"
            />
            <View className="flex-row items-center gap-3">
              <View className="flex-1">
                <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                  Raise health flag on "yes"
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  Turn off for non-medical prompts (goals, preferences).
                </Text>
              </View>
              <Switch
                value={r.flag_on_yes}
                onValueChange={(v) => update(idx, { flag_on_yes: v })}
              />
              <Pressable
                onPress={() => remove(idx)}
                hitSlop={8}
                className="active:opacity-70">
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        onPress={add}
        className="flex-row items-center gap-2 self-start px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
        <Ionicons name="add" size={16} color="#6B7280" />
        <Text className="text-gray-500 dark:text-gray-400">Add question</Text>
      </Pressable>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      <Button onPress={() => publish.mutate()} loading={publish.isPending} success={saved}>
        {active.data ? 'Publish new version' : 'Publish PAR-Q'}
      </Button>

      <Text className="text-gray-400 dark:text-gray-500 text-xs">
        Publishing creates a new version. Existing responses stay tied to
        the version members saw at submission, and every member will be
        prompted to re-fill the new one on their next visit.
      </Text>
    </View>
  );
}

export default function ParqPage() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            PAR-Q
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Health screening questions every member fills in.
          </Text>
        </View>
        <ParqPanel />
      </ScrollView>
    </Screen>
  );
}
