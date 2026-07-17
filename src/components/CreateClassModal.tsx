import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ClassTypePicker } from '@/components/ClassTypePicker';
import { DatePicker } from '@/components/DatePicker';
import { DurationField } from '@/components/DurationField';
import { Input } from '@/components/Input';
import {
  EMPTY_RECURRENCE,
  RecurrenceEditor,
  type RecurrenceForm,
  validateRecurrence,
  weekPosition,
} from '@/components/RecurrenceEditor';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';
import { useClassTypes } from '@/lib/useClassCatalog';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Fallback when the gym defaults query hasn't resolved yet. Matches
// the SQL default in 0049; live value comes from gymDefaults.
const HORIZON_WEEKS_FALLBACK = 12;

function fmtDateLocal(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getDate()
    .toString()
    .padStart(2, '0')}`;
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function fmtTime(h: number, m: number) {
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function defaultTimeFor(hour: number | undefined) {
  if (hour !== undefined) return fmtTime(hour, 0);
  const now = new Date();
  const next = now.getMinutes() > 0 ? now.getHours() + 1 : now.getHours();
  return fmtTime(next % 24, 0);
}

export function CreateClassModal({
  visible,
  defaultDate,
  defaultHour,
  onClose,
  onCreated,
}: {
  visible: boolean;
  defaultDate?: Date;
  defaultHour?: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: membership } = useGymMembership();
  const { data: gymDefaults } = useGymOperatingDefaults();
  const [classTypeId, setClassTypeId] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceForm>(EMPTY_RECURRENCE);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'form' | 'confirm'>('form');

  // Shared canonical query (see useClassCatalog); archived types can't
  // be scheduled.
  const allTypesQuery = useClassTypes();
  const typesQuery = {
    ...allTypesQuery,
    data: allTypesQuery.data?.filter((t) => t.archived_at === null),
  };
  const selectedType = typesQuery.data?.find((t) => t.id === classTypeId);

  useEffect(() => {
    if (!visible) return;
    const d = defaultDate ?? new Date();
    setClassTypeId(null);
    setDateStr(fmtDate(d));
    setTimeStr(defaultTimeFor(defaultHour));
    setRecurring(false);
    setRecurrence({
      ...EMPTY_RECURRENCE,
      indefinite: false,
      capacity: String(gymDefaults?.default_class_capacity ?? 12),
      durationMinutes: String(gymDefaults?.default_class_minutes ?? 60),
    });
    setNotes('');
    setError(null);
    setStage('form');
  }, [
    visible,
    defaultDate,
    defaultHour,
    gymDefaults?.default_class_capacity,
    gymDefaults?.default_class_minutes,
  ]);

  function validate(): string | null {
    if (!classTypeId) return 'Pick a class type';
    if (!DATE_RE.test(dateStr)) return 'Pick a date';
    if (recurring) {
      return validateRecurrence(recurrence);
    }
    const dur = parseInt(recurrence.durationMinutes, 10);
    const cap = parseInt(recurrence.capacity, 10);
    if (!Number.isFinite(dur) || dur <= 0) {
      return 'Duration must be a positive number of minutes';
    }
    if (!Number.isFinite(cap) || cap <= 0) {
      return 'Capacity must be a positive number';
    }
    if (!TIME_RE.test(timeStr)) return 'Time must be HH:MM (24-hour)';
    return null;
  }

  function sessionsInHorizon(): number {
    if (!recurring) return 1;
    const validTimes = recurrence.times
      .map((t) => t.trim())
      .filter((t) => TIME_RE.test(t));
    if (validTimes.length === 0 || recurrence.days.length === 0) return 0;
    const [y, mo, day] = dateStr.split('-').map(Number);
    if (!y || !mo || !day) return 0;
    const start = new Date(y, mo - 1, day);
    start.setHours(0, 0, 0, 0);
    const horizon = new Date();
    horizon.setHours(0, 0, 0, 0);
    horizon.setDate(
      horizon.getDate() +
        (gymDefaults?.materialisation_horizon_weeks ?? HORIZON_WEEKS_FALLBACK) *
          7,
    );
    let end = horizon;
    if (!recurrence.indefinite) {
      const w = parseInt(recurrence.weeks, 10);
      const finiteEnd = new Date(start);
      finiteEnd.setDate(finiteEnd.getDate() + w * 7 - 1);
      if (finiteEnd < end) end = finiteEnd;
    }
    const daysSet = new Set(recurrence.days);
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      if (daysSet.has(cursor.getDay())) count += validTimes.length;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }

  function onReview() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStage('confirm');
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      if (!classTypeId) throw new Error('Pick a class type');
      if (!DATE_RE.test(dateStr)) throw new Error('Pick a date');

      const dur = parseInt(recurrence.durationMinutes, 10);
      const cap = parseInt(recurrence.capacity, 10);
      if (!Number.isFinite(dur) || dur <= 0) {
        throw new Error('Duration must be a positive number of minutes');
      }
      if (!Number.isFinite(cap) || cap <= 0) {
        throw new Error('Capacity must be a positive number');
      }

      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) throw userErr ?? new Error('Not signed in');
      const userId = userResp.user.id;

      const [y, mo, day] = dateStr.split('-').map(Number);

      if (recurring) {
        const recErrMsg = validateRecurrence(recurrence);
        if (recErrMsg) throw new Error(recErrMsg);
        const validTimes = recurrence.times.map((t) => t.trim()).filter(Boolean);

        let endsOn: string | null = null;
        if (!recurrence.indefinite) {
          const w = parseInt(recurrence.weeks, 10);
          const endDate = new Date(y, mo - 1, day);
          endDate.setDate(endDate.getDate() + w * 7 - 1);
          endsOn = fmtDateLocal(endDate);
        }

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

        const { data: rec, error: recErr } = await supabase
          .from('class_recurrences')
          .insert({
            gym_id: membership.gymId,
            class_type_id: classTypeId,
            days_of_week: recurrence.days,
            times: validTimes,
            duration_minutes: dur,
            capacity: cap,
            notes: notes.trim() || null,
            starts_on: dateStr,
            ends_on: endsOn,
            tz,
            created_by: userId,
          })
          .select('id')
          .single();
        if (recErr || !rec) throw recErr ?? new Error('Could not save recurrence');

        // Materialise the first horizon (gym setting weeks ahead of today,
        // capped by ends_on).
        const horizon = new Date();
        horizon.setDate(
          horizon.getDate() +
            (gymDefaults?.materialisation_horizon_weeks ??
              HORIZON_WEEKS_FALLBACK) *
              7,
        );
        const targetEnd =
          endsOn && new Date(endsOn) < horizon ? endsOn : fmtDateLocal(horizon);

        const { error: extErr } = await supabase.rpc('extend_recurrence', {
          rec_id: rec.id,
          until_date: targetEnd,
        });
        if (extErr) throw extErr;
      } else {
        if (!TIME_RE.test(timeStr)) throw new Error('Time must be HH:MM (24-hour)');
        const [h, mi] = timeStr.split(':').map(Number);
        const startsAt = new Date(y, mo - 1, day, h, mi, 0, 0);

        const { data: typeRow, error: typeErr } = await supabase
          .from('class_types')
          .select('name')
          .eq('id', classTypeId)
          .single();
        if (typeErr || !typeRow) throw typeErr ?? new Error('Class type not found');

        const { error } = await supabase.from('class_sessions').insert({
          gym_id: membership.gymId,
          name: typeRow.name,
          class_type_id: classTypeId,
          starts_at: startsAt.toISOString(),
          duration_minutes: dur,
          capacity: cap,
          notes: notes.trim() || null,
          coach_id: userId,
          created_by: userId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      haptic.success();
      setError(null);
      onCreated();
    },
    onError: (e) => {
      haptic.error();
      setError(errorMessage(e, 'Could not create class'));
    },
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <View className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-5">
          <View className="gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
              {stage === 'form' ? 'New class' : 'Ready to schedule?'}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              {stage === 'form'
                ? 'Pick a date and time, or have it repeat.'
                : 'Have a quick look — tap Edit if anything needs changing.'}
            </Text>
          </View>

          {stage === 'form' ? (
          <ScrollView className="max-h-[36rem]">
            <View className="gap-4">
              <ClassTypePicker value={classTypeId} onChange={setClassTypeId} />

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <DatePicker
                    label={recurring ? 'Start date' : 'Date'}
                    value={dateStr}
                    onChange={setDateStr}
                  />
                </View>
                {!recurring ? (
                  <View className="flex-1">
                    <Input
                      label="Start time"
                      value={timeStr}
                      onChangeText={setTimeStr}
                      placeholder="06:30"
                    />
                  </View>
                ) : null}
              </View>

              <Pressable
                onPress={() => setRecurring(!recurring)}
                className="flex-row items-center gap-2">
                <View
                  className={`w-5 h-5 rounded border-2 items-center justify-center ${
                    recurring
                      ? 'border-primary bg-primary'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                  {recurring ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                </View>
                <Text className="text-gray-900 dark:text-gray-50">Recurring</Text>
              </Pressable>

              {recurring ? (
                <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
              ) : (
                <>
                  <DurationField
                    label="Duration"
                    value={recurrence.durationMinutes}
                    onChange={(v) =>
                      setRecurrence({ ...recurrence, durationMinutes: v })
                    }
                    base="minutes"
                    units={['minutes', 'hours']}
                  />
                  <Input
                    label="Capacity"
                    value={recurrence.capacity}
                    onChangeText={(v) =>
                      setRecurrence({ ...recurrence, capacity: v })
                    }
                    keyboardType="numeric"
                  />
                </>
              )}

              <Input
                label="Notes (optional)"
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </View>
          </ScrollView>
          ) : (
            <ConfirmView
              selectedType={selectedType}
              dateStr={dateStr}
              timeStr={timeStr}
              recurring={recurring}
              days={new Set(recurrence.days)}
              times={recurrence.times}
              indefinite={recurrence.indefinite}
              weeks={recurrence.weeks}
              durationMinutes={recurrence.durationMinutes}
              capacity={recurrence.capacity}
              notes={notes}
              sessionCount={sessionsInHorizon()}
            />
          )}

          {error ? <Text className="text-red-500 text-sm">{error}</Text> : null}

          {stage === 'form' ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" onPress={onClose}>
                  Cancel
                </Button>
              </View>
              <View className="flex-1">
                <Button onPress={onReview}>Review</Button>
              </View>
            </View>
          ) : (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" onPress={() => setStage('form')}>
                  Edit
                </Button>
              </View>
              <View className="flex-1">
                <Button onPress={() => create.mutate()} loading={create.isPending}>
                  Confirm
                </Button>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ConfirmView({
  selectedType,
  dateStr,
  timeStr,
  recurring,
  days,
  times,
  indefinite,
  weeks,
  durationMinutes,
  capacity,
  notes,
  sessionCount,
}: {
  selectedType: { name: string; color: string } | undefined;
  dateStr: string;
  timeStr: string;
  recurring: boolean;
  days: Set<number>;
  times: string[];
  indefinite: boolean;
  weeks: string;
  durationMinutes: string;
  capacity: string;
  notes: string;
  sessionCount: number;
}) {
  const { data: gymDefaults } = useGymOperatingDefaults();
  const weekStartsOn = gymDefaults?.week_starts_on ?? 'mon';

  const [y, mo, day] = dateStr.split('-').map(Number);
  const dateObj = y && mo && day ? new Date(y, mo - 1, day) : null;
  const dateLabel = dateObj
    ? dateObj.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : dateStr;

  const daysList = [...days]
    .sort(
      (a, b) => weekPosition(a, weekStartsOn) - weekPosition(b, weekStartsOn),
    )
    .map((i) => DAY_NAMES[i])
    .join(', ');

  const timesList = times
    .map((t) => t.trim())
    .filter((t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t))
    .join(', ');

  return (
    <ScrollView className="max-h-[36rem]">
      <View className="gap-5">
        <ConfirmRow label="Type">
          <View className="flex-row items-center gap-2">
            {selectedType ? (
              <View
                style={{ backgroundColor: selectedType.color }}
                className="w-3 h-3 rounded-full"
              />
            ) : null}
            <Text className="text-gray-900 dark:text-gray-50 text-base font-medium">
              {selectedType?.name ?? 'Unknown'}
            </Text>
          </View>
        </ConfirmRow>

        {recurring ? (
          <ConfirmRow label="Repeats">
            <Text className="text-gray-900 dark:text-gray-50">
              {daysList || '—'} at {timesList || '—'}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Starting {dateLabel}
              {indefinite
                ? ''
                : ` · for ${weeks} ${weeks === '1' ? 'week' : 'weeks'}`}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {indefinite
                ? `We'll add ${sessionCount} ${
                    sessionCount === 1 ? 'class' : 'classes'
                  } to your calendar over the next 12 weeks. More are added automatically as time goes on.`
                : `We'll add ${sessionCount} ${
                    sessionCount === 1 ? 'class' : 'classes'
                  } to your calendar.`}
            </Text>
          </ConfirmRow>
        ) : (
          <ConfirmRow label="When">
            <Text className="text-gray-900 dark:text-gray-50">
              {dateLabel} at {timeStr}
            </Text>
          </ConfirmRow>
        )}

        <ConfirmRow label="Duration · Capacity">
          <Text className="text-gray-900 dark:text-gray-50">
            {durationMinutes} min · {capacity} spot{capacity === '1' ? '' : 's'}
          </Text>
        </ConfirmRow>

        {notes.trim() ? (
          <ConfirmRow label="Notes">
            <Text className="text-gray-900 dark:text-gray-50">{notes.trim()}</Text>
          </ConfirmRow>
        ) : null}
      </View>
    </ScrollView>
  );
}

function ConfirmRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1">
      <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
        {label}
      </Text>
      {children}
    </View>
  );
}
