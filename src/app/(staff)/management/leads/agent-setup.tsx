import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { DurationField } from '@/components/DurationField';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { VoiceSampleButton } from '@/components/VoiceSampleButton';
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

type Tone = 'friendly' | 'professional' | 'high_energy';

const STEPS = ['Welcome', 'What it says', 'Voice', 'Recording', 'Test & go live'];

const TONES: { id: Tone; label: string; desc: string }[] = [
  { id: 'friendly', label: 'Friendly', desc: 'Warm, like your best front-desk person' },
  { id: 'professional', label: 'Professional', desc: 'Polished and precise' },
  { id: 'high_energy', label: 'High-energy', desc: 'Upbeat and enthusiastic' },
];

function suggestedRegion(tz: string | null, currency: string | null): string {
  const t = tz ?? '';
  if (t.startsWith('Europe/Dublin')) return 'Ireland';
  if (t.startsWith('Australia/')) return 'Australia';
  if (t.startsWith('Pacific/Auckland')) return 'New Zealand';
  if (t.startsWith('Africa/')) return 'South Africa';
  if (t.startsWith('America/Toronto') || t.startsWith('America/Vancouver')) return 'Canada';
  if (t.startsWith('America/')) return 'US';
  if (currency === 'EUR') return 'Ireland';
  if (currency === 'USD') return 'US';
  if (currency === 'CAD') return 'Canada';
  if (currency === 'AUD') return 'Australia';
  if (currency === 'NZD') return 'New Zealand';
  if (currency === 'ZAR') return 'South Africa';
  return 'UK, RP';
}

export default function AgentSetupWizard() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const isOwner = membership?.role === 'owner';
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [promptMode, setPromptMode] = useState<'generate' | 'manual'>('generate');
  const [answers, setAnswers] = useState({
    intro_offer: '',
    beginner_start: '',
    levels: '',
    location: '',
    faq: '',
    tone: 'friendly' as Tone,
  });
  const [promptText, setPromptText] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [recOn, setRecOn] = useState<boolean | null>(null);
  const [recRetention, setRecRetention] = useState<string | null>(null);
  const [answerCalls, setAnswerCalls] = useState<boolean | null>(null);
  // What the last generate produced — so "Regenerate" can warn before it
  // replaces a brief the owner has since edited by hand.
  const lastGenerated = useRef<string | null>(null);

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

  // What the platform already knows — shown as proof on the welcome step and
  // used to suggest a voice that matches the gym's part of the world.
  const gymInfo = useQuery({
    queryKey: ['agent-setup-info', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async () => {
      const now = new Date();
      const weekOut = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
      const [gym, plans, sessions, coaches] = await Promise.all([
        supabase.from('gyms').select('timezone, currency').eq('id', membership!.gymId).single(),
        supabase
          .from('membership_plans')
          .select('plan_id', { count: 'exact', head: true })
          .eq('gym_id', membership!.gymId)
          .is('archived_at', null),
        supabase
          .from('class_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', membership!.gymId)
          .gte('starts_at', now.toISOString())
          .lte('starts_at', weekOut.toISOString()),
        supabase
          .from('gym_memberships')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', membership!.gymId)
          .is('left_at', null)
          .in('role', ['owner', 'coach']),
      ]);
      return {
        timezone: (gym.data?.timezone as string | null) ?? null,
        currency: (gym.data?.currency as string | null) ?? null,
        plans: plans.count ?? 0,
        sessions: sessions.count ?? 0,
        coaches: coaches.count ?? 0,
      };
    },
  });

  // Seed drafts once from the saved settings.
  useEffect(() => {
    if (!agent.isSuccess) return;
    if (promptText === null) setPromptText(agent.data?.context ?? '');
    if (selectedVoice === null) setSelectedVoice(agent.data?.voice_id ?? '');
    if (recOn === null) setRecOn(agent.data?.call_recording_enabled ?? true);
    if (recRetention === null)
      setRecRetention(String(agent.data?.call_recording_retention_days ?? 90));
    if (answerCalls === null) setAnswerCalls(agent.data?.voice_enabled ?? false);
  }, [agent.isSuccess, agent.data, promptText, selectedVoice, recOn, recRetention, answerCalls]);

  const region = suggestedRegion(gymInfo.data?.timezone ?? null, gymInfo.data?.currency ?? null);
  const suggestedVoices = AGENT_VOICES.filter((v) => v.region === region);
  const otherVoices = AGENT_VOICES.filter((v) => v.region !== region);

  // No saved voice yet: preselect the first suggested one so the fast path
  // through this step is a single tap.
  useEffect(() => {
    const first = suggestedVoices[0] ?? AGENT_VOICES[0];
    if (selectedVoice === '' && first && gymInfo.isSuccess) {
      setSelectedVoice(first.id);
    }
  }, [selectedVoice, gymInfo.isSuccess, suggestedVoices]);

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
      if (prompt) {
        setPromptText(prompt);
        lastGenerated.current = prompt;
      }
    },
    onError: (e) => setError(errorMessage(e, 'Could not draft the brief')),
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
    onError: (e) => setError(errorMessage(e, 'Could not save the brief')),
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
        p_enabled: recOn ?? true,
        p_retention_days: Number.isFinite(days) ? days : 90,
      });
      if (e) throw e;
      // The greeting's recording notice follows this toggle.
      await syncVapiAssistant(membership!.gymId);
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
  const editedSinceGenerate =
    !!promptText?.trim() && promptText !== lastGenerated.current;

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
              It picks up texts and calls from new leads on your gym's number,
              answers from your real plans and schedule, captures every lead on
              your board, and closes by emailing a one-time signup link. You
              review every conversation and can coach any reply.
            </Text>
            <View className="gap-1.5">
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                Already in its brief — nothing to type
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {[
                  `${gymInfo.data?.plans ?? '…'} membership plans`,
                  `${gymInfo.data?.sessions ?? '…'} classes this week`,
                  `${gymInfo.data?.coaches ?? '…'} coaches`,
                ].map((chip) => (
                  <View
                    key={chip}
                    className="flex-row items-center gap-1.5 rounded-full bg-gray-50 dark:bg-gray-800 px-3 py-1.5">
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                    <Text className="text-gray-700 dark:text-gray-200 text-xs font-medium">
                      {chip}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            <View className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {number
                  ? `Your agent number: ${number}`
                  : 'No number yet — Temple provisions one for you. You can still set everything up now.'}
              </Text>
            </View>
            <Button onPress={() => setStep(1)}>Get started — about 3 minutes</Button>
          </View>
        ) : null}

        {/* STEP 1 — Prompt */}
        {step === 1 ? (
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
                  Your plans, schedule, class types and coaches are included
                  automatically. These five fill in what only you know — every
                  one is optional, but the first is where the sales happen.
                </Text>
                <Input
                  label="Your intro offer — what gets someone through the door?"
                  value={answers.intro_offer}
                  onChangeText={(t) => setAnswers((a) => ({ ...a, intro_offer: t }))}
                  multiline
                  placeholder="First class free. Or: £19 trial week, no commitment…"
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
                    'Do you do drop-ins? Yes, £15.\nDo I need to be fit first? No — everything scales.'
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
                            sel
                              ? 'border-primary bg-primary/10'
                              : 'border-gray-200 dark:border-gray-700'
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
                  {promptText?.trim()
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
              {promptText !== null ? (
                <Input
                  label="Edit anything before saving — it's yours"
                  value={promptText}
                  onChangeText={setPromptText}
                  multiline
                  numberOfLines={10}
                  placeholder={
                    promptMode === 'generate'
                      ? 'Answer what you can above, then tap "Draft the brief" — it lands here for you to tweak.'
                      : "You are the friendly front desk for … Answer new leads, capture their name and number, and send a signup link to close."
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
              How the assistant sounds on calls. Change it any time — texts are
              unaffected.
            </Text>
            {suggestedVoices.length > 0 ? (
              <>
                <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                  Suggested for your gym
                </Text>
                <View className="gap-2">
                  {suggestedVoices.map((v) => (
                    <VoiceRow
                      key={v.id}
                      id={v.id}
                      name={v.name}
                      region={v.region}
                      gender={v.gender}
                      desc={v.desc}
                      selected={selectedVoice === v.id}
                      onPress={() => setSelectedVoice(v.id)}
                    />
                  ))}
                </View>
              </>
            ) : null}
            {otherVoices.length > 0 ? (
              <>
                <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                  {suggestedVoices.length > 0 ? 'More voices & accents' : 'Choose a voice'}
                </Text>
                <View className="gap-2">
                  {otherVoices.map((v) => (
                    <VoiceRow
                      key={v.id}
                      id={v.id}
                      name={v.name}
                      region={v.region}
                      gender={v.gender}
                      desc={v.desc}
                      selected={selectedVoice === v.id}
                      onPress={() => setSelectedVoice(v.id)}
                    />
                  ))}
                </View>
              </>
            ) : null}
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
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  Record calls for review
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  This is how the agent gets better: play a call back, tap any
                  reply, and coach it — the correction applies to every future
                  conversation. Callers hear a notice at the start; recordings
                  are private and every playback is logged.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Record calls for review"
                value={recOn ?? true}
                onValueChange={setRecOn}
              />
            </View>
            {recOn !== false && recRetention !== null ? (
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

        {/* STEP 4 — Test & go live */}
        {step === 4 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              Test it, then turn it on
            </Text>
            <View className="gap-2">
              <SummaryRow k="Brief" v={promptText && promptText.trim() ? 'Saved' : 'Not set'} />
              <SummaryRow
                k="Voice"
                v={currentVoice ? `${currentVoice.name} · ${currentVoice.region}` : 'Default'}
              />
              <SummaryRow
                k="Recording"
                v={recOn === false ? 'Off' : 'On, with caller notice'}
              />
              <SummaryRow k="Number" v={number ?? 'Provisioning'} />
            </View>
            {number ? (
              <View className="rounded-lg border border-primary/30 bg-primary/5 p-3 gap-1">
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  Take it for a spin first
                </Text>
                <Text className="text-primary text-lg font-semibold">{number}</Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  Text it from your own phone — ask about prices, say you want to
                  join. The thread appears under Conversations, where you can
                  coach any reply before real leads ever see it.
                </Text>
              </View>
            ) : null}
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

function VoiceRow({
  id,
  name,
  region,
  gender,
  desc,
  selected,
  onPress,
}: {
  id: string;
  name: string;
  region: string;
  gender: string;
  desc: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center justify-between rounded-lg border p-3 ${
        selected ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'
      }`}>
      <View className="flex-1">
        <Text className="text-gray-900 dark:text-gray-50 font-medium">
          {name}
          <Text className="text-gray-400 dark:text-gray-500 font-normal">
            {'  '}· {region}
          </Text>
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {gender} · {desc}
        </Text>
      </View>
      <View className="flex-row items-center gap-2">
        {selected ? <Text className="text-primary text-xs font-semibold">Selected</Text> : null}
        <VoiceSampleButton voiceId={id} />
      </View>
    </Pressable>
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
