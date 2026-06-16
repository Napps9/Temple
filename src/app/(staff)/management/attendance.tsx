import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AttendanceChart } from '@/components/AttendanceChart';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { DatePicker } from '@/components/DatePicker';
import { Screen } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { BackLink } from '@/components/BackLink';
import { useGymMembership } from '@/lib/auth';
import { useClassTypes } from '@/lib/useClassCatalog';
import {
  bucketByClassType,
  bucketByDay,
  type AttendanceBooking,
  type AttendanceSession,
} from '@/lib/attendance';
import { useExportAttendanceCsv, exportErrorMessage } from '@/lib/csv-exports';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start: iso(start), end: iso(end) };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AttendanceScreen() {
  const { data: membership } = useGymMembership();
  const [range, setRange] = useState(defaultRange);
  const [error, setError] = useState<string | null>(null);
  const canViewAttendance = useCan('can_view_attendance');
  const canExport = useCan('can_export_members') ?? false;
  const exportAttendance = useExportAttendanceCsv();

  const rangeValid =
    DATE_RE.test(range.start) && DATE_RE.test(range.end) && range.start <= range.end;

  const sessionsQuery = useQuery({
    queryKey: ['attendance-sessions', membership?.gymId, range.start, range.end],
    enabled: !!membership?.gymId && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select('id, class_type_id, starts_at')
        .gte('starts_at', `${range.start}T00:00:00Z`)
        .lte('starts_at', `${range.end}T23:59:59Z`);
      if (error) throw error;
      return (data ?? []) as AttendanceSession[];
    },
  });

  const sessionIds = useMemo(
    () => (sessionsQuery.data ?? []).map((s) => s.id),
    [sessionsQuery.data],
  );

  const bookingsQuery = useQuery({
    queryKey: ['attendance-bookings', membership?.gymId, sessionIds.join(',')],
    enabled: !!membership?.gymId && sessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select('class_session_id, attended_at, no_show')
        .in('class_session_id', sessionIds);
      if (error) throw error;
      return (data ?? []) as AttendanceBooking[];
    },
  });

  // Shared canonical query (see useClassCatalog). Archived types stay
  // included — historical attendance still needs their names.
  const classTypesQuery = useClassTypes();

  const sessions = sessionsQuery.data ?? [];
  const bookings = bookingsQuery.data ?? [];
  const classTypes = classTypesQuery.data ?? [];

  const dayBuckets = useMemo(
    () => bucketByDay(bookings, sessions, { start: range.start, end: range.end }),
    [bookings, sessions, range.start, range.end],
  );

  const typeBuckets = useMemo(
    () => bucketByClassType(bookings, sessions),
    [bookings, sessions],
  );

  const totals = useMemo(() => {
    return typeBuckets.reduce(
      (acc, b) => ({
        attended: acc.attended + b.attended,
        no_show: acc.no_show + b.no_show,
        unmarked: acc.unmarked + b.unmarked,
      }),
      { attended: 0, no_show: 0, unmarked: 0 },
    );
  }, [typeBuckets]);

  if (canViewAttendance === false) {
    return <Redirect href="/management" />;
  }

  const loading = sessionsQuery.isLoading || bookingsQuery.isLoading;
  const queryError = sessionsQuery.error ?? bookingsQuery.error;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-3xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Attendance
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Trends from check-ins recorded on class bookings.
          </Text>
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <DatePicker
              label="From"
              value={range.start}
              onChange={(v) => {
                setError(null);
                setRange((r) => ({ ...r, start: v }));
              }}
            />
          </View>
          <View className="flex-1">
            <DatePicker
              label="To"
              value={range.end}
              onChange={(v) => {
                setError(null);
                setRange((r) => ({ ...r, end: v }));
              }}
            />
          </View>
        </View>

        {canExport ? (
          <View className="gap-2">
            <ChipButton
              className="self-start"
              label={exportAttendance.isPending ? 'Exporting…' : 'Export attendance CSV'}
              icon="download-outline"
              tone="neutral"
              onPress={() => exportAttendance.mutate()}
              disabled={exportAttendance.isPending}
            />
            {exportAttendance.error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {exportErrorMessage(exportAttendance.error, 'attendance')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {!rangeValid ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            Pick valid dates with From on or before To.
          </Text>
        ) : null}

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        {queryError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(queryError, 'Could not load attendance data')}
          </Text>
        ) : null}

        <View className="flex-row gap-3 flex-wrap">
          <StatTile title="Attended" value={totals.attended} tone="green" minWidth={120} />
          <StatTile title="No-show" value={totals.no_show} tone="red" minWidth={120} />
          <StatTile title="Unmarked" value={totals.unmarked} tone="muted" minWidth={120} />
        </View>

        <View className="gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Attended per day
          </Text>
          <AttendanceChart
            data={dayBuckets.map((d) => ({ label: d.day.slice(5), value: d.attended }))}
          />
          <View className="gap-1">
            {dayBuckets.length === 0 ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                {loading ? 'Loading…' : 'No attendance recorded in this range.'}
              </Text>
            ) : (
              dayBuckets.map((d) => (
                <View key={d.day} className="flex-row justify-between">
                  <Text className="text-gray-900 dark:text-gray-50">{d.day}</Text>
                  <Text className="text-gray-500 dark:text-gray-400">{d.attended}</Text>
                </View>
              ))
            )}
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            By class type
          </Text>
          {typeBuckets.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              {loading ? 'Loading…' : 'No bookings to bucket.'}
            </Text>
          ) : (
            typeBuckets.map((b) => {
              const typeName =
                classTypes.find((t) => t.id === b.class_type_id)?.name ??
                (b.class_type_id ? 'Untyped class' : 'Open gym');
              return (
                <View
                  key={`${b.class_type_id ?? 'open'}`}
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1">
                  <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                    {typeName}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    Attended {b.attended} · No-show {b.no_show} · Unmarked {b.unmarked}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

