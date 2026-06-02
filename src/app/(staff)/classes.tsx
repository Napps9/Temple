import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { CreateClassModal } from '@/components/CreateClassModal';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const HOURS = Array.from({ length: 18 }, (_, i) => i + 5);
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEK_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const VIEWS = ['day', 'week', 'month'] as const;
type ViewMode = (typeof VIEWS)[number];

type ClassSession = {
  id: string;
  name: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
};

type GymHour = { day_of_week: number; opens_at: string; closes_at: string };

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

function monthGrid(d: Date) {
  const firstOfMonth = startOfMonth(d);
  const gridStart = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function fmtTime(d: Date) {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fmtMonthYear(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function fmtFullDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function fmtWeekRange(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getDate()} — ${end.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
    })}`;
  }
  return `${start.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })} — ${end.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`;
}

function classesAtDayHour(
  sessions: ClassSession[] | undefined,
  day: Date,
  hour: number,
) {
  return (sessions ?? []).filter((s) => {
    const start = new Date(s.starts_at);
    return isSameDay(start, day) && start.getHours() === hour;
  });
}

function classesOnDay(sessions: ClassSession[] | undefined, day: Date) {
  return (sessions ?? []).filter((s) => isSameDay(new Date(s.starts_at), day));
}

function isHourOpen(hour: number, dayHours: GymHour | undefined) {
  if (!dayHours) return false;
  const open = timeToMinutes(dayHours.opens_at.slice(0, 5));
  const close = timeToMinutes(dayHours.closes_at.slice(0, 5));
  const hourMin = hour * 60;
  return hourMin >= open && hourMin < close;
}

export default function StaffClasses() {
  const [view, setView] = useState<ViewMode>('day');
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [createAt, setCreateAt] = useState<{ date: Date; hour: number } | null>(null);
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();

  const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}`;

  const hoursQuery = useQuery({
    queryKey: ['gym-hours', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_hours')
        .select('day_of_week, opens_at, closes_at');
      if (error) throw error;
      return data as GymHour[];
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ['class-sessions-month', membership?.gymId, monthKey],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const start = addDays(startOfMonth(date), -7);
      const end = addDays(startOfMonth(addMonths(date, 1)), 7);
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

  const dayHoursFor = (d: Date) =>
    hoursQuery.data?.find((h) => h.day_of_week === d.getDay());

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="pb-10">
        <View className="w-full max-w-5xl mx-auto px-2">
          <View className="items-center pt-6 pb-4">
            <View className="flex-row bg-gray-100 rounded-full p-1">
              {VIEWS.map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setView(v)}
                  className={`px-6 py-1.5 rounded-full ${
                    view === v ? 'bg-white' : ''
                  }`}>
                  <Text
                    className={`capitalize text-sm font-medium ${
                      view === v ? 'text-gray-900' : 'text-gray-500'
                    }`}>
                    {v}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View className="flex-row items-center justify-center gap-4 pb-6">
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

          {view === 'day' ? (
            <DayView
              date={date}
              setDate={setDate}
              sessions={sessionsQuery.data}
              dayHoursFor={dayHoursFor}
              onCreateAt={(d, hour) => setCreateAt({ date: d, hour })}
            />
          ) : null}
          {view === 'week' ? (
            <WeekView
              date={date}
              setDate={setDate}
              setView={setView}
              sessions={sessionsQuery.data}
              dayHoursFor={dayHoursFor}
              onCreateAt={(d, hour) => setCreateAt({ date: d, hour })}
            />
          ) : null}
          {view === 'month' ? (
            <MonthView
              date={date}
              setDate={setDate}
              setView={setView}
              sessions={sessionsQuery.data}
            />
          ) : null}
        </View>
      </ScrollView>

      <CreateClassModal
        visible={createAt !== null}
        date={createAt?.date ?? new Date()}
        hour={createAt?.hour ?? 0}
        onClose={() => setCreateAt(null)}
        onCreated={() => {
          setCreateAt(null);
          queryClient.invalidateQueries({ queryKey: ['class-sessions-month'] });
        }}
      />
    </Screen>
  );
}

function DayView({
  date,
  setDate,
  sessions,
  dayHoursFor,
  onCreateAt,
}: {
  date: Date;
  setDate: (d: Date) => void;
  sessions: ClassSession[] | undefined;
  dayHoursFor: (d: Date) => GymHour | undefined;
  onCreateAt: (d: Date, hour: number) => void;
}) {
  const weekStart = startOfWeek(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayHours = dayHoursFor(date);

  return (
    <View>
      <View className="flex-row gap-2 justify-center pb-8">
        {weekDays.map((d) => {
          const selected = isSameDay(d, date);
          const today = isSameDay(d, new Date());
          return (
            <Pressable
              key={d.toISOString()}
              onPress={() => setDate(d)}
              hitSlop={4}
              className={`w-14 h-16 rounded-2xl items-center justify-center gap-0.5 ${
                selected
                  ? 'bg-primary'
                  : today
                    ? 'bg-white border border-primary'
                    : 'bg-white border border-gray-200'
              }`}>
              <Text
                className={`text-xs font-medium ${
                  selected ? 'text-white/80' : today ? 'text-primary' : 'text-gray-500'
                }`}>
                {DAY_LETTERS[d.getDay()]}
              </Text>
              <Text
                className={`font-bold text-lg ${
                  selected ? 'text-white' : today ? 'text-primary' : 'text-gray-900'
                }`}>
                {d.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mb-4">
        <Text className="text-gray-900 text-2xl font-semibold">{fmtFullDate(date)}</Text>
        {todayHours ? (
          <Text className="text-gray-500 mt-1">
            Open {todayHours.opens_at.slice(0, 5)} — {todayHours.closes_at.slice(0, 5)}
          </Text>
        ) : (
          <Text className="text-gray-500 mt-1">Gym closed today</Text>
        )}
      </View>

      {HOURS.map((hour) => {
        const open = isHourOpen(hour, todayHours);
        const cellClasses = classesAtDayHour(sessions, date, hour);
        return (
          <DayHourRow
            key={hour}
            hour={hour}
            open={open}
            classes={cellClasses}
            onCreate={() => onCreateAt(date, hour)}
          />
        );
      })}
    </View>
  );
}

function DayHourRow({
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
    <View className="flex-row gap-4 py-2 border-t border-gray-100">
      <Text className="text-gray-400 text-sm w-14 pt-3">{label}</Text>
      <View className="flex-1 py-1.5 gap-2">
        {!open ? (
          <View className="bg-gray-100 rounded-xl px-4 py-3">
            <Text className="text-gray-400 text-sm">Closed</Text>
          </View>
        ) : classes.length > 0 ? (
          classes.map((c) => <DayClassCard key={c.id} session={c} />)
        ) : (
          <Pressable
            onPress={onCreate}
            className="border border-dashed border-gray-300 rounded-xl px-4 py-3 active:bg-gray-50">
            <Text className="text-gray-400 text-sm">+ Add a class</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DayClassCard({ session }: { session: ClassSession }) {
  const start = new Date(session.starts_at);
  const end = new Date(start.getTime() + session.duration_minutes * 60 * 1000);
  return (
    <View className="bg-primary rounded-2xl p-4 gap-1">
      <Text className="text-white text-lg font-semibold">{session.name}</Text>
      <Text className="text-white/80 text-sm">
        {fmtTime(start)} — {fmtTime(end)}
      </Text>
      <Text className="text-white/70 text-xs mt-1">{session.capacity} spots</Text>
    </View>
  );
}

function WeekView({
  date,
  setDate,
  setView,
  sessions,
  dayHoursFor,
  onCreateAt,
}: {
  date: Date;
  setDate: (d: Date) => void;
  setView: (v: ViewMode) => void;
  sessions: ClassSession[] | undefined;
  dayHoursFor: (d: Date) => GymHour | undefined;
  onCreateAt: (d: Date, hour: number) => void;
}) {
  const weekStart = startOfWeek(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <View>
      <View className="flex-row items-center justify-center gap-4 pb-4">
        <Pressable
          onPress={() => setDate(addDays(date, -7))}
          hitSlop={8}
          className="w-8 h-8 rounded-full border border-gray-200 items-center justify-center">
          <Text className="text-gray-500">‹</Text>
        </Pressable>
        <Text className="text-gray-700 font-medium">
          {fmtWeekRange(weekDays[0], weekDays[6])}
        </Text>
        <Pressable
          onPress={() => setDate(addDays(date, 7))}
          hitSlop={8}
          className="w-8 h-8 rounded-full border border-gray-200 items-center justify-center">
          <Text className="text-gray-500">›</Text>
        </Pressable>
      </View>

      <View className="flex-row pb-2 border-b border-gray-200">
        <View className="w-14" />
        {weekDays.map((d) => {
          const today = isSameDay(d, new Date());
          return (
            <Pressable
              key={d.toISOString()}
              onPress={() => {
                setDate(d);
                setView('day');
              }}
              hitSlop={4}
              className="flex-1 items-center pb-2">
              <Text
                className={`text-xs uppercase tracking-wide ${
                  today ? 'text-primary font-semibold' : 'text-gray-500'
                }`}>
                {d.toLocaleDateString(undefined, { weekday: 'short' })}
              </Text>
              <Text
                className={`text-lg font-bold mt-0.5 ${
                  today ? 'text-primary' : 'text-gray-900'
                }`}>
                {d.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {HOURS.map((hour) => {
        const label = `${hour.toString().padStart(2, '0')}:00`;
        return (
          <View key={hour} className="flex-row border-t border-gray-100 min-h-14">
            <Text className="w-14 text-xs text-gray-400 pt-2">{label}</Text>
            {weekDays.map((d) => {
              const dayHours = dayHoursFor(d);
              const open = isHourOpen(hour, dayHours);
              const cellClasses = classesAtDayHour(sessions, d, hour);
              return (
                <View key={d.toISOString()} className="flex-1 p-0.5">
                  {!open ? (
                    <View className="flex-1 bg-gray-100/60 rounded min-h-12" />
                  ) : cellClasses.length > 0 ? (
                    <View className="flex-1 bg-primary rounded p-1.5 min-h-12 justify-center">
                      <Text
                        className="text-white text-xs font-semibold"
                        numberOfLines={1}>
                        {cellClasses[0].name}
                      </Text>
                      <Text
                        className="text-white/80 text-[10px]"
                        numberOfLines={1}>
                        {cellClasses[0].duration_minutes}m
                      </Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => onCreateAt(d, hour)}
                      className="flex-1 border border-dashed border-gray-200 rounded min-h-12 active:bg-gray-50"
                    />
                  )}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function MonthView({
  date,
  setDate,
  setView,
  sessions,
}: {
  date: Date;
  setDate: (d: Date) => void;
  setView: (v: ViewMode) => void;
  sessions: ClassSession[] | undefined;
}) {
  const grid = monthGrid(date);

  return (
    <View>
      <View className="flex-row pb-2">
        {WEEK_LETTERS.map((l, i) => (
          <View key={i} className="flex-1 items-center">
            <Text className="text-gray-400 text-xs font-medium uppercase">{l}</Text>
          </View>
        ))}
      </View>

      {Array.from({ length: 6 }, (_, w) => (
        <View key={w} className="flex-row">
          {grid.slice(w * 7, (w + 1) * 7).map((d) => {
            const inMonth = d.getMonth() === date.getMonth();
            const today = isSameDay(d, new Date());
            const selected = isSameDay(d, date);
            const dayClasses = classesOnDay(sessions, d);
            return (
              <Pressable
                key={d.toISOString()}
                onPress={() => {
                  setDate(d);
                  setView('day');
                }}
                className={`flex-1 aspect-square m-0.5 rounded-xl p-2 border ${
                  selected
                    ? 'bg-primary border-primary'
                    : today
                      ? 'border-primary bg-white'
                      : 'border-transparent bg-white'
                }`}>
                <Text
                  className={
                    selected
                      ? 'text-white font-semibold'
                      : !inMonth
                        ? 'text-gray-300'
                        : today
                          ? 'text-primary font-semibold'
                          : 'text-gray-900 font-medium'
                  }>
                  {d.getDate()}
                </Text>
                {dayClasses.length > 0 ? (
                  <View className="flex-row gap-0.5 mt-1 items-center">
                    {Array.from(
                      { length: Math.min(3, dayClasses.length) },
                      (_, i) => (
                        <View
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full ${
                            selected ? 'bg-white' : 'bg-primary'
                          }`}
                        />
                      ),
                    )}
                    {dayClasses.length > 3 ? (
                      <Text
                        className={`text-[10px] ml-0.5 ${
                          selected ? 'text-white' : 'text-primary'
                        }`}>
                        +{dayClasses.length - 3}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
