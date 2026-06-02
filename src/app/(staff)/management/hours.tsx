import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const DAYS = [
  { dow: 0, label: 'Sunday' },
  { dow: 1, label: 'Monday' },
  { dow: 2, label: 'Tuesday' },
  { dow: 3, label: 'Wednesday' },
  { dow: 4, label: 'Thursday' },
  { dow: 5, label: 'Friday' },
  { dow: 6, label: 'Saturday' },
] as const;

type DayState = { open: boolean; opensAt: string; closesAt: string };

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function defaultState(): DayState {
  return { open: false, opensAt: '06:00', closesAt: '21:00' };
}

export default function HoursScreen() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [states, setStates] = useState<Record<number, DayState>>(() => {
    const initial: Record<number, DayState> = {};
    DAYS.forEach((d) => (initial[d.dow] = defaultState()));
    return initial;
  });
  const [error, setError] = useState<string | null>(null);

  const hours = useQuery({
    queryKey: ['gym-hours', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_hours')
        .select('day_of_week, opens_at, closes_at')
        .order('day_of_week');
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!hours.data) return;
    setStates(() => {
      const next: Record<number, DayState> = {};
      DAYS.forEach((d) => (next[d.dow] = defaultState()));
      hours.data.forEach((h) => {
        next[h.day_of_week] = {
          open: true,
          opensAt: h.opens_at.slice(0, 5),
          closesAt: h.closes_at.slice(0, 5),
        };
      });
      return next;
    });
  }, [hours.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      for (const d of DAYS) {
        const s = states[d.dow];
        if (!s.open) continue;
        if (!TIME_RE.test(s.opensAt) || !TIME_RE.test(s.closesAt)) {
          throw new Error(`${d.label}: times must be HH:MM (24-hour)`);
        }
        if (s.opensAt >= s.closesAt) {
          throw new Error(`${d.label}: opens must be before closes`);
        }
      }
      const toUpsert = DAYS.filter((d) => states[d.dow].open).map((d) => ({
        gym_id: membership.gymId,
        day_of_week: d.dow,
        opens_at: states[d.dow].opensAt + ':00',
        closes_at: states[d.dow].closesAt + ':00',
      }));
      const toDelete = DAYS.filter((d) => !states[d.dow].open).map((d) => d.dow);

      if (toUpsert.length > 0) {
        const { error } = await supabase
          .from('gym_hours')
          .upsert(toUpsert, { onConflict: 'gym_id,day_of_week' });
        if (error) throw error;
      }
      if (toDelete.length > 0) {
        const { error } = await supabase
          .from('gym_hours')
          .delete()
          .eq('gym_id', membership.gymId)
          .in('day_of_week', toDelete);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['gym-hours'] });
    },
    onError: (e) => setError(errorMessage(e, 'Save failed')),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6">
        <View className="gap-2">
          <Text className="text-gray-900 text-2xl font-semibold">Operating hours</Text>
          <Text className="text-gray-500">
            Set when your gym is open each day. Hours outside these windows
            appear as Closed in the Classes view, so they can't be booked.
          </Text>
        </View>

        <View className="gap-3">
          {DAYS.map((d) => {
            const s = states[d.dow];
            return (
              <View key={d.dow} className="bg-white rounded-xl p-4 gap-3">
                <View className="flex-row justify-between items-center">
                  <Text className="text-gray-900 font-semibold">{d.label}</Text>
                  <Pressable
                    onPress={() =>
                      setStates({ ...states, [d.dow]: { ...s, open: !s.open } })
                    }
                    hitSlop={8}
                    className={`px-3 py-1 rounded-full border ${
                      s.open ? 'border-primary bg-primary/10' : 'border-gray-200'
                    }`}>
                    <Text className={s.open ? 'text-primary' : 'text-gray-500'}>
                      {s.open ? 'Open' : 'Closed'}
                    </Text>
                  </Pressable>
                </View>
                {s.open ? (
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      <Input
                        label="Opens"
                        value={s.opensAt}
                        onChangeText={(v) =>
                          setStates({ ...states, [d.dow]: { ...s, opensAt: v } })
                        }
                        placeholder="06:00"
                      />
                    </View>
                    <View className="flex-1">
                      <Input
                        label="Closes"
                        value={s.closesAt}
                        onChangeText={(v) =>
                          setStates({ ...states, [d.dow]: { ...s, closesAt: v } })
                        }
                        placeholder="21:00"
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        {error ? <Text className="text-red-500">{error}</Text> : null}

        <Button onPress={() => save.mutate()} loading={save.isPending}>
          Save changes
        </Button>
      </ScrollView>
    </Screen>
  );
}
