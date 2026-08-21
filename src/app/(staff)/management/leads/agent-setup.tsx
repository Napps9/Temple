import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { PageHead } from '@/components/PageHead';
import { Text } from '@/components/Text';

import { AgentBriefBuilder } from '@/components/AgentBriefBuilder';
import { BackLink } from '@/components/BackLink';
import { BrandGradientHero } from '@/components/BrandGradientHero';
import { Button } from '@/components/Button';
import { DurationField } from '@/components/DurationField';
import { Screen } from '@/components/Screen';
import { FieldLabel } from '@/components/SectionLabel';
import { TalkToAssistant } from '@/components/TalkToAssistant';
import { VoiceSampleButton } from '@/components/VoiceSampleButton';
import { provisionFrontDesk, syncVapiAssistant } from '@/lib/agent-sync';
import { AGENT_VOICES } from '@/lib/agent-voices';
import { useGymMembership } from '@/lib/auth';
import { contrastRatio } from '@/lib/contrast';
import { copyToClipboard } from '@/lib/clipboard';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';

type AgentSettings = {
  enabled: boolean;
  phone_number: string | null;
  voice_enabled: boolean;
  vapi_assistant_id: string | null;
  context: string | null;
  voice_id: string | null;
  call_recording_enabled: boolean;
  call_recording_retention_days: number;
  front_desk_entitled: boolean;
  provision_status: string;
};

const STEPS = ['Welcome', 'What it says', 'Voice', 'Recording', 'Test & go live'];

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
  const brand = useGymBrand();
  const { data: membership } = useGymMembership();
  const isOwner = membership?.role === 'owner';
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [recOn, setRecOn] = useState<boolean | null>(null);
  const [recRetention, setRecRetention] = useState<string | null>(null);
  const [answerCalls, setAnswerCalls] = useState<boolean | null>(null);
  const [showTextTest, setShowTextTest] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [justWentLive, setJustWentLive] = useState(false);
  // provision-front-desk is one synchronous call (buy number, create
  // assistant, import number) with no progress signal of its own — this
  // just advances a 3-item checklist on a timer so the wait isn't a dead
  // spinner. It caps at the last item until the real request resolves.
  const [provisionStep, setProvisionStep] = useState(0);
  const provisionTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const agent = useQuery({
    queryKey: ['agent-settings', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<AgentSettings | null> => {
      const { data, error: e } = await supabase
        .from('gym_agent_settings')
        .select(
          'enabled, phone_number, voice_enabled, vapi_assistant_id, context, voice_id, call_recording_enabled, call_recording_retention_days, front_desk_entitled, provision_status',
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

  const provision = useMutation({
    mutationFn: async () => {
      await provisionFrontDesk(membership!.gymId);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, "Couldn't set up your number")),
    onSettled: () => {
      if (provisionTimer.current) {
        clearInterval(provisionTimer.current);
        provisionTimer.current = null;
      }
    },
  });

  function startProvisioning() {
    setProvisionStep(0);
    if (provisionTimer.current) clearInterval(provisionTimer.current);
    provisionTimer.current = setInterval(() => {
      setProvisionStep((s) => (s < 2 ? s + 1 : s));
    }, 3500);
    provision.mutate();
  }

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
      setJustWentLive(true);
    },
    onError: (e) => setError(errorMessage(e, 'Could not turn on the agent')),
  });

  if (membership && !isOwner) return <Redirect href="/management/leads" />;
  if (!membership) return null;

  const number = agent.data?.phone_number ?? null;
  const voiceReady = !!agent.data?.vapi_assistant_id;
  // Entitled by default (0163) - a gym with no settings row yet is a paying
  // customer same as any other, so absence reads the same as an explicit
  // true. Only an explicit false (a manual off-switch) reads as not entitled.
  const frontDeskEntitled = agent.data?.front_desk_entitled ?? true;
  const provisionFailed = agent.data?.provision_status === 'failed';
  const currentVoice = AGENT_VOICES.find((v) => v.id === selectedVoice) ?? null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management/leads" />

        <View className="gap-2">
          <PageHead
            lead={
              <Ionicons
                name="sparkles"
                size={22}
                color={colors.primary}
                style={{ marginTop: 4 }}
              />
            }
            title="AI Sales Agent"
          />
          <View className="flex-row gap-1.5">
            {STEPS.map((s, i) => (
              <View
                key={s}
                className={`h-1.5 flex-1 rounded-full ${
                  i < step
                    ? 'bg-green-500'
                    : i === step
                      ? 'bg-primary'
                      : 'bg-sunken dark:bg-sunken-dk'
                }`}
              />
            ))}
          </View>
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </Text>
        </View>

        {/* STEP 0 — Welcome */}
        {step === 0 ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
            <Text className="text-ink dark:text-ink-dk text-lg font-semibold">
              An assistant that answers and sells for you
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              It picks up texts and calls from new leads on your gym's number,
              answers from your real plans and schedule, captures every lead on
              your board, and closes by emailing a one-time signup link. You
              review every conversation and can coach any reply.
            </Text>
            <View className="gap-1.5">
              <FieldLabel>
                Already in its brief — nothing to type
              </FieldLabel>
              <View className="flex-row flex-wrap gap-2">
                {[
                  `${gymInfo.data?.plans ?? '…'} membership plans`,
                  `${gymInfo.data?.sessions ?? '…'} classes this week`,
                  `${gymInfo.data?.coaches ?? '…'} coaches`,
                ].map((chip) => (
                  <View
                    key={chip}
                    className="flex-row items-center gap-1.5 rounded-full bg-raised dark:bg-raised-dk px-3 py-1.5">
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-medium">
                      {chip}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            <View className="rounded-lg bg-raised dark:bg-raised-dk p-3">
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                {number
                  ? `Your agent number: ${number}`
                  : 'No number yet — Temple provisions one for you. You can still set everything up now.'}
              </Text>
            </View>
            <Button onPress={() => setStep(1)}>Get started — about 3 minutes</Button>
          </View>
        ) : null}

        {/* STEP 1 — Prompt */}
        {step === 1 && promptText !== null ? (
          <View className="gap-4">
            <AgentBriefBuilder
              gymId={membership.gymId}
              value={promptText}
              onChange={setPromptText}
            />
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
        ) : null}

        {/* STEP 2 — Voice */}
        {step === 2 ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              How the assistant sounds on calls. Change it any time — texts are
              unaffected.
            </Text>
            {suggestedVoices.length > 0 ? (
              <>
                <FieldLabel>
                  Suggested for your gym
                </FieldLabel>
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
                <FieldLabel>
                  {suggestedVoices.length > 0 ? 'More voices & accents' : 'Choose a voice'}
                </FieldLabel>
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
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dk font-medium">
                  Record calls for review
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
        {step === 4 && justWentLive ? (
          <LiveHero
            gymName={brand.gymName}
            number={number}
            primaryColor={colors.primary}
            onDone={() => router.replace('/management/leads')}
          />
        ) : step === 4 ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
            <Text className="text-ink dark:text-ink-dk text-lg font-semibold">
              Test it, then turn it on
            </Text>

            {/* Browser call needs only the assistant, never the number — a
                gym waiting on the Twilio bundle can still talk to its AI.
                Web-only: the native TalkToAssistant is a hard no-op, so the
                pitch card would be a dead button there. */}
            {voiceReady && Platform.OS === 'web' && !talkOpen ? (
              <View className="rounded-xl border-[1.5px] border-primary bg-surface dark:bg-surface-dk p-4 gap-2.5">
                <View className="flex-row items-center gap-3">
                  <View className="w-9 h-9 rounded-lg bg-primary/10 items-center justify-center">
                    <Ionicons name="mic" size={16} color={colors.primary} />
                  </View>
                  <Text className="text-ink dark:text-ink-dk font-semibold text-base">
                    Talk to it now
                  </Text>
                </View>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Hear it live in the browser before anyone else does — no
                  phone, no waiting on a number.
                </Text>
                <Button onPress={() => setTalkOpen(true)}>Start talking</Button>
              </View>
            ) : voiceReady && Platform.OS === 'web' ? (
              <TalkToAssistant assistantId={agent.data?.vapi_assistant_id ?? null} gymName={brand.gymName} />
            ) : null}

            {number ? (
              <>
                <Pressable onPress={() => setShowTextTest((s) => !s)} className="py-1">
                  <Text className="text-ink-3 dark:text-ink-3-dk text-xs text-center underline">
                    {showTextTest
                      ? 'Hide'
                      : voiceReady && Platform.OS === 'web'
                        ? 'or text it from your own phone instead'
                        : 'Test it by text from your own phone'}
                  </Text>
                </Pressable>
                {showTextTest ? (
                  <View className="rounded-lg border border-primary/30 bg-primary/5 p-3 gap-1">
                    <Text className="text-ink dark:text-ink-dk font-medium">
                      Take it for a spin
                    </Text>
                    <Text className="text-primary text-lg font-semibold">{number}</Text>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      Text it from your own phone — ask about prices, say you want
                      to join. The thread appears under Conversations, where you
                      can coach any reply before real leads ever see it.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}

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
              <SummaryRow
                k="Number"
                v={number ?? (frontDeskEntitled ? 'Not set up yet' : 'Not on your plan')}
              />
            </View>

            {number ? (
              <>
                <View className="flex-row items-center justify-between gap-3 pt-1">
                  <View className="flex-1">
                    <Text className="text-ink dark:text-ink-dk font-medium">
                      Answer phone calls too
                    </Text>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
              </>
            ) : frontDeskEntitled && provision.isPending ? (
              <ProvisioningChecklist step={provisionStep} resuming={provisionFailed} />
            ) : frontDeskEntitled ? (
              <View className="rounded-lg border border-primary/30 bg-primary/5 p-3 gap-2">
                <Text className="text-ink dark:text-ink-dk font-medium">
                  {provisionFailed ? 'Something went wrong' : 'Ready to go live'}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {provisionFailed
                    ? "We couldn't finish setting up your number. It's safe to try again — your progress was saved, so this won't buy a second number."
                    : 'Temple sets up a real phone number for texts and calls, in a few seconds.'}
                </Text>
                <Button onPress={startProvisioning} loading={provision.isPending}>
                  {provisionFailed ? 'Try again' : 'Set up my number'}
                </Button>
                {provision.error ? (
                  <Text className="text-red-500 dark:text-red-400 text-xs">
                    {errorMessage(provision.error, "Couldn't set up your number")}
                  </Text>
                ) : null}
              </View>
            ) : (
              <View className="rounded-lg border border-line dark:border-line-dk p-3 gap-1">
                <Text className="text-ink dark:text-ink-dk font-medium">
                  Not on your plan yet
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Answering calls and texts needs phone &amp; text access —
                  contact Temple to turn it on, then come back and go live in
                  one tap.
                </Text>
              </View>
            )}

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
        selected ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
      }`}>
      <View className="flex-1">
        <Text className="text-ink dark:text-ink-dk font-medium">
          {name}
          <Text className="text-ink-3 dark:text-ink-3-dk font-normal">
            {'  '}· {region}
          </Text>
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
    <View className="flex-row items-center justify-between rounded-lg bg-raised dark:bg-raised-dk px-3 py-2.5">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">{k}</Text>
      <Text className="text-ink dark:text-ink-dk text-sm font-medium">{v}</Text>
    </View>
  );
}

const PROVISION_STEPS = ['Bought your number', 'Setting up your assistant', 'Connecting the two'];

function ProvisioningChecklist({ step, resuming }: { step: number; resuming: boolean }) {
  return (
    <View className="rounded-lg border border-primary/30 bg-primary/5 p-3 gap-3">
      <Text className="text-ink dark:text-ink-dk font-medium">
        {resuming ? 'Picking up where we left off' : 'Setting up your number'}
      </Text>
      <View className="gap-2">
        {PROVISION_STEPS.map((label, i) => (
          <View key={label} className="flex-row items-center gap-2.5">
            <View
              className={`w-5 h-5 rounded-full items-center justify-center ${
                i < step
                  ? 'bg-green-500/15'
                  : i === step
                    ? 'bg-primary/15'
                    : 'bg-raised dark:bg-raised-dk'
              }`}>
              {i < step ? (
                <Ionicons name="checkmark" size={12} color="#16A34A" />
              ) : (
                <View
                  className={`w-1.5 h-1.5 rounded-full ${
                    i === step ? 'bg-primary' : 'bg-sunken dark:bg-sunken-dk'
                  }`}
                />
              )}
            </View>
            <Text
              className={`text-xs ${
                i === step
                  ? 'text-ink dark:text-ink-dk font-medium'
                  : 'text-ink-2 dark:text-ink-2-dk'
              }`}>
              {label}
              {i === step ? '…' : ''}
            </Text>
          </View>
        ))}
      </View>
      <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] text-center">
        {resuming
          ? 'Your progress was saved — this won\'t buy a second number'
          : 'Usually under a minute'}
      </Text>
    </View>
  );
}

function LiveHero({
  gymName,
  number,
  primaryColor,
  onDone,
}: {
  gymName: string;
  number: string | null;
  primaryColor: string;
  onDone: () => void;
}) {
  // Same brand-fill contrast pick as Button.tsx's primary variant — the
  // fill is the gym's own colour, so white text isn't guaranteed to read.
  const ink =
    contrastRatio(primaryColor, '#FFFFFF') >= contrastRatio(primaryColor, '#111827')
      ? '#FFFFFF'
      : '#111827';
  const tint = (opacity: string) => (ink === '#FFFFFF' ? `rgba(255,255,255,${opacity})` : `rgba(17,24,39,${opacity})`);

  return (
    <BrandGradientHero color={primaryColor}>
      <View className="px-8 py-8 gap-4 items-center">
        <View
          className="w-16 h-16 rounded-full items-center justify-center"
          style={{ backgroundColor: tint('0.2'), borderWidth: 1, borderColor: tint('0.3') }}>
          <Ionicons name="checkmark" size={28} color={ink} />
        </View>
        <View className="gap-1 items-center">
          <Text className="font-bold" style={{ color: ink, fontSize: 26, lineHeight: 32 }}>
            You're live
          </Text>
          <Text className="text-sm text-center" style={{ color: tint('0.85') }}>
            {gymName}'s AI is now answering calls and texts.
          </Text>
        </View>
        {number ? (
          <View
            className="flex-row items-center justify-between gap-3 rounded-lg px-4 py-3 self-stretch"
            style={{ backgroundColor: tint('0.15') }}>
            <Text className="text-lg font-semibold" style={{ color: ink }}>
              {number}
            </Text>
            <Pressable onPress={() => copyToClipboard(number)} hitSlop={6}>
              <Text className="font-semibold text-xs" style={{ color: ink }}>
                Copy
              </Text>
            </Pressable>
          </View>
        ) : null}
        {number ? (
          <Pressable
            onPress={() => router.push('/management/website')}
            className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ backgroundColor: tint('0.15'), borderWidth: 1, borderColor: tint('0.25') }}>
            <Ionicons name="globe-outline" size={13} color={ink} />
            <Text className="text-xs font-medium" style={{ color: ink }}>
              Add to your website
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onDone}
          className="bg-white rounded-lg px-6 py-3 self-stretch items-center">
          <Text className="font-semibold" style={{ color: primaryColor }}>
            Done
          </Text>
        </Pressable>
      </View>
    </BrandGradientHero>
  );
}
