import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';

type Session = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  class_types: { name: string; color: string } | null;
  bookings: { count: number }[] | null;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
  return `${date} · ${time}`;
}

export default function NewClassBroadcast() {
  const colors = useThemeColors();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const canBroadcast = useCan('can_broadcast_to_class');
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['broadcast-sessions', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Session[]> => {
      const nowIso = new Date().toISOString();
      const cutoffIso = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();
      const { data, error: err } = await supabase
        .from('class_sessions')
        .select(
          'id, starts_at, duration_minutes, class_types(name, color), bookings:class_bookings(count)',
        )
        .eq('gym_id', membership!.gymId)
        .gte('starts_at', nowIso)
        .lte('starts_at', cutoffIso)
        .order('starts_at', { ascending: true });
      if (err) throw err;
      return (data ?? []) as unknown as Session[];
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!session || !membership) throw new Error('Missing context');
      if (!selected) throw new Error('Pick a session');
      const trimmed = body.trim();
      if (!trimmed) throw new Error('Write a message');
      const { error: err } = await supabase
        .from('class_session_broadcasts')
        .insert({
          gym_id: membership.gymId,
          class_session_id: selected,
          sender_id: session.user.id,
          body: trimmed,
        });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['class-session-broadcasts'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-unread-summary'] });
      router.replace('/inbox' as never);
    },
    onError: (e) => setError(errorMessage(e, 'Could not broadcast')),
  });

  if (canBroadcast === false) {
    return (
      <Screen>
        <Text className="text-gray-500 dark:text-gray-400 mt-8">
          You don't have permission to broadcast to classes.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <BackLink inline fallbackHref="/inbox" />
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Broadcast to class
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Message everyone booked into a single session.
            </Text>
          </View>
        </View>

        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          Pick a session in the next 7 days
        </Text>
        {sessions.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : (sessions.data?.length ?? 0) === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No upcoming sessions in the next week.
            </Text>
          </View>
        ) : (
          <View className="gap-2">
            {sessions.data!.map((s) => {
              const selectedNow = selected === s.id;
              const color = s.class_types?.color ?? colors.primary;
              const bookings = s.bookings?.[0]?.count ?? 0;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSelected(s.id)}
                  className={`bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70 ${
                    selectedNow ? 'border border-primary' : 'border border-transparent'
                  }`}>
                  <View
                    style={{ backgroundColor: color }}
                    className="rounded-full px-2 py-0.5">
                    <Text className="text-white text-[10px] font-semibold">
                      {s.class_types?.name ?? 'Class'}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-gray-900 dark:text-gray-50 font-medium text-sm">
                      {fmtWhen(s.starts_at)}
                    </Text>
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">
                      {bookings} booked · {s.duration_minutes} min
                    </Text>
                  </View>
                  <Ionicons
                    name={selectedNow ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={selectedNow ? colors.primary : colors.iconTertiary}
                  />
                </Pressable>
              );
            })}
          </View>
        )}

        <Input
          label="Message"
          value={body}
          onChangeText={setBody}
          placeholder="Bring a jump rope. Running late, start without me."
          multiline
          numberOfLines={4}
          style={{ minHeight: 100, textAlignVertical: 'top' }}
          autoCapitalize="sentences"
        />

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
        ) : null}
        <Button onPress={() => send.mutate()} loading={send.isPending}>
          Send broadcast
        </Button>
      </ScrollView>
    </Screen>
  );
}
