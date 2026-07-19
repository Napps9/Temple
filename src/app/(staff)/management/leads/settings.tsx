import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { DurationField } from '@/components/DurationField';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { VoiceSampleButton } from '@/components/VoiceSampleButton';
import { syncVapiAssistant } from '@/lib/agent-sync';
import { AGENT_VOICES } from '@/lib/agent-voices';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Strategy = 'round_robin' | 'single_default' | 'manual';

type Rule = {
  strategy: Strategy;
  default_coach_id: string | null;
};

type GymLeadSettings = {
  lead_sms_enabled: boolean;
  lead_retention_days: number;
};

type CoachRow = { profile_id: string; full_name: string | null };

type AgentSettings = {
  enabled: boolean;
  phone_number: string | null;
  voice_enabled: boolean;
  vapi_assistant_id: string | null;
  context: string | null;
  voice_provider: string | null;
  voice_id: string | null;
  voice_region: string | null;
  call_recording_enabled: boolean;
  call_recording_retention_days: number;
  daily_message_cap: number;
  conversation_retention_days: number;
};

type Correction = {
  id: string;
  field_kind: string;
  scope: string;
  correction: string;
  active: boolean;
  created_at: string;
};

const VOICES = AGENT_VOICES;

const STRATEGY_COPY: Record<Strategy, { title: string; blurb: string }> = {
  round_robin: {
    title: 'Round-robin',
    blurb: 'Share new leads evenly across your active coaches. No setup.',
  },
  single_default: {
    title: 'One coach',
    blurb: 'Send every new lead to a single coach you choose.',
  },
  manual: {
    title: 'Manual',
    blurb: "Don't auto-assign — you'll pick a coach on each lead yourself.",
  },
};

export default function LeadAutomationSettings() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const isOwner = membership?.role === 'owner';

  const rule = useQuery({
    queryKey: ['lead-rule', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<Rule | null> => {
      const { data, error } = await supabase
        .from('lead_assignment_rules')
        .select('strategy, default_coach_id')
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (error) throw error;
      return (data as Rule) ?? null;
    },
  });

  const gymSettings = useQuery({
    queryKey: ['lead-gym-settings', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<GymLeadSettings> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('lead_sms_enabled, lead_retention_days')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data as GymLeadSettings;
    },
  });

  const coaches = useQuery({
    queryKey: ['lead-coaches', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<CoachRow[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .is('left_at', null)
        .in('role', ['owner', 'admin', 'coach', 'staff']);
      if (error) throw error;
      return (data ?? [])
        .map((r) => {
          const row = r as unknown as {
            profile_id: string;
            profiles: { full_name: string | null } | null;
          };
          return { profile_id: row.profile_id, full_name: row.profiles?.full_name ?? null };
        })
        .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''));
    },
  });

  const agent = useQuery({
    queryKey: ['agent-settings', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<AgentSettings | null> => {
      const { data, error } = await supabase
        .from('gym_agent_settings')
        .select(
          'enabled, phone_number, voice_enabled, vapi_assistant_id, context, voice_provider, voice_id, voice_region, call_recording_enabled, call_recording_retention_days, daily_message_cap, conversation_retention_days',
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

  const [strategy, setStrategy] = useState<Strategy>('round_robin');
  const [defaultCoach, setDefaultCoach] = useState<string | null>(null);
  // Seed once — a refetch after another card's save must not wipe an
  // unsaved draft of the agent notes.
  const [agentContext, setAgentContext] = useState<string | null>(null);
  // null until the setting loads — DurationField seeds its unit once at
  // mount, so it must not mount on the placeholder '365' and then be stuck
  // when the real value arrives a tick later.
  const [retention, setRetention] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [recRetention, setRecRetention] = useState<string | null>(null);
  const [msgCap, setMsgCap] = useState<string | null>(null);
  const [convRetention, setConvRetention] = useState<string | null>(null);
  const [teachPhone, setTeachPhone] = useState('');
  const [interviewDraft, setInterviewDraft] = useState<string | null>(null);
  const seededInterviewId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rule.data) {
      setStrategy(rule.data.strategy);
      setDefaultCoach(rule.data.default_coach_id);
    }
  }, [rule.data]);
  useEffect(() => {
    if (gymSettings.data && retention === null)
      setRetention(String(gymSettings.data.lead_retention_days));
  }, [gymSettings.data, retention]);
  useEffect(() => {
    if (!agent.isSuccess) return;
    if (agentContext === null) setAgentContext(agent.data?.context ?? '');
    if (selectedVoice === null) setSelectedVoice(agent.data?.voice_id ?? '');
    if (recRetention === null)
      setRecRetention(String(agent.data?.call_recording_retention_days ?? 90));
    if (msgCap === null) setMsgCap(String(agent.data?.daily_message_cap ?? 200));
    if (convRetention === null)
      setConvRetention(String(agent.data?.conversation_retention_days ?? 365));
  }, [agent.isSuccess, agent.data, agentContext, selectedVoice, recRetention, msgCap, convRetention]);

  // Light usage read so the agent isn't a black box: outbound texts in the
  // last 24h (what the daily cap meters) and conversations touched in 7 days.
  const usage = useQuery({
    queryKey: ['agent-usage', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async () => {
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const [sent, convs, calls] = await Promise.all([
        supabase
          .from('agent_messages')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', membership!.gymId)
          .eq('role', 'agent')
          .gte('created_at', dayAgo),
        supabase
          .from('agent_conversations')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', membership!.gymId)
          .gte('last_message_at', weekAgo),
        supabase
          .from('agent_conversations')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', membership!.gymId)
          .eq('channel', 'voice')
          .gte('last_message_at', weekAgo),
      ]);
      return {
        sentToday: sent.count ?? 0,
        conversations7d: convs.count ?? 0,
        calls7d: calls.count ?? 0,
      };
    },
  });

  const outcomes = useQuery({
    queryKey: ['agent-outcomes', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('agent_outcomes', {
        p_gym_id: membership!.gymId,
      });
      if (e) throw e;
      const rows = (data ?? []) as {
        leads_30d: number;
        committed: number;
        converted_30d: number;
        attributed_monthly_cents: number;
        currency: string;
      }[];
      return rows[0] ?? null;
    },
  });

  const saveRule = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('set_lead_assignment_rule', {
        p_gym_id: membership!.gymId,
        p_strategy: strategy,
        p_default_coach_id: strategy === 'single_default' ? defaultCoach : null,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['lead-rule', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save assignment rule')),
  });

  const saveRetention = useMutation({
    mutationFn: async () => {
      const days = parseInt(retention ?? '', 10);
      if (!Number.isFinite(days)) throw new Error('Enter a retention window');
      const { error: e } = await supabase.rpc('set_gym_lead_retention', {
        p_gym_id: membership!.gymId,
        p_days: days,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['lead-gym-settings', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save retention')),
  });

  const toggleSms = useMutation({
    mutationFn: async (next: boolean) => {
      const { error: e } = await supabase.rpc('set_gym_lead_sms', {
        p_gym_id: membership!.gymId,
        p_enabled: next,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-gym-settings', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not change SMS setting')),
  });

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

  const toggleRecording = useMutation({
    mutationFn: async (next: boolean) => {
      const days = parseInt(recRetention ?? '', 10);
      const retentionDays = Number.isFinite(days)
        ? days
        : (agent.data?.call_recording_retention_days ?? 90);
      const { error: e } = await supabase.rpc('set_gym_call_recording', {
        p_gym_id: membership!.gymId,
        p_enabled: next,
        p_retention_days: retentionDays,
      });
      if (e) throw e;
      // The greeting's recording notice follows this toggle.
      await syncVapiAssistant(membership!.gymId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not change recording')),
  });

  const saveRecordingRetention = useMutation({
    mutationFn: async () => {
      const days = parseInt(recRetention ?? '', 10);
      if (!Number.isFinite(days)) throw new Error('Enter a retention window');
      const { error: e } = await supabase.rpc('set_gym_call_recording', {
        p_gym_id: membership!.gymId,
        p_enabled: agent.data?.call_recording_enabled ?? true,
        p_retention_days: days,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save recording retention')),
  });

  type InterviewRow = {
    id: string;
    status: 'calling' | 'completed' | 'failed' | 'applied' | 'discarded';
    phone: string;
    transcript: string | null;
    draft_brief: string | null;
  };
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

  const saveLimits = useMutation({
    mutationFn: async () => {
      const cap = parseInt(msgCap ?? '', 10);
      const days = parseInt(convRetention ?? '', 10);
      if (!Number.isFinite(cap)) throw new Error('Enter a daily message cap');
      if (!Number.isFinite(days)) throw new Error('Enter a conversation retention window');
      const { error: e } = await supabase.rpc('set_gym_agent_limits', {
        p_gym_id: membership!.gymId,
        p_daily_message_cap: cap,
        p_conversation_retention_days: days,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-settings', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the limits')),
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

  const smsOn = gymSettings.data?.lead_sms_enabled ?? false;
  const agentOn = agent.data?.enabled ?? false;
  const agentNumber = agent.data?.phone_number ?? null;
  const voiceOn = agent.data?.voice_enabled ?? false;
  const voiceReady = !!agent.data?.vapi_assistant_id;
  const recOn = agent.data?.call_recording_enabled ?? true;
  const currentVoice = VOICES.find((v) => v.id === (agent.data?.voice_id ?? '')) ?? null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="CRM" fallbackHref="/management/leads" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Lead automation
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            New leads are shared across your coaches automatically. Change how
            that works — or leave it, it's set up out of the box.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            When a lead comes in
          </Text>
          {(['round_robin', 'single_default', 'manual'] as Strategy[]).map((s) => {
            const sel = strategy === s;
            return (
              <Pressable
                key={s}
                onPress={() => setStrategy(s)}
                className={`rounded-lg border p-3 gap-1 ${
                  sel
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 dark:border-gray-700'
                }`}>
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  {STRATEGY_COPY[s].title}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {STRATEGY_COPY[s].blurb}
                </Text>
              </Pressable>
            );
          })}

          {strategy === 'single_default' ? (
            <View className="gap-1.5 pt-1">
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                Send every lead to
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {(coaches.data ?? []).map((c) => {
                  const sel = defaultCoach === c.profile_id;
                  return (
                    <Pressable
                      key={c.profile_id}
                      onPress={() => setDefaultCoach(c.profile_id)}
                      className={`px-3 py-1.5 rounded-full border ${
                        sel
                          ? 'border-primary bg-primary/10'
                          : 'border-gray-200 dark:border-gray-700'
                      }`}>
                      <Text className="text-xs text-gray-700 dark:text-gray-200">
                        {c.full_name ?? 'Coach'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <Button
            onPress={() => saveRule.mutate()}
            loading={saveRule.isPending}
            disabled={strategy === 'single_default' && !defaultCoach}>
            Save
          </Button>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-medium">
                Text the coach too
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                Send an SMS alongside the email. Requires an SMS plan — off by
                default.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Text the coach too"
              value={smsOn}
              onValueChange={(v) => toggleSms.mutate(v)}
            />
          </View>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            AI front desk
          </Text>
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-medium">
                Answer texts automatically
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                An AI assistant replies to texts on your gym's number — it
                answers from your real plans and schedule, captures the lead
                and hands hot ones a signup link.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Answer texts automatically"
              value={agentOn}
              onValueChange={(v) => toggleAgent.mutate(v)}
            />
          </View>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {agentNumber
              ? `Your number: ${agentNumber}`
              : 'No number yet — Temple provisions this for you.'}
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-medium">
                Answer phone calls too
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {voiceReady
                  ? 'The assistant picks up calls to your number and can text the caller a signup link.'
                  : 'Not set up yet — missed calls get an automatic "text us back" reply instead. Contact Temple to enable voice.'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Answer phone calls too"
              value={voiceOn}
              disabled={!voiceReady}
              onValueChange={(v) => toggleVoice.mutate(v)}
            />
          </View>
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
                    {sel ? (
                      <Text className="text-primary text-xs font-semibold">Selected</Text>
                    ) : null}
                    <VoiceSampleButton voiceId={v.id} />
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Button
            onPress={() => saveVoice.mutate()}
            loading={saveVoice.isPending}
            disabled={!selectedVoice}>
            Save voice
          </Button>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Call recording &amp; consent
          </Text>
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-medium">
                Record calls for review
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                A short consent line plays at the start of every call. Recordings
                let you review and coach the AI.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Record calls for review"
              value={recOn}
              onValueChange={(v) => toggleRecording.mutate(v)}
            />
          </View>
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
          <Button
            onPress={() => saveRecordingRetention.mutate()}
            loading={saveRecordingRetention.isPending}>
            Save retention
          </Button>
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Recordings are stored privately, every playback is logged, and a caller
            who replies STOP is opted out.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Usage &amp; limits
          </Text>
          <View className="flex-row gap-3">
            <View className="flex-1 items-center gap-0.5 rounded-lg bg-gray-50 dark:bg-gray-800 py-3">
              <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                {usage.data?.sentToday ?? '—'}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">Texts sent (24h)</Text>
            </View>
            <View className="flex-1 items-center gap-0.5 rounded-lg bg-gray-50 dark:bg-gray-800 py-3">
              <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                {usage.data?.conversations7d ?? '—'}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">Threads (7d)</Text>
            </View>
            <View className="flex-1 items-center gap-0.5 rounded-lg bg-gray-50 dark:bg-gray-800 py-3">
              <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                {usage.data?.calls7d ?? '—'}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">Calls (7d)</Text>
            </View>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1 items-center gap-0.5 rounded-lg bg-gray-50 dark:bg-gray-800 py-3">
              <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                {outcomes.data?.leads_30d ?? '—'}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">Leads (30d)</Text>
            </View>
            <View className="flex-1 items-center gap-0.5 rounded-lg bg-gray-50 dark:bg-gray-800 py-3">
              <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                {outcomes.data?.converted_30d ?? '—'}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">Joined (30d)</Text>
            </View>
            <View className="flex-1 items-center gap-0.5 rounded-lg bg-gray-50 dark:bg-gray-800 py-3">
              <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                {outcomes.data
                  ? new Intl.NumberFormat('en-GB', {
                      style: 'currency',
                      currency: outcomes.data.currency,
                      maximumFractionDigits: 0,
                    }).format(outcomes.data.attributed_monthly_cents / 100)
                  : '—'}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">Won per month</Text>
            </View>
          </View>
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Bottom row counts leads the agent sourced: captured, signed up as
            members, and the monthly value of those members' current plans.
            {outcomes.data?.committed
              ? ` ${outcomes.data.committed} more committed and finishing signup.`
              : ''}
          </Text>
          {msgCap !== null ? (
            <Input
              label="Daily message cap"
              value={msgCap}
              onChangeText={setMsgCap}
              keyboardType="number-pad"
              placeholder="200"
            />
          ) : null}
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Past the cap the AI stops replying for the day and hands threads to
            a coach — it bounds what a hostile or chatty texter can cost you.
          </Text>
          {convRetention !== null ? (
            <DurationField
              label="Delete conversations after"
              value={convRetention}
              onChange={setConvRetention}
              base="days"
              units={['days', 'weeks', 'months']}
              placeholder="365"
            />
          ) : null}
          <Button onPress={() => saveLimits.mutate()} loading={saveLimits.isPending}>
            Save limits
          </Button>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            What the agent knows
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Plans and the class schedule are included automatically. Add
            anything else it should know — address, parking, intro offer,
            what makes your gym great.
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
          <Button
            onPress={() => saveAgentContext.mutate()}
            loading={saveAgentContext.isPending}>
            Save notes
          </Button>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Teach it by talking
          </Text>
          {latestInterview.data?.status === 'calling' ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Calling you now at {latestInterview.data.phone} — answer and chat.
              When the call ends, the updated brief appears here for your
              review.
            </Text>
          ) : latestInterview.data?.status === 'completed' &&
            latestInterview.data.draft_brief ? (
            <View className="gap-3">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Here's what your call taught the agent, merged into its brief.
                Edit anything, then apply — nothing is live until you do.
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
              <Button
                onPress={() => applyInterview.mutate()}
                loading={applyInterview.isPending}
                disabled={!interviewDraft?.trim()}>
                Apply to the agent
              </Button>
              <ChipButton
                label="Discard"
                icon="trash-outline"
                tone="neutral"
                onPress={() => discardInterview.mutate()}
              />
            </View>
          ) : latestInterview.data?.status === 'completed' ? (
            <View className="gap-3">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Call captured, but automatic drafting isn't configured — copy
                anything useful into the notes card above.
              </Text>
              <Text
                className="text-gray-500 dark:text-gray-400 text-xs"
                numberOfLines={12}>
                {latestInterview.data.transcript ?? ''}
              </Text>
              <ChipButton
                label="Dismiss"
                icon="trash-outline"
                tone="neutral"
                onPress={() => discardInterview.mutate()}
              />
            </View>
          ) : (
            <View className="gap-3">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                A five-minute phone call where the assistant interviews you —
                your intro offer, where beginners start, parking, the questions
                you always get. It drafts the update; you review and approve
                before anything changes.
              </Text>
              {latestInterview.data?.status === 'failed' ? (
                <Text className="text-amber-600 dark:text-amber-400 text-xs">
                  The last call didn't connect — check the number and try
                  again.
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
            </View>
          )}
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Coaching rules
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Rules and examples you've taught the agent from call reviews. Turn one
            off to stop applying it on future calls. The agent applies your 25
            most recent active rules (and 5 examples) — retire stale ones so new
            coaching keeps landing.
          </Text>
          {(rules.data ?? []).length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No rules yet. Open a call in Conversations and use “Coach this turn”
              to teach the agent.
            </Text>
          ) : (
            (rules.data ?? []).map((r) => (
              <View
                key={r.id}
                className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 gap-2">
                <Text className="text-gray-800 dark:text-gray-100 text-sm">
                  {r.correction}
                </Text>
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

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Data retention
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Leads that never convert are deleted after this window. Converted
            leads become members and are kept.
          </Text>
          {retention !== null ? (
            <DurationField
              label="Delete after"
              value={retention}
              onChange={setRetention}
              base="days"
              units={['days', 'weeks', 'months']}
              placeholder="365"
            />
          ) : null}
          <Button onPress={() => saveRetention.mutate()} loading={saveRetention.isPending}>
            Save retention
          </Button>
        </View>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
