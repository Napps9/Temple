import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { FieldLabel } from './SectionLabel';
import { AIMark } from './AIMark';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { errorMessage } from '@/lib/errors';
import { currencySymbol } from '@/lib/setup-flow';
import { supabase } from '@/lib/supabase';
import { useGymCurrency } from '@/lib/useGymCurrency';

type Tone = 'friendly' | 'professional' | 'high_energy';

type Answers = {
  intro_offer: string;
  beginner_start: string;
  levels: string;
  location: string;
  faq: string;
  tone: Tone;
};

const TONES: { id: Tone; label: string; desc: string }[] = [
  { id: 'friendly', label: 'Friendly', desc: 'Warm, like your best front-desk person' },
  { id: 'professional', label: 'Professional', desc: 'Polished and precise' },
  { id: 'high_energy', label: 'High-energy', desc: 'Upbeat and enthusiastic' },
];

const EMPTY_ANSWERS: Answers = {
  intro_offer: '',
  beginner_start: '',
  levels: '',
  location: '',
  faq: '',
  tone: 'friendly',
};

// Shared by the setup wizard's "What it says" step and the AI Agent tab's
// "Rewrite with AI" modal — both draft the agent's brief the same way, from
// the gym's real data (plans, schedule, coaches) plus these owner answers,
// via the generate-agent-prompt edge function.
// The five prompts are questions, not field names: a full sentence in
// small caps reads as shouting, and the field below is the answer to it.
// So the question is body copy and the field carries its name only for a
// screen reader.
function Question({ children }: { children: ReactNode }) {
  return (
    <Text className="text-ink dark:text-ink-dk text-[15px] leading-[21px]">
      {children}
    </Text>
  );
}

export function AgentBriefBuilder({
  gymId,
  value,
  onChange,
}: {
  gymId: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const symbol = currencySymbol(useGymCurrency());
  const [promptMode, setPromptMode] = useState<'generate' | 'manual'>('generate');
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [error, setError] = useState<string | null>(null);
  // What the last generate produced — so "Regenerate" can warn before it
  // replaces a brief the owner has since edited by hand.
  const lastGenerated = useRef<string | null>(null);

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error: e } = await supabase.functions.invoke('generate-agent-prompt', {
        body: { gym_id: gymId, answers },
      });
      if (e) throw e;
      if (data?.error) throw new Error(data.error);
      return data?.prompt as string;
    },
    onSuccess: (prompt) => {
      setError(null);
      if (prompt) {
        onChange(prompt);
        lastGenerated.current = prompt;
      }
    },
    onError: (e) => setError(errorMessage(e, 'Could not draft the brief')),
  });

  const editedSinceGenerate = !!value?.trim() && value !== lastGenerated.current;

  return (
    <View className="gap-4">
      <View className="flex-row gap-2">
        {(
          [
            ['generate', 'Build it from my gym'],
            ['manual', 'Write it myself'],
          ] as ['generate' | 'manual', string][]
        ).map(([m, label]) => (
          <Pressable
            key={m}
            onPress={() => setPromptMode(m)}
            className={`flex-1 px-3 py-2.5 rounded-lg border ${
              promptMode === m
                ? 'border-transparent bg-raised dark:bg-raised-dk'
                : 'border-line dark:border-line-dk'
            }`}>
            <Text
              className={`text-sm font-semibold text-center ${
                promptMode === m ? 'text-ink dark:text-ink-dk font-semibold' : 'text-ink-2 dark:text-ink-2-dk'
              }`}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {promptMode === 'generate' ? (
        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Your plans, schedule, class types and coaches are included automatically. These five
            fill in what only you know — every one is optional, but the first is where the sales
            happen.
          </Text>
          <Question>Your intro offer — what gets someone through the door?</Question>
          <Input
            accessibilityLabel="Your intro offer — what gets someone through the door?"
            value={answers.intro_offer}
            onChangeText={(t) => setAnswers((a) => ({ ...a, intro_offer: t }))}
            multiline
            placeholder={`First class free. Or: ${symbol}19 trial week, no commitment…`}
          />
          <Question>Where should a brand-new member start?</Question>
          <Input
            accessibilityLabel="Where should a brand-new member start?"
            value={answers.beginner_start}
            onChangeText={(t) => setAnswers((a) => ({ ...a, beginner_start: t }))}
            multiline
            placeholder="Book any Foundations class — coaches take it from there…"
          />
          <Question>Which classes suit beginners vs advanced?</Question>
          <Input
            accessibilityLabel="Which classes suit beginners vs advanced?"
            value={answers.levels}
            onChangeText={(t) => setAnswers((a) => ({ ...a, levels: t }))}
            multiline
            placeholder="Foundations & Sweat are beginner-friendly; Comp is advanced…"
          />
          <Question>Location, parking, how to find you</Question>
          <Input
            accessibilityLabel="Location, parking, how to find you"
            value={answers.location}
            onChangeText={(t) => setAnswers((a) => ({ ...a, location: t }))}
            multiline
            placeholder="Rivington St, behind the station; free parking after 6pm…"
          />
          <Question>The questions you answer most — with your answers</Question>
          <Input
            accessibilityLabel="The questions you answer most — with your answers"
            value={answers.faq}
            onChangeText={(t) => setAnswers((a) => ({ ...a, faq: t }))}
            multiline
            numberOfLines={3}
            placeholder={
              `Do you do drop-ins? Yes, ${symbol}15.\nDo I need to be fit first? No — everything scales.`
            }
          />
          <View className="gap-1.5">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
              How should it sound?
            </Text>
            <View className="flex-row gap-2">
              {TONES.map((t) => {
                const sel = answers.tone === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setAnswers((a) => ({ ...a, tone: t.id }))}
                    className={`flex-1 rounded-lg border px-2 py-2 ${
                      sel ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
                    }`}>
                    <Text
                      className={`text-xs font-semibold text-center ${
                        sel ? 'text-ink dark:text-ink-dk font-semibold' : 'text-ink-2 dark:text-ink-2-dk'
                      }`}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
              {TONES.find((t) => t.id === answers.tone)?.desc}
            </Text>
          </View>
          <Button
            variant="secondary"
            icon={<AIMark />}
            onPress={() => generate.mutate()}
            loading={generate.isPending}>
            {value?.trim()
              ? editedSinceGenerate
                ? 'Regenerate (replaces your edits)'
                : 'Regenerate'
              : 'Draft the brief'}
          </Button>
        </View>
      ) : null}

      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
        <FieldLabel>
          The agent's brief
        </FieldLabel>
        <Question>Edit anything before saving — it&rsquo;s yours</Question>
        <Input
          accessibilityLabel="Edit anything before saving — it's yours"
          value={value}
          onChangeText={onChange}
          multiline
          numberOfLines={10}
          placeholder={
            promptMode === 'generate'
              ? 'Answer what you can above, then tap "Draft the brief" — it lands here for you to tweak.'
              : "You are the friendly front desk for … Answer new leads, capture their name and number, and send a signup link to close."
          }
        />
      </View>

      {error ? <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text> : null}
    </View>
  );
}
