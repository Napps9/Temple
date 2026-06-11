import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { ClassDetailModal } from '@/components/ClassDetailModal';
import { CreateClassModal } from '@/components/CreateClassModal';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { useCan } from '@/lib/useCan';
import { supabase } from '@/lib/supabase';
import { useClassRecurrences } from '@/lib/useClassCatalog';

type CreateRequest = { date?: Date; hour?: number };

const HORIZON_WEEKS = 12;
const HOURS = Array.from({ length: 18 }, (_, i) => i + 5);
const HOUR_HEIGHT = 64;
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEK_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const VIEWS = ['day', 'week', 'month'] as const;
type ViewMode = (typeof VIEWS)[number];

function scrollYForHour(hour: number) {
  const clamped = Math.max(HOURS[0], Math.min(hour, HOURS[HOURS.length - 1]));
  return Math.max(0, (clamped - HOURS[0]) * HOUR_HEIGHT);
}

type ClassSession = {
  id: string;
  name: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
  class_type_id: string | null;
  class_types: {
    name: string;
    color: string;
    archived_at: string | null;
  } | null;
  coach_id: string | null;
  coach: { full_name: string | null; avatar_url: string | null } | null;
};

const DEFAULT_CLASS_COLOR = '#2563EB';

function sessionColor(s: ClassSession) {
  return s.class_types?.color ?? DEFAULT_CLASS_COLOR;
}

function sessionLabel(s: ClassSession) {
  return s.class_types?.name ?? s.name;
}

function fmtDateLocal(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getDate()
    .toString()
    .padStart(2, '0')}`;
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

function fmtMonthYear(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
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

function ViewSwitcher({ view }: { view: ViewMode }) {
  return (
    <View className="flex-row bg-slate-200 dark:bg-gray-800 rounded-full p-1">
      {VIEWS.map((v) => (
        <Pressable
          key={v}
          onPress={() => router.setParams({ view: v })}
          className={`px-4 py-1.5 rounded-full ${
            view === v ? 'bg-white dark:bg-gray-700' : ''
          }`}>
          <Text
            className={`capitalize text-sm font-medium ${
              view === v
                ? 'text-gray-900 dark:text-gray-50'
                : 'text-gray-500 dark:text-gray-400'
            }`}>
            {v}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function parseView(v: string | undefined): ViewMode {
  return VIEWS.includes(v as ViewMode) ? (v as ViewMode) : 'day';
}

export function ClassesCalendar({
  mode,
  topSlot,
}: {
  mode: 'manage' | 'book';
  topSlot?: React.ReactNode;
}) {
  const params = useLocalSearchParams<{ view?: string }>();
  const view = parseView(params.view);
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [createAt, setCreateAt] = useState<CreateRequest | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const { data: membership } = useGymMembership();
  const canEditClasses = useCan('can_edit_classes') ?? false;
  const canCreate = mode === 'manage' && canEditClasses;
  const queryClient = useQueryClient();

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
        .select(
          'id, name, starts_at, duration_minutes, capacity, class_type_id, class_types(name, color, archived_at), coach_id, coach:profiles!coach_id(full_name, avatar_url)',
        )
        .gte('starts_at', start.toISOString())
        .lt('starts_at', end.toISOString())
        .order('starts_at');
      if (error) throw error;
      const rows = data as unknown as ClassSession[];
      // Hide sessions whose class_type has been archived — staff
      // shouldn't see lingering CrossFit slots if CrossFit is put
      // away, and members shouldn't be able to book new ones. The
      // server's book_class refuses these too (see
      // 0035_archive_class_type_cascades.sql) but filtering here
      // keeps them out of the calendar so the UI doesn't show
      // un-bookable phantoms.
      return rows.filter((s) => !s.class_types?.archived_at);
    },
  });

  // Shared canonical query — this key is also observed by the Class
  // types editor; redefining it inline with a different column set made
  // the two queryFns overwrite each other's cache entry (visible as the
  // editor flashing). See useClassCatalog.
  const recurrencesQuery = useClassRecurrences();

  // Set of class_session_ids the current user has booked into the future.
  // Drives the "Booked" badge on the per-session cards in book mode so
  // members can see at a glance which classes they've already booked.
  // Disabled in manage mode — staff aren't looking at "their" bookings.
  const session = useSession();
  const myBookingsQuery = useQuery({
    queryKey: ['my-future-bookings', session?.user.id],
    enabled: !!session?.user.id && mode === 'book',
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('class_bookings')
        .select('class_session_id, class_sessions!inner(starts_at)')
        .eq('profile_id', session!.user.id)
        .gt('class_sessions.starts_at', nowIso);
      if (error) throw error;
      return new Set<string>(
        (data ?? []).map((r) => (r as { class_session_id: string }).class_session_id),
      );
    },
  });
  const bookedSet = myBookingsQuery.data ?? new Set<string>();

  const extend = useMutation({
    mutationFn: async (untilDate: string) => {
      const recs = recurrencesQuery.data ?? [];
      for (const r of recs) {
        const cursor = r.materialized_until ?? r.starts_on;
        if (cursor >= untilDate) continue;
        if (r.ends_on && r.ends_on <= cursor) continue;
        const { error } = await supabase.rpc('extend_recurrence', {
          rec_id: r.id,
          until_date: untilDate,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class-recurrences'] });
      queryClient.invalidateQueries({ queryKey: ['class-sessions-month'] });
    },
  });

  useEffect(() => {
    if (!recurrencesQuery.data || recurrencesQuery.data.length === 0) return;
    if (extend.isPending) return;
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + HORIZON_WEEKS * 7);
    const visibleEnd = addDays(startOfMonth(addMonths(date, 1)), 7);
    const target = visibleEnd > horizon ? visibleEnd : horizon;
    const targetStr = fmtDateLocal(target);
    const needs = recurrencesQuery.data.some((r) => {
      const cursor = r.materialized_until ?? r.starts_on;
      if (cursor >= targetStr) return false;
      if (r.ends_on && r.ends_on <= cursor) return false;
      return true;
    });
    if (needs) extend.mutate(targetStr);
  }, [recurrencesQuery.data, date, extend]);

  function openSession(id: string) {
    setOpenSessionId(id);
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      {topSlot ? (
        <View className="w-full max-w-5xl mx-auto px-2 pt-4">{topSlot}</View>
      ) : null}
      <View className="w-full max-w-5xl mx-auto px-2">
        <View className="relative flex-row items-center justify-center gap-4 pt-6 pb-6">
          {/* View switcher sits left of the month header on md+,
              mirroring the Add-class CTA on the right. On small screens
              the absolute slot collides with the month title, so it
              renders as its own row below instead. */}
          <View className="absolute left-0 top-6 hidden md:flex">
            <ViewSwitcher view={view} />
          </View>
          <Pressable
            onPress={() => setDate(startOfDay(addMonths(date, -1)))}
            hitSlop={8}
            className="w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center">
            <Text className="text-gray-500 dark:text-gray-400 text-lg">‹</Text>
          </Pressable>
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            {fmtMonthYear(date)}
          </Text>
          <Pressable
            onPress={() => setDate(startOfDay(addMonths(date, 1)))}
            hitSlop={8}
            className="w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center">
            <Text className="text-gray-500 dark:text-gray-400 text-lg">›</Text>
          </Pressable>
          {canCreate ? (
            <View className="absolute right-0 top-6">
              <Pressable
                onPress={() => setCreateAt({ date })}
                className="bg-primary rounded-full p-2 md:pl-3 md:pr-4 md:py-2 flex-row items-center gap-1.5 active:bg-primary-dark">
                <Ionicons name="add" size={16} color="#FFFFFF" />
                <Text className="hidden md:flex text-white text-sm font-semibold">
                  Add class
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        <View className="md:hidden items-center pb-4 -mt-1">
          <ViewSwitcher view={view} />
        </View>
      </View>

      {view === 'day' ? (
        <DayView
          mode={mode}
          date={date}
          setDate={setDate}
          sessions={sessionsQuery.data}
          onCreateAt={(d, hour) => setCreateAt({ date: d, hour })}
          onSessionPress={openSession}
          canCreate={canCreate}
          bookedSet={bookedSet}
        />
      ) : null}
      {view === 'week' ? (
        <WeekView
          date={date}
          setDate={setDate}
          gotoDay={() => router.setParams({ view: 'day' })}
          sessions={sessionsQuery.data}
          onCreateAt={(d, hour) => setCreateAt({ date: d, hour })}
          onSessionPress={openSession}
          canCreate={canCreate}
          bookedSet={bookedSet}
        />
      ) : null}
      {view === 'month' ? (
        <MonthView
          date={date}
          setDate={setDate}
          gotoDay={() => router.setParams({ view: 'day' })}
          sessions={sessionsQuery.data}
        />
      ) : null}

      <CreateClassModal
        visible={createAt !== null}
        defaultDate={createAt?.date}
        defaultHour={createAt?.hour}
        onClose={() => setCreateAt(null)}
        onCreated={() => {
          setCreateAt(null);
          queryClient.invalidateQueries({ queryKey: ['class-sessions-month'] });
          queryClient.invalidateQueries({ queryKey: ['class-recurrences'] });
        }}
      />

      <ClassDetailModal
        visible={openSessionId !== null}
        sessionId={openSessionId}
        mode={mode}
        onClose={() => setOpenSessionId(null)}
      />
    </Screen>
  );
}

function DayView({
  mode,
  date,
  setDate,
  sessions,
  onCreateAt,
  onSessionPress,
  canCreate,
  bookedSet,
}: {
  mode: 'manage' | 'book';
  date: Date;
  setDate: (d: Date) => void;
  sessions: ClassSession[] | undefined;
  onCreateAt: (d: Date, hour: number) => void;
  onSessionPress: (id: string) => void;
  canCreate: boolean;
  bookedSet: Set<string>;
}) {
  const weekStart = startOfWeek(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayClasses = classesOnDay(sessions, date).sort(
    (a, b) =>
      new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );

  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    if (mode !== 'manage') return;
    const now = new Date();
    const hourTarget = isSameDay(now, date) ? now.getHours() : HOURS[0];
    const y = scrollYForHour(hourTarget);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
    });
  }, [date, mode]);

  return (
    <View className="flex-1">
      <View className="w-full max-w-5xl mx-auto px-2">
        <View className="flex-row gap-2 md:gap-3 md:justify-center pt-2 pb-4 md:pb-6">
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
                    today ? 'text-primary' : 'text-gray-400 dark:text-gray-500'
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
                          : 'text-gray-900 dark:text-gray-50'
                    }`}>
                    {d.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="pb-10">
        <View className="w-full max-w-5xl mx-auto px-2">
          {mode === 'book' ? (
            <View className="gap-2">
              {dayClasses.length > 0 ? (
                dayClasses.map((c) => (
                  <DayClassCard
                    key={c.id}
                    session={c}
                    onPress={() => onSessionPress(c.id)}
                    bookedByMe={bookedSet.has(c.id)}
                  />
                ))
              ) : (
                <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    No classes scheduled today.
                  </Text>
                </View>
              )}
            </View>
          ) : (
            HOURS.map((hour) => {
              const cellClasses = classesAtDayHour(sessions, date, hour);
              return (
                <DayHourRow
                  key={hour}
                  hour={hour}
                  classes={cellClasses}
                  onCreate={canCreate ? () => onCreateAt(date, hour) : null}
                  onSessionPress={onSessionPress}
                />
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function DayHourRow({
  hour,
  classes,
  onCreate,
  onSessionPress,
}: {
  hour: number;
  classes: ClassSession[];
  onCreate: (() => void) | null;
  onSessionPress: (id: string) => void;
}) {
  const label = `${hour.toString().padStart(2, '0')}:00`;
  return (
    <View className="flex-row gap-4 py-2 border-t border-gray-100 dark:border-gray-800">
      <Text className="text-gray-400 dark:text-gray-500 text-sm w-14 pt-3">
        {label}
      </Text>
      <View className="flex-1 py-1.5 gap-2">
        {classes.length > 0 ? (
          classes.map((c) => (
            <DayClassCard
              key={c.id}
              session={c}
              onPress={() => onSessionPress(c.id)}
            />
          ))
        ) : onCreate ? (
          <Pressable
            onPress={onCreate}
            className="border border-dashed border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800">
            <Text className="text-gray-400 dark:text-gray-500 text-sm">+ Add a class</Text>
          </Pressable>
        ) : (
          <View className="border border-dashed border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
            <Text className="text-gray-400 dark:text-gray-500 text-sm">No class scheduled</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function DayClassCard({
  session,
  onPress,
  bookedByMe,
}: {
  session: ClassSession;
  onPress: () => void;
  bookedByMe?: boolean;
}) {
  const start = new Date(session.starts_at);
  const end = new Date(start.getTime() + session.duration_minutes * 60 * 1000);
  return (
    <Pressable
      onPress={onPress}
      className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 flex-row items-start gap-3 active:bg-gray-50 dark:active:bg-gray-800">
      <View className="flex-1 gap-1.5">
        <View className="flex-row items-center gap-2">
          <View
            style={{ backgroundColor: sessionColor(session) }}
            className="self-start rounded-full px-2.5 py-1">
            <Text className="text-white text-xs font-semibold">{sessionLabel(session)}</Text>
          </View>
          {bookedByMe ? (
            <View className="flex-row items-center gap-1 rounded-full px-2 py-0.5 border border-emerald-300 dark:border-emerald-700">
              <Ionicons name="checkmark-circle" size={12} color="#10B981" />
              <Text className="text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold uppercase tracking-widest">
                Booked
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="text-gray-900 dark:text-gray-50 text-base font-medium">
          {fmtTime(start)} — {fmtTime(end)}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {session.capacity} spots
        </Text>
      </View>
      <Avatar
        name={session.coach?.full_name}
        avatarUrl={session.coach?.avatar_url}
        size={36}
      />
    </Pressable>
  );
}

function WeekView({
  date,
  setDate,
  gotoDay,
  sessions,
  onCreateAt,
  onSessionPress,
  canCreate,
  bookedSet,
}: {
  date: Date;
  setDate: (d: Date) => void;
  gotoDay: () => void;
  sessions: ClassSession[] | undefined;
  onCreateAt: (d: Date, hour: number) => void;
  onSessionPress: (id: string) => void;
  canCreate: boolean;
  bookedSet: Set<string>;
}) {
  const weekStart = startOfWeek(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    const now = new Date();
    const inWeek = weekDays.some((d) => isSameDay(d, now));
    const hourTarget = inWeek ? now.getHours() : HOURS[0];
    const y = scrollYForHour(hourTarget);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart.toISOString()]);

  return (
    <View className="flex-1">
      <View className="w-full max-w-5xl mx-auto px-2">
        <View className="flex-row items-center justify-center gap-4 pb-4">
          <Pressable
            onPress={() => setDate(addDays(date, -7))}
            hitSlop={8}
            className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center">
            <Text className="text-gray-500 dark:text-gray-400">‹</Text>
          </Pressable>
          <Text className="text-gray-700 dark:text-gray-200 font-medium">
            {fmtWeekRange(weekDays[0], weekDays[6])}
          </Text>
          <Pressable
            onPress={() => setDate(addDays(date, 7))}
            hitSlop={8}
            className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center">
            <Text className="text-gray-500 dark:text-gray-400">›</Text>
          </Pressable>
        </View>

        <View className="flex-row pb-2 border-b border-gray-200 dark:border-gray-700">
          <View className="w-10 md:w-14" />
          {weekDays.map((d) => {
            const today = isSameDay(d, new Date());
            return (
              <Pressable
                key={d.toISOString()}
                onPress={() => {
                  setDate(d);
                  gotoDay();
                }}
                hitSlop={4}
                className="flex-1 items-center pb-2">
                <Text
                  className={`text-xs uppercase tracking-wide ${
                    today
                      ? 'text-primary font-semibold'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}>
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                </Text>
                <Text
                  className={`text-lg font-bold mt-0.5 ${
                    today ? 'text-primary' : 'text-gray-900 dark:text-gray-50'
                  }`}>
                  {d.getDate()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="pb-10">
        <View className="w-full max-w-5xl mx-auto px-2">
          {HOURS.map((hour) => {
            const label = `${hour.toString().padStart(2, '0')}:00`;
            return (
              <View
                key={hour}
                className="flex-row border-t border-gray-100 dark:border-gray-800 min-h-14 py-0.5">
                <Text className="w-10 md:w-14 text-xs text-gray-400 dark:text-gray-500 pt-2">
                  {label}
                </Text>
                {weekDays.map((d) => {
                  const cellClasses = classesAtDayHour(sessions, d, hour);
                  return (
                    <View key={d.toISOString()} className="flex-1 px-0.5">
                      {cellClasses.length > 0 ? (
                        <WeekTile
                          session={cellClasses[0]}
                          onPress={() => onSessionPress(cellClasses[0].id)}
                          bookedByMe={bookedSet.has(cellClasses[0].id)}
                        />
                      ) : canCreate ? (
                        <Pressable
                          onPress={() => onCreateAt(d, hour)}
                          className="flex-1 border border-dashed border-gray-200 dark:border-gray-700 rounded-md min-h-14 active:bg-gray-50 dark:active:bg-gray-800"
                        />
                      ) : (
                        <View className="flex-1 rounded-md min-h-14" />
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function WeekTile({
  session,
  onPress,
  bookedByMe,
}: {
  session: ClassSession;
  onPress: () => void;
  bookedByMe?: boolean;
}) {
  const start = new Date(session.starts_at);
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 bg-white dark:bg-gray-900 rounded-md p-1.5 min-h-14 gap-1 border active:bg-gray-50 dark:active:bg-gray-800 ${
        bookedByMe
          ? 'border-emerald-400 dark:border-emerald-600'
          : 'border-gray-200 dark:border-gray-700'
      }`}>
      <View className="flex-row items-center gap-1">
        {bookedByMe ? (
          <Ionicons name="checkmark-circle" size={10} color="#10B981" />
        ) : (
          <View
            style={{ backgroundColor: sessionColor(session) }}
            className="w-1.5 h-1.5 rounded-full"
          />
        )}
        <Text
          className="text-gray-900 dark:text-gray-50 text-[10px] font-semibold flex-1"
          numberOfLines={1}>
          {sessionLabel(session)}
        </Text>
      </View>
      <Text className="text-gray-500 dark:text-gray-400 text-[10px]" numberOfLines={1}>
        {fmtTime(start)}
      </Text>
    </Pressable>
  );
}

function MonthView({
  date,
  setDate,
  gotoDay,
  sessions,
}: {
  date: Date;
  setDate: (d: Date) => void;
  gotoDay: () => void;
  sessions: ClassSession[] | undefined;
}) {
  const grid = monthGrid(date);

  return (
    <View className="flex-1">
      <View className="w-full max-w-5xl mx-auto px-2">
        <View className="flex-row pb-2">
          {WEEK_LETTERS.map((l, i) => (
            <View key={i} className="flex-1 items-center">
              <Text className="text-gray-400 dark:text-gray-500 text-xs font-medium uppercase">
                {l}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="pb-10">
        <View className="w-full max-w-5xl mx-auto px-2">
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
                      gotoDay();
                    }}
                    className={`flex-1 aspect-square m-0.5 rounded-xl p-2 border ${
                      selected
                        ? 'bg-primary border-primary'
                        : today
                          ? 'border-primary bg-white dark:bg-gray-900'
                          : 'border-transparent bg-white dark:bg-gray-900'
                    }`}>
                    <Text
                      className={
                        selected
                          ? 'text-white font-semibold'
                          : !inMonth
                            ? 'text-gray-300 dark:text-gray-600'
                            : today
                              ? 'text-primary font-semibold'
                              : 'text-gray-900 dark:text-gray-50 font-medium'
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
      </ScrollView>
    </View>
  );
}
