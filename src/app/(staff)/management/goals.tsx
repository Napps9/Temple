import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// Goals (docs/roadmap.md phase 9): "200 members by December" as a brief,
// with the score kept for you. The current number is read from the
// roster, never typed — a goal card is a sentence and a computed line,
// not a KPI tile.

type Goal = {
  id: string;
  target_value: number;
  due_on: string;
  achieved_at: string | null;
};

function monthsLeft(dueOn: string): number {
  const [y, m] = dueOn.split('-').map(Number);
  const now = new Date();
  return Math.max(0, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()));
}

function dueLabel(dueOn: string): string {
  const [y, m] = dueOn.split('-').map(Number);
  const withYear = y !== new Date().getFullYear();
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export default function Goals() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const gymId = membership?.gymId;
  const isOwner = useRole() === 'owner';
  const qc = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const goals = useQuery({
    queryKey: ['gym-goals', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await supabase
        .from('gym_goals')
        .select('id, target_value, due_on, achieved_at')
        .eq('gym_id', gymId!)
        .order('due_on');
      if (error) throw error;
      return (data ?? []) as Goal[];
    },
  });

  const memberCount = useQuery({
    queryKey: ['member-count', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('gym_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId!)
        .eq('role', 'member')
        .is('left_at', null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const addGoal = async () => {
    const value = Number(target);
    if (
      !gymId ||
      !session?.user.id ||
      busy ||
      !Number.isInteger(value) ||
      value <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)
    ) {
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await supabase.from('gym_goals').insert({
        gym_id: gymId,
        target_value: value,
        due_on: dueOn,
        created_by: session.user.id,
      });
      if (error) throw error;
      setAdding(false);
      setTarget('');
      setDueOn('');
      qc.invalidateQueries({ queryKey: ['gym-goals', gymId] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const removeGoal = async (id: string) => {
    if (busy) return;
    const { error } = await supabase.from('gym_goals').delete().eq('id', id);
    if (!error) qc.invalidateQueries({ queryKey: ['gym-goals', gymId] });
  };

  const current = memberCount.data ?? 0;

  return (
    <Screen className="px-0">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management" coveredByRail />
        <PageHead title="Goals" />

        {(goals.data ?? []).map((g) => {
          const toGo = Math.max(0, g.target_value - current);
          const months = monthsLeft(g.due_on);
          const hit = current >= g.target_value;
          return (
            <View
              key={g.id}
              className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
              <Text className="text-ink dark:text-ink-dk text-base font-semibold">
                {g.target_value} members by {dueLabel(g.due_on)}
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
                {hit
                  ? `Done — you're at ${current}.`
                  : `${current} today — ${toGo} to go, ${
                      months === 0
                        ? 'due this month'
                        : months === 1
                          ? 'a month left'
                          : `${months} months left`
                    }.`}
              </Text>
              {isOwner ? (
                <Pressable onPress={() => removeGoal(g.id)} hitSlop={6}>
                  <Text className="text-ink-3 dark:text-ink-3-dk text-sm">
                    Let this one go
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {(goals.data ?? []).length === 0 && !adding ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm px-1 leading-5">
            A goal here reads like a brief — &ldquo;200 members by
            December&rdquo;. Set one and the score is kept for you.
          </Text>
        ) : null}

        {isOwner && !adding ? (
          <View className="flex-row">
            <Button onPress={() => setAdding(true)}>Set a goal</Button>
          </View>
        ) : null}

        {isOwner && adding ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-4">
            <Input
              label="Members"
              value={target}
              onChangeText={setTarget}
              placeholder="200"
              keyboardType="number-pad"
            />
            <DatePicker label="By" value={dueOn} onChange={setDueOn} />
            {failed ? (
              <Text className="text-red-600 dark:text-red-400 text-sm">
                That didn&apos;t save — check the numbers and try again.
              </Text>
            ) : null}
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <Button onPress={addGoal} loading={busy}>
                  Set the goal
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  variant="secondary"
                  onPress={() => setAdding(false)}
                  disabled={busy}>
                  Cancel
                </Button>
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
