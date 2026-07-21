import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { AgentBriefBuilder } from '@/components/AgentBriefBuilder';
import { BrowserInterviewCall } from '@/components/BrowserInterviewCall';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import { LeadsShell } from '@/components/LeadsNav';
import { TalkToAssistant } from '@/components/TalkToAssistant';
import { VoiceSampleButton } from '@/components/VoiceSampleButton';
import { deprovisionFrontDesk, provisionFrontDesk, syncVapiAssistant } from '@/lib/agent-sync';
import { AGENT_VOICES } from '@/lib/agent-voices';
import { useGymMembership } from '@/lib/auth';
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
};

const VOICES = AGENT_VOICES;

// Plain grouping label, not a collapsible accordion — every card stays
// visible, this just gives the scroll a scannable shape.
function SectionHeader({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-2 px-0.5 pt-1">
      <View className="w-1 h-3.5 rounded-full bg-primary" />
      <Text className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-widest">
        {label}
      </Text>
    </View>
  );
}

export default function LeadAgentScreen() {
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
  const [teachPhone, setTeachPhone] = useState('');
  const [interviewDraft, setInterviewDraft] = useState<string | null>(null);
  const seededInterviewId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmTurnOff, setConfirmTurnOff] = useState(false);
  const [briefModalOpen, setBriefModalOpen] = useState(false);
  const [briefDraft, setBriefDraft] = useState('');
  const [teachMode, setTeachMode] = useState<'phone' | 'browser'>('phone');
  const [heroTab, setHeroTab] = useState<'teach' | 'test'>('teach');

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
        .select('id, status, phone, transcript, draft_brief')
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

  const startInterview = useMutation({
    mutationFn: async () => {
      const { data, error: e } = await supabase.functions.invoke('agent-interview/start', {
        body: { gym_id: membership!.gymId, phone: teachPhone.trim() },
      });
      if (e) throw e;
      if (data?.error) throw new Error(data.error);
      if (data?.started === false) {
        throw new Error(
          data?.reason === 'not_configured'
            ? "Phone teaching isn't switched on for the platform yet."
            : 'Could not place the call — try again in a minute.',
        );
      }
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-interview', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not start the teaching call')),
  });

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
  const frontDeskEntitled = agent.data?.front_desk_entitled ?? false;
  const provisionFailed = agent.data?.provision_status === 'failed';
  const currentVoice = VOICES.find((v) => v.id === (agent.data?.voice_id ?? '')) ?? null;

  const interview = latestInterview.data;
  const isCalling = interview?.status === 'calling';
  const isReviewing = interview?.status === 'completed' && !!interview.draft_brief;
  const isTranscriptOnly = interview?.status === 'completed' && !interview.draft_brief;
  const teachStep = isReviewing ? 1 : 0;

  return (
    <LeadsShell active="agent" tabs={['leads', 'agent', 'conversations', 'settings']}>
      <View className="gap-1">
        <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">AI Agent</Text>
        <Text className="text-gray-500 dark:text-gray-400">
          What it sounds like, what it knows, and how it keeps getting better.
        </Text>
      </View>

      {/* Talk to your AI — teaching it (the interview) and testing it (how
          it sounds to a lead) both start the same way, so they share one
          hero container with a tab switch instead of two separate "talk to
          it" cards on the page. Step bar + icon avatar only apply to the
          Teach tab's call → review → live arc. */}
      <View className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-2xl p-5 gap-4">
        <View className="flex-row items-center gap-3">
          <View className="w-12 h-12 rounded-full bg-primary items-center justify-center">
            {isCalling ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Ionicons name={heroTab === 'teach' ? 'call' : 'mic'} size={20} color="#FFFFFF" />
            )}
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              Talk to your AI
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
                  sel ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-700'
                }`}>
                <Text
                  className={`text-sm font-semibold text-center ${
                    sel ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
                  }`}>
                  {t === 'teach' ? 'Teach it' : 'Test it'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {heroTab === 'test' ? (
          <View className="gap-3">
            {voiceReady && Platform.OS === 'web' ? (
              <TalkToAssistant
                assistantId={agent.data?.vapi_assistant_id ?? null}
                gymName={brand.gymName}
              />
            ) : (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Finish setting up your assistant first, then you can talk to it here.
              </Text>
            )}
          </View>
        ) : (
          <>
            <View className="gap-1.5">
              <View className="flex-row gap-1.5">
                <View className={`h-1.5 flex-1 rounded-full ${teachStep >= 0 ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'}`} />
                <View className={`h-1.5 flex-1 rounded-full ${teachStep >= 1 ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'}`} />
              </View>
              <View className="flex-row justify-between">
                <Text className={`text-[10px] font-semibold uppercase tracking-widest ${teachStep === 0 ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}>
                  1. Call
                </Text>
                <Text className={`text-[10px] font-semibold uppercase tracking-widest ${teachStep === 1 ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}>
                  2. Review &amp; apply
                </Text>
              </View>
            </View>

            {isCalling ? (
              <View className="gap-2">
                <Text className="text-gray-700 dark:text-gray-200 text-sm">
                  {interview!.phone === 'browser'
                    ? "A browser interview looks to be in progress — if that's stuck (e.g. left over from a closed tab), cancel and start again."
                    : `Calling you now at ${interview!.phone} — answer and chat. When the call ends, the updated brief appears here for your review.`}
                </Text>
                <Pressable onPress={() => discardInterview.mutate()} hitSlop={6} className="self-start">
                  <Text className="text-gray-400 dark:text-gray-500 text-xs underline">Cancel</Text>
                </Pressable>
              </View>
            ) : isReviewing ? (
              <View className="gap-3">
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
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
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  Call captured, but automatic drafting isn't configured — copy anything useful into
                  the notes card below.
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs" numberOfLines={12}>
                  {interview!.transcript ?? ''}
                </Text>
                <ChipButton
                  label="Dismiss"
                  icon="trash-outline"
                  tone="neutral"
                  onPress={() => discardInterview.mutate()}
                />
              </View>
            ) : teachMode === 'browser' && Platform.OS === 'web' ? (
              <BrowserInterviewCall
                gymId={membership.gymId}
                onCompleted={() => {
                  setTeachMode('phone');
                  queryClient.invalidateQueries({ queryKey: ['agent-interview', membership.gymId] });
                }}
                onCancel={() => setTeachMode('phone')}
              />
            ) : (
              <View className="gap-3">
                {applyInterview.isSuccess ? (
                  <View className="flex-row items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
                    <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                    <Text className="text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                      Applied — the agent is live with your update.
                    </Text>
                  </View>
                ) : null}
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  The assistant interviews you — your intro offer, where beginners start, parking, the
                  questions you always get. It drafts the update; you review and approve before
                  anything changes.
                </Text>
                {interview?.status === 'failed' ? (
                  <Text className="text-amber-600 dark:text-amber-400 text-xs">
                    The last call didn't connect — check the number and try again.
                  </Text>
                ) : null}
                <Input
                  label="Your mobile"
                  value={teachPhone}
                  onChangeText={setTeachPhone}
                  keyboardType="phone-pad"
                  placeholder="+447700900123"
                />
                <Button
                  icon="call-outline"
                  onPress={() => startInterview.mutate()}
                  loading={startInterview.isPending}
                  disabled={!teachPhone.trim()}>
                  Call me now
                </Button>
                {Platform.OS === 'web' ? (
                  <Pressable
                    onPress={() => setTeachMode('browser')}
                    hitSlop={6}
                    className="self-center">
                    <Text className="text-primary text-xs font-semibold">
                      No phone needed — talk to it in your browser instead
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </>
        )}
      </View>

      <SectionHeader label="AI Front Desk" />

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">
              Answer texts automatically
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
        <View className="h-px bg-gray-100 dark:bg-gray-800" />
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">
              Answer phone calls too
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Your number: {agentNumber}
          </Text>
        ) : frontDeskEntitled ? (
          <View className="gap-2">
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              {provisionFailed
                ? "Setting up your number didn't finish — it's safe to try again."
                : 'No number yet — set one up to start answering leads.'}
            </Text>
            <Button variant="secondary" onPress={() => provision.mutate()} loading={provision.isPending}>
              {provisionFailed ? 'Try again' : 'Set up my number'}
            </Button>
          </View>
        ) : (
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            No number yet — phone & text isn't on your plan. Contact Temple to turn it on.
          </Text>
        )}
      </View>

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          Voice
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
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

      <SectionHeader label="Knowledge & Coaching" />

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest pt-1">
            What the agent knows
          </Text>
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
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
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

      <Modal
        visible={briefModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBriefModalOpen(false)}>
        <Pressable
          onPress={() => setBriefModalOpen(false)}
          className="flex-1 bg-black/60 items-center justify-center px-6 py-10">
          <Pressable
            onPress={() => {}}
            className="bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-xl gap-4 max-h-[90%]">
            <View className="flex-row items-center justify-between">
              <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                Rewrite with AI
              </Text>
              <Pressable
                onPress={() => setBriefModalOpen(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
                className="w-8 h-8 items-center justify-center rounded-full active:bg-gray-200 dark:active:bg-gray-800">
                <Ionicons name="close" size={18} color={colors.iconSecondary} />
              </Pressable>
            </View>
            <ScrollView>
              <AgentBriefBuilder
                gymId={membership.gymId}
                value={briefDraft}
                onChange={setBriefDraft}
              />
            </ScrollView>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button variant="secondary" onPress={() => setBriefModalOpen(false)}>
                  Cancel
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  onPress={() => {
                    setAgentContext(briefDraft);
                    setBriefModalOpen(false);
                  }}
                  disabled={!briefDraft.trim()}>
                  Use this
                </Button>
              </View>
            </View>
            <Text className="text-gray-400 dark:text-gray-500 text-xs text-center">
              This fills in the notes below — tap "Save notes" after to make it live.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          Coaching rules
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          Rules and examples you've taught the agent from call reviews. Turn one off to stop
          applying it on future calls. The agent applies your 25 most recent active rules (and 5
          examples) — retire stale ones so new coaching keeps landing.
        </Text>
        {(rules.data ?? []).length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            No rules yet. Open a call in Conversations and use "Coach this turn" to teach the
            agent.
          </Text>
        ) : (
          (rules.data ?? []).map((r) => (
            <View key={r.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 gap-2">
              <Text className="text-gray-800 dark:text-gray-100 text-sm">{r.correction}</Text>
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-wide">
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
            <Text className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-widest">
              Danger Zone
            </Text>
          </View>
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card border border-red-200 dark:border-red-900/40">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">
              Turn off the AI front desk
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
    </LeadsShell>
  );
}
