import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '@/components/Text';

import { Ionicons } from '@expo/vector-icons';

import { AgentBriefBuilder } from '@/components/AgentBriefBuilder';
import { BrowserInterviewCall } from '@/components/BrowserInterviewCall';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FieldLabel, SectionLabel } from '@/components/SectionLabel';
import { Sheet, SheetAction } from '@/components/Sheet';
import { Input } from '@/components/Input';
import { TalkToAssistant } from '@/components/TalkToAssistant';
import { VoiceSampleButton } from '@/components/VoiceSampleButton';
import { deprovisionFrontDesk, provisionFrontDesk, syncVapiAssistant } from '@/lib/agent-sync';
import { AGENT_VOICES } from '@/lib/agent-voices';
import { buildCallWidgetSnippet } from '@/lib/ai-widget-snippet';
import { useGymMembership } from '@/lib/auth';
import { copyToClipboard } from '@/lib/clipboard';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { formatCallDuration } from '@/lib/vapi-call';
import { useGymBrand } from '@/lib/useGymBrand';

type AgentSettings = {
  enabled: boolean;
  phone_number: string | null;
  voice_enabled: boolean;
  vapi_assistant_id: string | null;
  context: string | null;
  voice_id: string | null;
  front_desk_entitled: boolean;
  provision_status: string;
};

type Correction = {
  id: string;
  field_kind: string;
  scope: string;
  correction: string;
  active: boolean;
  created_at: string;
};

type InterviewRow = {
  id: string;
  status: 'calling' | 'completed' | 'failed' | 'applied' | 'discarded';
  phone: string;
  transcript: string | null;
  draft_brief: string | null;
  created_at: string;
};

const VOICES = AGENT_VOICES;

const STALE_CALL_MS = 15 * 60 * 1000;

// An expanding, fading ring behind the avatar reads as "ringing" the way a
// bare spinner doesn't — same glow-pulse technique as TalkToAssistant's
// VoiceOrb, just a single ring since there's no live audio to visualize on
// an outbound phone call.
function RingingIcon({ color }: { color: string }) {
  const colors = useThemeColors();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1100,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View className="items-center justify-center" style={{ width: 48, height: 48 }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: color,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
        }}
      />
      <View className="w-12 h-12 rounded-full bg-primary items-center justify-center">
        <Ionicons name="call" size={20} color={colors.onPrimary} />
      </View>
    </View>
  );
}

// The AI front desk, as sections of Lead settings rather than a screen of
// its own. It was a separate tab, and a tab called "AI Agent" sitting next
// to a tab called "Settings" is one screen wearing two hats: what the
// assistant sounds like, what it knows, how leads route, what gets
// recorded and how long any of it is kept are all the same job.
//
// Moved as a component rather than merged as code. Both screens carry a
// dozen queries and per-card drafts each, and the house rule about seeding
// drafts once is exactly the thing a hand-merge of forty hooks gets wrong.
// Nothing in here changed except its container.
export function AgentSettings() {
  const { data: membership } = useGymMembership();
  const brand = useGymBrand();
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const isOwner = membership?.role === 'owner';

  const agent = useQuery({
    queryKey: ['agent-settings', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<AgentSettings | null> => {
      const { data, error } = await supabase
        .from('gym_agent_settings')
        .select(
          'enabled, phone_number, voice_enabled, vapi_assistant_id, context, voice_id, front_desk_entitled, provision_status',
        )
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (error) throw error;
      return (data as AgentSettings) ?? null;
    },
  });

  const rules = useQuery({
    queryKey: ['agent-rules', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<Correction[]> => {
      const { data, error } = await supabase
        .from('agent_coaching_corrections')
        .select('id, field_kind, scope, correction, active, created_at')
        .eq('gym_id', membership!.gymId)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Correction[];
    },
  });

  // Seed once — a refetch after another card's save must not wipe an
  // unsaved draft of the agent notes.
  const [agentContext, setAgentContext] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [interviewDraft, setInterviewDraft] = useState<string | null>(null);
  const seededInterviewId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmTurnOff, setConfirmTurnOff] = useState(false);
  const [briefModalOpen, setBriefModalOpen] = useState(false);
  const [briefDraft, setBriefDraft] = useState('');
  const [heroTab, setHeroTab] = useState<'teach' | 'test'>('teach');
  // Gates mounting BrowserInterviewCall behind an explicit tap.
  // BrowserInterviewCall calls agent-interview/browser-start (which
  // inserts a 'calling' row) the instant it mounts — without this gate
  // that fired on every page load just from landing on the Teach tab,
  // silently starting an unrequested interview and, if the tab was ever
  // closed before it resolved, leaving a stuck "in progress" row that
  // every later visit picked back up as if a call were still ringing.
  const [teachStarted, setTeachStarted] = useState(false);
  const [callClock, setCallClock] = useState(0);

  useEffect(() => {
    if (!agent.isSuccess) return;
    if (agentContext === null) setAgentContext(agent.data?.context ?? '');
    if (selectedVoice === null) setSelectedVoice(agent.data?.voice_id ?? '');
  }, [agent.isSuccess, agent.data, agentContext, selectedVoice]);

  const toggleAgent = useMutation({
    mutationFn: async (next: boolean) => {
      const { error: e } = await supabase.rpc('set_gym_agent_enabled', {
        p_gym_id: membership!.gymId,
        p_enabled: next,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not change the AI front desk')),
  });

  const toggleVoice = useMutation({
    mutationFn: async (next: boolean) => {
      const { error: e } = await supabase.rpc('set_gym_agent_voice', {
        p_gym_id: membership!.gymId,
        p_enabled: next,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not change phone answering')),
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
  });

  const turnOff = useMutation({
    mutationFn: async () => {
      await deprovisionFrontDesk(membership!.gymId);
    },
    onSuccess: () => {
      setConfirmTurnOff(false);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
    },
    // No setError — this runs inside a full-screen Modal, so the page's
    // bottom error line would be invisible. ConfirmDialog renders its own.
  });

  const saveAgentContext = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('set_gym_agent_context', {
        p_gym_id: membership!.gymId,
        p_context: agentContext ?? '',
      });
      if (e) throw e;
      await syncVapiAssistant(membership!.gymId);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the agent notes')),
  });

  const saveVoice = useMutation({
    mutationFn: async () => {
      const v = VOICES.find((x) => x.id === selectedVoice);
      if (!v) throw new Error('Pick a voice');
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
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the voice')),
  });

  const latestInterview = useQuery({
    queryKey: ['agent-interview', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    refetchInterval: (q) =>
      (q.state.data as InterviewRow | null | undefined)?.status === 'calling' ? 5000 : false,
    queryFn: async (): Promise<InterviewRow | null> => {
      const { data, error: e } = await supabase
        .from('agent_interviews')
        .select('id, status, phone, transcript, draft_brief, created_at')
        .eq('gym_id', membership!.gymId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (e) throw e;
      return (data as InterviewRow) ?? null;
    },
  });

  // Seed the editable draft once per interview, not on every refetch.
  useEffect(() => {
    const row = latestInterview.data;
    if (row?.status === 'completed' && row.draft_brief && seededInterviewId.current !== row.id) {
      seededInterviewId.current = row.id;
      setInterviewDraft(row.draft_brief);
    }
  }, [latestInterview.data]);

  // Ticks the in-call timer off the row's own created_at rather than a
  // local counter, so it's still correct after a background tab or a
  // remount mid-call.
  useEffect(() => {
    const row = latestInterview.data;
    if (row?.status !== 'calling') {
      setCallClock(0);
      return;
    }
    const startedAt = new Date(row.created_at).getTime();
    const tick = () => setCallClock(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [latestInterview.data?.status, latestInterview.data?.id, latestInterview.data?.created_at]);

  const applyInterview = useMutation({
    mutationFn: async () => {
      const row = latestInterview.data;
      if (!row || !interviewDraft?.trim()) throw new Error('Nothing to apply');
      const { error: e1 } = await supabase.rpc('set_gym_agent_context', {
        p_gym_id: membership!.gymId,
        p_context: interviewDraft,
      });
      if (e1) throw e1;
      const { error: e2 } = await supabase.rpc('set_agent_interview_status', {
        p_id: row.id,
        p_status: 'applied',
      });
      if (e2) throw e2;
      await syncVapiAssistant(membership!.gymId);
    },
    onSuccess: () => {
      setError(null);
      setAgentContext(interviewDraft);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
      queryClient.invalidateQueries({ queryKey: ['agent-interview', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not apply the update')),
  });

  const discardInterview = useMutation({
    mutationFn: async () => {
      const row = latestInterview.data;
      if (!row) return;
      const { error: e } = await supabase.rpc('set_agent_interview_status', {
        p_id: row.id,
        p_status: 'discarded',
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-interview', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not discard the update')),
  });

  const toggleRule = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.rpc('set_agent_correction_active', {
        p_id: id,
        p_active: false,
      });
      if (e) throw e;
      await syncVapiAssistant(membership!.gymId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-rules', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not update the rule')),
  });

  if (membership && !isOwner) return <Redirect href="/management/leads" />;
  if (!membership) return null;

  const agentOn = agent.data?.enabled ?? false;
  const agentNumber = agent.data?.phone_number ?? null;
  const voiceOn = agent.data?.voice_enabled ?? false;
  const voiceReady = !!agent.data?.vapi_assistant_id;
  // Entitled by default (0163) - a gym with no settings row yet is a paying
  // customer same as any other, so absence reads the same as an explicit
  // true. Only an explicit false (a manual off-switch) reads as not entitled.
  const frontDeskEntitled = agent.data?.front_desk_entitled ?? true;
  const canTestWeb = voiceReady && Platform.OS === 'web';
  // Same "will actually answer" gate as gym_public_ai_phone (0162) and
  // canShareNumber below — a real number that's provisioned but not
  // switched on yet shouldn't be offered as if it works.
  const canTestPhone = !!agentNumber && agentOn && voiceOn;
  const canShareNumber = !!agentNumber && agentOn && voiceOn;
  const provisionFailed = agent.data?.provision_status === 'failed';
  const currentVoice = VOICES.find((v) => v.id === (agent.data?.voice_id ?? '')) ?? null;

  const interview = latestInterview.data;
  // Interview calls run under ~6 minutes by design (see interviewerPrompt in
  // the edge function) — a 'calling' row older than this is a dead tab, not
  // a live call, and must not be shown as one. Without this, a closed-tab
  // row that never resolved would render "in call" with a growing timer on
  // every future visit to this page, forever.
  const isStaleCall =
    interview?.status === 'calling' &&
    Date.now() - new Date(interview.created_at).getTime() > STALE_CALL_MS;
  const isCalling = interview?.status === 'calling' && !isStaleCall;
  const isReviewing = interview?.status === 'completed' && !!interview.draft_brief;
  const isTranscriptOnly = interview?.status === 'completed' && !interview.draft_brief;
  const teachStep = isReviewing ? 1 : 0;

  useEffect(() => {
    if (isStaleCall) discardInterview.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaleCall, interview?.id]);

  return (
    <>
      <SectionLabel>Talk to your AI</SectionLabel>

      {/* Talk to your AI — teaching it (the interview) and testing it (how
          it sounds to a lead) both start the same way, so they share one
          hero container with a tab switch instead of two separate "talk to
          it" cards on the page. Step bar + icon avatar only apply to the
          Teach tab's call → review → live arc. */}
      <View className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-2xl p-5 gap-4">
        <View className="flex-row items-center gap-3">
          {isCalling ? (
            <RingingIcon color={colors.primary} />
          ) : (
            <View className="w-12 h-12 rounded-full bg-primary items-center justify-center">
              <Ionicons name={heroTab === 'teach' ? 'call' : 'mic'} size={20} color="#FFFFFF" />
            </View>
          )}
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk text-lg font-semibold">
              Talk to your AI
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Teach it what to say, or hear how it sounds right now.
            </Text>
          </View>
        </View>

        <View className="flex-row gap-2">
          {(['teach', 'test'] as const).map((t) => {
            const sel = heroTab === t;
            return (
              <Pressable
                key={t}
                onPress={() => setHeroTab(t)}
                className={`flex-1 px-3 py-2 rounded-lg border ${
                  sel ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
                }`}>
                <Text
                  className={`text-sm font-semibold text-center ${
                    sel ? 'text-ink dark:text-ink-dk font-semibold' : 'text-ink-2 dark:text-ink-2-dk'
                  }`}>
                  {t === 'teach' ? 'Teach it' : 'Test it'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {heroTab === 'test' ? (
          <View className="gap-3">
            {canTestWeb ? (
              <TalkToAssistant
                assistantId={agent.data?.vapi_assistant_id ?? null}
                gymName={brand.gymName}
              />
            ) : null}
            {canTestPhone ? (
              <Pressable
                onPress={() => Linking.openURL(`tel:${agentNumber}`)}
                className="flex-row items-center gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-xl p-3">
                <View className="w-10 h-10 rounded-full bg-primary/10 items-center justify-center">
                  <Ionicons name="call-outline" size={18} color={colors.primary} />
                </View>
                <View className="flex-1">
                  <Text className="text-ink dark:text-ink-dk text-sm font-semibold">
                    Call it for real
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    Dial {agentNumber} to hear exactly what a prospect hears.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={colors.ink3} />
              </Pressable>
            ) : null}
            {!canTestWeb && !canTestPhone ? (
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                Finish setting up your assistant first, then you can talk to it here.
              </Text>
            ) : null}
          </View>
        ) : (
          <>
            <View className="gap-1.5">
              <View className="flex-row gap-1.5">
                <View className={`h-1.5 flex-1 rounded-full ${teachStep >= 0 ? 'bg-primary' : 'bg-sunken dark:bg-sunken-dk'}`} />
                <View className={`h-1.5 flex-1 rounded-full ${teachStep >= 1 ? 'bg-primary' : 'bg-sunken dark:bg-sunken-dk'}`} />
              </View>
              <View className="flex-row justify-between">
                <Text className={`text-[10px] font-semibold uppercase tracking-widest ${teachStep === 0 ? 'text-primary' : 'text-ink-3 dark:text-ink-3-dk'}`}>
                  1. Call
                </Text>
                <Text className={`text-[10px] font-semibold uppercase tracking-widest ${teachStep === 1 ? 'text-primary' : 'text-ink-3 dark:text-ink-3-dk'}`}>
                  2. Review &amp; apply
                </Text>
              </View>
            </View>

            {isCalling ? (
              <View className="items-center gap-3 py-2">
                <FieldLabel>
                  {callClock < 3 ? 'Ringing…' : 'In call'}
                </FieldLabel>
                <Text
                  className="text-ink dark:text-ink-dk text-3xl font-semibold"
                  style={{ fontVariant: ['tabular-nums'] }}>
                  {formatCallDuration(callClock)}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
                  {interview!.phone === 'browser'
                    ? "A browser interview looks to be in progress — if that's stuck (e.g. left over from a closed tab), hang up and start again."
                    : `Calling ${interview!.phone} — answer and chat. When the call ends, the updated brief appears here for your review.`}
                </Text>
                <Pressable
                  onPress={() => discardInterview.mutate()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Hang up"
                  className="w-14 h-14 rounded-full bg-red-500 items-center justify-center active:bg-red-600 mt-1">
                  <Ionicons name="call" size={24} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
                </Pressable>
                <Text className="text-ink-3 dark:text-ink-3-dk text-xs">Hang up</Text>
              </View>
            ) : isReviewing ? (
              <View className="gap-3">
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  Here's what your call taught the agent, merged into its brief. Edit anything, then
                  apply — nothing is live until you do.
                </Text>
                {interviewDraft !== null ? (
                  <Input
                    label="Updated brief from your call"
                    value={interviewDraft}
                    onChangeText={setInterviewDraft}
                    multiline
                    numberOfLines={10}
                  />
                ) : null}
                <View className="flex-row gap-2 items-start">
                  <View className="flex-1">
                    <Button
                      onPress={() => applyInterview.mutate()}
                      loading={applyInterview.isPending}
                      disabled={!interviewDraft?.trim()}>
                      Apply to the agent
                    </Button>
                  </View>
                  <ChipButton
                    label="Discard"
                    icon="trash-outline"
                    tone="neutral"
                    onPress={() => discardInterview.mutate()}
                  />
                </View>
              </View>
            ) : isTranscriptOnly ? (
              <View className="gap-3">
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  Call captured, but automatic drafting isn't configured — copy anything useful into
                  the notes card below.
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs" numberOfLines={12}>
                  {interview!.transcript ?? ''}
                </Text>
                <ChipButton
                  label="Dismiss"
                  icon="trash-outline"
                  tone="neutral"
                  onPress={() => discardInterview.mutate()}
                />
              </View>
            ) : Platform.OS === 'web' ? (
              <View className="gap-3">
                {applyInterview.isSuccess ? (
                  <View className="flex-row items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
                    <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                    <Text className="text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                      Applied — the agent is live with your update.
                    </Text>
                  </View>
                ) : null}
                {teachStarted ? (
                  <BrowserInterviewCall
                    gymId={membership.gymId}
                    onCompleted={() => {
                      setTeachStarted(false);
                      queryClient.invalidateQueries({ queryKey: ['agent-interview', membership.gymId] });
                    }}
                    onCancel={() => setTeachStarted(false)}
                  />
                ) : (
                  <>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                      The assistant interviews you — your intro offer, where beginners start, parking,
                      the questions you always get. It drafts the update; you review and approve
                      before anything changes.
                    </Text>
                    {interview?.status === 'failed' ? (
                      <Text className="text-amber-600 dark:text-amber-400 text-xs">
                        The last attempt didn't capture anything — try again.
                      </Text>
                    ) : null}
                    <Button icon="mic-outline" onPress={() => setTeachStarted(true)}>
                      Start teaching
                    </Button>
                  </>
                )}
              </View>
            ) : (
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                Teaching it by talking needs a browser — open Temple on desktop or your phone's browser
                to do this.
              </Text>
            )}
          </>
        )}
      </View>

      <SectionLabel>The front desk</SectionLabel>

      <View className="rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk p-4 gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-medium">
              Answer texts automatically
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              An AI assistant replies to texts on your gym's number — it answers from your real
              plans and schedule, captures the lead and hands hot ones a signup link.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Answer texts automatically"
            value={agentOn}
            onValueChange={(v) => toggleAgent.mutate(v)}
          />
        </View>
        <View className="h-px bg-raised dark:bg-raised-dk" />
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-medium">
              Answer phone calls too
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              {voiceReady
                ? 'The assistant picks up calls to your number and can text the caller a signup link.'
                : 'Not set up yet — missed calls get an automatic "text us back" reply instead. Set up your number below to enable it.'}
            </Text>
          </View>
          <Switch
            accessibilityLabel="Answer phone calls too"
            value={voiceOn}
            disabled={!voiceReady}
            onValueChange={(v) => toggleVoice.mutate(v)}
          />
        </View>
        {agentNumber ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Your number: {agentNumber}
          </Text>
        ) : frontDeskEntitled ? (
          <View className="gap-2">
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              {provisionFailed
                ? "Setting up your number didn't finish — it's safe to try again."
                : 'No number yet — set one up to start answering leads.'}
            </Text>
            <Button variant="secondary" onPress={() => provision.mutate()} loading={provision.isPending}>
              {provisionFailed ? 'Try again' : 'Set up my number'}
            </Button>
            {provision.error ? (
              <Text className="text-red-500 dark:text-red-400 text-xs">
                {errorMessage(provision.error, "Couldn't set up your number")}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            No number yet — phone & text isn't on your plan. Contact Temple to turn it on.
          </Text>
        )}
      </View>

      {canShareNumber ? (
        <View className="rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk p-4 gap-3">
          <FieldLabel>
            Share your number
          </FieldLabel>
          <View className="flex-row items-center justify-between bg-raised dark:bg-raised-dk rounded-lg px-3 py-2.5">
            <Text className="text-ink dark:text-ink-dk font-medium">{agentNumber}</Text>
            <ChipButton
              label="Copy"
              icon="copy-outline"
              tone="neutral"
              onPress={() => copyToClipboard(agentNumber!)}
            />
          </View>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Paste this into emails or a social bio.
          </Text>

          <View className="h-px bg-raised dark:bg-raised-dk" />

          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-ink dark:text-ink-dk font-medium text-sm">
                On your Google Business Profile
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Opens Google's own site — paste the number in there so it shows on Search and Maps.
              </Text>
            </View>
            <ChipButton
              label="Open Google"
              icon="open-outline"
              tone="neutral"
              onPress={() => Linking.openURL('https://business.google.com/')}
            />
          </View>

          <View className="h-px bg-raised dark:bg-raised-dk" />

          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-ink dark:text-ink-dk font-medium text-sm">
                On Temple's website builder
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Add the "Call &amp; text" block from there — it always shows your current number.
              </Text>
            </View>
            <ChipButton
              label="Open builder"
              icon="open-outline"
              tone="primary"
              onPress={() => router.push('/management/website')}
            />
          </View>

          <View className="h-px bg-raised dark:bg-raised-dk" />

          <View className="gap-1.5">
            <Text className="text-ink dark:text-ink-dk font-medium text-sm">
              Hosting your site elsewhere
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Copy this snippet into a custom-HTML block on Wix, Squarespace or wherever your site
              lives.
            </Text>
            <ChipButton
              label="Copy embed code"
              icon="code-slash-outline"
              tone="neutral"
              onPress={() =>
                copyToClipboard(
                  buildCallWidgetSnippet({
                    phoneNumber: agentNumber!,
                    gymName: brand.gymName,
                    accentColor: colors.primary,
                  }),
                )
              }
            />
          </View>
        </View>
      ) : null}

      <View className="rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk p-4 gap-3">
        <FieldLabel>
          Voice
        </FieldLabel>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          How the assistant sounds on calls.
          {currentVoice ? ` Currently ${currentVoice.name} · ${currentVoice.region}.` : ''}
        </Text>
        <View className="gap-2">
          {VOICES.map((v) => {
            const sel = selectedVoice === v.id;
            return (
              <Pressable
                key={v.id}
                onPress={() => setSelectedVoice(v.id)}
                className={`flex-row items-center justify-between rounded-lg border p-3 ${
                  sel ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
                }`}>
                <View className="flex-1">
                  <Text className="text-ink dark:text-ink-dk font-medium">
                    {v.name}
                    <Text className="text-ink-3 dark:text-ink-3-dk font-normal">
                      {'  '}· {v.region}
                    </Text>
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    {v.gender} · {v.desc}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  {sel ? <Text className="text-primary text-xs font-semibold">Selected</Text> : null}
                  <VoiceSampleButton voiceId={v.id} />
                </View>
              </Pressable>
            );
          })}
        </View>
        <Button onPress={() => saveVoice.mutate()} loading={saveVoice.isPending} disabled={!selectedVoice}>
          Save voice
        </Button>
      </View>

      <SectionLabel>What it knows</SectionLabel>

      <View className="rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk p-4 gap-3">
        <View className="flex-row items-start justify-between gap-3">
          <FieldLabel className="pt-1">
            What the agent knows
          </FieldLabel>
          <ChipButton
            label="Rewrite with AI"
            icon="sparkles"
            tone="primary"
            onPress={() => {
              setBriefDraft(agentContext ?? '');
              setBriefModalOpen(true);
            }}
          />
        </View>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          Plans and the class schedule are included automatically. Add anything else it should
          know — address, parking, intro offer, what makes your gym great.
        </Text>
        {agentContext !== null ? (
          <Input
            label="Notes for the agent"
            value={agentContext}
            onChangeText={setAgentContext}
            multiline
            numberOfLines={5}
            placeholder="We're behind the station, free parking on site. First class is free…"
          />
        ) : null}
        <Button onPress={() => saveAgentContext.mutate()} loading={saveAgentContext.isPending}>
          Save notes
        </Button>
      </View>

      <Sheet
        visible={briefModalOpen}
        title="Rewrite with AI"
        subtitle={'This fills in the notes below — tap "Save notes" after to make it live.'}
        onClose={() => setBriefModalOpen(false)}
        dialogWidth={640}
        actions={
          <>
            <SheetAction>
              <Button variant="secondary" onPress={() => setBriefModalOpen(false)}>
                Cancel
              </Button>
            </SheetAction>
            <SheetAction grow>
              <Button
                onPress={() => {
                  setAgentContext(briefDraft);
                  setBriefModalOpen(false);
                }}
                disabled={!briefDraft.trim()}>
                Use this
              </Button>
            </SheetAction>
          </>
        }>
        <View className="pb-1">
          <AgentBriefBuilder
            gymId={membership.gymId}
            value={briefDraft}
            onChange={setBriefDraft}
          />
        </View>
      </Sheet>

      <View className="rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk p-4 gap-3">
        <FieldLabel>
          Coaching rules
        </FieldLabel>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          Rules and examples you've taught the agent from call reviews. Turn one off to stop
          applying it on future calls. The agent applies your 25 most recent active rules (and 5
          examples) — retire stale ones so new coaching keeps landing.
        </Text>
        {(rules.data ?? []).length === 0 ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            No rules yet. Open a call in Conversations and use "Coach this turn" to teach the
            agent.
          </Text>
        ) : (
          (rules.data ?? []).map((r) => (
            <View key={r.id} className="rounded-lg border border-line dark:border-line-dk p-3 gap-2">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">{r.correction}</Text>
              <View className="flex-row items-center justify-between">
                <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-wide">
                  {r.field_kind} · {r.scope === 'standing_rule' ? 'always' : 'example'}
                </Text>
                <Pressable onPress={() => toggleRule.mutate(r.id)} hitSlop={6}>
                  <Text className="text-red-600 dark:text-red-400 text-xs font-semibold">
                    Turn off
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      {agentNumber ? (
        <>
          <View className="flex-row items-center gap-2 px-0.5 pt-1">
            <View className="w-1 h-3.5 rounded-full bg-red-500" />
            <FieldLabel>
              Danger Zone
            </FieldLabel>
          </View>
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3 border border-red-200 dark:border-red-900/40">
            <Text className="text-ink dark:text-ink-dk font-medium">
              Turn off the AI front desk
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Releases your number ({agentNumber}) and deletes the AI assistant. Calls and texts
              stop working immediately — this can't be undone from here.
            </Text>
            <Button variant="destructive" onPress={() => setConfirmTurnOff(true)}>
              Turn off &amp; release number
            </Button>
          </View>
        </>
      ) : null}

      <ConfirmDialog
        visible={confirmTurnOff}
        title="Turn off the AI front desk?"
        body={`This releases ${agentNumber ?? 'your number'} back to Temple's pool — it may be reassigned to another gym — and deletes the AI assistant. Calls and texts to this number stop working immediately.`}
        confirmLabel="Turn off & release number"
        pending={turnOff.isPending}
        onConfirm={() => turnOff.mutate()}
        onCancel={() => setConfirmTurnOff(false)}
        error={turnOff.error ? errorMessage(turnOff.error, "Couldn't turn off the AI front desk") : null}
      />

      {error ? <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text> : null}
    </>
  );
}
