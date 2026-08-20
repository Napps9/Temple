import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
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
                ? 'border-primary bg-primary/10'
                : 'border-gray-200 dark:border-gray-700'
            }`}>
            <Text
              className={`text-sm font-semibold text-center ${
                promptMode === m ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
              }`}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {promptMode === 'generate' ? (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Your plans, schedule, class types and coaches are included automatically. These five
            fill in what only you know — every one is optional, but the first is where the sales
            happen.
          </Text>
          <Input
            label="Your intro offer — what gets someone through the door?"
            value={answers.intro_offer}
            onChangeText={(t) => setAnswers((a) => ({ ...a, intro_offer: t }))}
            multiline
            placeholder={`First class free. Or: ${symbol}19 trial week, no commitment…`}
          />
          <Input
            label="Where should a brand-new member start?"
            value={answers.beginner_start}
            onChangeText={(t) => setAnswers((a) => ({ ...a, beginner_start: t }))}
            multiline
            placeholder="Book any Foundations class — coaches take it from there…"
          />
          <Input
            label="Which classes suit beginners vs advanced?"
            value={answers.levels}
            onChangeText={(t) => setAnswers((a) => ({ ...a, levels: t }))}
            multiline
            placeholder="Foundations & Sweat are beginner-friendly; Comp is advanced…"
          />
          <Input
            label="Location, parking, how to find you"
            value={answers.location}
            onChangeText={(t) => setAnswers((a) => ({ ...a, location: t }))}
            multiline
            placeholder="Rivington St, behind the station; free parking after 6pm…"
          />
          <Input
            label="The questions you answer most — with your answers"
            value={answers.faq}
            onChangeText={(t) => setAnswers((a) => ({ ...a, faq: t }))}
            multiline
            numberOfLines={3}
            placeholder={
              `Do you do drop-ins? Yes, ${symbol}15.\nDo I need to be fit first? No — everything scales.`
            }
          />
          <View className="gap-1.5">
            <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
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
                      sel ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-700'
                    }`}>
                    <Text
                      className={`text-xs font-semibold text-center ${
                        sel ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
                      }`}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text className="text-gray-400 dark:text-gray-500 text-xs">
              {TONES.find((t) => t.id === answers.tone)?.desc}
            </Text>
          </View>
          <Button
            variant="secondary"
            icon="sparkles"
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

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          The agent's brief
        </Text>
        <Input
          label="Edit anything before saving — it's yours"
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
