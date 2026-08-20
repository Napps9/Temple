import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { BodyMap } from '@/components/BodyMap';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  daysAgo,
  injuryTitle,
  isCheckInDue,
  painColour,
  regionLabel,
  STATUS_META,
} from '@/lib/injuries';
import { MOVEMENT_GROUPS, movementName } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { dueCheckIns, useMyInjuries, type InjuryRow } from '@/lib/useInjuries';
import { useThemeColors } from '@/lib/theme';
import type { InjuryFeeling, InjurySide, InjuryStatus } from '@/types/database';

// The member's own day, not UTC's and not the gym's. When a shoulder
// started hurting is answered on the calendar the person logging it is
// living in — unlike a class time, which is the gym's schedule. UTC got
// this wrong for part of every day everywhere east of Greenwich: at 8am
// in Sydney it pre-filled yesterday.
function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const ALL_MOVEMENTS: { key: string; name: string }[] = MOVEMENT_GROUPS.flatMap(
  (g) => g.movements.map((m) => ({ key: m.key, name: m.name })),
);

export default function InjuriesScreen() {
  const injuries = useMyInjuries();
  const [picking, setPicking] = useState<{
    region: string;
    side: InjurySide;
  } | null>(null);

  const rows = injuries.data ?? [];
  const open = rows.filter((r) => r.status !== 'resolved');
  const resolved = rows.filter((r) => r.status === 'resolved');
  const due = dueCheckIns(rows);
  const [showResolved, setShowResolved] = useState(false);

  // Tint the map with the member's own open injuries.
  const highlights = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of open) map[r.body_region] = painColour(r.pain_level);
    return map;
  }, [open]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/track" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Injury tracker
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Log a niggle or injury so your coaches can program around it.
            Tap the body where it hurts.
          </Text>
        </View>

        {due.length > 0 ? (
          <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-4 gap-1">
            <Text className="text-amber-700 dark:text-amber-300 font-semibold">
              Weekly check-in due
            </Text>
            <Text className="text-amber-700 dark:text-amber-300 text-sm">
              {due.length === 1
                ? `How's your ${injuryTitle(due[0].body_region, due[0].side).toLowerCase()}? Add a quick update below.`
                : `${due.length} injuries need a quick update below.`}
            </Text>
          </View>
        ) : null}

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <BodyMap
            selected={picking}
            highlights={highlights}
            onSelect={(region, side) => setPicking({ region, side })}
          />
          {picking ? (
            <LogInjuryForm
              region={picking.region}
              side={picking.side}
              onSideChange={(side) => setPicking({ ...picking, side })}
              onDone={() => setPicking(null)}
            />
          ) : (
            <Text className="text-gray-400 dark:text-gray-500 text-xs text-center">
              Tap a body region to record a new injury.
            </Text>
          )}
        </View>

        <View className="gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Your injuries
          </Text>
          {injuries.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
          ) : open.length === 0 ? (
            <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Nothing logged. Long may it last.
              </Text>
            </View>
          ) : (
            open.map((r) => <InjuryCard key={r.id} injury={r} />)
          )}
        </View>

        {resolved.length > 0 ? (
          <View className="gap-3">
            <ChipButton
              tone="neutral"
              className="self-start"
              label={
                showResolved
                  ? 'Hide resolved'
                  : `Resolved (${resolved.length})`
              }
              icon={showResolved ? 'chevron-up' : 'chevron-down'}
              onPress={() => setShowResolved((v) => !v)}
            />
            {showResolved
              ? resolved.map((r) => <InjuryCard key={r.id} injury={r} />)
              : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Logging a new injury
// ---------------------------------------------------------------------------

function LogInjuryForm({
  region,
  side,
  onSideChange,
  onDone,
}: {
  region: string;
  side: InjurySide;
  onSideChange: (side: InjurySide) => void;
  onDone: () => void;
}) {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [pain, setPain] = useState(5);
  const [description, setDescription] = useState('');
  const [startedOn, setStartedOn] = useState(isoToday());
  const [hurt, setHurt] = useState<string[]>([]);
  const [ok, setOk] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('log_injury', {
        p_gym_id: membership!.gymId,
        p_body_region: region,
        p_side: side,
        p_description: description.trim() || null,
        p_pain_level: pain,
        p_movements_hurt: hurt,
        p_movements_ok: ok,
        p_started_on: startedOn,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-injuries'] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the injury')),
  });

  return (
    <View className="gap-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
        New injury — {regionLabel(region)}
      </Text>

      <SidePicker value={side} onChange={onSideChange} />
      <PainPicker label="Pain right now" value={pain} onChange={setPain} />
      <DatePicker label="When did it start?" value={startedOn} onChange={setStartedOn} />
      <Input
        label="What happened? (optional)"
        value={description}
        onChangeText={setDescription}
        placeholder="Felt a pull at the bottom of a heavy squat…"
        multiline
      />
      <MovementMultiPick label="Movements that hurt" value={hurt} onChange={setHurt} />
      <MovementMultiPick
        label="Movements that feel fine"
        value={ok}
        onChange={setOk}
      />

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button onPress={() => save.mutate()} loading={save.isPending}>
            Save injury
          </Button>
        </View>
        <Button variant="secondary" onPress={onDone}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Existing injury card + weekly check-in
// ---------------------------------------------------------------------------

function InjuryCard({ injury }: { injury: InjuryRow }) {
  const [updating, setUpdating] = useState(false);
  const status = STATUS_META[injury.status];
  const due = isCheckInDue(injury.updated_at, injury.status);
  const updatedDays = daysAgo(injury.updated_at);

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 shadow-card">
      <View className="flex-row items-center gap-2">
        <View
          style={{ backgroundColor: painColour(injury.pain_level) }}
          className="w-7 h-7 rounded-full items-center justify-center">
          <Text className="text-white text-[11px] font-bold">
            {injury.pain_level}
          </Text>
        </View>
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold" numberOfLines={1}>
          {injuryTitle(injury.body_region, injury.side)}
        </Text>
        <View
          style={{ borderColor: status.colour }}
          className="rounded-full border px-2 py-0.5">
          <Text style={{ color: status.colour }} className="text-[10px] font-semibold">
            {status.label}
          </Text>
        </View>
      </View>

      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        Started {injury.started_on} · last update{' '}
        {updatedDays === 0 ? 'today' : `${updatedDays}d ago`}
      </Text>
      {injury.description ? (
        <Text className="text-gray-700 dark:text-gray-200 text-sm">
          {injury.description}
        </Text>
      ) : null}

      {injury.movements_hurt.length > 0 || injury.movements_ok.length > 0 ? (
        <View className="gap-1">
          {injury.movements_hurt.length > 0 ? (
            <View className="flex-row flex-wrap gap-1 items-center">
              <Ionicons name="close-circle" size={12} color="#EF4444" />
              {injury.movements_hurt.map((k) => (
                <MoveChip key={k} label={movementName(k)} tone="red" />
              ))}
            </View>
          ) : null}
          {injury.movements_ok.length > 0 ? (
            <View className="flex-row flex-wrap gap-1 items-center">
              <Ionicons name="checkmark-circle" size={12} color="#10B981" />
              {injury.movements_ok.map((k) => (
                <MoveChip key={k} label={movementName(k)} tone="green" />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {injury.status !== 'resolved' ? (
        updating ? (
          <CheckInForm injury={injury} onDone={() => setUpdating(false)} />
        ) : (
          <ChipButton
            className="self-start"
            tone={due ? 'amber' : 'primary'}
            label={due ? 'Check in (due)' : 'Check in'}
            icon="pulse-outline"
            onPress={() => setUpdating(true)}
          />
        )
      ) : null}
    </View>
  );
}

// The "few questions" of the weekly check-in: pain now, trending
// better/same/worse, status, optional note.
function CheckInForm({
  injury,
  onDone,
}: {
  injury: InjuryRow;
  onDone: () => void;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [pain, setPain] = useState(injury.pain_level);
  const [feeling, setFeeling] = useState<InjuryFeeling | null>(null);
  const [status, setStatus] = useState<InjuryStatus>(injury.status);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('log_injury_update', {
        p_injury_id: injury.id,
        p_pain_level: pain,
        p_feeling: feeling,
        p_status: status,
        p_note: note.trim() || null,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-injuries'] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the update')),
  });

  return (
    <View className="gap-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
      <PainPicker label="Pain today" value={pain} onChange={setPain} />

      <View className="gap-1.5">
        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          Compared to last time?
        </Text>
        <View className="flex-row gap-2">
          {(
            [
              ['better', 'Better', 'trending-down-outline'],
              ['same', 'Same', 'remove-outline'],
              ['worse', 'Worse', 'trending-up-outline'],
            ] as [InjuryFeeling, string, string][]
          ).map(([key, label, icon]) => (
            <Pressable
              key={key}
              onPress={() => setFeeling(key)}
              className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-full border ${
                feeling === key
                  ? 'border-primary bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
              <Ionicons
                name={icon as never}
                size={13}
                color={feeling === key ? colors.primary : colors.iconTertiary}
              />
              <Text
                className={`text-xs font-semibold ${
                  feeling === key
                    ? 'text-primary'
                    : 'text-gray-500 dark:text-gray-400'
                }`}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View className="gap-1.5">
        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          Where is it at?
        </Text>
        <View className="flex-row gap-2">
          {(['active', 'improving', 'resolved'] as InjuryStatus[]).map((s) => (
            <Pressable
              key={s}
              onPress={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-full border ${
                status === s
                  ? 'border-primary bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
              <Text
                className={`text-xs font-semibold ${
                  status === s
                    ? 'text-primary'
                    : 'text-gray-500 dark:text-gray-400'
                }`}>
                {STATUS_META[s].label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Input
        label="Anything to add? (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Squatted light, no pain until the last set…"
        multiline
      />

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button onPress={() => save.mutate()} loading={save.isPending}>
            Save check-in
          </Button>
        </View>
        <Button variant="secondary" onPress={onDone}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Small form controls
// ---------------------------------------------------------------------------

function SidePicker({
  value,
  onChange,
}: {
  value: InjurySide;
  onChange: (side: InjurySide) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        Side
      </Text>
      <View className="flex-row gap-2 flex-wrap">
        {(
          [
            ['left', 'Left'],
            ['right', 'Right'],
            ['both', 'Both'],
            ['na', 'N/A'],
          ] as [InjurySide, string][]
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            className={`px-3 py-1.5 rounded-full border ${
              value === key
                ? 'border-primary bg-primary/10'
                : 'border-gray-200 dark:border-gray-700'
            }`}>
            <Text
              className={`text-xs font-semibold ${
                value === key
                  ? 'text-primary'
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PainPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label} — {value}/10
      </Text>
      <View className="flex-row gap-1">
        {Array.from({ length: 11 }, (_, i) => i).map((i) => (
          <Pressable
            key={i}
            onPress={() => onChange(i)}
            style={{
              backgroundColor:
                i <= value ? painColour(i) : undefined,
            }}
            className={`flex-1 h-8 rounded-md items-center justify-center ${
              i <= value ? '' : 'bg-gray-200 dark:bg-gray-700'
            } ${i === value ? 'border-2 border-gray-900 dark:border-white' : ''}`}>
            <Text
              className={`text-[10px] font-bold ${
                i <= value ? 'text-white' : 'text-gray-500 dark:text-gray-400'
              }`}>
              {i}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MoveChip({ label, tone }: { label: string; tone: 'red' | 'green' }) {
  return (
    <View
      className={`rounded-full px-2 py-0.5 border ${
        tone === 'red'
          ? 'border-red-300 dark:border-red-700'
          : 'border-emerald-300 dark:border-emerald-700'
      }`}>
      <Text
        className={`text-[10px] font-semibold ${
          tone === 'red'
            ? 'text-red-600 dark:text-red-400'
            : 'text-emerald-700 dark:text-emerald-300'
        }`}>
        {label}
      </Text>
    </View>
  );
}

function MovementMultiPick({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ALL_MOVEMENTS;
    return ALL_MOVEMENTS.filter((m) => m.name.toLowerCase().includes(q));
  }, [filter]);

  function toggle(key: string) {
    onChange(
      value.includes(key) ? value.filter((k) => k !== key) : [...value, key],
    );
  }

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center">
        <Text className="flex-1 text-gray-700 dark:text-gray-200 text-sm font-medium">
          {label}
        </Text>
        <ChipButton
          tone="neutral"
          label={open ? 'Done' : value.length > 0 ? 'Edit' : 'Add'}
          icon={open ? 'checkmark' : 'add'}
          onPress={() => setOpen((v) => !v)}
        />
      </View>
      {value.length > 0 && !open ? (
        <View className="flex-row flex-wrap gap-1">
          {value.map((k) => (
            <MoveChip
              key={k}
              label={movementName(k)}
              tone={label.toLowerCase().includes('hurt') ? 'red' : 'green'}
            />
          ))}
        </View>
      ) : null}
      {open ? (
        <View className="gap-2 bg-white dark:bg-gray-900 rounded-lg p-2">
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter movements…"
            placeholderTextColor="#9CA3AF"
            className="bg-gray-50 dark:bg-gray-800 rounded-md px-3 py-2 text-gray-900 dark:text-gray-50 text-sm"
          />
          <View className="flex-row flex-wrap gap-1">
            {shown.map((m) => {
              const on = value.includes(m.key);
              return (
                <Pressable
                  key={m.key}
                  onPress={() => toggle(m.key)}
                  className={`rounded-full px-2.5 py-1 border ${
                    on
                      ? 'border-primary bg-primary/10'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Text
                    className={`text-[11px] font-medium ${
                      on
                        ? 'text-primary'
                        : 'text-gray-600 dark:text-gray-300'
                    }`}>
                    {m.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
