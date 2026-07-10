import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
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

  const [strategy, setStrategy] = useState<Strategy>('round_robin');
  const [defaultCoach, setDefaultCoach] = useState<string | null>(null);
  const [retention, setRetention] = useState('365');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rule.data) {
      setStrategy(rule.data.strategy);
      setDefaultCoach(rule.data.default_coach_id);
    }
  }, [rule.data]);
  useEffect(() => {
    if (gymSettings.data) setRetention(String(gymSettings.data.lead_retention_days));
  }, [gymSettings.data]);

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
      const days = parseInt(retention, 10);
      if (!Number.isFinite(days)) throw new Error('Enter a number of days');
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

  if (membership && !isOwner) return <Redirect href="/management/leads" />;
  if (!membership) return null;

  const smsOn = gymSettings.data?.lead_sms_enabled ?? false;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Leads" fallbackHref="/management/leads" />
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
            Data retention
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Leads that never convert are deleted after this many days. Converted
            leads become members and are kept.
          </Text>
          <Input
            label="Days"
            value={retention}
            onChangeText={setRetention}
            keyboardType="number-pad"
            placeholder="365"
          />
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
