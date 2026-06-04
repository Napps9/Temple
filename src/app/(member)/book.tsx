import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { ClassesCalendar } from '@/components/ClassesCalendar';
import { useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type NextBooking = {
  id: string;
  class_session_id: string;
  class_sessions: {
    starts_at: string;
    class_types: { name: string; color: string } | null;
  } | null;
};

function fmtNext(start: Date) {
  const date = start.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  const time = `${start.getHours().toString().padStart(2, '0')}:${start
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
  return `${date} at ${time}`;
}

function NextClassCard() {
  const session = useSession();
  const nowIso = new Date().toISOString();
  const next = useQuery({
    queryKey: ['my-next-booking', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select(
          'id, class_session_id, class_sessions!inner(starts_at, class_types(name, color))',
        )
        .eq('profile_id', session!.user.id)
        .gt('class_sessions.starts_at', nowIso)
        .order('class_sessions(starts_at)', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as NextBooking | null;
    },
  });

  if (!next.data || !next.data.class_sessions) return null;

  const start = new Date(next.data.class_sessions.starts_at);
  const typeColor = next.data.class_sessions.class_types?.color ?? '#2563EB';
  const typeName = next.data.class_sessions.class_types?.name ?? 'Class';

  return (
    <Pressable
      onPress={() => router.push('/bookings')}
      className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
      <View
        style={{ backgroundColor: typeColor }}
        className="rounded-full px-2 py-0.5">
        <Text className="text-white text-[10px] font-semibold">{typeName}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
          Your next class
        </Text>
        <Text className="text-gray-900 dark:text-gray-50 font-medium">
          {fmtNext(start)}
        </Text>
      </View>
      <Text className="text-primary text-xs uppercase tracking-widest">View</Text>
    </Pressable>
  );
}

export default function Book() {
  return <ClassesCalendar mode="book" topSlot={<NextClassCard />} />;
}
