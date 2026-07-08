import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { Avatar } from '@/components/Avatar';
import { ClassDetailModal } from '@/components/ClassDetailModal';
import { CreateClassModal } from '@/components/CreateClassModal';
import { MonthPickerModal } from '@/components/MonthPickerModal';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { useCan } from '@/lib/useCan';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';
import {
  useClassRecurrences,
  useClassTypes,
  type ClassTypeRow,
} from '@/lib/useClassCatalog';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { useThemeColors } from '@/lib/theme';

type CreateRequest = { date?: Date; hour?: number };

// Fallback when the gym defaults query hasn't resolved yet. Matches
// the SQL default in 0049; the live value comes from gymDefaults.
const HORIZON_WEEKS_FALLBACK = 12;
const HOURS = Array.from({ length: 18 }, (_, i) => i + 5);
const HOUR_HEIGHT = 80;
// DAY_LETTERS is indexed by JS day-of-week (0=Sun..6=Sat) and used
// in the day-strip header where the column header tracks the day's
// real weekday. It does NOT depend on the gym's week_starts_on.
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// WEEK_LETTERS_MON / WEEK_LETTERS_SUN are the first-column-first
// orderings the month grid renders. The calendar picks based on the
// gym's week_starts_on setting.
const WEEK_LETTERS_MON = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEK_LETTERS_SUN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
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

function sessionColor(s: ClassSession, fallback: string) {
  return s.class_types?.color ?? fallback;
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

function startOfWeek(d: Date, weekStartsOn: 'mon' | 'sun') {
  const x = startOfDay(d);
  const day = x.getDay();
  if (weekStartsOn === 'sun') {
    return addDays(x, -day);
  }
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDays(x, diffToMonday);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthGrid(d: Date, weekStartsOn: 'mon' | 'sun') {
  const firstOfMonth = startOfMonth(d);
  const gridStart = startOfWeek(firstOfMonth, weekStartsOn);
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

function fmtDayShort(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
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

function classesOnDay(sessions: ClassSession[] | undefined, day: Date) {
  return (sessions ?? []).filter((s) => isSameDay(new Date(s.starts_at), day));
}

// Live "now" marker — a thin brand-coloured line at the supplied
// pixel offset from the top of the grid. Lives in the absolute
// overlay layer alongside the duration-sized tiles so the
// horizontal extent matches the day's content area exactly.
function NowLine({ topPx }: { topPx: number }) {
  const colors = useThemeColors();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: topPx,
        left: 0,
        right: 0,
        zIndex: 10,
      }}>
      <View
        style={{
          position: 'absolute',
          top: -4,
          left: -3,
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.primary,
          shadowColor: colors.primary,
          shadowOpacity: 0.7,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
        }}
      />
      <View style={{ height: 2, backgroundColor: colors.primary }} />
    </View>
  );
}

// Position class sessions absolutely within a day column: convert
// start time → top offset, duration → height. Sessions that overlap
// in time tile side-by-side in equal-width sub-columns via greedy
// column packing.
type PositionedSession = {
  session: ClassSession;
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
};

function layoutDay(
  sessions: ClassSession[] | undefined,
  day: Date,
  baseHour: number,
  hourHeight: number,
  totalHours: number,
): PositionedSession[] {
  const items = (sessions ?? [])
    .filter((s) => isSameDay(new Date(s.starts_at), day))
    .map((s) => {
      const start = new Date(s.starts_at);
      const startMin = (start.getHours() - baseHour) * 60 + start.getMinutes();
      const endMin = startMin + s.duration_minutes;
      return { session: s, startMin, endMin };
    })
    .filter((it) => it.endMin > 0 && it.startMin < totalHours * 60)
    .map((it) => ({
      session: it.session,
      startMin: Math.max(0, it.startMin),
      endMin: Math.min(totalHours * 60, it.endMin),
    }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const columnEnds: number[] = [];
  const itemColumns = items.map((it) => {
    let col = columnEnds.findIndex((end) => end <= it.startMin);
    if (col === -1) col = columnEnds.length;
    columnEnds[col] = it.endMin;
    return col;
  });

  const positioned: PositionedSession[] = [];
  let clusterStart = 0;
  let clusterEnd = items.length > 0 ? items[0].endMin : -1;
  for (let i = 1; i <= items.length; i += 1) {
    if (i < items.length && items[i].startMin < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, items[i].endMin);
      continue;
    }
    const cols = Math.max(...itemColumns.slice(clusterStart, i)) + 1;
    for (let j = clusterStart; j < i; j += 1) {
      const it = items[j];
      const col = itemColumns[j];
      positioned.push({
        session: it.session,
        topPx: (it.startMin / 60) * hourHeight,
        heightPx: Math.max(
          22,
          ((it.endMin - it.startMin) / 60) * hourHeight - 2,
        ),
        leftPct: (col / cols) * 100,
        widthPct: (1 / cols) * 100,
      });
    }
    if (i < items.length) {
      clusterStart = i;
      clusterEnd = items[i].endMin;
    }
  }
  return positioned;
}

// Which whole hours overlap any positioned tile — used to suppress
// the "+ Add a class" placeholder where a class is sitting on top.
function occupiedHourSet(
  positioned: PositionedSession[],
  baseHour: number,
  hourHeight: number,
): Set<number> {
  const out = new Set<number>();
  for (const p of positioned) {
    const startHour = baseHour + Math.floor(p.topPx / hourHeight);
    const endHour =
      baseHour + Math.ceil((p.topPx + p.heightPx) / hourHeight) - 1;
    for (let h = startHour; h <= endHour; h += 1) out.add(h);
  }
  return out;
}

function ViewSwitcher({ view }: { view: string }) {
  return (
    <View className="flex-row bg-slate-200 dark:bg-gray-800 rounded-full p-1">
      {VIEWS.map((v) => (
        <Pressable
          key={v}
          onPress={() => {
            haptic.selection();
            router.setParams({ view: v });
          }}
          className={`px-4 py-1.5 rounded-full ${
            view === v
              ? 'bg-white dark:bg-gray-700 shadow-pill'
              : 'hover:bg-white/50 dark:hover:bg-gray-700/40'
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

// Compact List/Grid toggle for the phone Book calendar. The agenda list
// is the default; the 2-day grid stays available for a time-of-day
// overview. Month is dropped on the phone entirely.
function ViewIconToggle({ view }: { view: string }) {
  const colors = useThemeColors();
  const options: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { key: 'list', icon: 'list-outline', label: 'List view' },
    { key: 'week', icon: 'grid-outline', label: 'Grid view' },
  ];
  return (
    <View className="flex-row bg-slate-200 dark:bg-gray-800 rounded-full p-1">
      {options.map((o) => {
        const active = view === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              haptic.selection();
              router.setParams({ view: o.key });
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            className={`w-9 h-8 rounded-full items-center justify-center ${
              active ? 'bg-white dark:bg-gray-700 shadow-pill' : ''
            }`}>
            <Ionicons
              name={o.icon}
              size={16}
              color={active ? colors.iconPrimary : colors.iconSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function TodayButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Jump to today"
      className="rounded-full border border-gray-200 dark:border-gray-700 px-4 h-9 items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800/60 active:bg-gray-100 dark:active:bg-gray-800">
      <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">
        Today
      </Text>
    </Pressable>
  );
}

// Book mode, wide screens only — the phone Agenda view (list) already
// scopes its own FilterPill to the day's actual class types, so this
// only renders for the Day/Week/Month grid a member sees on tablet or
// desktop. Multi-select toggle chips; empty selection means "show
// everything" rather than "show nothing".
function ClassTypeFilterRow({
  classTypes,
  selected,
  onChange,
}: {
  classTypes: ClassTypeRow[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  function toggle(id: string) {
    haptic.selection();
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }
  return (
    <View className="flex-row flex-wrap gap-2 pb-4 -mt-2 justify-center">
      {classTypes.map((ct) => {
        const active = selected.has(ct.id);
        return (
          <Pressable
            key={ct.id}
            onPress={() => toggle(ct.id)}
            className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-full border ${
              active
                ? 'border-primary bg-primary/10'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
            }`}>
            <View
              style={{ backgroundColor: ct.color }}
              className="w-2 h-2 rounded-full"
            />
            <Text
              className={`text-xs font-semibold ${
                active ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
              }`}>
              {ct.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ClassesCalendar({
  mode,
  topSlot,
  headerSlot,
  recommendedSessionId,
}: {
  mode: 'manage' | 'book';
  topSlot?: React.ReactNode;
  headerSlot?: React.ReactNode;
  // The session id the member's "Recommended" card is pointing at (see
  // useRecommendedClass in book.tsx) — the matching agenda row gets a
  // purple border so the recommendation is visible in the day's list,
  // not just in the standalone card above it.
  recommendedSessionId?: string | null;
}) {
  const params = useLocalSearchParams<{ view?: string; session?: string }>();
  const { width } = useWindowDimensions();
  // On a phone the member Book calendar drops Month entirely and shows an
  // Apple-style 2-day week instead of cramming seven columns in. Staff
  // Manage and any wide screen keep the full Day/Week/Month calendar.
  const compactBook = mode === 'book' && width < 768;
  const weekVisibleDays = compactBook ? 2 : 7;
  const rawView = parseView(params.view);
  // Phone Book lands on an agenda list (a card per class) and keeps the
  // 2-day grid behind a toggle. Wide screens / staff keep day/week/month.
  const view: 'day' | 'week' | 'month' | 'list' = compactBook
    ? params.view === 'week'
      ? 'week'
      : 'list'
    : rawView;
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [createAt, setCreateAt] = useState<CreateRequest | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  // The phone header's date label opens a month grid to jump around;
  // pickerMonth is which month that grid is showing (independent of the
  // selected date until they tap a day).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => startOfMonth(new Date()));
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const { data: membership } = useGymMembership();
  const classTypesQuery = useClassTypes();
  const { data: gymDefaults } = useGymOperatingDefaults();
  const weekStartsOn: 'mon' | 'sun' = gymDefaults?.week_starts_on ?? 'mon';
  const canEditClasses = useCan('can_edit_classes') ?? false;
  const canCreate = mode === 'manage' && canEditClasses;
  const queryClient = useQueryClient();

  const goToToday = () => {
    haptic.selection();
    setDate(startOfDay(new Date()));
  };

  // Header date label for the phone calendar: the 2-day range in week
  // view, the single day in day view. Tapping it opens the month grid.
  const headerLabel =
    view === 'week'
      ? fmtWeekRange(startOfDay(date), addDays(date, weekVisibleDays - 1))
      : fmtDayShort(date);

  const openPicker = () => {
    haptic.selection();
    setPickerMonth(startOfMonth(date));
    setPickerOpen(true);
  };

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

  // Wide-screen book mode only — the phone Agenda view (list) already
  // filters itself per day. Staff scheduling (manage mode) always sees
  // everything; hiding a class type there would look like it had been
  // unscheduled.
  const visibleSessions =
    mode === 'book' && view !== 'list' && typeFilter.size > 0
      ? sessionsQuery.data?.filter(
          (s) => !!s.class_type_id && typeFilter.has(s.class_type_id),
        )
      : sessionsQuery.data;

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
    const horizonWeeks =
      gymDefaults?.materialisation_horizon_weeks ?? HORIZON_WEEKS_FALLBACK;
    horizon.setDate(horizon.getDate() + horizonWeeks * 7);
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

  // Deep link from the membership "Continue booking" CTA — reopen the
  // class the member returned to finish booking now they have a plan.
  useEffect(() => {
    if (params.session) setOpenSessionId(params.session);
  }, [params.session]);

  // Swipe → step the visible date. Step size matches the current
  // view (day = 1d, week = 7d, month = 1mo). Pan thresholds keep
  // vertical scroll inside the grid working — only horizontal motion
  // past ~30px activates the gesture.
  function shiftDate(direction: -1 | 1) {
    if (view === 'month') {
      setDate(startOfDay(addMonths(date, direction)));
    } else if (view === 'week') {
      setDate(addDays(date, weekVisibleDays * direction));
    } else {
      setDate(addDays(date, direction));
    }
    haptic.selection();
  }
  const swipe = Gesture.Pan()
    .activeOffsetX([-30, 30])
    .failOffsetY([-15, 15])
    .onEnd((e) => {
      'worklet';
      const enoughDistance = Math.abs(e.translationX) > 60;
      const enoughVelocity = Math.abs(e.velocityX) > 200;
      if (!enoughDistance && !enoughVelocity) return;
      runOnJS(shiftDate)(e.translationX > 0 ? -1 : 1);
    });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      {headerSlot ? (
        <View className="w-full max-w-5xl mx-auto px-2 pt-3">{headerSlot}</View>
      ) : null}
      {compactBook ? (
        <View className="w-full max-w-5xl mx-auto px-2">
          {/* Phone Book: the date sits where the month used to — arrows
              step the current view (a day, or the 2-day week), and tapping
              the label opens a month grid to jump further. Equal side
              zones keep it centred. */}
          <View className="flex-row items-center pt-5 pb-3">
            <View className="flex-1 flex-row justify-start">
              <Pressable
                onPress={goToToday}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
                className="w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
                <Ionicons name="locate-outline" size={18} color="#6B7280" />
              </Pressable>
            </View>
            <View className="flex-row items-center gap-0.5">
              <Pressable
                onPress={() => shiftDate(-1)}
                hitSlop={8}
                accessibilityLabel="Previous"
                className="w-8 h-8 items-center justify-center">
                <Text className="text-gray-400 dark:text-gray-500 text-lg">‹</Text>
              </Pressable>
              <Pressable
                onPress={openPicker}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Pick a date"
                className="px-1.5 py-1 items-center justify-center active:opacity-70">
                <Text className="text-gray-900 dark:text-gray-50 text-base font-semibold">
                  {headerLabel}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => shiftDate(1)}
                hitSlop={8}
                accessibilityLabel="Next"
                className="w-8 h-8 items-center justify-center">
                <Text className="text-gray-400 dark:text-gray-500 text-lg">›</Text>
              </Pressable>
            </View>
            <View className="flex-1 flex-row justify-end">
              <ViewIconToggle view={view} />
            </View>
          </View>
        </View>
      ) : (
        <View className="w-full max-w-5xl mx-auto px-2">
          <View className="relative flex-row items-center justify-center gap-4 pt-6 pb-6">
            {/* View switcher sits left of the month header on md+,
                mirroring the Add-class CTA on the right. On small screens
                the absolute slot collides with the month title, so it
                renders as its own row below instead. */}
            <View className="absolute left-0 top-6 hidden md:flex md:flex-row md:items-center gap-2">
              <ViewSwitcher view={view} />
              <TodayButton onPress={goToToday} />
            </View>
            <Pressable
              onPress={() => {
                haptic.selection();
                setDate(startOfDay(addMonths(date, -1)));
              }}
              hitSlop={8}
              className="w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800">
              <Text className="text-gray-500 dark:text-gray-400 text-lg">‹</Text>
            </Pressable>
            <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
              {fmtMonthYear(date)}
            </Text>
            <Pressable
              onPress={() => {
                haptic.selection();
                setDate(startOfDay(addMonths(date, 1)));
              }}
              hitSlop={8}
              className="w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800">
              <Text className="text-gray-500 dark:text-gray-400 text-lg">›</Text>
            </Pressable>
            {canCreate ? (
              <View className="absolute right-0 top-6">
                <Pressable
                  onPress={() => setCreateAt({ date })}
                  className="bg-primary rounded-full p-2 md:pl-3 md:pr-4 md:py-2 flex-row items-center gap-1.5 hover:opacity-90 active:bg-primary-dark shadow-pop">
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                  <Text className="hidden md:flex text-white text-sm font-semibold">
                    Add class
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <View className="md:hidden flex-row items-center justify-center gap-2 pb-4 -mt-1">
            <ViewSwitcher view={view} />
            <TodayButton onPress={goToToday} />
          </View>
        </View>
      )}

      {mode === 'book' && !compactBook && (classTypesQuery.data?.length ?? 0) > 0 ? (
        <View className="w-full max-w-5xl mx-auto px-2">
          <ClassTypeFilterRow
            classTypes={classTypesQuery.data!}
            selected={typeFilter}
            onChange={setTypeFilter}
          />
        </View>
      ) : null}

      <GestureDetector gesture={swipe}>
        <View className="flex-1">
          {view === 'list' ? (
            <AgendaView
              date={date}
              setDate={setDate}
              sessions={sessionsQuery.data}
              weekStartsOn={weekStartsOn}
              bookedSet={bookedSet}
              gymId={membership?.gymId}
              onSessionPress={openSession}
              dimPast={mode === 'book'}
              topSlot={topSlot}
              recommendedSessionId={recommendedSessionId}
            />
          ) : null}
          {view === 'day' ? (
            <DayView
              mode={mode}
              date={date}
              setDate={setDate}
              sessions={visibleSessions}
              onCreateAt={(d, hour) => setCreateAt({ date: d, hour })}
              onSessionPress={openSession}
              canCreate={canCreate}
              bookedSet={bookedSet}
              weekStartsOn={weekStartsOn}
              topSlot={topSlot}
            />
          ) : null}
          {view === 'week' ? (
            <WeekView
              date={date}
              setDate={setDate}
              gotoDay={() => router.setParams({ view: 'day' })}
              sessions={visibleSessions}
              onCreateAt={(d, hour) => setCreateAt({ date: d, hour })}
              onSessionPress={openSession}
              canCreate={canCreate}
              bookedSet={bookedSet}
              weekStartsOn={weekStartsOn}
              dimPast={mode === 'book'}
              topSlot={topSlot}
              visibleDays={weekVisibleDays}
            />
          ) : null}
          {view === 'month' ? (
            <MonthView
              date={date}
              setDate={setDate}
              gotoDay={() => router.setParams({ view: 'day' })}
              sessions={visibleSessions}
              weekStartsOn={weekStartsOn}
              topSlot={topSlot}
            />
          ) : null}
        </View>
      </GestureDetector>

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
        recommended={
          openSessionId !== null && openSessionId === recommendedSessionId
        }
        onClose={() => setOpenSessionId(null)}
      />

      <MonthPickerModal
        visible={pickerOpen}
        month={pickerMonth}
        selected={date}
        weekStartsOn={weekStartsOn}
        onChangeMonth={(dir) => setPickerMonth((m) => startOfMonth(addMonths(m, dir)))}
        onSelectDay={(day) => {
          haptic.selection();
          setDate(startOfDay(day));
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

// Class-type filter chip for the agenda. Inactive shows the type's colour
// as a dot; active fills with that colour. The "All" chip has no colour,
// so it falls back to the brand accent.
function FilterPill({
  label,
  color,
  active,
  accent,
  onPress,
}: {
  label: string;
  color?: string;
  active: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={active ? { backgroundColor: color ?? accent } : undefined}
      className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-full active:opacity-70 ${
        active ? '' : 'bg-gray-100 dark:bg-gray-800'
      }`}>
      {color && !active ? (
        <View
          style={{ backgroundColor: color }}
          className="w-2 h-2 rounded-full"
        />
      ) : null}
      <Text
        className={`text-xs font-semibold ${
          active ? 'text-white' : 'text-gray-600 dark:text-gray-300'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

// Agenda list — the phone Book default. A day strip up top, then a card
// per class for the selected day showing time, coach, spots-left and
// booking state. Booking itself still runs through ClassDetailModal (all
// the entitlement / waitlist / purchase logic lives there), so a card tap
// just opens it.
function AgendaView({
  date,
  setDate,
  sessions,
  weekStartsOn,
  bookedSet,
  gymId,
  onSessionPress,
  dimPast,
  topSlot,
  recommendedSessionId,
}: {
  date: Date;
  setDate: (d: Date) => void;
  sessions: ClassSession[] | undefined;
  weekStartsOn: 'mon' | 'sun';
  bookedSet: Set<string>;
  gymId: string | undefined;
  onSessionPress: (id: string) => void;
  dimPast?: boolean;
  topSlot?: React.ReactNode;
  recommendedSessionId?: string | null;
}) {
  const colors = useThemeColors();
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const weekStart = startOfWeek(date, weekStartsOn);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayClasses = classesOnDay(sessions, date).sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
  const dayIds = dayClasses.map((s) => s.id);
  const isoDay = fmtDateLocal(date);

  // Filter pills reflect only the class types actually on this day, so the
  // set changes as the member moves between days. A filter that no longer
  // applies to the selected day falls back to "All" rather than emptying
  // the list.
  const dayTypes: { id: string; name: string; color: string }[] = [];
  const seenTypes = new Set<string>();
  for (const s of dayClasses) {
    if (s.class_type_id && s.class_types && !seenTypes.has(s.class_type_id)) {
      seenTypes.add(s.class_type_id);
      dayTypes.push({
        id: s.class_type_id,
        name: s.class_types.name,
        color: sessionColor(s, colors.primary),
      });
    }
  }
  const activeType =
    typeFilter && seenTypes.has(typeFilter) ? typeFilter : null;
  const shownClasses = activeType
    ? dayClasses.filter((s) => s.class_type_id === activeType)
    : dayClasses;

  // One round trip for the whole day's spot counts (RLS lets a member
  // read same-gym bookings — class_bookings_tenant_select), tallied into
  // a per-session map. Confirmed rows only; waitlist sits in its own table.
  const counts = useQuery({
    queryKey: ['agenda-booking-counts', gymId, isoDay, dayIds.join(',')],
    enabled: dayIds.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select('class_session_id')
        .in('class_session_id', dayIds);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as { class_session_id: string }[]) {
        m.set(r.class_session_id, (m.get(r.class_session_id) ?? 0) + 1);
      }
      return m;
    },
  });

  return (
    <View className="flex-1">
      <View className="w-full max-w-5xl mx-auto px-2">
        <View className="flex-row gap-2 pt-1 pb-4">
          {weekDays.map((d) => {
            const selected = isSameDay(d, date);
            const today = isSameDay(d, new Date());
            return (
              <Pressable
                key={d.toISOString()}
                onPress={() => {
                  haptic.selection();
                  setDate(startOfDay(d));
                }}
                hitSlop={6}
                className="flex-1 items-center gap-1.5">
                <Text
                  className={`text-xs font-semibold uppercase ${
                    today ? 'text-primary' : 'text-gray-400 dark:text-gray-500'
                  }`}>
                  {DAY_LETTERS[d.getDay()]}
                </Text>
                <View
                  className={`w-9 h-9 rounded-full items-center justify-center ${
                    selected ? 'bg-primary shadow-pop' : ''
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

        {dayTypes.length > 1 ? (
          <View className="flex-row flex-wrap gap-2 pb-3">
            <FilterPill
              label="All"
              active={activeType === null}
              accent={colors.primary}
              onPress={() => {
                haptic.selection();
                setTypeFilter(null);
              }}
            />
            {dayTypes.map((t) => (
              <FilterPill
                key={t.id}
                label={t.name}
                color={t.color}
                active={activeType === t.id}
                accent={colors.primary}
                onPress={() => {
                  haptic.selection();
                  setTypeFilter(t.id);
                }}
              />
            ))}
          </View>
        ) : null}
      </View>

      <ScrollView className="flex-1" contentContainerClassName="pb-10">
        {topSlot ? (
          <View className="w-full max-w-5xl mx-auto px-2 pt-1 pb-2">{topSlot}</View>
        ) : null}
        <View className="w-full max-w-5xl mx-auto px-2 gap-2.5">
          {shownClasses.length === 0 ? (
            <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 items-center gap-2">
              <Ionicons
                name="calendar-clear-outline"
                size={24}
                color={colors.iconTertiary}
              />
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                No classes on this day.
              </Text>
            </View>
          ) : (
            shownClasses.map((s) => (
              <AgendaCard
                key={s.id}
                session={s}
                count={counts.data?.get(s.id) ?? 0}
                bookedByMe={bookedSet.has(s.id)}
                recommended={recommendedSessionId === s.id}
                onPress={() => onSessionPress(s.id)}
                dimPast={dimPast}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function AgendaCard({
  session,
  count,
  bookedByMe,
  recommended,
  onPress,
  dimPast,
}: {
  session: ClassSession;
  count: number;
  bookedByMe: boolean;
  recommended?: boolean;
  onPress: () => void;
  dimPast?: boolean;
}) {
  const colors = useThemeColors();
  const start = new Date(session.starts_at);
  const end = new Date(start.getTime() + session.duration_minutes * 60 * 1000);
  const isPast = dimPast === true && end.getTime() <= Date.now();
  const spotsLeft = Math.max(0, session.capacity - count);
  const full = spotsLeft <= 0;
  const color = sessionColor(session, colors.primary);
  const coachName = session.coach?.full_name?.trim() || null;

  const statusText = bookedByMe
    ? 'Booked in'
    : full
      ? 'Full'
      : `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`;
  const statusClass = bookedByMe
    ? 'text-emerald-600 dark:text-emerald-400'
    : full
      ? 'text-gray-400 dark:text-gray-500'
      : spotsLeft <= 3
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';

  return (
    <Pressable
      onPress={isPast ? undefined : onPress}
      disabled={isPast}
      className={`flex-row items-center gap-3 bg-white dark:bg-gray-900 rounded-2xl p-3.5 border shadow-card active:bg-gray-50 dark:active:bg-gray-800 ${
        bookedByMe
          ? 'border-emerald-400 dark:border-emerald-600'
          : recommended
            ? 'border-purple-400 dark:border-purple-500'
            : 'border-gray-200 dark:border-gray-700'
      } ${isPast ? 'opacity-50' : ''}`}>
      <View className="w-14">
        <Text className="text-gray-900 dark:text-gray-50 text-[17px] font-extrabold">
          {fmtTime(start)}
        </Text>
        <Text className="text-gray-400 dark:text-gray-500 text-[11px] mt-0.5">
          {session.duration_minutes} min
        </Text>
      </View>

      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2">
          <View
            style={{ backgroundColor: color }}
            className="w-2 h-2 rounded-full"
          />
          {recommended && !bookedByMe ? (
            <Ionicons name="sparkles" size={13} color="#A855F7" />
          ) : null}
          <Text
            numberOfLines={1}
            className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
            {sessionLabel(session)}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5 mt-1">
          {coachName ? (
            <>
              <Text
                className="text-gray-500 dark:text-gray-400 text-xs"
                numberOfLines={1}>
                with {coachName}
              </Text>
              <Text className="text-gray-300 dark:text-gray-600 text-xs">·</Text>
            </>
          ) : null}
          <Text className={`text-xs font-semibold ${statusClass}`}>
            {statusText}
          </Text>
        </View>
      </View>

      {bookedByMe ? (
        <View className="flex-row items-center gap-1 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1.5">
          <Ionicons name="checkmark" size={14} color="#059669" />
          <Text className="text-emerald-700 dark:text-emerald-300 text-xs font-bold">
            Booked
          </Text>
        </View>
      ) : isPast ? null : (
        <View
          className={`rounded-full px-4 py-2 ${
            full ? 'bg-gray-100 dark:bg-gray-800' : 'bg-primary'
          }`}>
          <Text
            className={`text-xs font-bold ${
              full ? 'text-gray-500 dark:text-gray-400' : 'text-white'
            }`}>
            {full ? 'Waitlist' : 'Book'}
          </Text>
        </View>
      )}
    </Pressable>
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
  weekStartsOn,
  topSlot,
}: {
  mode: 'manage' | 'book';
  date: Date;
  setDate: (d: Date) => void;
  sessions: ClassSession[] | undefined;
  onCreateAt: (d: Date, hour: number) => void;
  onSessionPress: (id: string) => void;
  canCreate: boolean;
  bookedSet: Set<string>;
  weekStartsOn: 'mon' | 'sun';
  topSlot?: React.ReactNode;
}) {
  const weekStart = startOfWeek(date, weekStartsOn);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekLetters =
    weekStartsOn === 'sun' ? WEEK_LETTERS_SUN : WEEK_LETTERS_MON;
  const dayClasses = classesOnDay(sessions, date).sort(
    (a, b) =>
      new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );

  const scrollRef = useRef<ScrollView | null>(null);
  // topSlot scrolls with the grid (so it can move off-screen on small
  // phones); the jump-to-now offset has to skip past its measured
  // height. Kept in a ref so expanding/collapsing the onboarding card
  // never yanks a scrolled-down user back up.
  const topSlotHeight = useRef(0);
  const didInitialScroll = useRef(false);
  const scrollToNow = useCallback(() => {
    const now = new Date();
    const hourTarget = isSameDay(now, date) ? now.getHours() : HOURS[0];
    const y = scrollYForHour(hourTarget) + topSlotHeight.current;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
    });
  }, [date]);
  useEffect(() => {
    didInitialScroll.current = false;
    scrollToNow();
  }, [date, scrollToNow]);

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
                onPress={() => {
                  haptic.selection();
                  setDate(d);
                }}
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
                    selected ? 'bg-primary shadow-pop' : ''
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
        {topSlot ? (
          <View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (Math.abs(h - topSlotHeight.current) > 1) {
                topSlotHeight.current = h;
                if (!didInitialScroll.current) {
                  didInitialScroll.current = true;
                  scrollToNow();
                }
              }
            }}
            className="w-full max-w-5xl mx-auto px-2 pt-4 pb-2">
            {topSlot}
          </View>
        ) : null}
        <View className="w-full max-w-5xl mx-auto px-2">
          {mode === 'book' ? (
            dayClasses.length === 0 ? (
              <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  No classes scheduled today.
                </Text>
              </View>
            ) : (
              // Wide-screen book mode (the phone width goes to the Agenda
              // list instead) — a compact stacked list, not the hourly
              // grid. A member scanning today's classes doesn't need 18
              // mostly-empty hour rows between a 06:00 and a 17:30 class;
              // the grid stays for manage mode, where the gaps are the
              // point (they're where a coach schedules the next class).
              <View className="gap-3">
                {dayClasses.map((s) => (
                  <DayClassCard
                    key={s.id}
                    session={s}
                    onPress={() => onSessionPress(s.id)}
                    bookedByMe={bookedSet.has(s.id)}
                    dimPast
                  />
                ))}
              </View>
            )
          ) : (
            <DayGrid
              date={date}
              sessions={sessions}
              canCreate={canCreate}
              onCreateAt={onCreateAt}
              onSessionPress={onSessionPress}
              bookedSet={bookedSet}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// Width of the time-label gutter on the left of the grid + the
// flex-row gap that sits between the label and the day content.
// Keeping these in sync with the row classes (w-14 = 56, gap-4 = 16)
// so the absolute overlay aligns with the cells underneath.
const TIME_GUTTER_PX = 56 + 16;

function DayGrid({
  date,
  sessions,
  canCreate,
  onCreateAt,
  onSessionPress,
  bookedSet,
}: {
  date: Date;
  sessions: ClassSession[] | undefined;
  canCreate: boolean;
  onCreateAt: (d: Date, hour: number) => void;
  onSessionPress: (id: string) => void;
  bookedSet: Set<string>;
}) {
  const positioned = layoutDay(sessions, date, HOURS[0], HOUR_HEIGHT, HOURS.length);
  const occupied = occupiedHourSet(positioned, HOURS[0], HOUR_HEIGHT);
  const now = new Date();
  const isToday = isSameDay(date, now);
  const nowTopPx = isToday
    ? ((now.getHours() - HOURS[0]) * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT
    : null;

  return (
    <View style={{ position: 'relative' }}>
      {HOURS.map((hour) => {
        const label = `${hour.toString().padStart(2, '0')}:00`;
        const isOccupied = occupied.has(hour);
        return (
          <View
            key={hour}
            className="flex-row gap-4 border-t border-gray-100 dark:border-gray-800"
            style={{ height: HOUR_HEIGHT }}>
            <Text className="text-gray-400 dark:text-gray-500 text-sm w-14 pt-3">
              {label}
            </Text>
            <View className="flex-1 py-1.5">
              {isOccupied ? null : canCreate ? (
                <Pressable
                  onPress={() => onCreateAt(date, hour)}
                  className="border border-dashed border-gray-300 dark:border-gray-600 rounded-xl px-4 justify-center hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:border-gray-400 dark:hover:border-gray-500 active:bg-gray-50 dark:active:bg-gray-800"
                  style={{ height: HOUR_HEIGHT - 12 }}>
                  <Text className="text-gray-400 dark:text-gray-500 text-sm">+ Add a class</Text>
                </Pressable>
              ) : (
                <View
                  className="border border-dashed border-gray-200 dark:border-gray-700 rounded-xl px-4 justify-center"
                  style={{ height: HOUR_HEIGHT - 12 }}>
                  <Text className="text-gray-400 dark:text-gray-500 text-sm">No class scheduled</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}

      {/* Class tiles + now line — absolutely positioned across the
          day's content area (right of the time label gutter). The
          container is box-none so empty space falls through to the
          placeholder Pressables underneath. */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: TIME_GUTTER_PX,
          right: 0,
        }}>
        {positioned.map((p) => (
          <View
            key={p.session.id}
            style={{
              position: 'absolute',
              top: p.topPx,
              height: p.heightPx,
              left: `${p.leftPct}%`,
              width: `${p.widthPct}%`,
              padding: 2,
            }}>
            <DayClassCard
              session={p.session}
              heightPx={p.heightPx}
              onPress={() => onSessionPress(p.session.id)}
              bookedByMe={bookedSet.has(p.session.id)}
            />
          </View>
        ))}
        {nowTopPx != null ? <NowLine topPx={nowTopPx} /> : null}
      </View>
    </View>
  );
}

function DayClassCard({
  session,
  onPress,
  bookedByMe,
  heightPx,
  dimPast,
}: {
  session: ClassSession;
  onPress: () => void;
  bookedByMe?: boolean;
  // When provided, the card is rendered inside the absolute
  // duration-block layer and fills its parent (height/width 100%).
  // Without it (book-mode list view) the card sizes to content.
  heightPx?: number;
  // Book mode only: a finished class (end time in the past) is dimmed
  // and made unpressable — there is nothing left to book.
  dimPast?: boolean;
}) {
  const colors = useThemeColors();
  const start = new Date(session.starts_at);
  const end = new Date(start.getTime() + session.duration_minutes * 60 * 1000);
  const inGrid = heightPx != null;
  const isPast = dimPast === true && end.getTime() <= Date.now();
  // The full layout (coach avatar + spot count) needs ~108px to render
  // without clipping. Below that we use the clean chip + time card, so a
  // standard 1-hour block (≈78px at the current hour height) reads big
  // but uncramped; the detail layout kicks in for 90-minute+ sessions.
  const compact = inGrid && heightPx! < 110;
  return (
    <Pressable
      onPress={
        isPast
          ? undefined
          : () => {
              haptic.tap();
              onPress();
            }
      }
      disabled={isPast}
      style={
        inGrid ? { height: '100%', width: '100%' } : undefined
      }
      className={`bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 flex-row items-start gap-3 active:bg-gray-50 dark:active:bg-gray-800 overflow-hidden shadow-card ${
        compact ? 'p-2' : 'p-4'
      } ${
        isPast
          ? 'opacity-50'
          : 'hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-pop'
      }`}>
      <View className={`flex-1 ${compact ? 'gap-0.5' : 'gap-1.5'}`}>
        <View className="flex-row items-center gap-2">
          <View
            style={{ backgroundColor: sessionColor(session, colors.primary) }}
            className={`self-start rounded-full ${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'}`}>
            <Text className={`text-white font-semibold ${compact ? 'text-[10px]' : 'text-xs'}`}>
              {sessionLabel(session)}
            </Text>
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
        <Text
          className={`text-gray-900 dark:text-gray-50 font-medium ${
            compact ? 'text-xs' : 'text-base'
          }`}>
          {fmtTime(start)} — {fmtTime(end)}
        </Text>
        {!compact ? (
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {session.capacity} spots
          </Text>
        ) : null}
      </View>
      {!compact ? (
        <Avatar
          name={session.coach?.full_name}
          avatarUrl={session.coach?.avatar_url}
          size={36}
        />
      ) : null}
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
  weekStartsOn,
  dimPast,
  topSlot,
  visibleDays = 7,
}: {
  date: Date;
  setDate: (d: Date) => void;
  gotoDay: () => void;
  sessions: ClassSession[] | undefined;
  onCreateAt: (d: Date, hour: number) => void;
  onSessionPress: (id: string) => void;
  canCreate: boolean;
  bookedSet: Set<string>;
  weekStartsOn: 'mon' | 'sun';
  dimPast?: boolean;
  topSlot?: React.ReactNode;
  visibleDays?: number;
}) {
  // A true week anchors on the gym's week-start; the phone Book calendar
  // shows a rolling N-day window (Apple-style) anchored on the selected
  // day instead.
  const rolling = visibleDays !== 7;
  const weekStart = rolling ? startOfDay(date) : startOfWeek(date, weekStartsOn);
  const weekDays = Array.from({ length: visibleDays }, (_, i) =>
    addDays(weekStart, i),
  );

  const scrollRef = useRef<ScrollView | null>(null);
  const topSlotHeight = useRef(0);
  const didInitialScroll = useRef(false);
  const weekKey = weekStart.toISOString();
  const scrollToNow = useCallback(() => {
    const now = new Date();
    const inWeek = weekDays.some((d) => isSameDay(d, now));
    const hourTarget = inWeek ? now.getHours() : HOURS[0];
    const y = scrollYForHour(hourTarget) + topSlotHeight.current;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);
  useEffect(() => {
    didInitialScroll.current = false;
    scrollToNow();
  }, [weekKey, scrollToNow]);

  return (
    <View className="flex-1">
      <View className="w-full max-w-5xl mx-auto px-2">
        {/* On the phone (rolling window) the calendar header already
            carries the date + arrows, so this internal mover only shows
            on the wide 7-day week. */}
        {rolling ? null : (
          <View className="flex-row items-center justify-center gap-4 pb-4">
            <Pressable
              onPress={() => setDate(addDays(date, -visibleDays))}
              hitSlop={8}
              className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center">
              <Text className="text-gray-500 dark:text-gray-400">‹</Text>
            </Pressable>
            <Text className="text-gray-700 dark:text-gray-200 font-medium">
              {fmtWeekRange(weekDays[0], weekDays[weekDays.length - 1])}
            </Text>
            <Pressable
              onPress={() => setDate(addDays(date, visibleDays))}
              hitSlop={8}
              className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center">
              <Text className="text-gray-500 dark:text-gray-400">›</Text>
            </Pressable>
          </View>
        )}

        <View className="flex-row pb-2 border-b border-gray-200 dark:border-gray-700">
          <View className="w-10 md:w-14" />
          {weekDays.map((d, i) => {
            const today = isSameDay(d, new Date());
            return (
              <Pressable
                key={d.toISOString()}
                onPress={() => {
                  haptic.selection();
                  setDate(d);
                  gotoDay();
                }}
                hitSlop={4}
                className={`flex-1 items-center pb-2 border-gray-200 dark:border-gray-800 ${
                  i > 0 ? 'border-l' : ''
                }`}>
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
        {topSlot ? (
          <View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (Math.abs(h - topSlotHeight.current) > 1) {
                topSlotHeight.current = h;
                if (!didInitialScroll.current) {
                  didInitialScroll.current = true;
                  scrollToNow();
                }
              }
            }}
            className="w-full max-w-5xl mx-auto px-2 pt-4 pb-2">
            {topSlot}
          </View>
        ) : null}
        <View className="w-full max-w-5xl mx-auto px-2">
          <WeekGrid
            weekDays={weekDays}
            sessions={sessions}
            canCreate={canCreate}
            onCreateAt={onCreateAt}
            onSessionPress={onSessionPress}
            bookedSet={bookedSet}
            dimPast={dimPast}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function WeekGrid({
  weekDays,
  sessions,
  canCreate,
  onCreateAt,
  onSessionPress,
  bookedSet,
  dimPast,
}: {
  weekDays: Date[];
  sessions: ClassSession[] | undefined;
  canCreate: boolean;
  onCreateAt: (d: Date, hour: number) => void;
  onSessionPress: (id: string) => void;
  bookedSet: Set<string>;
  dimPast?: boolean;
}) {
  // Per-day layout + occupancy so empty cells keep their "+ Add a
  // class" hit target while occupied ones step out of the way for
  // the absolute tile overlay.
  const perDay = weekDays.map((d) => ({
    day: d,
    positioned: layoutDay(sessions, d, HOURS[0], HOUR_HEIGHT, HOURS.length),
  }));
  const occupiedByDayIdx = perDay.map((p) =>
    occupiedHourSet(p.positioned, HOURS[0], HOUR_HEIGHT),
  );
  const now = new Date();
  const todayIdx = weekDays.findIndex((d) => isSameDay(d, now));
  const nowTopPx =
    todayIdx >= 0
      ? ((now.getHours() - HOURS[0]) * 60 + now.getMinutes()) / 60 *
        HOUR_HEIGHT
      : null;

  return (
    <View style={{ position: 'relative' }}>
      {HOURS.map((hour) => {
        const label = `${hour.toString().padStart(2, '0')}:00`;
        return (
          <View
            key={hour}
            className="flex-row border-t border-gray-100 dark:border-gray-800"
            style={{ height: HOUR_HEIGHT }}>
            <Text className="w-10 md:w-14 text-xs text-gray-400 dark:text-gray-500 pt-2">
              {label}
            </Text>
            {weekDays.map((d, i) => {
              const isOccupied = occupiedByDayIdx[i].has(hour);
              return (
                <View
                  key={d.toISOString()}
                  className={`flex-1 px-0.5 py-0.5 border-gray-200 dark:border-gray-800 ${
                    i > 0 ? 'border-l' : ''
                  }`}>
                  {isOccupied ? (
                    <View className="flex-1 rounded-md" />
                  ) : canCreate ? (
                    <Pressable
                      onPress={() => onCreateAt(d, hour)}
                      className="flex-1 border border-dashed border-gray-200 dark:border-gray-700 rounded-md active:bg-gray-50 dark:active:bg-gray-800"
                    />
                  ) : (
                    <View className="flex-1 rounded-md" />
                  )}
                </View>
              );
            })}
          </View>
        );
      })}

      {/* Absolute overlay: 7 day columns sharing the row area, each
          carrying its layoutDay-positioned tiles. box-none on the
          spacers + the column wrappers lets clicks fall through to
          the placeholders behind. */}
      <View
        pointerEvents="box-none"
        className="flex-row"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        }}>
        <View pointerEvents="none" className="w-10 md:w-14" />
        {perDay.map(({ day, positioned }, i) => (
          <View
            key={day.toISOString()}
            pointerEvents="box-none"
            className="flex-1 px-0.5"
            style={{ position: 'relative' }}>
            {positioned.map((p) => (
              <View
                key={p.session.id}
                style={{
                  position: 'absolute',
                  top: p.topPx,
                  height: p.heightPx,
                  left: `${p.leftPct}%`,
                  width: `${p.widthPct}%`,
                  padding: 1,
                }}>
                <WeekTile
                  session={p.session}
                  onPress={() => onSessionPress(p.session.id)}
                  bookedByMe={bookedSet.has(p.session.id)}
                  heightPx={p.heightPx}
                  dimPast={dimPast}
                />
              </View>
            ))}
            {i === todayIdx && nowTopPx != null ? (
              <NowLine topPx={nowTopPx} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function WeekTile({
  session,
  onPress,
  bookedByMe,
  heightPx,
  dimPast,
}: {
  session: ClassSession;
  onPress: () => void;
  bookedByMe?: boolean;
  heightPx: number;
  dimPast?: boolean;
}) {
  const colors = useThemeColors();
  const start = new Date(session.starts_at);
  const end = new Date(start.getTime() + session.duration_minutes * 60 * 1000);
  const compact = heightPx < 38;
  const isPast = dimPast === true && end.getTime() <= Date.now();
  return (
    <Pressable
      onPress={
        isPast
          ? undefined
          : () => {
              haptic.tap();
              onPress();
            }
      }
      disabled={isPast}
      style={{ height: '100%', width: '100%' }}
      className={`bg-white dark:bg-gray-900 rounded-md p-1.5 gap-1 border overflow-hidden active:bg-gray-50 dark:active:bg-gray-800 shadow-card ${
        bookedByMe
          ? 'border-emerald-400 dark:border-emerald-600'
          : 'border-gray-200 dark:border-gray-700'
      } ${isPast ? 'opacity-50' : ''}`}>
      <View className="flex-row items-center gap-1">
        {bookedByMe ? (
          <Ionicons name="checkmark-circle" size={10} color="#10B981" />
        ) : (
          <View
            style={{ backgroundColor: sessionColor(session, colors.primary) }}
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
        {compact ? fmtTime(start) : `${fmtTime(start)} – ${fmtTime(end)}`}
      </Text>
    </Pressable>
  );
}

function MonthView({
  date,
  setDate,
  gotoDay,
  sessions,
  weekStartsOn,
  topSlot,
}: {
  date: Date;
  setDate: (d: Date) => void;
  gotoDay: () => void;
  sessions: ClassSession[] | undefined;
  weekStartsOn: 'mon' | 'sun';
  topSlot?: React.ReactNode;
}) {
  const grid = monthGrid(date, weekStartsOn);
  const weekLetters =
    weekStartsOn === 'sun' ? WEEK_LETTERS_SUN : WEEK_LETTERS_MON;

  return (
    <View className="flex-1">
      <View className="w-full max-w-5xl mx-auto px-2">
        <View className="flex-row pb-2">
          {weekLetters.map((l, i) => (
            <View key={i} className="flex-1 items-center">
              <Text className="text-gray-400 dark:text-gray-500 text-xs font-medium uppercase">
                {l}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="pb-10">
        {topSlot ? (
          <View className="w-full max-w-5xl mx-auto px-2 pt-4 pb-2">{topSlot}</View>
        ) : null}
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
                      haptic.selection();
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
