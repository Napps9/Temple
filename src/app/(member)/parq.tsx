import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ListRow, RuledList } from '@/components/ListRow';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { FieldLabel } from '@/components/SectionLabel';
import { useThemeColors } from '@/lib/theme';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  canAdvance,
  initialStep,
  isReview,
  progressFraction,
  progressLabel,
} from '@/lib/parq-steps';
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

// Who sees a health answer, stated on every screen of the form rather
// than once in a privacy policy nobody opens.
const PRIVACY_LINE =
  'Only your coaches see this, and only while you are a member here.';

export default function ParqForm() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const session = useSession();
  const queryClient = useQueryClient();
  // When opened for a dependent (from the Family screen), the guardian
  // completes the child's PAR-Q and returns there.
  const params = useLocalSearchParams<{ subject?: string; step?: string }>();
  const subject = params.subject;
  const [answers, setAnswers] = useState<Answer[]>([]);
  // null = not chosen yet; set once the questions land (?step= wins for
  // deep links and the harness, otherwise the first unanswered question).
  const [step, setStep] = useState<number | null>(
    typeof params.step === 'string' && /^\d+$/.test(params.step)
      ? Number(params.step)
      : null,
  );
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
          <EmptyState
            icon="medkit-outline"
            title="No PAR-Q yet"
            description="Your gym hasn't published a health screening questionnaire yet. You can keep using the app normally."
            actionLabel="Continue"
            actionIcon="arrow-forward"
            onAction={() => router.replace('/book' as never)}
          />
        </ScrollView>
      </Screen>
    );
  }

  const list = questions.data ?? [];
  const total = list.length;
  // Pin the step the first time the questions land: deriving it live
  // from the answers would auto-advance on every selection, and a "yes"
  // would jump away before its explanation box could be used.
  if (step === null && answers.length > 0) {
    setStep(initialStep(answers));
  }
  const current = Math.min(step ?? initialStep(answers), total);
  const onReview = isReview(current, total);
  const question = onReview ? null : list[current];
  const answer = onReview ? null : answers[current];

  function set(idx: number, patch: Partial<Answer>) {
    setAnswers((a) => a.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  if (total === 0 || !answers.length) {
    return (
      <Screen>
        <Text className="text-ink-2 dark:text-ink-2-dk p-6">Loading…</Text>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-5 py-6 md:max-w-xl md:mx-auto md:w-full px-4">
        <BackLink />
        <PageHead
          title="Health screening"
          subtitle={
            current === 0
              ? 'Please answer honestly. Any "yes" answer on a flagged question tells the team to follow up before your first session — you can still book.'
              : undefined
          }
        />

        <View className="gap-1.5">
          <View className="flex-row items-center justify-between">
            <FieldLabel>{progressLabel(current, total)}</FieldLabel>
            {!onReview ? (
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                Once a year, then you are done
              </Text>
            ) : null}
          </View>
          <View className="h-1 rounded-full bg-raised dark:bg-raised-dk overflow-hidden">
            <View
              className="h-1 rounded-full bg-primary"
              style={{ width: `${progressFraction(current, total) * 100}%` }}
            />
          </View>
        </View>

        {onReview ? (
          <View className="gap-2">
            <RuledList>
              {list.map((q, idx) => (
                <ListRow
                  key={q.id}
                  ruled
                  first={idx === 0}
                  title={q.prompt}
                  subtitle={
                    answers[idx]?.explanation.trim()
                      ? answers[idx].explanation.trim()
                      : undefined
                  }
                  onPress={() => setStep(idx)}
                  chip={
                    <View
                      className={`rounded-full px-2.5 py-0.5 ${
                        answers[idx]?.answeredYes
                          ? 'bg-amber-500/15'
                          : 'bg-raised dark:bg-raised-dk'
                      }`}>
                      <Text
                        className={`text-xs font-semibold ${
                          answers[idx]?.answeredYes
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-ink-2 dark:text-ink-2-dk'
                        }`}>
                        {answers[idx]?.answeredYes ? 'Yes' : 'No'}
                      </Text>
                    </View>
                  }
                />
              ))}
            </RuledList>
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
              Tap an answer to change it. {PRIVACY_LINE}
            </Text>
          </View>
        ) : question && answer ? (
          <View className="gap-4">
            <Text className="text-ink dark:text-ink-dk text-xl font-semibold leading-7">
              {question.prompt}
            </Text>
            <View className="flex-row gap-2">
              <YesNoOption
                label="Yes"
                selected={answer.answeredYes === true}
                onPress={() => set(current, { answeredYes: true })}
              />
              <YesNoOption
                label="No"
                selected={answer.answeredYes === false}
                onPress={() => set(current, { answeredYes: false })}
              />
            </View>
            {answer.answeredYes === true && question.flag_on_yes ? (
              <TextInput
                value={answer.explanation}
                onChangeText={(t) => set(current, { explanation: t })}
                placeholder="Add detail (optional but helpful)"
                placeholderTextColor={colors.ink3}
                multiline
                numberOfLines={3}
                style={{ minHeight: 72, textAlignVertical: 'top' }}
                autoCapitalize="sentences"
                className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2 text-ink dark:text-ink-dk text-sm"
              />
            ) : null}
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
              {PRIVACY_LINE}
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
      </ScrollView>

      <View className="border-t border-line dark:border-line-dk px-4 py-3 md:max-w-xl md:mx-auto md:w-full flex-row gap-2">
        {current > 0 ? (
          <View className="flex-1">
            <Button
              variant="secondary"
              onPress={() => setStep(Math.max(0, current - 1))}>
              Back
            </Button>
          </View>
        ) : null}
        <View className="flex-1">
          {onReview ? (
            <Button onPress={() => submit.mutate()} loading={submit.isPending}>
              Submit screening
            </Button>
          ) : (
            <Button
              onPress={() => setStep(current + 1)}
              disabled={!canAdvance(current, answers)}>
              Next
            </Button>
          )}
        </View>
      </View>
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
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`flex-1 px-4 py-4 rounded-ctl border items-center active:opacity-70 ${
        selected
          ? 'border-transparent bg-raised dark:bg-raised-dk'
          : 'border-line dark:border-line-dk'
      }`}>
      <Text
        className={
          selected
            ? 'text-ink dark:text-ink-dk font-semibold text-base'
            : 'text-ink-2 dark:text-ink-2-dk text-base'
        }>
        {label}
      </Text>
    </Pressable>
  );
}
