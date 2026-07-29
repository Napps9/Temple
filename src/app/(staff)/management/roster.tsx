import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { ChipButton } from '@/components/ChipButton';
import { MoneyJobCard } from '@/components/MoneyJobCard';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// The Roster (docs/roadmap.md phase 9): who works for you — the people,
// and Temple's jobs in plain names, each with one line of what it does
// and how much rope it has. Changing the rope is deliberate and
// owner-only; the fine-grained permission editors stay one tap deeper.

type StaffRow = {
  role: 'owner' | 'coach' | 'staff';
  profile_id: string;
  profiles: { full_name: string | null } | null;
};

type AuthorityRow = {
  action_kind: 'chase_message' | 'plan_adjustment_offer';
  level: 'autonomous' | 'approval' | 'reserved';
};

const ROLE_LABEL: Record<StaffRow['role'], string> = {
  owner: 'Owner',
  coach: 'Coach',
  staff: 'Front desk',
};

export default function Roster() {
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId;
  const role = useRole();
  const isOwner = role === 'owner';
  const qc = useQueryClient();
  const [busyDial, setBusyDial] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const people = useQuery({
    queryKey: ['roster-people', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<StaffRow[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('role, profile_id, profiles(full_name)')
        .eq('gym_id', gymId!)
        .in('role', ['owner', 'coach', 'staff'])
        .is('left_at', null);
      if (error) throw error;
      return (data ?? []) as unknown as StaffRow[];
    },
  });

  const authority = useQuery({
    queryKey: ['agent-authority', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<AuthorityRow[]> => {
      const { data, error } = await supabase
        .from('agent_authority')
        .select('action_kind, level')
        .eq('gym_id', gymId!);
      if (error) throw error;
      return (data ?? []) as AuthorityRow[];
    },
  });

  const setLevel = async (
    kind: AuthorityRow['action_kind'],
    level: 'approval' | 'autonomous',
  ) => {
    if (!gymId || busyDial || !isOwner) return;
    setBusyDial(true);
    try {
      const { error } = await supabase.rpc('set_agent_job_level', {
        p_gym_id: gymId,
        p_action_kind: kind,
        p_level: level,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['agent-authority', gymId] });
    } finally {
      setBusyDial(false);
    }
  };

  const switchOff = async () => {
    if (!gymId || busyDial) return;
    if (!confirmOff) {
      setConfirmOff(true);
      return;
    }
    setBusyDial(true);
    try {
      const { error } = await supabase.rpc('set_money_job', {
        p_gym_id: gymId,
        p_enabled: false,
      });
      if (error) throw error;
      setConfirmOff(false);
      qc.invalidateQueries({ queryKey: ['agent-authority', gymId] });
    } finally {
      setBusyDial(false);
    }
  };

  const moneyOn = (authority.data ?? []).length > 0;
  const levelFor = (kind: AuthorityRow['action_kind']) =>
    (authority.data ?? []).find((a) => a.action_kind === kind)?.level;

  return (
    <Screen className="px-0">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Timeline" fallbackHref="/timeline" />
        <Text className="text-gray-900 dark:text-gray-50 text-2xl font-bold">
          The team
        </Text>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <View className="flex-row items-center gap-3">
            <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold text-base">
              People
            </Text>
            <ChipButton
              label="Manage"
              icon="settings-outline"
              onPress={() => router.push('/management/team' as never)}
            />
          </View>
          {(people.data ?? []).map((p) => (
            <View key={p.profile_id} className="flex-row items-center gap-3">
              <Text className="flex-1 text-gray-700 dark:text-gray-200 text-[15px]">
                {p.profiles?.full_name ?? 'Unnamed'}
              </Text>
              <Text className="text-gray-400 dark:text-gray-500 text-sm">
                {ROLE_LABEL[p.role]}
              </Text>
            </View>
          ))}
        </View>

        <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-bold uppercase tracking-wide pt-2">
          Temple&apos;s jobs
        </Text>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <View className="flex-row items-center gap-3">
            <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold text-base">
              The front desk
            </Text>
            <RopePill label="on its own" />
          </View>
          <Text className="text-gray-600 dark:text-gray-300 text-sm leading-5">
            Answers calls and texts from people asking about the gym — day and
            night — and books their first visit.
          </Text>
          <View className="flex-row">
            <ChipButton
              label="Its screens"
              icon="open-outline"
              onPress={() => router.push('/management/leads/agent' as never)}
            />
          </View>
        </View>

        {moneyOn ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <View className="flex-row items-center gap-3">
              <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold text-base">
                The money
              </Text>
              <RopePill
                label={
                  levelFor('chase_message') === 'autonomous'
                    ? 'on its own'
                    : 'asks first'
                }
              />
            </View>
            <Text className="text-gray-600 dark:text-gray-300 text-sm leading-5">
              Chases failed payments with a warm nudge, and asks before
              offering the smaller plan. Never cancels anyone; two messages at
              most.
            </Text>
            {isOwner ? (
              <View className="gap-2.5">
                <DialRow
                  label="Payment nudges"
                  level={levelFor('chase_message')}
                  onPick={(l) => setLevel('chase_message', l)}
                />
                <DialRow
                  label="Plan offers"
                  level={levelFor('plan_adjustment_offer')}
                  onPick={(l) => setLevel('plan_adjustment_offer', l)}
                />
                <Pressable onPress={switchOff} hitSlop={6}>
                  <Text className="text-red-600 dark:text-red-400 text-sm font-semibold">
                    {confirmOff
                      ? 'Tap again — the job stops and open questions are dropped'
                      : 'Switch this job off'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : isOwner ? (
          <MoneyJobCard
            gymId={gymId}
            onTakenOn={() =>
              qc.invalidateQueries({ queryKey: ['agent-authority', gymId] })
            }
          />
        ) : null}

        <Text className="text-gray-400 dark:text-gray-500 text-sm px-1">
          More jobs — keeping members, finding cover — arrive the same way:
          read the rules, say &ldquo;sounds right&rdquo;.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function RopePill({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5">
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">
        {label}
      </Text>
    </View>
  );
}

function DialRow({
  label,
  level,
  onPick,
}: {
  label: string;
  level: 'autonomous' | 'approval' | 'reserved' | undefined;
  onPick: (l: 'approval' | 'autonomous') => void;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="flex-1 text-gray-700 dark:text-gray-200 text-sm">{label}</Text>
      {(['approval', 'autonomous'] as const).map((l) => {
        const selected = level === l;
        return (
          <Pressable
            key={l}
            onPress={() => onPick(l)}
            className={`px-3 py-1.5 rounded-full border active:opacity-70 ${
              selected
                ? 'bg-primary border-primary'
                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
            }`}>
            <Text
              className={`text-[13px] font-semibold ${
                selected ? 'text-white' : 'text-gray-700 dark:text-gray-300'
              }`}>
              {l === 'approval' ? 'asks first' : 'on its own'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
