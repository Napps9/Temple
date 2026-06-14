import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ColorSwatchPicker, PALETTE } from '@/components/ColorSwatchPicker';
import { DurationField, formatBaseDuration } from '@/components/DurationField';
import { Input } from '@/components/Input';
import {
  EMPTY_RECURRENCE,
  RecurrenceEditor,
  type RecurrenceForm,
  summariseRecurrence,
  validateRecurrence,
} from '@/components/RecurrenceEditor';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import {
  useClassRecurrences,
  useClassTypes,
  type RecurrenceRow,
} from '@/lib/useClassCatalog';
import { useSavedFlag } from '@/lib/useSavedFlag';

const HORIZON_WEEKS = 12;

type EditableType = {
  id: string | null;
  name: string;
  color: string;
  archivedAt: string | null;
  scheduleOpen: boolean;
  recurrenceId: string | null;
  recurrence: RecurrenceForm;
  rulesOpen: boolean;
  // String-backed so an empty input maps cleanly to NULL = inherit
  // the gym default. The save path parses to integer.
  bookingWindowHoursAhead: string;
  bookingCutoffMinutesBefore: string;
  cancelCutoffMinutesBefore: string;
};

function fmtDateLocal(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function recurrenceFromServer(r: RecurrenceRow): RecurrenceForm {
  const indefinite = r.ends_on === null;
  let weeks = '4';
  if (!indefinite && r.ends_on) {
    const start = new Date(r.starts_on);
    const end = new Date(r.ends_on);
    const days =
      Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    weeks = Math.max(1, Math.round(days / 7)).toString();
  }
  return {
    days: r.days_of_week,
    times: r.times,
    durationMinutes: r.duration_minutes.toString(),
    capacity: r.capacity.toString(),
    indefinite,
    weeks,
  };
}

export function ClassTypesPanel() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditableType[]>([]);
  const [openPickerIdx, setOpenPickerIdx] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const canArchive = useCan('can_archive_classes') ?? false;
  const canHardDelete = useCan('can_hard_delete') ?? false;

  // Shared canonical queries — see useClassCatalog for why these must
  // not be redefined inline (queryKey collisions made this editor flash).
  const types = useClassTypes();
  const recurrences = useClassRecurrences();

  const dependents = useQuery({
    queryKey: ['class-type-dependents', membership?.gymId, types.data?.map((t) => t.id).join(',')],
    enabled: !!types.data && types.data.length > 0,
    queryFn: async () => {
      const ids = types.data!.map((t) => t.id);
      const results = await Promise.all(
        ids.map((id) =>
          supabase.rpc('class_type_has_dependents', { p_id: id }),
        ),
      );
      const map = new Map<string, boolean>();
      for (let i = 0; i < ids.length; i++) {
        map.set(ids[i], !!results[i].data);
      }
      return map;
    },
  });

  useEffect(() => {
    if (!types.data || !recurrences.data) return;
    const recByTypeId = new Map<string, RecurrenceRow>();
    for (const r of recurrences.data) {
      if (!recByTypeId.has(r.class_type_id)) recByTypeId.set(r.class_type_id, r);
    }
    setRows(
      types.data.map((t) => {
        const rec = recByTypeId.get(t.id);
        return {
          id: t.id,
          name: t.name,
          color: t.color,
          archivedAt: t.archived_at,
          scheduleOpen: false,
          recurrenceId: rec?.id ?? null,
          recurrence: rec
            ? recurrenceFromServer(rec)
            : { ...EMPTY_RECURRENCE, indefinite: true },
          rulesOpen: false,
          bookingWindowHoursAhead:
            t.booking_window_hours_ahead === null
              ? ''
              : String(t.booking_window_hours_ahead),
          bookingCutoffMinutesBefore:
            t.booking_cutoff_minutes_before === null
              ? ''
              : String(t.booking_cutoff_minutes_before),
          cancelCutoffMinutesBefore:
            t.cancel_cutoff_minutes_before === null
              ? ''
              : String(t.cancel_cutoff_minutes_before),
        };
      }),
    );
  }, [types.data, recurrences.data]);

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('archive_class_type', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['class-types'] });
      queryClient.invalidateQueries({ queryKey: ['class-recurrences'] });
    },
    onError: (e) => setActionError(errorMessage(e, 'Could not archive')),
  });

  const restore = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('restore_class_type', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['class-types'] });
    },
    onError: (e) => setActionError(errorMessage(e, 'Could not restore')),
  });

  const hardDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_class_type', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['class-types'] });
      queryClient.invalidateQueries({ queryKey: ['class-recurrences'] });
    },
    onError: (e) => setActionError(errorMessage(e, 'Could not delete')),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) throw userErr ?? new Error('Not signed in');
      const userId = userResp.user.id;

      const server = types.data ?? [];
      const serverById = new Map(server.map((t) => [t.id, t]));

      type Insert = {
        localIdx: number;
        name: string;
        color: string;
        booking_window_hours_ahead: number | null;
        booking_cutoff_minutes_before: number | null;
        cancel_cutoff_minutes_before: number | null;
      };
      type Update = {
        id: string;
        name: string;
        color: string;
        booking_window_hours_ahead: number | null;
        booking_cutoff_minutes_before: number | null;
        cancel_cutoff_minutes_before: number | null;
      };
      const inserts: Insert[] = [];
      const updates: Update[] = [];

      function nullableInt(v: string): number | null {
        const t = v.trim();
        if (t === '') return null;
        const n = parseInt(t, 10);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error('Booking-rule values must be non-negative whole numbers');
        }
        return n;
      }

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = r.name.trim();
        const rules = {
          booking_window_hours_ahead: nullableInt(r.bookingWindowHoursAhead),
          booking_cutoff_minutes_before: nullableInt(r.bookingCutoffMinutesBefore),
          cancel_cutoff_minutes_before: nullableInt(r.cancelCutoffMinutesBefore),
        };
        if (r.id === null) {
          if (!name) throw new Error('Each type needs a name');
          inserts.push({ localIdx: i, name, color: r.color, ...rules });
          continue;
        }
        if (r.archivedAt) continue;
        if (!name) throw new Error('Each type needs a name');
        const sv = serverById.get(r.id);
        const changed =
          sv &&
          (sv.name !== name ||
            sv.color !== r.color ||
            sv.booking_window_hours_ahead !== rules.booking_window_hours_ahead ||
            sv.booking_cutoff_minutes_before !==
              rules.booking_cutoff_minutes_before ||
            sv.cancel_cutoff_minutes_before !==
              rules.cancel_cutoff_minutes_before);
        if (changed) {
          updates.push({ id: r.id, name, color: r.color, ...rules });
        }
      }

      const newIdByLocalIdx = new Map<number, string>();
      if (inserts.length > 0) {
        const { data, error } = await supabase
          .from('class_types')
          .insert(
            inserts.map((i) => ({
              gym_id: membership.gymId,
              name: i.name,
              color: i.color,
              booking_window_hours_ahead: i.booking_window_hours_ahead,
              booking_cutoff_minutes_before: i.booking_cutoff_minutes_before,
              cancel_cutoff_minutes_before: i.cancel_cutoff_minutes_before,
            })),
          )
          .select('id');
        if (error) throw error;
        if (!data || data.length !== inserts.length) {
          throw new Error('Insert mismatch');
        }
        for (let k = 0; k < inserts.length; k++) {
          newIdByLocalIdx.set(inserts[k].localIdx, data[k].id);
        }
      }
      for (const u of updates) {
        const { error } = await supabase
          .from('class_types')
          .update({
            name: u.name,
            color: u.color,
            booking_window_hours_ahead: u.booking_window_hours_ahead,
            booking_cutoff_minutes_before: u.booking_cutoff_minutes_before,
            cancel_cutoff_minutes_before: u.cancel_cutoff_minutes_before,
          })
          .eq('id', u.id);
        if (error) throw error;
      }

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.archivedAt) continue;
        const classTypeId = r.id ?? newIdByLocalIdx.get(i);
        if (!classTypeId) continue;

        const wantsSchedule = r.recurrence.days.length > 0;

        if (!wantsSchedule) {
          if (r.recurrenceId) {
            const { error: delErr } = await supabase
              .from('class_recurrences')
              .delete()
              .eq('id', r.recurrenceId);
            if (delErr) throw delErr;
          }
          continue;
        }

        const errMsg = validateRecurrence(r.recurrence);
        if (errMsg) throw new Error(`${r.name}: ${errMsg}`);

        const validTimes = r.recurrence.times
          .map((t) => t.trim())
          .filter(Boolean);
        const dur = parseInt(r.recurrence.durationMinutes, 10);
        const cap = parseInt(r.recurrence.capacity, 10);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = fmtDateLocal(today);

        let endsOn: string | null = null;
        if (!r.recurrence.indefinite) {
          const w = parseInt(r.recurrence.weeks, 10);
          const endDate = new Date(today);
          endDate.setDate(endDate.getDate() + w * 7 - 1);
          endsOn = fmtDateLocal(endDate);
        }

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

        let recId: string;
        if (r.recurrenceId) {
          const nowIso = new Date().toISOString();
          const { error: sessDelErr } = await supabase
            .from('class_sessions')
            .delete()
            .eq('recurrence_id', r.recurrenceId)
            .gte('starts_at', nowIso);
          if (sessDelErr) throw sessDelErr;

          const { error: updErr } = await supabase
            .from('class_recurrences')
            .update({
              days_of_week: r.recurrence.days,
              times: validTimes,
              duration_minutes: dur,
              capacity: cap,
              ends_on: endsOn,
              tz,
              materialized_until: todayStr,
            })
            .eq('id', r.recurrenceId);
          if (updErr) throw updErr;
          recId = r.recurrenceId;
        } else {
          const { data, error: insErr } = await supabase
            .from('class_recurrences')
            .insert({
              gym_id: membership.gymId,
              class_type_id: classTypeId,
              days_of_week: r.recurrence.days,
              times: validTimes,
              duration_minutes: dur,
              capacity: cap,
              notes: null,
              starts_on: todayStr,
              ends_on: endsOn,
              tz,
              created_by: userId,
            })
            .select('id')
            .single();
          if (insErr || !data) {
            throw insErr ?? new Error('Could not save recurrence');
          }
          recId = data.id;
        }

        const horizon = new Date();
        horizon.setDate(horizon.getDate() + HORIZON_WEEKS * 7);
        const targetEnd =
          endsOn && new Date(endsOn) < horizon ? endsOn : fmtDateLocal(horizon);

        const { error: extErr } = await supabase.rpc('extend_recurrence', {
          rec_id: recId,
          until_date: targetEnd,
        });
        if (extErr) throw extErr;
      }
    },
    onSuccess: () => {
      setError(null);
      setOpenPickerIdx(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['class-types'] });
      queryClient.invalidateQueries({ queryKey: ['class-recurrences'] });
      queryClient.invalidateQueries({ queryKey: ['class-sessions-month'] });
      queryClient.invalidateQueries({ queryKey: ['class-programming-month'] });
    },
    onError: (e) => setError(errorMessage(e, 'Save failed')),
  });

  function addRow() {
    const usedColors = new Set(rows.map((r) => r.color.toUpperCase()));
    const next =
      PALETTE.find((c) => !usedColors.has(c.hex.toUpperCase())) ?? PALETTE[0];
    setRows([
      ...rows,
      {
        id: null,
        name: '',
        color: next.hex,
        archivedAt: null,
        scheduleOpen: true,
        recurrenceId: null,
        recurrence: { ...EMPTY_RECURRENCE, indefinite: true },
        rulesOpen: false,
        bookingWindowHoursAhead: '',
        bookingCutoffMinutesBefore: '',
        cancelCutoffMinutesBefore: '',
      },
    ]);
  }

  function updateRow(idx: number, patch: Partial<EditableType>) {
    setRows((curr) => curr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const activeRows = useMemo(
    () => rows.map((r, idx) => ({ row: r, idx })).filter(({ row }) => !row.archivedAt),
    [rows],
  );
  const archivedRows = useMemo(
    () => rows.map((r, idx) => ({ row: r, idx })).filter(({ row }) => !!row.archivedAt),
    [rows],
  );

  function hasDeps(id: string | null): boolean {
    if (!id) return false;
    return dependents.data?.get(id) ?? true;
  }

  return (
    <View className="gap-6">
        <View className="gap-2">
          {activeRows.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400">
              No types yet — add one below.
            </Text>
          ) : null}
          {activeRows.map(({ row: r, idx }) => {
            const hasSchedule = r.recurrence.days.length > 0;
            const isSaved = r.id !== null;
            const deletable = isSaved && canHardDelete && !hasDeps(r.id);
            return (
              <View
                key={r.id ?? `new-${idx}`}
                className="bg-white dark:bg-gray-900 rounded-xl p-3 gap-3">
                <View className="flex-row items-center gap-3">
                  <Pressable
                    onPress={() =>
                      setOpenPickerIdx(openPickerIdx === idx ? null : idx)
                    }
                    hitSlop={4}
                    style={{ backgroundColor: r.color }}
                    className="w-10 h-10 rounded-full border-2 border-white dark:border-gray-900"
                  />
                  <View className="flex-1">
                    <Input
                      label=""
                      value={r.name}
                      onChangeText={(v) => updateRow(idx, { name: v })}
                      placeholder="CrossFit"
                      autoCapitalize="words"
                    />
                  </View>
                  {!isSaved ? (
                    <Pressable
                      onPress={() => {
                        setRows(rows.filter((_, i) => i !== idx));
                        if (openPickerIdx === idx) setOpenPickerIdx(null);
                      }}
                      hitSlop={4}
                      className="w-10 h-10 rounded-lg items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
                      <Ionicons name="close" size={18} color="#9CA3AF" />
                    </Pressable>
                  ) : null}
                </View>
                {openPickerIdx === idx ? (
                  <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <ColorSwatchPicker
                      value={r.color}
                      onChange={(c) => updateRow(idx, { color: c })}
                      inUse={rows
                        .filter((o, i) => i !== idx && !o.archivedAt)
                        .map((o) => o.color)}
                    />
                  </View>
                ) : null}

                <Pressable
                  onPress={() =>
                    updateRow(idx, { scheduleOpen: !r.scheduleOpen })
                  }
                  className="flex-row items-center justify-between gap-3 px-1 py-1 active:opacity-70">
                  <Text
                    className={`flex-1 text-sm ${
                      hasSchedule
                        ? 'text-gray-700 dark:text-gray-200'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}
                    numberOfLines={2}>
                    {hasSchedule
                      ? summariseRecurrence(r.recurrence)
                      : 'No recurring schedule yet.'}
                  </Text>
                  <ChipButton
                    label={r.scheduleOpen ? 'Hide' : hasSchedule ? 'Edit' : 'Set up'}
                    icon={
                      r.scheduleOpen ? 'chevron-up' : hasSchedule ? 'pencil' : 'add'
                    }
                  />
                </Pressable>

                {r.scheduleOpen ? (
                  <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-3">
                    <RecurrenceEditor
                      value={r.recurrence}
                      onChange={(next) => updateRow(idx, { recurrence: next })}
                    />
                    {hasSchedule ? (
                      <Pressable
                        onPress={() =>
                          updateRow(idx, {
                            recurrence: { ...r.recurrence, days: [] },
                          })
                        }
                        hitSlop={4}
                        className="self-start">
                        <Text className="text-red-500 dark:text-red-400 text-sm">
                          Remove schedule
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                <Pressable
                  onPress={() => updateRow(idx, { rulesOpen: !r.rulesOpen })}
                  className="flex-row items-center justify-between gap-3 px-1 py-1 active:opacity-70">
                  <Text
                    className={`flex-1 text-sm ${
                      r.bookingWindowHoursAhead ||
                      r.bookingCutoffMinutesBefore ||
                      r.cancelCutoffMinutesBefore
                        ? 'text-gray-700 dark:text-gray-200'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}
                    numberOfLines={2}>
                    {r.bookingWindowHoursAhead ||
                    r.bookingCutoffMinutesBefore ||
                    r.cancelCutoffMinutesBefore
                      ? `Custom rules — opens ${r.bookingWindowHoursAhead ? formatBaseDuration(parseInt(r.bookingWindowHoursAhead, 10), 'hours') : 'gym'} ahead · closes ${r.bookingCutoffMinutesBefore ? formatBaseDuration(parseInt(r.bookingCutoffMinutesBefore, 10), 'minutes') : 'gym'} before · cancel ${r.cancelCutoffMinutesBefore ? formatBaseDuration(parseInt(r.cancelCutoffMinutesBefore, 10), 'minutes') : 'gym'}`
                      : 'Booking rules inherit the gym defaults.'}
                  </Text>
                  <ChipButton
                    label={r.rulesOpen ? 'Hide' : 'Override'}
                    icon={r.rulesOpen ? 'chevron-up' : 'options'}
                  />
                </Pressable>

                {r.rulesOpen ? (
                  <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-3">
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">
                      Leave blank to use the gym-wide setting (Manage →
                      Gym settings). Set a value here to override for this
                      class type only.
                    </Text>
                    <DurationField
                      label="Booking opens ahead (blank = inherit)"
                      value={r.bookingWindowHoursAhead}
                      onChange={(v) =>
                        updateRow(idx, { bookingWindowHoursAhead: v })
                      }
                      base="hours"
                      units={['hours', 'days', 'weeks']}
                      placeholder="inherit"
                    />
                    <DurationField
                      label="Booking closes before start (blank = inherit)"
                      value={r.bookingCutoffMinutesBefore}
                      onChange={(v) =>
                        updateRow(idx, { bookingCutoffMinutesBefore: v })
                      }
                      base="minutes"
                      units={['minutes', 'hours', 'days', 'weeks']}
                      placeholder="inherit"
                    />
                    <DurationField
                      label="Free-cancel cutoff before start (blank = inherit)"
                      value={r.cancelCutoffMinutesBefore}
                      onChange={(v) =>
                        updateRow(idx, { cancelCutoffMinutesBefore: v })
                      }
                      base="minutes"
                      units={['minutes', 'hours', 'days', 'weeks']}
                      placeholder="inherit"
                    />
                  </View>
                ) : null}

                {isSaved && canArchive ? (
                  <View className="flex-row gap-2 justify-end flex-wrap">
                    <ActionButton
                      kind="archive"
                      label="Archive"
                      onPress={() => archive.mutate(r.id!)}
                    />
                    {canHardDelete ? (
                      <ActionButton
                        kind="delete"
                        label="Delete permanently"
                        disabled={!deletable || hardDelete.isPending}
                        disabledLabel="Cannot delete — has history"
                        onPress={() => hardDelete.mutate(r.id!)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <ChipButton
          className="self-start"
          label="Add type"
          icon="add"
          onPress={addRow}
        />

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
        {actionError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{actionError}</Text>
        ) : null}

        <Button
          onPress={() => save.mutate()}
          loading={save.isPending}
          success={saved}>
          Save changes
        </Button>

        {archivedRows.length > 0 ? (
          <View className="gap-2">
            <Pressable
              onPress={() => setShowArchived(!showArchived)}
              className="flex-row items-center gap-2 self-start py-1">
              <Ionicons
                name={showArchived ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color="#6B7280"
              />
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Archived ({archivedRows.length})
              </Text>
            </Pressable>
            {showArchived
              ? archivedRows.map(({ row: r }) => {
                  const deletable = canHardDelete && !hasDeps(r.id);
                  return (
                    <View
                      key={r.id!}
                      className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 gap-2">
                      <View className="flex-row items-center gap-3">
                        <View
                          style={{ backgroundColor: r.color }}
                          className="w-8 h-8 rounded-full opacity-50"
                        />
                        <Text className="flex-1 text-gray-700 dark:text-gray-200" numberOfLines={1}>
                          {r.name}
                        </Text>
                      </View>
                      {canArchive ? (
                        <View className="flex-row gap-2 justify-end flex-wrap">
                          <ActionButton
                            kind="restore"
                            label="Restore"
                            onPress={() => restore.mutate(r.id!)}
                          />
                          {canHardDelete ? (
                            <ActionButton
                              kind="delete"
                              label="Delete permanently"
                              disabled={!deletable || hardDelete.isPending}
                              disabledLabel="Cannot delete — has history"
                              onPress={() => hardDelete.mutate(r.id!)}
                            />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              : null}
          </View>
        ) : null}
    </View>
  );
}

export default function ClassTypesScreen() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Class types
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Name and colour the kinds of class you run, and set up a recurring
            schedule so they appear on the calendar automatically.
          </Text>
        </View>
        <ClassTypesPanel />
      </ScrollView>
    </Screen>
  );
}
