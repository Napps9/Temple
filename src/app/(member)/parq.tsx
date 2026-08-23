import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { useThemeColors } from '@/lib/theme';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Questionnaire = {
  id: string;
  version: number;
};

type Question = {
  id: string;
  sort_order: number;
  prompt: string;
  flag_on_yes: boolean;
};

type Answer = {
  questionId: string;
  answeredYes: boolean | null;
  explanation: string;
};

export default function ParqForm() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const session = useSession();
  const queryClient = useQueryClient();
  // When opened for a dependent (from the Family screen), the guardian
  // completes the child's PAR-Q and returns there.
  const { subject } = useLocalSearchParams<{ subject?: string }>();
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const active = useQuery({
    queryKey: ['parq-active', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Questionnaire | null> => {
      const { data, error } = await supabase
        .from('parq_questionnaires')
        .select('id, version')
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
      const rows = (data ?? []) as Question[];
      setAnswers((prev) => {
        // Preserve any in-flight selection if the prompt list re-resolves.
        const byId = new Map(prev.map((a) => [a.questionId, a]));
        return rows.map((q) => ({
          questionId: q.id,
          answeredYes: byId.get(q.id)?.answeredYes ?? null,
          explanation: byId.get(q.id)?.explanation ?? '',
        }));
      });
      return rows;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id || !active.data) {
        throw new Error('Missing context');
      }
      if (answers.some((a) => a.answeredYes === null)) {
        throw new Error('Answer every question before submitting');
      }
      const payload = answers.map((a) => ({
        question_id: a.questionId,
        answered_yes: a.answeredYes,
        explanation: a.explanation.trim() || null,
      }));
      const { error } = await supabase.rpc('submit_parq_response', {
        p_gym_id: membership.gymId,
        p_questionnaire_id: active.data.id,
        p_answers: payload,
        ...(subject ? { p_subject_profile_id: subject } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['parq-state'] });
      queryClient.invalidateQueries({ queryKey: ['gym-membership'] });
      queryClient.invalidateQueries({ queryKey: ['dependent-screening'] });
      if (subject) {
        // Completing a child's PAR-Q returns to Family — the injury check is
        // the member's own next step, not the child's.
        router.replace('/family' as never);
      } else {
        // Health screening flows straight into the injury check — same
        // "tell us how to keep you safe" beat, so we ask while they're in
        // that headspace rather than surfacing it later on the checklist.
        router.replace('/injury-check' as never);
      }
    },
    onError: (e) => setError(errorMessage(e, 'Could not submit')),
  });

  if (active.isLoading) {
    return (
      <Screen>
        <Text className="text-ink-2 dark:text-ink-2-dk p-6">Loading…</Text>
      </Screen>
    );
  }

  if (!active.data) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-xl md:mx-auto md:w-full px-4">
          <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
            No PAR-Q yet
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk">
            Your gym hasn't published a health screening questionnaire yet.
            You can keep using the app normally.
          </Text>
          <Button onPress={() => router.replace('/book' as never)}>
            Continue
          </Button>
        </ScrollView>
      </Screen>
    );
  }

  const list = questions.data ?? [];

  function set(idx: number, patch: Partial<Answer>) {
    setAnswers((a) => a.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 md:max-w-xl md:mx-auto md:w-full px-4">
        <BackLink />
        <PageHead
          title="Health screening"
          subtitle={'Please answer honestly. Any "yes" answer on a flagged question tells the team to follow up before your first session — you can still book.'}
        />

        {list.map((q, idx) => {
          const answer = answers[idx];
          if (!answer) return null;
          return (
            <View
              key={q.id}
              className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
              <Text className="text-ink dark:text-ink-dk font-medium">
                {q.prompt}
              </Text>
              <View className="flex-row gap-2">
                <YesNoOption
                  label="Yes"
                  selected={answer.answeredYes === true}
                  onPress={() => set(idx, { answeredYes: true })}
                />
                <YesNoOption
                  label="No"
                  selected={answer.answeredYes === false}
                  onPress={() => set(idx, { answeredYes: false })}
                />
              </View>
              {answer.answeredYes === true && q.flag_on_yes ? (
                <TextInput
                  value={answer.explanation}
                  onChangeText={(t) => set(idx, { explanation: t })}
                  placeholder="Add detail (optional but helpful)"
                  placeholderTextColor={colors.ink3}
                  multiline
                  numberOfLines={3}
                  style={{ minHeight: 60, textAlignVertical: 'top' }}
                  autoCapitalize="sentences"
                  className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2 text-ink dark:text-ink-dk text-sm"
                />
              ) : null}
            </View>
          );
        })}

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        <Button onPress={() => submit.mutate()} loading={submit.isPending}>
          Submit screening
        </Button>
      </ScrollView>
    </Screen>
  );
}

function YesNoOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 px-4 py-3 rounded-ctl border items-center active:opacity-70 ${
        selected
          ? 'border-transparent bg-raised dark:bg-raised-dk'
          : 'border-line dark:border-line-dk'
      }`}>
      <Text
        className={
          selected
            ? 'text-ink dark:text-ink-dk font-semibold'
            : 'text-ink-2 dark:text-ink-2-dk'
        }>
        {label}
      </Text>
    </Pressable>
  );
}
