// Lives here rather than under app/ because it has no route of its own.
// /management/class-types was a Screen, a BackLink and a heading wrapped
// around this panel, and the Manage screen's Settings tab already rendered
// the same component behind the same capability.

import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from './Text';

import { ActionButton } from '@/components/ActionButton';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ColorSwatchPicker, PALETTE } from '@/components/ColorSwatchPicker';
import { DurationField, formatBaseDuration } from '@/components/DurationField';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/Input';
import {
  EMPTY_RECURRENCE,
  RecurrenceEditor,
  type RecurrenceForm,
  summariseRecurrence,
  validateRecurrence,
} from '@/components/RecurrenceEditor';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymDiscipline } from '@/lib/useGymDiscipline';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import {
  useClassRecurrences,
  useClassTypes,
  type RecurrenceRow,
} from '@/lib/useClassCatalog';
import { useSavedFlag } from '@/lib/useSavedFlag';
import { useThemeColors } from '@/lib/theme';

// Fallback if the gym defaults query hasn't resolved yet — matches the
// SQL default in 0049.
const HORIZON_WEEKS_FALLBACK = 12;

// One recurring schedule row for a class type. A type can hold several
// (e.g. Mon–Fri 06:00 as one, Sat 10:00 as another) — `id` is null until
// the schedule has been saved.
type ScheduleDraft = {
  id: string | null;
  form: RecurrenceForm;
};

type EditableType = {
  id: string | null;
  name: string;
  color: string;
  archivedAt: string | null;
  scheduleOpen: boolean;
  schedules: ScheduleDraft[];
  rulesOpen: boolean;
  // String-backed so an empty input maps cleanly to NULL = inherit
  // the gym default. The save path parses to integer.
  bookingWindowHoursAhead: string;
  bookingCutoffMinutesBefore: string;
  // Cancel cutoff has three modes:
  //   'inherit'    — both relative override and absolute mode null
  //   'relative'   — cancelCutoffMinutesBefore drives, mode null
  //   'day_before' — cancelCutoffTime + cancelCutoffDaysBefore drive,
  //                  mode = 'day_before'
  // String-backed for the same blank-empty-equals-inherit reason.
  cancelCutoffMode: 'inherit' | 'relative' | 'day_before';
  cancelCutoffMinutesBefore: string;
  cancelCutoffTime: string;
  cancelCutoffDaysBefore: string;
  // Unsaved edits. A dirty row survives the server reseed so saving or
  // archiving one card can't wipe another card's in-progress edits.
  dirty: boolean;
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

// Canonical form of a schedule for change detection. Saving an
// unchanged schedule must be a no-op: rewriting a recurrence deletes
// its future sessions (and their bookings) before rematerialising.
function scheduleKey(f: RecurrenceForm): string {
  return JSON.stringify({
    days: [...f.days].sort((a, b) => a - b),
    times: f.times.map((t) => t.trim()).filter(Boolean),
    dur: parseInt(f.durationMinutes, 10),
    cap: parseInt(f.capacity, 10),
    indefinite: f.indefinite,
    weeks: f.indefinite ? '' : f.weeks,
  });
}

function nullableInt(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = parseInt(t, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Booking-rule values must be non-negative whole numbers');
  }
  return n;
}

// Derive the three cancel-cutoff columns from the row's mode. Only
// one of the relative override / absolute pair is populated at a
// time; the other side goes back to null = inherit.
function cancelCutoffFromRow(r: EditableType): {
  cancel_cutoff_minutes_before: number | null;
  cancel_cutoff_mode: 'day_before' | null;
  cancel_cutoff_time: string | null;
  cancel_cutoff_days_before: number | null;
} {
  if (r.cancelCutoffMode === 'relative') {
    return {
      cancel_cutoff_minutes_before: nullableInt(r.cancelCutoffMinutesBefore),
      cancel_cutoff_mode: null,
      cancel_cutoff_time: null,
      cancel_cutoff_days_before: null,
    };
  }
  if (r.cancelCutoffMode === 'day_before') {
    const t = r.cancelCutoffTime.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
      throw new Error(
        `${r.name || 'Class type'}: cancel time must be HH:MM (24h), e.g. 21:00`,
      );
    }
    const d = nullableInt(r.cancelCutoffDaysBefore);
    return {
      cancel_cutoff_minutes_before: null,
      cancel_cutoff_mode: 'day_before',
      cancel_cutoff_time: t,
      cancel_cutoff_days_before: d ?? 1,
    };
  }
  return {
    cancel_cutoff_minutes_before: null,
    cancel_cutoff_mode: null,
    cancel_cutoff_time: null,
    cancel_cutoff_days_before: null,
  };
}

export function ClassTypesPanel() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const { data: gymDefaults } = useGymOperatingDefaults();
  const gymTz = gymDefaults?.timezone ?? 'UTC';
  const discipline = useGymDiscipline();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditableType[]>([]);
  const [openPickerIdx, setOpenPickerIdx] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [saveError, setSaveError] = useState<{ idx: number; message: string } | null>(null);
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
    // Group every recurrence under its class type — a type can have more
    // than one (different days at different times).
    const recsByTypeId = new Map<string, RecurrenceRow[]>();
    for (const r of recurrences.data) {
      const arr = recsByTypeId.get(r.class_type_id) ?? [];
      arr.push(r);
      recsByTypeId.set(r.class_type_id, arr);
    }
    setRows((prev) => {
      const prevById = new Map(
        prev.filter((r) => r.id !== null).map((r) => [r.id!, r]),
      );
      const fromServer = types.data!.map((t): EditableType => {
        const existing = prevById.get(t.id);
        // A row with unsaved edits keeps its draft — reseeding it here
        // would throw the edits away whenever a neighbouring card saves.
        if (existing?.dirty) return existing;
        const recs = recsByTypeId.get(t.id) ?? [];
        return {
          id: t.id,
          name: t.name,
          color: t.color,
          archivedAt: t.archived_at,
          scheduleOpen: existing?.scheduleOpen ?? false,
          schedules: recs.map((rec) => ({
            id: rec.id,
            form: recurrenceFromServer(rec),
          })),
          rulesOpen: existing?.rulesOpen ?? false,
          bookingWindowHoursAhead:
            t.booking_window_hours_ahead === null
              ? ''
              : String(t.booking_window_hours_ahead),
          bookingCutoffMinutesBefore:
            t.booking_cutoff_minutes_before === null
              ? ''
              : String(t.booking_cutoff_minutes_before),
          cancelCutoffMode:
            t.cancel_cutoff_mode === 'day_before'
              ? 'day_before'
              : t.cancel_cutoff_minutes_before !== null
                ? 'relative'
                : 'inherit',
          cancelCutoffMinutesBefore:
            t.cancel_cutoff_minutes_before === null
              ? ''
              : String(t.cancel_cutoff_minutes_before),
          cancelCutoffTime: t.cancel_cutoff_time
            ? t.cancel_cutoff_time.slice(0, 5)
            : '',
          cancelCutoffDaysBefore:
            t.cancel_cutoff_days_before === null
              ? '1'
              : String(t.cancel_cutoff_days_before),
          dirty: false,
        };
      });
      // Drafts not yet on the server always survive a reseed.
      const drafts = prev.filter((r) => r.id === null);
      return [...fromServer, ...drafts];
    });
  }, [
    types.data,
    recurrences.data,
    gymDefaults?.default_class_minutes,
    gymDefaults?.default_class_capacity,
  ]);

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('archive_class_type', { p_id: id });
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      setActionError(null);
      // Drop any unsaved edits on the archived card so the reseed takes
      // the server's archived state instead of the stale active draft.
      setRows((curr) =>
        curr.map((r) => (r.id === id ? { ...r, dirty: false } : r)),
      );
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

  // Saves one card: the class type row plus its schedules. Schedules
  // whose form matches the server are skipped entirely — rewriting a
  // recurrence deletes its future sessions (and their bookings), so an
  // untouched schedule must never be rewritten as a side effect.
  const save = useMutation({
    mutationFn: async (idx: number) => {
      if (!membership) throw new Error('No gym');
      const r = rows[idx];
      if (!r) throw new Error('Nothing to save');
      const name = r.name.trim();
      if (!name) throw new Error('The type needs a name');

      const rules = {
        booking_window_hours_ahead: nullableInt(r.bookingWindowHoursAhead),
        booking_cutoff_minutes_before: nullableInt(r.bookingCutoffMinutesBefore),
        ...cancelCutoffFromRow(r),
      };

      let classTypeId = r.id;
      if (classTypeId === null) {
        const { data, error } = await supabase
          .from('class_types')
          .insert({ gym_id: membership.gymId, name, color: r.color, ...rules })
          .select('id')
          .single();
        if (error || !data) throw error ?? new Error('Could not create type');
        classTypeId = data.id;
      } else {
        const sv = (types.data ?? []).find((t) => t.id === classTypeId);
        const svTime = sv?.cancel_cutoff_time
          ? sv.cancel_cutoff_time.slice(0, 5)
          : null;
        const changed =
          !sv ||
          sv.name !== name ||
          sv.color !== r.color ||
          sv.booking_window_hours_ahead !== rules.booking_window_hours_ahead ||
          sv.booking_cutoff_minutes_before !==
            rules.booking_cutoff_minutes_before ||
          sv.cancel_cutoff_minutes_before !==
            rules.cancel_cutoff_minutes_before ||
          sv.cancel_cutoff_mode !== rules.cancel_cutoff_mode ||
          svTime !== rules.cancel_cutoff_time ||
          sv.cancel_cutoff_days_before !== rules.cancel_cutoff_days_before;
        if (changed) {
          const { error } = await supabase
            .from('class_types')
            .update({ name, color: r.color, ...rules })
            .eq('id', classTypeId);
          if (error) throw error;
        }
      }

      async function deleteRecurrence(id: string) {
        const { error: delErr } = await supabase
          .from('class_recurrences')
          .delete()
          .eq('id', id);
        if (delErr) throw delErr;
      }

      // Schedules removed in the editor are recurrences that exist on
      // the server but are no longer in the draft list — delete them.
      const serverRecs = (recurrences.data ?? []).filter(
        (rr) => rr.class_type_id === classTypeId,
      );
      const keptIds = new Set(
        r.schedules.map((s) => s.id).filter((id): id is string => !!id),
      );
      for (const rec of serverRecs) {
        if (!keptIds.has(rec.id)) await deleteRecurrence(rec.id);
      }

      const serverRecById = new Map(serverRecs.map((rec) => [rec.id, rec]));

      for (const sched of r.schedules) {
        const form = sched.form;
        if (form.days.length === 0) {
          // An emptied existing schedule is a removal; a blank new one
          // is simply skipped.
          if (sched.id) await deleteRecurrence(sched.id);
          continue;
        }

        const errMsg = validateRecurrence(form);
        if (errMsg) throw new Error(`${r.name}: ${errMsg}`);

        if (sched.id) {
          const serverRec = serverRecById.get(sched.id);
          if (
            serverRec &&
            scheduleKey(recurrenceFromServer(serverRec)) === scheduleKey(form)
          ) {
            continue;
          }
        }

        const validTimes = form.times.map((t) => t.trim()).filter(Boolean);
        const dur = parseInt(form.durationMinutes, 10);
        const cap = parseInt(form.capacity, 10);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = fmtDateLocal(today);

        let endsOn: string | null = null;
        if (!form.indefinite) {
          const w = parseInt(form.weeks, 10);
          const endDate = new Date(today);
          endDate.setDate(endDate.getDate() + w * 7 - 1);
          endsOn = fmtDateLocal(endDate);
        }

        // The gym's clock, not the device's. A recurrence created from
        // a phone abroad would otherwise materialise every class at the
        // traveller's hour rather than the members'.
        const tz = gymTz;

        let recId: string;
        if (sched.id) {
          const nowIso = new Date().toISOString();
          const { error: sessDelErr } = await supabase
            .from('class_sessions')
            .delete()
            .eq('recurrence_id', sched.id)
            .gte('starts_at', nowIso);
          if (sessDelErr) throw sessDelErr;

          const { error: updErr } = await supabase
            .from('class_recurrences')
            .update({
              days_of_week: form.days,
              times: validTimes,
              duration_minutes: dur,
              capacity: cap,
              ends_on: endsOn,
              tz,
              materialized_until: todayStr,
            })
            .eq('id', sched.id);
          if (updErr) throw updErr;
          recId = sched.id;
        } else {
          const { data: userResp, error: userErr } = await supabase.auth.getUser();
          if (userErr || !userResp.user) {
            throw userErr ?? new Error('Not signed in');
          }
          const { data, error: insErr } = await supabase
            .from('class_recurrences')
            .insert({
              gym_id: membership.gymId,
              class_type_id: classTypeId,
              days_of_week: form.days,
              times: validTimes,
              duration_minutes: dur,
              capacity: cap,
              notes: null,
              starts_on: todayStr,
              ends_on: endsOn,
              tz,
              created_by: userResp.user.id,
            })
            .select('id')
            .single();
          if (insErr || !data) {
            throw insErr ?? new Error('Could not save recurrence');
          }
          recId = data.id;
        }

        const horizon = new Date();
        const horizonWeeks =
          gymDefaults?.materialisation_horizon_weeks ?? HORIZON_WEEKS_FALLBACK;
        horizon.setDate(horizon.getDate() + horizonWeeks * 7);
        const targetEnd =
          endsOn && new Date(endsOn) < horizon ? endsOn : fmtDateLocal(horizon);

        const { error: extErr } = await supabase.rpc('extend_recurrence', {
          rec_id: recId,
          until_date: targetEnd,
        });
        if (extErr) throw extErr;
      }

      return { idx, classTypeId };
    },
    onSuccess: ({ idx, classTypeId }) => {
      setSaveError(null);
      setOpenPickerIdx(null);
      setRows((curr) =>
        curr.map((r, i) =>
          i === idx ? { ...r, id: classTypeId, dirty: false } : r,
        ),
      );
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['class-types'] });
      queryClient.invalidateQueries({ queryKey: ['class-recurrences'] });
      queryClient.invalidateQueries({ queryKey: ['class-sessions-month'] });
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
      queryClient.invalidateQueries({ queryKey: ['class-programming-month'] });
    },
    onError: (e, idx) =>
      setSaveError({ idx, message: errorMessage(e, 'Save failed') }),
  });

  function makeDefaultForm(): RecurrenceForm {
    return {
      ...EMPTY_RECURRENCE,
      durationMinutes: String(gymDefaults?.default_class_minutes ?? 60),
      capacity: String(gymDefaults?.default_class_capacity ?? 12),
      indefinite: true,
    };
  }

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
        schedules: [{ id: null, form: makeDefaultForm() }],
        rulesOpen: false,
        bookingWindowHoursAhead: '',
        bookingCutoffMinutesBefore: '',
        cancelCutoffMode: 'inherit',
        cancelCutoffMinutesBefore: '',
        cancelCutoffTime: '',
        cancelCutoffDaysBefore: '1',
        dirty: true,
      },
    ]);
  }

  function updateRow(idx: number, patch: Partial<EditableType>) {
    setRows((curr) => curr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  // For content edits (name, colour, rules) — anything that must not be
  // lost to a reseed until the card is saved. UI-only state (open/closed
  // sections) goes through updateRow so it never blocks a reseed.
  function editRow(idx: number, patch: Partial<EditableType>) {
    updateRow(idx, { ...patch, dirty: true });
  }

  // Open the schedule editor for a type, seeding a first blank schedule
  // if it has none yet so there's something to fill in.
  function openSchedule(idx: number) {
    setRows((curr) =>
      curr.map((r, i) =>
        i === idx
          ? {
              ...r,
              scheduleOpen: !r.scheduleOpen,
              schedules:
                !r.scheduleOpen && r.schedules.length === 0
                  ? [{ id: null, form: makeDefaultForm() }]
                  : r.schedules,
            }
          : r,
      ),
    );
  }

  function updateSchedule(idx: number, sIdx: number, form: RecurrenceForm) {
    setRows((curr) =>
      curr.map((r, i) =>
        i === idx
          ? {
              ...r,
              dirty: true,
              schedules: r.schedules.map((s, j) =>
                j === sIdx ? { ...s, form } : s,
              ),
            }
          : r,
      ),
    );
  }

  function addSchedule(idx: number) {
    setRows((curr) =>
      curr.map((r, i) =>
        i === idx
          ? {
              ...r,
              dirty: true,
              schedules: [...r.schedules, { id: null, form: makeDefaultForm() }],
            }
          : r,
      ),
    );
  }

  function removeSchedule(idx: number, sIdx: number) {
    setRows((curr) =>
      curr.map((r, i) =>
        i === idx
          ? {
              ...r,
              dirty: true,
              schedules: r.schedules.filter((_, j) => j !== sIdx),
            }
          : r,
      ),
    );
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
        {activeRows.length === 0 ? (
          <EmptyState
            icon="albums-outline"
            title="No class types yet"
            description="Class types are the kinds of class you run, each with its own name and colour."
            actionLabel="Create your first type"
            onAction={addRow}
          />
        ) : null}

        <View className="gap-2">
          {activeRows.map(({ row: r, idx }) => {
            const activeSchedules = r.schedules.filter(
              (s) => s.form.days.length > 0,
            );
            const hasSchedule = activeSchedules.length > 0;
            const isSaved = r.id !== null;
            const deletable = isSaved && canHardDelete && !hasDeps(r.id);
            return (
              <View
                key={r.id ?? `new-${idx}`}
                className="bg-surface dark:bg-surface-dk rounded-xl p-3 gap-3 shadow-card">
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
                      onChangeText={(v) => editRow(idx, { name: v })}
                      placeholder={discipline === 'hyrox' ? 'Hyrox' : 'CrossFit'}
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
                      accessibilityRole="button"
                      accessibilityLabel="Remove"
                      className="w-10 h-10 rounded-lg items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
                      <Ionicons name="close" size={18} color={colors.ink3} />
                    </Pressable>
                  ) : null}
                </View>
                {openPickerIdx === idx ? (
                  <View className="bg-raised dark:bg-raised-dk rounded-lg p-3">
                    <ColorSwatchPicker
                      value={r.color}
                      onChange={(c) => editRow(idx, { color: c })}
                      inUse={rows
                        .filter((o, i) => i !== idx && !o.archivedAt)
                        .map((o) => o.color)}
                    />
                  </View>
                ) : null}

                <Pressable
                  onPress={() => openSchedule(idx)}
                  className="flex-row items-center justify-between gap-3 px-1 py-1 active:opacity-70">
                  <Text
                    className={`flex-1 text-sm ${
                      hasSchedule
                        ? 'text-ink-2 dark:text-ink-2-dk'
                        : 'text-ink-3 dark:text-ink-3-dk'
                    }`}
                    numberOfLines={4}>
                    {hasSchedule
                      ? activeSchedules
                          .map((s) =>
                            summariseRecurrence(
                              s.form,
                              gymDefaults?.week_starts_on ?? 'mon',
                            ),
                          )
                          .join('\n')
                      : 'No recurring schedule yet.'}
                  </Text>
                  <ChipButton
                    label={r.scheduleOpen ? 'Hide' : hasSchedule ? 'Edit' : 'Set up'}
                    icon={
                      r.scheduleOpen ? 'chevron-up' : hasSchedule ? 'create-outline' : 'add'
                    }
                  />
                </Pressable>

                {r.scheduleOpen ? (
                  <View className="bg-raised dark:bg-raised-dk rounded-lg p-3 gap-4">
                    {r.schedules.map((sched, sIdx) => (
                      <View
                        key={sIdx}
                        className={
                          sIdx > 0
                            ? 'gap-3 pt-4 border-t border-line dark:border-line-dk'
                            : 'gap-3'
                        }>
                        {r.schedules.length > 1 ? (
                          <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-widest">
                            Schedule {sIdx + 1}
                          </Text>
                        ) : null}
                        <RecurrenceEditor
                          value={sched.form}
                          onChange={(next) => updateSchedule(idx, sIdx, next)}
                        />
                        <Pressable
                          onPress={() => removeSchedule(idx, sIdx)}
                          hitSlop={4}
                          className="self-start">
                          <Text className="text-red-500 dark:text-red-400 text-sm">
                            Remove schedule
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                    <Pressable
                      onPress={() => addSchedule(idx)}
                      className="flex-row items-center gap-1 self-start px-3 py-2 rounded-lg border border-dashed border-line-strong dark:border-line-strong-dk">
                      <Ionicons name="add" size={14} color={colors.ink2} />
                      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                        Add another schedule
                      </Text>
                    </Pressable>
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
                        ? 'text-ink-2 dark:text-ink-2-dk'
                        : 'text-ink-3 dark:text-ink-3-dk'
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
                  <View className="bg-raised dark:bg-raised-dk rounded-lg p-3 gap-3">
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      Leave blank to use the gym-wide setting (Manage →
                      Gym settings). Set a value here to override for this
                      class type only.
                    </Text>
                    <DurationField
                      label="Booking opens ahead (blank = inherit)"
                      value={r.bookingWindowHoursAhead}
                      onChange={(v) =>
                        editRow(idx, { bookingWindowHoursAhead: v })
                      }
                      base="hours"
                      units={['hours', 'days', 'weeks']}
                      placeholder="inherit"
                    />
                    <DurationField
                      label="Booking closes before start (blank = inherit)"
                      value={r.bookingCutoffMinutesBefore}
                      onChange={(v) =>
                        editRow(idx, { bookingCutoffMinutesBefore: v })
                      }
                      base="minutes"
                      units={['minutes', 'hours', 'days', 'weeks']}
                      placeholder="inherit"
                    />
                    <View className="gap-2">
                      <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                        Free-cancel cutoff
                      </Text>
                      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                        Inherit the gym setting, or override with either a
                        time before class or "by 9pm the night before"-style
                        absolute cutoff per class type.
                      </Text>
                      <View className="flex-row gap-2">
                        {(
                          [
                            ['inherit', 'Inherit'],
                            ['relative', 'A time before class'],
                            ['day_before', 'A set time, days before'],
                          ] as const
                        ).map(([m, label]) => {
                          const on = r.cancelCutoffMode === m;
                          return (
                            <Pressable
                              key={m}
                              onPress={() =>
                                editRow(idx, { cancelCutoffMode: m })
                              }
                              className={`flex-1 px-3 py-2 rounded-lg border ${
                                on
                                  ? 'border-primary bg-primary/10'
                                  : 'border-line dark:border-line-dk'
                              }`}>
                              <Text
                                className={`text-xs text-center ${
                                  on
                                    ? 'text-primary font-medium'
                                    : 'text-ink-2 dark:text-ink-2-dk'
                                }`}>
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {r.cancelCutoffMode === 'relative' ? (
                        <DurationField
                          label=""
                          value={r.cancelCutoffMinutesBefore}
                          onChange={(v) =>
                            editRow(idx, { cancelCutoffMinutesBefore: v })
                          }
                          base="minutes"
                          units={['minutes', 'hours', 'days', 'weeks']}
                          placeholder="e.g. 60"
                        />
                      ) : null}
                      {r.cancelCutoffMode === 'day_before' ? (
                        <View className="gap-2">
                          <View className="flex-row gap-2">
                            <View className="flex-1 gap-1.5">
                              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                                Cancel by (24h)
                              </Text>
                              <TextInput
                                value={r.cancelCutoffTime}
                                onChangeText={(v) =>
                                  editRow(idx, { cancelCutoffTime: v })
                                }
                                placeholder="21:00"
                                placeholderTextColor="#9CA3AF"
                                autoCapitalize="none"
                                autoCorrect={false}
                                className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 text-ink dark:text-ink-dk text-base"
                              />
                            </View>
                            <View className="w-28 gap-1.5">
                              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                                Days before
                              </Text>
                              <TextInput
                                value={r.cancelCutoffDaysBefore}
                                onChangeText={(v) =>
                                  editRow(idx, { cancelCutoffDaysBefore: v })
                                }
                                placeholder="1"
                                placeholderTextColor="#9CA3AF"
                                keyboardType="number-pad"
                                className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 text-ink dark:text-ink-dk text-base"
                              />
                            </View>
                          </View>
                          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                            e.g. 21:00 · 1 day before = “cancel by 9pm the night before”. Time uses the gym timezone.
                          </Text>
                        </View>
                      ) : null}
                    </View>
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

                {saveError?.idx === idx ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">
                    {saveError.message}
                  </Text>
                ) : null}
                <Button
                  onPress={() => save.mutate(idx)}
                  loading={save.isPending && save.variables === idx}
                  success={saved && save.variables === idx}>
                  {isSaved ? 'Save' : 'Create type'}
                </Button>
              </View>
            );
          })}
        </View>

        {activeRows.length > 0 ? (
          <Button variant="secondary" icon="add" onPress={addRow}>
            Add type
          </Button>
        ) : null}

        {actionError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{actionError}</Text>
        ) : null}

        {archivedRows.length > 0 ? (
          <View className="gap-2">
            <Pressable
              onPress={() => setShowArchived(!showArchived)}
              className="flex-row items-center gap-2 self-start py-1">
              <Ionicons
                name={showArchived ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color={colors.ink2}
              />
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                Archived ({archivedRows.length})
              </Text>
            </Pressable>
            {showArchived
              ? archivedRows.map(({ row: r }) => {
                  const deletable = canHardDelete && !hasDeps(r.id);
                  return (
                    <View
                      key={r.id!}
                      className="bg-raised dark:bg-raised-dk rounded-xl p-3 gap-2">
                      <View className="flex-row items-center gap-3">
                        <View
                          style={{ backgroundColor: r.color }}
                          className="w-8 h-8 rounded-full opacity-50"
                        />
                        <Text className="flex-1 text-ink-2 dark:text-ink-2-dk" numberOfLines={1}>
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
