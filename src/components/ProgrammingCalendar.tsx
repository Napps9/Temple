import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ProgrammingModal } from '@/components/ProgrammingModal';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type ClassSession = {
  id: string;
  starts_at: string;
  class_type_id: string | null;
  class_types: { name: string; color: string } | null;
};

type ProgrammingRow = {
  id: string;
  class_type_id: string;
  date: string;
};

type DayClassType = {
  id: string;
  name: string;
  color: string;
};

function fmtDateLocal(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

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

function addMonths(d: Date, months: number) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDays(x, diffToMonday);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function fmtMonthYear(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function ProgrammingCalendar({ mode }: { mode: 'manage' | 'view' }) {
  const { data: membership } = useGymMembership();
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [openFor, setOpenFor] = useState<{
    classType: DayClassType;
    date: Date;
  } | null>(null);

  const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}`;

  const sessionsQuery = useQuery({
    queryKey: ['class-sessions-month', membership?.gymId, monthKey],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const start = addDays(startOfMonth(date), -7);
      const end = addDays(startOfMonth(addMonths(date, 1)), 7);
      const { data, error } = await supabase
        .from('class_sessions')
        .select('id, starts_at, class_type_id, class_types(name, color)')
        .gte('starts_at', start.toISOString())
        .lt('starts_at', end.toISOString())
        .order('starts_at');
      if (error) throw error;
      return data as unknown as ClassSession[];
    },
  });

  const programmingMonthQuery = useQuery({
    queryKey: ['class-programming-month', membership?.gymId, monthKey],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const start = fmtDateLocal(addDays(startOfMonth(date), -7));
      const end = fmtDateLocal(addDays(startOfMonth(addMonths(date, 1)), 7));
      const { data, error } = await supabase
        .from('class_programming')
        .select('id, class_type_id, date')
        .gte('date', start)
        .lt('date', end);
      if (error) throw error;
      return data as ProgrammingRow[];
    },
  });

  const weekStart = startOfWeek(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const dayTypes: DayClassType[] = (() => {
    const sessions = sessionsQuery.data ?? [];
    const map = new Map<string, DayClassType>();
    for (const s of sessions) {
      if (!s.class_type_id || !s.class_types) continue;
      if (!isSameDay(new Date(s.starts_at), date)) continue;
      if (!map.has(s.class_type_id)) {
        map.set(s.class_type_id, {
          id: s.class_type_id,
          name: s.class_types.name,
          color: s.class_types.color,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  })();

  const dateStr = fmtDateLocal(date);
  const programmedTypeIds = new Set(
    (programmingMonthQuery.data ?? [])
      .filter((p) => p.date === dateStr)
      .map((p) => p.class_type_id),
  );

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <View className="w-full max-w-5xl mx-auto px-2">
        <View className="flex-row items-center justify-center gap-4 pt-2 pb-4">
          <Pressable
            onPress={() => setDate(startOfDay(addMonths(date, -1)))}
            hitSlop={8}
            className="w-9 h-9 rounded-full border border-gray-200 items-center justify-center">
            <Text className="text-gray-500 text-lg">‹</Text>
          </Pressable>
          <Text className="text-gray-900 text-xl font-semibold">
            {fmtMonthYear(date)}
          </Text>
          <Pressable
            onPress={() => setDate(startOfDay(addMonths(date, 1)))}
            hitSlop={8}
            className="w-9 h-9 rounded-full border border-gray-200 items-center justify-center">
            <Text className="text-gray-500 text-lg">›</Text>
          </Pressable>
        </View>

        <View className="flex-row gap-2 md:gap-3 md:justify-center pb-4">
          {weekDays.map((d) => {
            const selected = isSameDay(d, date);
            const today = isSameDay(d, new Date());
            return (
              <Pressable
                key={d.toISOString()}
                onPress={() => setDate(d)}
                hitSlop={6}
                className="flex-1 md:flex-none md:w-12 items-center gap-1.5">
                <Text
                  className={`text-xs font-semibold uppercase ${
                    today ? 'text-primary' : 'text-gray-400'
                  }`}>
                  {DAY_LETTERS[d.getDay()]}
                </Text>
                <View
                  className={`w-9 h-9 rounded-full items-center justify-center ${
                    selected ? 'bg-primary' : ''
                  }`}>
                  <Text
                    className={`font-bold text-base ${
                      selected
                        ? 'text-white'
                        : today
                          ? 'text-primary'
                          : 'text-gray-900'
                    }`}>
                    {d.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="pb-10">
        <View className="w-full max-w-5xl mx-auto px-2 gap-2">
          {dayTypes.length === 0 ? (
            <View className="bg-white border border-gray-200 rounded-xl p-4">
              <Text className="text-gray-500 text-sm">
                No classes scheduled for this day.
              </Text>
            </View>
          ) : (
            dayTypes.map((t) => {
              const programmed = programmedTypeIds.has(t.id);
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setOpenFor({ classType: t, date })}
                  className="bg-white rounded-xl p-4 flex-row items-center gap-3 active:bg-gray-50">
                  <View
                    style={{ backgroundColor: t.color }}
                    className="w-3 h-3 rounded-full"
                  />
                  <Text className="flex-1 text-gray-900 font-semibold">
                    {t.name}
                  </Text>
                  <Text
                    className={
                      programmed
                        ? 'text-primary text-xs uppercase tracking-widest'
                        : 'text-gray-400 text-xs uppercase tracking-widest'
                    }>
                    {programmed ? 'Programmed' : 'Not yet'}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      <ProgrammingModal
        visible={openFor !== null}
        classType={openFor?.classType ?? null}
        date={openFor?.date ?? null}
        mode={mode}
        onClose={() => setOpenFor(null)}
      />
    </Screen>
  );
}
