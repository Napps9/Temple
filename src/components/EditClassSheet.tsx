import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ClassTypePicker } from '@/components/ClassTypePicker';
import { DatePicker } from '@/components/DatePicker';
import { DurationField } from '@/components/DurationField';
import { Input } from '@/components/Input';
import { FieldLabel } from '@/components/SectionLabel';
import { Sheet, SheetAction } from '@/components/Sheet';
import { useGymMembership } from '@/lib/auth';
import {
  buildEditArgs,
  describeEditResult,
  fmtEnds,
  fmtPattern,
  fmtSessionWhen,
  otherTimesNote,
  type EditDraft,
  type EditResult,
  type EditScope,
} from '@/lib/class-edit';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';

// Changing a class that already exists, from the class itself.
//
// The scope sits ABOVE the fields rather than beside the Save button,
// because it decides what is editable: only "Just this one" can move a
// class to another day, since a series' days are the pattern's
// days_of_week. Cancel asks the same question in the same words, and both
// read their pattern description from the same place.

type Props = {
  visible: boolean;
  sessionId: string;
  recurrenceId: string | null;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  classTypeId: string | null;
  classTypeName: string;
  coachId: string | null;
  location: string | null;
  notes: string | null;
  onClose: () => void;
  onSaved: () => void;
};

type Coach = { profile_id: string; name: string; avatar_url: string | null };

function isoDateInZone(iso: string, tz: string): string {
  // en-CA gives yyyy-mm-dd, which is what DatePicker and the ISO date
  // parsing in class-edit both expect.
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
}

function timeInZone(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function EditClassSheet({
  visible,
  sessionId,
  recurrenceId,
  startsAt,
  durationMinutes,
  capacity,
  classTypeId,
  classTypeName,
  coachId,
  location,
  notes,
  onClose,
  onSaved,
}: Props) {
  const queryClient = useQueryClient();
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId;
  const defaults = useGymOperatingDefaults();
  const tz = defaults.data?.timezone ?? 'UTC';

  const [scope, setScope] = useState<EditScope>('one');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);

  // Seeded once, from the class as it stands. Deliberately not re-seeded on
  // a refetch: a background refresh landing mid-edit would otherwise throw
  // away what the operator has typed.
  const original: EditDraft = {
    classTypeId: classTypeId ?? '',
    coachId,
    dateIso: isoDateInZone(startsAt, tz),
    time: timeInZone(startsAt, tz),
    duration: String(durationMinutes),
    capacity: String(capacity),
    location: location ?? '',
    notes: notes ?? '',
  };
  const [draft, setDraft] = useState<EditDraft>(original);
  const [seeded, setSeeded] = useState<string | null>(null);
  if (visible && seeded !== `${sessionId}:${tz}`) {
    setSeeded(`${sessionId}:${tz}`);
    setDraft(original);
    setScope('one');
    setError(null);
    setDone(null);
  }
  const set = (patch: Partial<EditDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // The draft already carries the class as it stood, so "has anything been
  // typed" is a field-wise comparison and nothing has to be remembered.
  const dirty = (Object.keys(original) as (keyof EditDraft)[]).some(
    (k) => draft[k] !== original[k],
  );

  // Owners and coaches only — set_session_coach's rule and user_can_cover's
  // before it: admins do not coach, so offering one is offering a choice
  // that fails.
  const coaches = useQuery({
    queryKey: ['class-edit-coaches', gymId],
    enabled: visible && !!gymId,
    queryFn: async (): Promise<Coach[]> => {
      const { data, error: e } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name, avatar_url)')
        .eq('gym_id', gymId!)
        .in('role', ['owner', 'coach'])
        .is('left_at', null);
      if (e) throw e;
      return ((data ?? []) as unknown as {
        profile_id: string;
        profiles: { full_name: string | null; avatar_url: string | null } | null;
      }[])
        .filter((r) => r.profiles?.full_name?.trim())
        .map((r) => ({
          profile_id: r.profile_id,
          name: r.profiles!.full_name!.trim(),
          avatar_url: r.profiles!.avatar_url ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const recurrence = useQuery({
    queryKey: ['class-edit-recurrence', recurrenceId],
    enabled: visible && !!recurrenceId,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('class_recurrences')
        .select('days_of_week, times, ends_on')
        .eq('id', recurrenceId!)
        .single();
      if (e) throw e;
      return data as {
        days_of_week: number[];
        times: string[];
        ends_on: string | null;
      };
    },
  });

  // How many classes each scope would touch, so the Save button can say
  // what it is about to do rather than leaving it to be discovered.
  const impact = useQuery({
    queryKey: ['class-edit-impact', sessionId, recurrenceId],
    enabled: visible,
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const [booked, fromCount, seriesCount] = await Promise.all([
        supabase
          .from('class_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('class_session_id', sessionId),
        recurrenceId
          ? supabase
              .from('class_sessions')
              .select('id', { count: 'exact', head: true })
              .eq('recurrence_id', recurrenceId)
              .gte('starts_at', `${isoDateInZone(startsAt, tz)}T00:00:00`)
              .gt('starts_at', nowIso)
          : Promise.resolve({ count: 1 } as { count: number | null }),
        recurrenceId
          ? supabase
              .from('class_sessions')
              .select('id', { count: 'exact', head: true })
              .eq('recurrence_id', recurrenceId)
              .gt('starts_at', nowIso)
          : Promise.resolve({ count: 1 } as { count: number | null }),
      ]);
      return {
        booked: booked.count ?? 0,
        from: fromCount.count ?? 1,
        series: seriesCount.count ?? 1,
      };
    },
  });

  const isRecurring = !!recurrenceId;
  const patternLabel = recurrence.data
    ? `${fmtPattern(recurrence.data.days_of_week, recurrence.data.times)}${fmtEnds(
        recurrence.data.ends_on,
      )}`
    : '…';
  const anchorDate = new Date(startsAt).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const seriesScope = scope !== 'one';
  const affected =
    scope === 'one' ? 1 : scope === 'from' ? impact.data?.from ?? 0 : impact.data?.series ?? 0;

  const shiftMinutes = (() => {
    const [oh, om] = original.time.split(':').map(Number);
    const [nh, nm] = draft.time.split(':').map(Number);
    if ([oh, om, nh, nm].some((n) => !Number.isFinite(n))) return 0;
    return nh * 60 + nm - (oh * 60 + om);
  })();
  const alsoMoves =
    seriesScope && recurrence.data
      ? otherTimesNote(recurrence.data.times, original.time, shiftMinutes)
      : null;

  const save = useMutation({
    mutationFn: async (): Promise<EditResult> => {
      const built = buildEditArgs({
        sessionId,
        scope,
        tz,
        original,
        draft,
        patternTimes: recurrence.data?.times,
      });
      if ('problem' in built) throw new Error(built.problem);
      const { data, error: e } = await supabase.rpc('edit_session_scoped', built.args);
      if (e) throw e;
      return data as EditResult;
    },
    onSuccess: (result) => {
      haptic.success();
      setError(null);
      setDone(describeEditResult(result));
      for (const key of [
        'class-sessions-month',
        'class-session-detail',
        'class-recurrences',
        'my-upcoming-sessions',
        'my-bookings',
        'my-next-booking',
        'coach-earnings',
        'class-edit-impact',
        'class-edit-recurrence',
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onSaved();
    },
    onError: (e) => {
      haptic.error();
      setDone(null);
      setError(errorMessage(e, 'Could not change the class'));
    },
  });

  function close() {
    if (save.isPending) return;
    setSeeded(null);
    onClose();
  }

  return (
    <Sheet
      visible={visible}
      title={`Edit ${classTypeName}`}
      subtitle={fmtSessionWhen(startsAt, durationMinutes)}
      onClose={close}
      busy={save.isPending}
      dirty={dirty && !done}
      size="standard"
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={close}>
              {done ? 'Done' : 'Cancel'}
            </Button>
          </SheetAction>
          {done ? null : (
            <SheetAction grow>
              <Button onPress={() => save.mutate()} loading={save.isPending}>
                {affected > 1 ? `Save ${affected} classes` : 'Save this class'}
              </Button>
            </SheetAction>
          )}
        </>
      }>
      <View className="gap-3">
        {done ? (
          <View className="gap-1.5">
            {done.map((line, i) => (
              <Text
                key={i}
                className={
                  i === 0
                    ? 'text-ink dark:text-ink-dk text-[14.5px] font-semibold'
                    : 'text-ink-2 dark:text-ink-2-dk text-[13.5px] leading-5'
                }>
                {line}
              </Text>
            ))}
          </View>
        ) : (
          <>
            <Text className="text-ink-2 dark:text-ink-2-dk text-[13.5px] leading-5">
              Members booked in keep their place, and are told if the time,
              length or coach changes.
            </Text>

            {isRecurring ? (
              <View className="gap-2">
                <ScopeOption
                  label="Just this one"
                  effect="The rest of the series keeps running"
                  detail={
                    impact.data
                      ? `${impact.data.booked} booking${
                          impact.data.booked === 1 ? '' : 's'
                        } on it`
                      : '…'
                  }
                  selected={scope === 'one'}
                  onPress={() => setScope('one')}
                />
                <ScopeOption
                  label="This and all future"
                  effect={`Classes before ${anchorDate} are left alone`}
                  detail={`${patternLabel}, from this date onward`}
                  selected={scope === 'from'}
                  onPress={() => setScope('from')}
                />
                <ScopeOption
                  label="The whole series"
                  effect="Past classes stay as they were; the schedule itself changes"
                  detail={patternLabel}
                  selected={scope === 'series'}
                  onPress={() => setScope('series')}
                />
              </View>
            ) : null}

            <ClassTypePicker
              value={draft.classTypeId || null}
              onChange={(id) => set({ classTypeId: id })}
            />

            <View className="gap-2">
              <FieldLabel>Coach</FieldLabel>
              <View className="flex-row flex-wrap gap-2">
                {(coaches.data ?? []).map((c) => {
                  const on = draft.coachId === c.profile_id;
                  return (
                    <Pressable
                      key={c.profile_id}
                      onPress={() => set({ coachId: c.profile_id })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      className={`h-9 flex-row items-center gap-2 rounded-full pl-1 pr-3 border ${
                        on
                          ? 'border-ink dark:border-ink-dk bg-raised dark:bg-raised-dk'
                          : 'border-line dark:border-line-dk'
                      }`}>
                      <Avatar name={c.name} avatarUrl={c.avatar_url} size={24} />
                      <Text className="text-ink dark:text-ink-dk text-[13px] font-medium">
                        {c.name}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => set({ coachId: null })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: !draft.coachId }}
                  className={`h-9 justify-center rounded-full px-3 border ${
                    !draft.coachId
                      ? 'border-ink dark:border-ink-dk bg-raised dark:bg-raised-dk'
                      : 'border-line dark:border-line-dk'
                  }`}>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-[13px] font-medium">
                    Nobody yet
                  </Text>
                </Pressable>
              </View>
            </View>

            <View className="gap-3 md:flex-row">
              <View className="flex-1">
                {seriesScope ? (
                  // A series keeps its days, so there is no date to pick —
                  // and a disabled field with a reason beats a field that
                  // silently refuses on save.
                  <View className="gap-1.5">
                    <FieldLabel>Date</FieldLabel>
                    <View className="rounded-ctl border border-dashed border-line-strong dark:border-line-strong-dk bg-raised dark:bg-raised-dk px-4 py-3">
                      <Text className="text-ink-3 dark:text-ink-3-dk text-base">
                        {recurrence.data
                          ? fmtPattern(recurrence.data.days_of_week, [])
                          : 'The series'}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <DatePicker
                    label="Date"
                    value={draft.dateIso}
                    onChange={(v) => set({ dateIso: v })}
                  />
                )}
              </View>
              <View className="flex-1">
                <Input
                  label="Start time"
                  value={draft.time}
                  onChangeText={(v) => set({ time: v })}
                  placeholder="06:30"
                />
              </View>
            </View>

            {seriesScope ? (
              <Text className="text-ink-3 dark:text-ink-3-dk text-[12px] leading-4">
                A series keeps its days. To move one class to another day,
                choose “Just this one”.
              </Text>
            ) : null}
            {alsoMoves ? (
              <Text className="text-amber-700 dark:text-amber-500 text-[12.5px] leading-4">
                {alsoMoves}
              </Text>
            ) : null}

            <View className="gap-3 md:flex-row">
              <View className="flex-1">
                <DurationField
                  label="Length"
                  value={draft.duration}
                  onChange={(v) => set({ duration: v })}
                  base="minutes"
                  units={['minutes', 'hours']}
                />
              </View>
              <View className="flex-1">
                <Input
                  label="Capacity"
                  value={draft.capacity}
                  onChangeText={(v) => set({ capacity: v })}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <Input
              label="Room (optional)"
              value={draft.location}
              onChangeText={(v) => set({ location: v })}
            />

            <Input
              label="Notes (optional)"
              value={draft.notes}
              onChangeText={(v) => set({ notes: v })}
              multiline
            />

            {error ? (
              <Text
                accessibilityLiveRegion="polite"
                className="text-red-500 dark:text-red-400 text-[13px]">
                {error}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </Sheet>
  );
}

function ScopeOption({
  label,
  effect,
  detail,
  selected,
  onPress,
}: {
  label: string;
  effect: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`rounded-ctl p-3 border ${
        selected
          ? 'border-ink dark:border-ink-dk bg-raised dark:bg-raised-dk'
          : 'border-line dark:border-line-dk'
      }`}>
      <View className="flex-row items-center gap-2">
        <View
          className={`w-[18px] h-[18px] rounded-full border-[1.5px] ${
            selected
              ? 'border-ink dark:border-ink-dk border-[6px]'
              : 'border-line-strong dark:border-line-strong-dk'
          }`}
        />
        <Text className="text-ink dark:text-ink-dk text-[14px] font-semibold">
          {label}
        </Text>
      </View>
      <Text className="text-ink-2 dark:text-ink-2-dk text-[12.5px] mt-1 ml-[26px] leading-4">
        {effect}
      </Text>
      <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px] mt-0.5 ml-[26px]">
        {detail}
      </Text>
    </Pressable>
  );
}
