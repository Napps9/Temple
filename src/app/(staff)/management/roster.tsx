import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
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
  action_kind:
    | 'chase_message'
    | 'plan_adjustment_offer'
    | 'retention_message'
    | 'cover_ask';
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

  const levelFor = (kind: AuthorityRow['action_kind']) =>
    (authority.data ?? []).find((a) => a.action_kind === kind)?.level;
  const moneyOn = levelFor('chase_message') !== undefined;

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

        <SimpleJob
          gymId={gymId}
          isOwner={isOwner}
          kind="retention_message"
          name="Keeping members"
          onDescription="Notices a regular gone quiet and sends one warm note — three a day at most, never the same person twice in six weeks, never about health. Writing anyone off stays yours."
          offTitle="Fading members — want me to reach out?"
          offLines={[
            "When a regular hasn't been in for three weeks, I'd send one warm note — and I ask you before each until you say otherwise.",
            'Three people a day at most, never the same person twice in six weeks, and never about health.',
            'Writing a member off stays yours — I only ever say we miss them.',
          ]}
          enableRpc="set_retention_job"
          disableRpc="set_retention_job"
          level={levelFor('retention_message')}
          onSetLevel={(l) => setLevel('retention_message', l)}
          authorityLoaded={authority.data !== undefined}
          onChanged={() =>
            qc.invalidateQueries({ queryKey: ['agent-authority', gymId] })
          }
        />

        <SimpleJob
          gymId={gymId}
          isOwner={isOwner}
          kind="cover_ask"
          name="Finding cover"
          onDescription="When a class inside your warning window still has no coach, asks every coach who could claim it — again. Never moves or cancels a class; the claim stays first-come."
          offTitle="Uncovered classes — want me to chase the cover?"
          offLines={[
            "When a class inside your warning window still has no coach, I'd nudge the qualified coaches again — you approve each ask until you say otherwise.",
            'I never move or cancel a class, and the claim stays first-come.',
          ]}
          enableRpc="set_cover_job"
          disableRpc="set_cover_job"
          level={levelFor('cover_ask')}
          onSetLevel={(l) => setLevel('cover_ask', l)}
          authorityLoaded={authority.data !== undefined}
          onChanged={() =>
            qc.invalidateQueries({ queryKey: ['agent-authority', gymId] })
          }
        />
      </ScrollView>
    </Screen>
  );
}

function SimpleJob({
  gymId,
  isOwner,
  name,
  onDescription,
  offTitle,
  offLines,
  enableRpc,
  disableRpc,
  level,
  onSetLevel,
  authorityLoaded,
  onChanged,
}: {
  gymId: string | undefined;
  isOwner: boolean;
  kind: AuthorityRow['action_kind'];
  name: string;
  onDescription: string;
  offTitle: string;
  offLines: string[];
  enableRpc: 'set_retention_job' | 'set_cover_job';
  disableRpc: 'set_retention_job' | 'set_cover_job';
  level: 'autonomous' | 'approval' | 'reserved' | undefined;
  onSetLevel: (l: 'approval' | 'autonomous') => void;
  authorityLoaded: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const flip = async (enabled: boolean) => {
    if (!gymId || busy) return;
    if (!enabled && !confirmOff) {
      setConfirmOff(true);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc(enabled ? enableRpc : disableRpc, {
        p_gym_id: gymId,
        p_enabled: enabled,
      });
      if (error) throw error;
      setConfirmOff(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!authorityLoaded) return null;

  if (level === undefined) {
    if (!isOwner) return null;
    return (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        <Text className="text-gray-900 dark:text-gray-50 text-[15px] font-semibold leading-[22px]">
          {offTitle}
        </Text>
        <View className="gap-1.5">
          {offLines.map((l, i) => (
            <Text key={i} className="text-gray-600 dark:text-gray-300 text-sm leading-5">
              {l}
            </Text>
          ))}
        </View>
        <View className="flex-row">
          <Button onPress={() => flip(true)} loading={busy}>
            Sounds right — take it on
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold text-base">
          {name}
        </Text>
        <RopePill label={level === 'autonomous' ? 'on its own' : 'asks first'} />
      </View>
      <Text className="text-gray-600 dark:text-gray-300 text-sm leading-5">
        {onDescription}
      </Text>
      {isOwner ? (
        <View className="gap-2.5">
          <DialRow label="Its asks" level={level} onPick={onSetLevel} />
          <Pressable onPress={() => flip(false)} hitSlop={6}>
            <Text className="text-red-600 dark:text-red-400 text-sm font-semibold">
              {confirmOff
                ? 'Tap again — the job stops and open questions are dropped'
                : 'Switch this job off'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
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
