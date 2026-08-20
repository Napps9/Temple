import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ClassLeaderboardModal } from '@/components/ClassLeaderboardModal';
import { MonthPickerModal } from '@/components/MonthPickerModal';
import { PercentPrescriptionRow } from '@/components/PercentPrescriptionRow';
import {
  ProgrammingModal,
  type ProgrammingTarget,
} from '@/components/ProgrammingModal';
import { useProgrammingBlocks } from '@/components/ProgrammingRoadmap';
import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { TodayButton } from '@/components/TodayButton';
import { useGymMembership, useSession } from '@/lib/auth';
import { blockForDate, blockStripText } from '@/lib/programming-roadmap';
import { formatMoney } from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import {
  useMemberProgrammingFiles,
  useMyProgrammingAccess,
  useOpenProgrammingFile,
  type MemberProgrammingFile,
  type MyProgrammingAccess,
} from '@/lib/member-programming';
import {
  formatLabel,
  parseSections,
  type Section,
} from '@/lib/programming';
import { useStartStoreCheckout } from '@/lib/store';
import { intervalSuffix } from '@/lib/store-format';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useGymCurrency } from '@/lib/useGymCurrency';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { useMyRepMaxes, type RepMaxLookup } from '@/lib/useOneRepMaxes';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type ClassSession = {
  id: string;
  starts_at: string;
  class_type_id: string | null;
  class_types: {
    name: string;
    color: string;
    archived_at: string | null;
  } | null;
};

type ProgrammingRow = {
  id: string;
  class_type_id: string;
  date: string;
  sections: Section[];
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

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function fmtDayShort(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function ProgrammingCalendar({
  mode,
  headerAction,
  memberScope,
  topBar,
  showMyPercentages,
  roadmap,
}: {
  mode: 'manage' | 'view';
  // Optional control rendered beside the month header (right-aligned
  // on desktop, its own row on mobile) — staff use it for Analysis.
  headerAction?: React.ReactNode;
  // Show the roadmap block strip above the week (staff surfaces only —
  // blocks are coaching material, RLS-hidden from members anyway).
  roadmap?: boolean;
  // Scopes the calendar to ONE member's individual programming (the
  // staff member-programming screen). Class sessions/programming stop
  // being fetched; each day is that member's personal card instead.
  memberScope?: { profileId: string; name: string };
  // Rendered above the date header, inside the Screen — the member
  // scope uses it for its BackLink + identity row.
  topBar?: React.ReactNode;
  // Resolve "@ 75%" against the VIEWER's own rep maxes. Set only from
  // the member programming tab: on the staff surfaces the viewer is a
  // coach, so this would silently attribute the coach's numbers to
  // whoever's programming is on screen.
  showMyPercentages?: boolean;
}) {
  const colors = useThemeColors();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const { data: gymDefaults } = useGymOperatingDefaults();
  const weekStartsOn: 'mon' | 'sun' = gymDefaults?.week_starts_on ?? 'mon';
  const { lookup: repMaxLookup } = useMyRepMaxes(!!showMyPercentages);
  // A ?date=YYYY-MM-DD param deep-links the calendar to a specific day
  // (e.g. "See programming" from a class). Read once on mount so it
  // doesn't fight the user's own navigation afterwards.
  const params = useLocalSearchParams<{ date?: string }>();
  const [date, setDate] = useState(() => {
    const p = typeof params.date === 'string' ? params.date : undefined;
    if (p && /^\d{4}-\d{2}-\d{2}$/.test(p)) {
      const [y, mo, d] = p.split('-').map(Number);
      return startOfDay(new Date(y, mo - 1, d));
    }
    return startOfDay(new Date());
  });
  const [openFor, setOpenFor] = useState<{
    target: ProgrammingTarget;
    date: Date;
  } | null>(null);
  const [recordingDate, setRecordingDate] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => startOfMonth(new Date()));

  const openPicker = () => {
    setPickerMonth(startOfMonth(date));
    setPickerOpen(true);
  };

  const blocksQuery = useProgrammingBlocks(
    roadmap ? membership?.gymId : undefined,
  );
  const activeBlock = roadmap
    ? blockForDate(blocksQuery.data ?? [], fmtDateLocal(date))
    : null;

  const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}`;

  const sessionsQuery = useQuery({
    queryKey: ['class-sessions-month', membership?.gymId, monthKey],
    enabled: !!membership?.gymId && !memberScope,
    queryFn: async () => {
      const start = addDays(startOfMonth(date), -7);
      const end = addDays(startOfMonth(addMonths(date, 1)), 7);
      const { data, error } = await supabase
        .from('class_sessions')
        .select(
          'id, name, starts_at, duration_minutes, capacity, class_type_id, class_types(name, color, archived_at), coach_id, coach:profiles!coach_id(full_name)',
        )
        .gte('starts_at', start.toISOString())
        .lt('starts_at', end.toISOString())
        .order('starts_at');
      if (error) throw error;
      return data as unknown as ClassSession[];
    },
  });

  const programmingMonthQuery = useQuery({
    queryKey: ['class-programming-month', membership?.gymId, monthKey],
    enabled: !!membership?.gymId && !memberScope,
    queryFn: async () => {
      const start = fmtDateLocal(addDays(startOfMonth(date), -7));
      const end = fmtDateLocal(addDays(startOfMonth(addMonths(date, 1)), 7));
      const { data, error } = await supabase
        .from('class_programming')
        .select('id, class_type_id, date, sections')
        .gte('date', start)
        .lt('date', end);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        sections: parseSections(row.sections),
      })) as ProgrammingRow[];
    },
  });

  // Individual programming: the scoped member's rows on the staff
  // screen, or the signed-in member's own on the view tab. The explicit
  // profile filter matters — staff RLS would otherwise hand a coach
  // every member's rows.
  const personalProfileId =
    memberScope?.profileId ??
    (mode === 'view' ? session?.user?.id : undefined);
  const personalMonthQuery = useQuery({
    queryKey: [
      'member-programming-month',
      membership?.gymId,
      personalProfileId,
      monthKey,
    ],
    enabled: !!membership?.gymId && !!personalProfileId,
    queryFn: async () => {
      const start = fmtDateLocal(addDays(startOfMonth(date), -7));
      const end = fmtDateLocal(addDays(startOfMonth(addMonths(date, 1)), 7));
      const { data, error } = await supabase
        .from('member_programming')
        .select('id, date, sections')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', personalProfileId!)
        .gte('date', start)
        .lt('date', end);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id as string,
        date: row.date as string,
        sections: parseSections(row.sections),
      }));
    },
  });

  const memberView = mode === 'view' && !memberScope;
  const filesQuery = useMemberProgrammingFiles(
    memberView || memberScope ? membership?.gymId : undefined,
    personalProfileId,
  );
  const accessQuery = useMyProgrammingAccess(membership?.gymId, memberView);

  const weekStart = startOfWeek(date, weekStartsOn);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const dayTypes: DayClassType[] = (() => {
    const sessions = sessionsQuery.data ?? [];
    const map = new Map<string, DayClassType>();
    for (const s of sessions) {
      if (!s.class_type_id || !s.class_types) continue;
      // Skip archived class types so the coach can't open the
      // programming editor for one — the server trigger refuses
      // writes too (0035), but we surface that by not offering it.
      if (s.class_types.archived_at) continue;
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
  const programmingByTypeId = new Map<
    string,
    { id: string; sections: Section[] }
  >(
    (programmingMonthQuery.data ?? [])
      .filter((p) => p.date === dateStr)
      .map((p) => [p.class_type_id, { id: p.id, sections: p.sections }]),
  );

  const personalDay =
    (personalMonthQuery.data ?? []).find((p) => p.date === dateStr) ?? null;
  const personalFiles = filesQuery.data ?? [];
  const access = accessQuery.data ?? null;
  // RLS already hides rows from a locked-out member; has_programming
  // (computed server-side) is what lets the locked card exist anyway.
  const personalLocked =
    memberView && !!access && access.has_programming && !access.entitled;
  const showPersonalCard =
    memberView &&
    !personalLocked &&
    ((personalDay?.sections.length ?? 0) > 0 || personalFiles.length > 0);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <View className="w-full max-w-5xl mx-auto px-2">
        {topBar ?? null}
        {/* Same date header as the Book calendar: Today jump, the selected
            day with day-stepping arrows, and a tap-to-open month grid. */}
        <View className="flex-row items-center pt-3 pb-4">
          <View className="flex-1 flex-row justify-start">
            <TodayButton onPress={() => setDate(startOfDay(new Date()))} />
          </View>
          <View className="flex-row items-center gap-0.5">
            <Pressable
              onPress={() => setDate(addDays(date, -1))}
              hitSlop={8}
              accessibilityLabel="Previous day"
              className="w-8 h-8 items-center justify-center">
              <Text className="text-ink-3 dark:text-ink-3-dk text-lg">‹</Text>
            </Pressable>
            <Pressable
              onPress={openPicker}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Pick a date"
              className="px-1.5 py-1 items-center justify-center active:opacity-70">
              <Text className="text-ink dark:text-ink-dk text-base font-semibold">
                {fmtDayShort(date)}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setDate(addDays(date, 1))}
              hitSlop={8}
              accessibilityLabel="Next day"
              className="w-8 h-8 items-center justify-center">
              <Text className="text-ink-3 dark:text-ink-3-dk text-lg">›</Text>
            </Pressable>
          </View>
          <View className="flex-1 flex-row justify-end">
            {/* Beside the date on md+; a two-chip headerAction has no
                room here on phone widths, so it moves to its own row
                below instead (same hidden md:flex / md:hidden split as
                ClassesCalendar's month header). */}
            <View className="hidden md:flex md:flex-row md:gap-2">
              {headerAction ?? null}
            </View>
          </View>
        </View>

        {headerAction ? (
          <View className="md:hidden flex-row flex-wrap justify-center gap-2 pb-4 -mt-1">
            {headerAction}
          </View>
        ) : null}

        {activeBlock ? (
          <View className="flex-row items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 mb-4 -mt-1">
            <View
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: activeBlock.color }}
            />
            <Text className="flex-1 text-primary text-[13px] font-semibold">
              {blockStripText(activeBlock, fmtDateLocal(date))}
            </Text>
            {activeBlock.note ? (
              <Text
                className="text-ink-2 dark:text-ink-2-dk text-xs max-w-[45%]"
                numberOfLines={1}>
                {activeBlock.note}
              </Text>
            ) : null}
          </View>
        ) : null}

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
                    today ? 'text-primary' : 'text-ink-3 dark:text-ink-3-dk'
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
                          : 'text-ink dark:text-ink-dk'
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
        <View className="w-full max-w-5xl mx-auto px-2 gap-3">
          {memberScope ? (
            <PersonalCard
              title={memberScope.name}
              sections={personalDay?.sections ?? []}
              files={personalFiles}
              mode={mode}
              onEdit={() =>
                setOpenFor({
                  target: {
                    kind: 'member',
                    profileId: memberScope.profileId,
                    name: memberScope.name,
                  },
                  date,
                })
              }
            />
          ) : (
            <>
              {mode === 'view' &&
              (dayTypes.length > 0 ||
                (personalDay?.sections.length ?? 0) > 0) ? (
                <Pressable
                  onPress={() => setRecordingDate(date)}
                  className="bg-primary active:bg-primary-dark rounded-xl p-3 flex-row items-center gap-3">
                  <View className="w-9 h-9 rounded-full bg-white/20 items-center justify-center">
                    <Ionicons name="add" size={20} color="#FFFFFF" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white font-semibold text-sm">
                      Record results
                    </Text>
                    <Text className="text-white/80 text-xs">
                      Log how today's session went.
                    </Text>
                  </View>
                </Pressable>
              ) : null}
              {personalLocked && access ? (
                <LockedProgrammingCard
                  access={access}
                  gymId={membership?.gymId}
                />
              ) : null}
              {showPersonalCard ? (
                <PersonalCard
                  title="Individual programming"
                  sections={personalDay?.sections ?? []}
                  files={personalFiles}
                  mode="view"
                  repMaxLookup={showMyPercentages ? repMaxLookup : undefined}
                />
              ) : null}
              {dayTypes.length === 0 ? (
                !personalLocked && !showPersonalCard ? (
                  <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card">
                    <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                      No classes scheduled for this day.
                    </Text>
                  </View>
                ) : null
              ) : (
                dayTypes.map((t) => {
                  const prog = programmingByTypeId.get(t.id);
                  return (
                    <ClassTypeCard
                      key={t.id}
                      classType={t}
                      programmingId={prog?.id ?? null}
                      sections={prog?.sections ?? []}
                      mode={mode}
                      repMaxLookup={showMyPercentages ? repMaxLookup : undefined}
                      onEdit={() =>
                        setOpenFor({
                          target: { kind: 'classType', classType: t },
                          date,
                        })
                      }
                    />
                  );
                })
              )}
            </>
          )}
        </View>
      </ScrollView>

      <ProgrammingModal
        visible={openFor !== null}
        target={openFor?.target ?? null}
        date={openFor?.date ?? null}
        onClose={() => setOpenFor(null)}
      />

      <RecordWorkoutModal
        visible={recordingDate !== null}
        onClose={() => setRecordingDate(null)}
        initialDate={recordingDate ? fmtDateLocal(recordingDate) : undefined}
      />

      <MonthPickerModal
        visible={pickerOpen}
        month={pickerMonth}
        selected={date}
        weekStartsOn={weekStartsOn}
        onChangeMonth={(dir) =>
          setPickerMonth((m) => startOfMonth(addMonths(m, dir)))
        }
        onSelectDay={(day) => {
          setDate(startOfDay(day));
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

function ClassTypeCard({
  classType,
  programmingId,
  sections,
  mode,
  onEdit,
  repMaxLookup,
}: {
  classType: DayClassType;
  programmingId: string | null;
  sections: Section[];
  mode: 'manage' | 'view';
  onEdit: () => void;
  repMaxLookup?: RepMaxLookup;
}) {
  const [leaderboardOpenFor, setLeaderboardOpenFor] = useState<
    { sectionIndex: number; sectionTitle: string } | null
  >(null);
  const header = (
    <View className="flex-row items-center gap-3">
      <View
        style={{ backgroundColor: classType.color }}
        className="w-3 h-3 rounded-full"
      />
      <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
        {classType.name}
      </Text>
      {mode === 'manage' ? (
        <ChipButton
          label={sections.length === 0 ? 'Add' : 'Edit'}
          icon={sections.length === 0 ? 'add' : 'create-outline'}
        />
      ) : null}
    </View>
  );

  const body =
    sections.length === 0 ? (
      <Text className="text-ink-3 dark:text-ink-3-dk text-sm">
        {mode === 'manage'
          ? 'No programming yet — tap to add.'
          : 'No programming yet.'}
      </Text>
    ) : (
      <View className="gap-3">
        {sections.map((s, idx) => (
          <View key={idx} className="gap-1">
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
                {s.title}
              </Text>
              <View className="rounded-full bg-raised dark:bg-raised-dk px-2 py-0.5">
                <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] font-semibold uppercase tracking-wider">
                  {formatLabel(s.section_format)}
                </Text>
              </View>
            </View>
            <Text className="text-ink-2 dark:text-ink-2-dk">{s.body}</Text>
            {repMaxLookup ? (
              <PercentPrescriptionRow section={s} lookup={repMaxLookup} />
            ) : null}
            {s.leaderboard_enabled && programmingId ? (
              <ChipButton
                className="self-start mt-1"
                label="View leaderboard"
                icon="trophy"
                onPress={() =>
                  setLeaderboardOpenFor({
                    sectionIndex: idx,
                    sectionTitle: s.title,
                  })
                }
              />
            ) : null}
          </View>
        ))}
      </View>
    );

  if (mode === 'manage') {
    return (
      <>
        <Pressable
          onPress={onEdit}
          className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 active:bg-gray-50 dark:active:bg-gray-800 shadow-card">
          {header}
          {body}
        </Pressable>
        <ClassLeaderboardModal
          visible={leaderboardOpenFor !== null}
          programmingId={programmingId}
          sectionIndex={leaderboardOpenFor?.sectionIndex ?? null}
          sectionTitle={leaderboardOpenFor?.sectionTitle ?? ''}
          onClose={() => setLeaderboardOpenFor(null)}
        />
      </>
    );
  }

  return (
    <>
      <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
        {header}
        {body}
      </View>
      <ClassLeaderboardModal
        visible={leaderboardOpenFor !== null}
        programmingId={programmingId}
        sectionIndex={leaderboardOpenFor?.sectionIndex ?? null}
        sectionTitle={leaderboardOpenFor?.sectionTitle ?? ''}
        onClose={() => setLeaderboardOpenFor(null)}
      />
    </>
  );
}

// The individual-programming analogue of ClassTypeCard — same shell,
// brand-coloured dot, no leaderboards, plus the programme PDFs.
function PersonalCard({
  title,
  sections,
  files,
  mode,
  onEdit,
  repMaxLookup,
}: {
  title: string;
  sections: Section[];
  files: MemberProgrammingFile[];
  mode: 'manage' | 'view';
  onEdit?: () => void;
  repMaxLookup?: RepMaxLookup;
}) {
  const colors = useThemeColors();
  const openFile = useOpenProgrammingFile();

  const header = (
    <View className="flex-row items-center gap-3">
      <View
        style={{ backgroundColor: colors.primary }}
        className="w-3 h-3 rounded-full"
      />
      <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
        {title}
      </Text>
      {mode === 'manage' ? (
        <ChipButton
          label={sections.length === 0 ? 'Add' : 'Edit'}
          icon={sections.length === 0 ? 'add' : 'create-outline'}
        />
      ) : null}
    </View>
  );

  const body =
    sections.length === 0 ? (
      <Text className="text-ink-3 dark:text-ink-3-dk text-sm">
        {mode === 'manage'
          ? 'No programming yet — tap to add.'
          : 'Nothing programmed for this day.'}
      </Text>
    ) : (
      <View className="gap-3">
        {sections.map((s, idx) => (
          <View key={idx} className="gap-1">
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
                {s.title}
              </Text>
              <View className="rounded-full bg-raised dark:bg-raised-dk px-2 py-0.5">
                <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] font-semibold uppercase tracking-wider">
                  {formatLabel(s.section_format)}
                </Text>
              </View>
            </View>
            <Text className="text-ink-2 dark:text-ink-2-dk">{s.body}</Text>
            {repMaxLookup ? (
              <PercentPrescriptionRow section={s} lookup={repMaxLookup} />
            ) : null}
          </View>
        ))}
      </View>
    );

  const filesFooter =
    files.length === 0 ? null : (
      <View className="gap-1.5 border-t border-line dark:border-line-dk pt-3">
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-semibold uppercase tracking-wider">
          Programme documents
        </Text>
        {files.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => openFile.mutate(f.file_path)}
            className="flex-row items-center gap-2 py-1 active:opacity-70">
            <Ionicons
              name="document-text-outline"
              size={16}
              color={colors.ink2}
            />
            <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm">
              {f.title}
            </Text>
            <Ionicons name="open-outline" size={14} color={colors.ink3} />
          </Pressable>
        ))}
      </View>
    );

  if (mode === 'manage') {
    return (
      <Pressable
        onPress={onEdit}
        className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 active:bg-gray-50 dark:active:bg-gray-800 shadow-card">
        {header}
        {body}
        {filesFooter}
      </Pressable>
    );
  }

  return (
    <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
      {header}
      {body}
      {filesFooter}
    </View>
  );
}

// Shown instead of the personal card when the coach has written a
// programme but the member's access is paid and unpaid-for.
function LockedProgrammingCard({
  access,
  gymId,
}: {
  access: MyProgrammingAccess;
  gymId: string | undefined;
}) {
  const colors = useThemeColors();
  const currency = useGymCurrency();
  const checkout = useStartStoreCheckout(gymId);
  const [error, setError] = useState<string | null>(null);

  const buyLabel =
    access.product_id && access.product_price_cents != null
      ? `Unlock — ${formatMoney(access.product_price_cents, currency)}${
          access.product_recurring
            ? intervalSuffix(access.product_recurring_interval ?? 'month')
            : ''
        }`
      : null;

  return (
    <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
      <View className="flex-row items-center gap-3">
        <View
          style={{ backgroundColor: colors.primary }}
          className="w-3 h-3 rounded-full"
        />
        <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
          Individual programming
        </Text>
        <Ionicons name="lock-closed" size={16} color={colors.ink2} />
      </View>
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
        Your coach has written you a personal programme
        {access.product_name ? ` — ${access.product_name}` : ''}. Unlock it to
        see your training here.
      </Text>
      {buyLabel && access.product_active ? (
        <Button
          variant="primary"
          icon="cart-outline"
          loading={checkout.isPending}
          onPress={() => {
            setError(null);
            checkout.mutate([{ product_id: access.product_id!, quantity: 1 }], {
              onError: (e) =>
                setError(errorMessage(e, 'Could not start checkout')),
            });
          }}>
          {buyLabel}
        </Button>
      ) : null}
      {access.plan_upgrade_available ? (
        <ChipButton
          className="self-start"
          label="View memberships"
          icon="card-outline"
          onPress={() => router.push('/membership' as never)}
        />
      ) : null}
      {!buyLabel && !access.plan_upgrade_available ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          Ask at the front desk about access.
        </Text>
      ) : null}
      {buyLabel && !access.product_active ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          This programme's product isn't available right now — ask at the
          front desk.
        </Text>
      ) : null}
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
    </View>
  );
}
