import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '@/components/Text';

import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { DurationField } from '@/components/DurationField';
import { Input } from '@/components/Input';
import { LeadsShell } from '@/components/LeadsNav';
import { syncVapiAssistant } from '@/lib/agent-sync';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

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

type SourceRow = { id: string; label: string; color: string };

type AgentLimits = {
  call_recording_enabled: boolean;
  call_recording_retention_days: number;
  daily_message_cap: number;
  conversation_retention_days: number;
};

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

export default function LeadSettingsScreen() {
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
    queryKey: ['agent-limits', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<AgentLimits | null> => {
      const { data, error } = await supabase
        .from('gym_agent_settings')
        .select(
          'call_recording_enabled, call_recording_retention_days, daily_message_cap, conversation_retention_days',
        )
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (error) throw error;
      return (data as AgentLimits) ?? null;
    },
  });

  const [strategy, setStrategy] = useState<Strategy>('round_robin');
  const [defaultCoach, setDefaultCoach] = useState<string | null>(null);
  // null until the setting loads — DurationField seeds its unit once at
  // mount, so it must not mount on the placeholder '365' and then be stuck
  // when the real value arrives a tick later.
  const [retention, setRetention] = useState<string | null>(null);
  const [recRetention, setRecRetention] = useState<string | null>(null);
  const [msgCap, setMsgCap] = useState<string | null>(null);
  const [convRetention, setConvRetention] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

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
    if (recRetention === null)
      setRecRetention(String(agent.data?.call_recording_retention_days ?? 90));
    if (msgCap === null) setMsgCap(String(agent.data?.daily_message_cap ?? 200));
    if (convRetention === null)
      setConvRetention(String(agent.data?.conversation_retention_days ?? 365));
  }, [agent.isSuccess, agent.data, recRetention, msgCap, convRetention]);

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
      queryClient.invalidateQueries({ queryKey: ['agent-limits', membership?.gymId] });
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
      queryClient.invalidateQueries({ queryKey: ['agent-limits', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save recording retention')),
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
      queryClient.invalidateQueries({ queryKey: ['agent-limits', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the limits')),
  });

  if (membership && !isOwner) return <Redirect href="/management/leads" />;
  if (!membership) return null;

  const smsOn = gymSettings.data?.lead_sms_enabled ?? false;
  const recOn = agent.data?.call_recording_enabled ?? true;

  return (
    <LeadsShell active="settings" tabs={['leads', 'agent', 'conversations', 'settings']}>
      <View className="gap-1">
        <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">Settings</Text>
        <Text className="text-gray-500 dark:text-gray-400">
          How leads are routed, recorded, and retained.
        </Text>
      </View>

      <SectionHeader label="When a lead comes in" />

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        {(['round_robin', 'single_default', 'manual'] as Strategy[]).map((s) => {
          const sel = strategy === s;
          return (
            <Pressable
              key={s}
              onPress={() => setStrategy(s)}
              className={`rounded-lg border p-3 gap-1 ${
                sel ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'
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
                      sel ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-700'
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
            <Text className="text-gray-900 dark:text-gray-50 font-medium">Text the coach too</Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Send an SMS alongside the email. Requires an SMS plan — off by default.
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
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">Lead sources</Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Where your prospects come from — Instagram, walk-in, referral, open day.
            </Text>
          </View>
          <ChipButton
            label="Manage"
            icon="share-social-outline"
            tone="neutral"
            onPress={() => setSourcesOpen(true)}
          />
        </View>
      </View>

      <SectionHeader label="Call Recording & Consent" />

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">
              Record calls for review
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              A short consent line plays at the start of every call. Recordings let you review and
              coach the AI.
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
        <Button onPress={() => saveRecordingRetention.mutate()} loading={saveRecordingRetention.isPending}>
          Save retention
        </Button>
        <Text className="text-gray-400 dark:text-gray-500 text-xs">
          Recordings are stored privately, every playback is logged, and a caller who replies STOP
          is opted out.
        </Text>
      </View>

      <SectionHeader label="Usage & Data" />

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
          Bottom row counts leads the agent sourced: captured, signed up as members, and the
          monthly value of those members' current plans.
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
          Past the cap the AI stops replying for the day and hands threads to a coach — it bounds
          what a hostile or chatty texter can cost you.
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

      <SectionHeader label="Data Retention" />

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          Leads that never convert are deleted after this window. Converted leads become members
          and are kept.
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

      {error ? <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text> : null}

      <SourcesEditorModal
        visible={sourcesOpen}
        gymId={membership.gymId}
        onClose={() => setSourcesOpen(false)}
      />
    </LeadsShell>
  );
}

const SOURCE_COLOURS = [
  '#EF4444', '#F97316', '#F59E0B', '#10B981',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280',
];

function SourcesEditorModal({
  visible,
  gymId,
  onClose,
}: {
  visible: boolean;
  gymId: string;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(SOURCE_COLOURS[0]);
  const [error, setError] = useState<string | null>(null);

  const sources = useQuery({
    queryKey: ['lead-sources', gymId],
    enabled: visible,
    queryFn: async (): Promise<SourceRow[]> => {
      const { data, error: e } = await supabase
        .from('lead_sources')
        .select('id, label, color')
        .eq('gym_id', gymId)
        .is('archived_at', null)
        .order('label');
      if (e) throw e;
      return (data ?? []) as SourceRow[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (label.trim() === '') throw new Error('Label is required');
      const { error: e } = await supabase
        .from('lead_sources')
        .insert({ gym_id: gymId, label: label.trim(), color });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setLabel('');
      setColor(SOURCE_COLOURS[0]);
      queryClient.invalidateQueries({ queryKey: ['lead-sources', gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not add source')),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase
        .from('lead_sources')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id);
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-sources', gymId] });
    },
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-4 max-h-[90%]">
          <ScrollView>
            <View className="gap-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                  Lead sources
                </Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  className="w-8 h-8 items-center justify-center rounded-full active:bg-gray-100 dark:active:bg-gray-800">
                  <Ionicons name="close" size={18} color={colors.iconSecondary} />
                </Pressable>
              </View>

              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Where your prospects come from — Instagram, walk-in,
                referral, open day. The chip colour shows up on every
                lead card.
              </Text>

              <View className="gap-2">
                {(sources.data ?? []).length === 0 ? (
                  <Text className="text-gray-400 dark:text-gray-500 text-sm">
                    No sources yet.
                  </Text>
                ) : (
                  (sources.data ?? []).map((s) => (
                    <View
                      key={s.id}
                      className="flex-row items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                      <View
                        style={{ backgroundColor: s.color }}
                        className="w-4 h-4 rounded-full"
                      />
                      <Text className="text-gray-900 dark:text-gray-50 flex-1">
                        {s.label}
                      </Text>
                      <Pressable
                        onPress={() => archive.mutate(s.id)}
                        hitSlop={8}
                        accessibilityLabel="Archive source">
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color={colors.iconTertiary}
                        />
                      </Pressable>
                    </View>
                  ))
                )}
              </View>

              <View className="gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                  Add a source
                </Text>
                <Input
                  label=""
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Instagram"
                />
                <View className="flex-row flex-wrap gap-2">
                  {SOURCE_COLOURS.map((c) => {
                    const sel = c === color;
                    return (
                      <Pressable
                        key={c}
                        onPress={() => setColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-8 h-8 rounded-full ${
                          sel ? 'border-2 border-gray-900 dark:border-gray-50' : ''
                        }`}
                      />
                    );
                  })}
                </View>
                {error ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">
                    {error}
                  </Text>
                ) : null}
                <Button
                  onPress={() => create.mutate()}
                  loading={create.isPending}
                  disabled={label.trim() === ''}>
                  Add source
                </Button>
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
