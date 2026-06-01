import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { CreateClassModal } from '@/components/CreateClassModal';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const HOURS = Array.from({ length: 18 }, (_, i) => i + 5); // 05:00 .. 22:00

type ClassSession = {
  id: string;
  name: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function formatDateLabel(date: Date) {
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fmtTime(d: Date) {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function StaffClasses() {
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [createAtHour, setCreateAtHour] = useState<number | null>(null);
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();

  const dayOfWeek = date.getDay();

  const hours = useQuery({
    queryKey: ['gym-hours', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_hours')
        .select('day_of_week, opens_at, closes_at');
      if (error) throw error;
      return data;
    },
  });

  const todayHours = hours.data?.find((h) => h.day_of_week === dayOfWeek);
  const todayOpenMin = todayHours ? timeToMinutes(todayHours.opens_at.slice(0, 5)) : null;
  const todayCloseMin = todayHours ? timeToMinutes(todayHours.closes_at.slice(0, 5)) : null;

  const dayKey = date.toISOString().slice(0, 10);
  const sessions = useQuery({
    queryKey: ['class-sessions', membership?.gymId, dayKey],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const start = startOfDay(date);
      const end = addDays(start, 1);
      const { data, error } = await supabase
        .from('class_sessions')
        .select('id, name, starts_at, duration_minutes, capacity')
        .gte('starts_at', start.toISOString())
        .lt('starts_at', end.toISOString())
        .order('starts_at');
      if (error) throw error;
      return data as ClassSession[];
    },
  });

  function classesAtHour(hour: number) {
    return sessions.data?.filter((s) => new Date(s.starts_at).getHours() === hour) ?? [];
  }

  function isHourOpen(hour: number) {
    if (todayOpenMin === null || todayCloseMin === null) return false;
    const hourMin = hour * 60;
    return hourMin >= todayOpenMin && hourMin < todayCloseMin;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <View className="py-4 flex-row items-center justify-between">
        <Pressable onPress={() => setDate(addDays(date, -1))} hitSlop={8}>
          <Text className="text-brand">← Prev</Text>
        </Pressable>
        <View className="items-center gap-0.5">
          <Text className="text-bone text-xl font-semibold">{formatDateLabel(date)}</Text>
          <Text className="text-bone/60 text-xs">
            {date.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        </View>
        <Pressable onPress={() => setDate(addDays(date, 1))} hitSlop={8}>
          <Text className="text-brand">Next →</Text>
        </Pressable>
      </View>

      {!todayHours && hours.data ? (
        <View className="bg-ink-soft rounded-xl p-4 gap-1 mb-2">
          <Text className="text-bone font-semibold">Gym closed today</Text>
          <Text className="text-bone/60">
            Open hours for this day are not set. Configure them in Manage →
            Operating hours to start scheduling.
          </Text>
        </View>
      ) : null}

      <ScrollView contentContainerClassName="pb-6">
        {HOURS.map((hour) => {
          const open = isHourOpen(hour);
          const classes = classesAtHour(hour);
          return (
            <HourRow
              key={hour}
              hour={hour}
              open={open}
              classes={classes}
              onCreate={() => setCreateAtHour(hour)}
            />
          );
        })}
      </ScrollView>

      <CreateClassModal
        visible={createAtHour !== null}
        date={date}
        hour={createAtHour ?? 0}
        onClose={() => setCreateAtHour(null)}
        onCreated={() => {
          setCreateAtHour(null);
          queryClient.invalidateQueries({ queryKey: ['class-sessions'] });
        }}
      />
    </Screen>
  );
}

function HourRow({
  hour,
  open,
  classes,
  onCreate,
}: {
  hour: number;
  open: boolean;
  classes: ClassSession[];
  onCreate: () => void;
}) {
  const label = `${hour.toString().padStart(2, '0')}:00`;
  return (
    <View className="flex-row gap-3 py-2 border-t border-bone/5">
      <Text className="text-bone/50 text-sm w-12 pt-2">{label}</Text>
      <View className="flex-1 gap-1.5 py-1">
        {!open ? (
          <View className="bg-ink-soft/40 rounded-md px-3 py-2">
            <Text className="text-bone/30 text-sm">Closed</Text>
          </View>
        ) : classes.length > 0 ? (
          classes.map((c) => <ClassCard key={c.id} session={c} />)
        ) : (
          <Pressable
            onPress={onCreate}
            className="border border-dashed border-bone/15 rounded-md px-3 py-2">
            <Text className="text-bone/40 text-sm">+ Add a class</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ClassCard({ session }: { session: ClassSession }) {
  const start = new Date(session.starts_at);
  const end = new Date(start.getTime() + session.duration_minutes * 60 * 1000);
  return (
    <View className="bg-brand/10 border border-brand/40 rounded-md p-3 gap-1">
      <Text className="text-bone font-semibold">{session.name}</Text>
      <Text className="text-bone/60 text-xs">
        {fmtTime(start)}–{fmtTime(end)} · {session.capacity} spots
      </Text>
    </View>
  );
}
