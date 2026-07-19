import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { DurationField } from '@/components/DurationField';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { syncVapiAssistant } from '@/lib/agent-sync';
import { AGENT_VOICES } from '@/lib/agent-voices';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

type AgentSettings = {
  enabled: boolean;
  phone_number: string | null;
  voice_enabled: boolean;
  vapi_assistant_id: string | null;
  context: string | null;
  voice_id: string | null;
  call_recording_enabled: boolean;
  call_recording_retention_days: number;
};

const STEPS = ['Welcome', 'What it says', 'Voice', 'Recording', 'Go live'];

export default function AgentSetupWizard() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const isOwner = membership?.role === 'owner';
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [promptMode, setPromptMode] = useState<'generate' | 'manual'>('generate');
  const [answers, setAnswers] = useState({
    levels: '',
    beginner_start: '',
    onboarding: '',
    location: '',
    extra: '',
  });
  const [promptText, setPromptText] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [recRetention, setRecRetention] = useState<string | null>(null);
  const [answerCalls, setAnswerCalls] = useState<boolean | null>(null);

  const agent = useQuery({
    queryKey: ['agent-settings', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<AgentSettings | null> => {
      const { data, error: e } = await supabase
        .from('gym_agent_settings')
        .select(
          'enabled, phone_number, voice_enabled, vapi_assistant_id, context, voice_id, call_recording_enabled, call_recording_retention_days',
        )
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (e) throw e;
      return (data as AgentSettings) ?? null;
    },
  });

  // Seed drafts once from the saved settings.
  useEffect(() => {
    if (!agent.isSuccess) return;
    if (promptText === null) setPromptText(agent.data?.context ?? '');
    if (selectedVoice === null) setSelectedVoice(agent.data?.voice_id ?? '');
    if (recRetention === null)
      setRecRetention(String(agent.data?.call_recording_retention_days ?? 90));
    if (answerCalls === null) setAnswerCalls(agent.data?.voice_enabled ?? false);
  }, [agent.isSuccess, agent.data, promptText, selectedVoice, recRetention, answerCalls]);

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error: e } = await supabase.functions.invoke('generate-agent-prompt', {
        body: { gym_id: membership!.gymId, answers },
      });
      if (e) throw e;
      if (data?.error) throw new Error(data.error);
      return data?.prompt as string;
    },
    onSuccess: (prompt) => {
      setError(null);
      if (prompt) setPromptText(prompt);
    },
    onError: (e) => setError(errorMessage(e, 'Could not draft the prompt')),
  });

  const saveContext = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('set_gym_agent_context', {
        p_gym_id: membership!.gymId,
        p_context: promptText ?? '',
      });
      if (e) throw e;
      await syncVapiAssistant(membership!.gymId);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
      setStep(2);
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the prompt')),
  });

  const saveVoice = useMutation({
    mutationFn: async () => {
      const v = AGENT_VOICES.find((x) => x.id === selectedVoice);
      if (!v) {
        setStep(3);
        return;
      }
      const { error: e } = await supabase.rpc('set_gym_agent_voice_selection', {
        p_gym_id: membership!.gymId,
        p_provider: v.provider,
        p_voice_id: v.id,
        p_region: v.region,
      });
      if (e) throw e;
      await syncVapiAssistant(membership!.gymId);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
      setStep(3);
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the voice')),
  });

  const saveRecording = useMutation({
    mutationFn: async () => {
      const days = parseInt(recRetention ?? '', 10);
      const { error: e } = await supabase.rpc('set_gym_call_recording', {
        p_gym_id: membership!.gymId,
        p_enabled: agent.data?.call_recording_enabled ?? true,
        p_retention_days: Number.isFinite(days) ? days : 90,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
      setStep(4);
    },
    onError: (e) => setError(errorMessage(e, 'Could not save recording settings')),
  });

  const goLive = useMutation({
    mutationFn: async () => {
      const { error: e1 } = await supabase.rpc('set_gym_agent_voice', {
        p_gym_id: membership!.gymId,
        p_enabled: !!answerCalls,
      });
      if (e1) throw e1;
      const { error: e2 } = await supabase.rpc('set_gym_agent_enabled', {
        p_gym_id: membership!.gymId,
        p_enabled: true,
      });
      if (e2) throw e2;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
      router.replace('/management/leads');
    },
    onError: (e) => setError(errorMessage(e, 'Could not turn on the agent')),
  });

  if (membership && !isOwner) return <Redirect href="/management/leads" />;
  if (!membership) return null;

  const number = agent.data?.phone_number ?? null;
  const voiceReady = !!agent.data?.vapi_assistant_id;
  const currentVoice = AGENT_VOICES.find((v) => v.id === selectedVoice) ?? null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="CRM" fallbackHref="/management/leads" />

        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Ionicons name="sparkles" size={22} color={colors.primary} />
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              AI Sales Agent
            </Text>
          </View>
          <View className="flex-row gap-1.5">
            {STEPS.map((s, i) => (
              <View
                key={s}
                className={`h-1.5 flex-1 rounded-full ${
                  i < step
                    ? 'bg-green-500'
                    : i === step
                      ? 'bg-primary'
                      : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            ))}
          </View>
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </Text>
        </View>

        {/* STEP 0 — Welcome */}
        {step === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              An assistant that answers and sells for you
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              It picks up texts and calls from new leads on your gym's number, answers
              from your real plans and schedule, captures the lead here, and texts a
              signup link to close. Takes about 5 minutes to set up.
            </Text>
            <View className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {number
                  ? `Your agent number: ${number}`
                  : 'No number yet — Temple provisions one for you. You can still set everything up now.'}
              </Text>
            </View>
            <Button onPress={() => setStep(1)}>Get started</Button>
          </View>
        ) : null}

        {/* STEP 1 — Prompt */}
        {step === 1 ? (
          <View className="gap-4">
            <View className="flex-row gap-2">
              {(
                [
                  ['generate', 'Generate from my gym'],
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
                  We'll use your plans, schedule, class types, coaches and location. A
                  few notes make it much better — all optional.
                </Text>
                <Input
                  label="Which classes suit beginners / intermediate / advanced?"
                  value={answers.levels}
                  onChangeText={(t) => setAnswers((a) => ({ ...a, levels: t }))}
                  multiline
                  placeholder="Foundations & Sweat are beginner-friendly; Comp is advanced…"
                />
                <Input
                  label="Where should a brand-new member start?"
                  value={answers.beginner_start}
                  onChangeText={(t) => setAnswers((a) => ({ ...a, beginner_start: t }))}
                  multiline
                  placeholder="Book a free intro, then the 3-class starter…"
                />
                <Input
                  label="Onboarding & waivers"
                  value={answers.onboarding}
                  onChangeText={(t) => setAnswers((a) => ({ ...a, onboarding: t }))}
                  multiline
                  placeholder="Sign the waiver before the first session; PAR-Q at signup…"
                />
                <Input
                  label="Location & parking"
                  value={answers.location}
                  onChangeText={(t) => setAnswers((a) => ({ ...a, location: t }))}
                  multiline
                  placeholder="Rivington St, behind the station; free parking after 6pm…"
                />
                <Button
                  variant="secondary"
                  icon="sparkles"
                  onPress={() => generate.mutate()}
                  loading={generate.isPending}>
                  {promptText ? 'Regenerate' : 'Generate the prompt'}
                </Button>
              </View>
            ) : null}

            <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                The agent's brief
              </Text>
              {promptText !== null ? (
                <Input
                  label="Edit anything before saving"
                  value={promptText}
                  onChangeText={setPromptText}
                  multiline
                  numberOfLines={10}
                  placeholder={
                    promptMode === 'generate'
                      ? 'Tap "Generate the prompt" above, then tweak it here.'
                      : "You are the friendly front desk for … Answer new leads, capture their name and number, and text a signup link to join."
                  }
                />
              ) : null}
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button variant="ghost" onPress={() => setStep(0)}>
                    Back
                  </Button>
                </View>
                <View className="flex-1">
                  <Button
                    onPress={() => saveContext.mutate()}
                    loading={saveContext.isPending}
                    disabled={!promptText || !promptText.trim()}>
                    Save &amp; continue
                  </Button>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* STEP 2 — Voice */}
        {step === 2 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              How the assistant sounds on calls. You can change it any time.
            </Text>
            <View className="gap-2">
              {AGENT_VOICES.map((v) => {
                const sel = selectedVoice === v.id;
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => setSelectedVoice(v.id)}
                    className={`flex-row items-center justify-between rounded-lg border p-3 ${
                      sel ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'
                    }`}>
                    <View className="flex-1">
                      <Text className="text-gray-900 dark:text-gray-50 font-medium">
                        {v.name}
                        <Text className="text-gray-400 dark:text-gray-500 font-normal">
                          {'  '}· {v.region}
                        </Text>
                      </Text>
                      <Text className="text-gray-500 dark:text-gray-400 text-xs">
                        {v.gender} · {v.desc}
                      </Text>
                    </View>
                    {sel ? <Text className="text-primary text-xs font-semibold">Selected</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button variant="ghost" onPress={() => setStep(1)}>
                  Back
                </Button>
              </View>
              <View className="flex-1">
                <Button onPress={() => saveVoice.mutate()} loading={saveVoice.isPending}>
                  Save &amp; continue
                </Button>
              </View>
            </View>
          </View>
        ) : null}

        {/* STEP 3 — Recording */}
        {step === 3 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">
              Record calls for review
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              A short consent line plays at the start of every call. Recordings let you
              review and coach the agent. Stored privately; every playback is logged.
            </Text>
            {recRetention !== null ? (
              <DurationField
                label="Delete recordings after"
                value={recRetention}
                onChange={setRecRetention}
                base="days"
                units={['days', 'weeks', 'months']}
                placeholder="90"
              />
            ) : null}
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button variant="ghost" onPress={() => setStep(2)}>
                  Back
                </Button>
              </View>
              <View className="flex-1">
                <Button onPress={() => saveRecording.mutate()} loading={saveRecording.isPending}>
                  Save &amp; continue
                </Button>
              </View>
            </View>
          </View>
        ) : null}

        {/* STEP 4 — Go live */}
        {step === 4 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              Turn it on
            </Text>
            <View className="gap-2">
              <SummaryRow k="Prompt" v={promptText && promptText.trim() ? 'Saved' : 'Not set'} />
              <SummaryRow k="Voice" v={currentVoice ? `${currentVoice.name} · ${currentVoice.region}` : 'Default'} />
              <SummaryRow k="Number" v={number ?? 'Provisioning'} />
            </View>
            <View className="flex-row items-center justify-between gap-3 pt-1">
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  Answer phone calls too
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {voiceReady
                    ? 'Picks up calls, not just texts.'
                    : 'Voice isn\'t provisioned yet — texts work now; missed calls get a "text us back" reply.'}
                </Text>
              </View>
              <Switch
                accessibilityLabel="Answer phone calls too"
                value={!!answerCalls && voiceReady}
                disabled={!voiceReady}
                onValueChange={setAnswerCalls}
              />
            </View>
            <Button onPress={() => goLive.mutate()} loading={goLive.isPending}>
              Turn on the AI Sales Agent
            </Button>
            <Button variant="ghost" onPress={() => setStep(3)}>
              Back
            </Button>
          </View>
        ) : null}

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <View className="flex-row items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2.5">
      <Text className="text-gray-500 dark:text-gray-400 text-sm">{k}</Text>
      <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">{v}</Text>
    </View>
  );
}
