import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from './Text';

import { Button } from './Button';
import { Sheet, SheetAction } from './Sheet';
import { DatePicker } from './DatePicker';
import { Input } from './Input';
import { FieldLabel } from './SectionLabel';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  HYROX_AGE_GROUPS,
  HYROX_GENDER_CATEGORIES,
  HYROX_RACE_DIVISIONS,
  HYROX_RACE_TYPES,
  HYROX_SIM,
  type HyroxGenderCategory,
  type HyroxRaceDivision,
  type HyroxRaceType,
} from '@/lib/hyrox';
import {
  allSplitsFilled,
  computeRaceTotals,
  emptyRaceSplits,
  type SplitDraft,
} from '@/lib/hyrox-race';
import { supabase } from '@/lib/supabase';
import { formatSeconds, parseDuration } from '@/lib/track';
import { useSavedFlag } from '@/lib/useSavedFlag';
import { useThemePreference } from '@/lib/theme';
import { webSelectStyle } from '@/lib/webSelect';

function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

const SEGMENT_LABEL: Record<SplitDraft['segmentType'], string> = {
  run: 'Run',
  roxzone: 'Roxzone',
  station: '',
};

export function RecordHyroxRaceModal({
  visible,
  onClose,
  initialRaceLength = 'full',
}: {
  visible: boolean;
  onClose: () => void;
  initialRaceLength?: 'full' | 'half';
}) {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const { scheme } = useThemePreference();

  const [date, setDate] = useState(todayLocalIso());
  const [raceLength, setRaceLength] = useState<'full' | 'half'>(initialRaceLength);
  const [raceType, setRaceType] = useState<HyroxRaceType>('singles');
  const [division, setDivision] = useState<HyroxRaceDivision>('open');
  const [genderCategory, setGenderCategory] = useState<HyroxGenderCategory>('mens');
  const [ageGroup, setAgeGroup] = useState<string>('');
  // The raw text the user typed per split, kept separate from the
  // parsed seconds — binding the input's value to a reformatted
  // "seconds -> MM:SS" string would fight the user's typing on every
  // keystroke (same reason RecordMovementResultModal stores draft.value
  // as a raw string and only parses at save time).
  const [splitTexts, setSplitTexts] = useState<string[]>(() =>
    emptyRaceSplits().map(() => ''),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  useEffect(() => {
    if (!visible) return;
    setDate(todayLocalIso());
    setRaceLength(initialRaceLength);
    setRaceType('singles');
    setDivision('open');
    setGenderCategory('mens');
    setAgeGroup('');
    setSplitTexts(emptyRaceSplits().map(() => ''));
    setError(null);
  }, [visible, initialRaceLength]);

  function updateSplit(index: number, text: string) {
    setSplitTexts((cur) => cur.map((t, i) => (i === index ? text : t)));
  }

  const splits: SplitDraft[] = useMemo(
    () =>
      emptyRaceSplits().map((s, i) => ({
        ...s,
        seconds: parseDuration(splitTexts[i]),
      })),
    [splitTexts],
  );
  const totals = computeRaceTotals(splits);
  const canSave = allSplitsFilled(splits) && !!date;

  const save = useMutation({
    mutationFn: async () => {
      if (!session || !membership) throw new Error('Missing context');
      if (!canSave) throw new Error('Fill in every split first');
      const gymId = membership.gymId;
      const performedAtIso = new Date(`${date}T12:00:00`).toISOString();

      const { data: workoutRow, error: workoutError } = await supabase
        .from('tracked_workouts')
        .insert({
          gym_id: gymId,
          profile_id: session.user.id,
          performed_at: performedAtIso,
          title: `${raceLength === 'full' ? 'Full' : 'Half'} Hyrox race simulation`,
        })
        .select('id')
        .single();
      if (workoutError) throw workoutError;
      const workoutId = workoutRow!.id;

      const { data: raceRow, error: raceError } = await supabase
        .from('tracked_hyrox_races')
        .insert({
          gym_id: gymId,
          profile_id: session.user.id,
          workout_id: workoutId,
          race_length: raceLength,
          race_type: raceType,
          division,
          gender_category: genderCategory,
          age_group: ageGroup || null,
          run_total_seconds: totals.runTotalSeconds,
          station_total_seconds: totals.stationTotalSeconds,
          roxzone_total_seconds: totals.roxzoneTotalSeconds,
          total_seconds: totals.totalSeconds,
          performed_at: performedAtIso,
        })
        .select('id')
        .single();
      if (raceError) throw raceError;
      const raceId = raceRow!.id;

      const splitRows = splits.map((s) => ({
        gym_id: gymId,
        profile_id: session.user.id,
        race_id: raceId,
        segment_type: s.segmentType,
        segment_index: s.segmentIndex,
        station_key: s.stationKey ?? null,
        time_seconds: s.seconds!,
      }));
      const { error: splitsError } = await supabase
        .from('tracked_hyrox_splits')
        .insert(splitRows);
      if (splitsError) throw splitsError;

      // Also write the aggregate as an ordinary PB result so the
      // existing leaderboard/PR-badge/sparkline surfaces for
      // hyrox_sim keep working unchanged — this table is the detail
      // view underneath that single number, not a replacement for it.
      const { error: resultError } = await supabase
        .from('tracked_movement_results')
        .insert({
          gym_id: gymId,
          profile_id: session.user.id,
          workout_id: workoutId,
          movement_key: HYROX_SIM.key,
          track_key: raceLength,
          value_seconds: totals.totalSeconds,
          performed_at: performedAtIso,
        });
      if (resultError) throw resultError;
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['tracked-journal'] });
      queryClient.invalidateQueries({ queryKey: ['tracked-results-by-movement'] });
      queryClient.invalidateQueries({ queryKey: ['tracked-results-by-group'] });
      setTimeout(() => onClose(), 600);
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the race')),
  });

  return (
<Sheet
      visible={visible}
      title={"Log a full race simulation"}
      subtitle={"Every run, station and roxzone split — the total posts as your Race Simulation result too."}
      dialogWidth={620}
      onClose={onClose}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button
              onPress={() => save.mutate()}
              loading={save.isPending}
              success={saved}
              disabled={!canSave}>
              Save race
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-4 pb-1">

            <DatePicker label="Date" value={date} onChange={setDate} />

            <View className="flex-row gap-2">
              <ChipRow
                value={raceLength}
                onChange={setRaceLength}
                options={[
                  { value: 'full', label: 'Full' },
                  { value: 'half', label: 'Half' },
                ]}
              />
            </View>

            <View className="gap-2">
              <FieldLabel>
                Race type
              </FieldLabel>
              <ChipRow
                value={raceType}
                onChange={setRaceType}
                options={HYROX_RACE_TYPES.map((o) => ({ value: o.value, label: o.label }))}
              />
            </View>

            <View className="gap-2">
              <FieldLabel>
                Division
              </FieldLabel>
              <ChipRow
                value={division}
                onChange={setDivision}
                options={HYROX_RACE_DIVISIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </View>

            <View className="gap-2">
              <FieldLabel>
                Category
              </FieldLabel>
              <ChipRow
                value={genderCategory}
                onChange={setGenderCategory}
                options={HYROX_GENDER_CATEGORIES.map((o) => ({ value: o.value, label: o.label }))}
              />
            </View>

            <View className="gap-1.5">
              <FieldLabel>
                Age group (optional)
              </FieldLabel>
              {Platform.OS === 'web' ? (
                // eslint-disable-next-line jsx-a11y/no-onchange
                <select
                  value={ageGroup}
                  onChange={(e) => setAgeGroup(e.target.value)}
                  style={webSelectStyle(scheme === 'dark', {
                    fontSize: 14,
                    padding: '8px 10px',
                  })}>
                  <option value="">Not specified</option>
                  {HYROX_AGE_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              ) : (
                <ChipRow
                  value={ageGroup}
                  onChange={setAgeGroup}
                  options={[
                    { value: '', label: 'N/A' },
                    ...HYROX_AGE_GROUPS.map((g) => ({ value: g, label: g })),
                  ]}
                />
              )}
            </View>

            <View className="gap-3">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                Splits — 8 laps, run → roxzone → station
              </Text>
              {Array.from({ length: 8 }, (_, lap) => (
                <LapCard
                  key={lap}
                  lapNumber={lap + 1}
                  splits={splits.slice(lap * 3, lap * 3 + 3)}
                  texts={splitTexts.slice(lap * 3, lap * 3 + 3)}
                  baseIndex={lap * 3}
                  onChangeSplit={updateSplit}
                />
              ))}
            </View>

            <View className="bg-primary/5 rounded-xl p-3 gap-1">
              <TotalRow label="Runs" seconds={totals.runTotalSeconds} />
              <TotalRow label="Stations" seconds={totals.stationTotalSeconds} />
              <TotalRow label="Roxzone" seconds={totals.roxzoneTotalSeconds} />
              <View className="h-px bg-sunken dark:bg-sunken-dk my-1" />
              <TotalRow label="Total" seconds={totals.totalSeconds} bold />
            </View>

          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          {!canSave && !error ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
              Fill in all 24 splits to save.
            </Text>
          ) : null}

      </View>
    </Sheet>
  );
}

function LapCard({
  lapNumber,
  splits,
  texts,
  baseIndex,
  onChangeSplit,
}: {
  lapNumber: number;
  splits: SplitDraft[];
  texts: string[];
  baseIndex: number;
  onChangeSplit: (index: number, text: string) => void;
}) {
  return (
    <View className="bg-raised dark:bg-raised-dk rounded-xl p-3 gap-2">
      <FieldLabel>
        Lap {lapNumber}
      </FieldLabel>
      {splits.map((s, i) => (
        <Input
          key={`${s.segmentType}-${s.segmentIndex}`}
          label={
            s.segmentType === 'station'
              ? stationLabel(s.stationKey)
              : `${SEGMENT_LABEL[s.segmentType]} ${s.segmentIndex}`
          }
          value={texts[i]}
          onChangeText={(text) => onChangeSplit(baseIndex + i, text)}
          placeholder="MM:SS"
          keyboardType="default"
        />
      ))}
    </View>
  );
}

function stationLabel(stationKey: string | undefined): string {
  if (!stationKey) return 'Station';
  const name = stationKey
    .replace('hyrox_', '')
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
  return name;
}

function TotalRow({
  label,
  seconds,
  bold,
}: {
  label: string;
  seconds: number;
  bold?: boolean;
}) {
  return (
    <View className="flex-row justify-between">
      <Text
        className={
          bold
            ? 'text-ink dark:text-ink-dk text-sm font-semibold'
            : 'text-ink-2 dark:text-ink-2-dk text-sm'
        }>
        {label}
      </Text>
      <Text
        className={
          bold
            ? 'text-ink dark:text-ink-dk text-sm font-semibold'
            : 'text-ink-2 dark:text-ink-2-dk text-sm'
        }>
        {formatSeconds(seconds)}
      </Text>
    </View>
  );
}

function ChipRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <View className="flex-row gap-2 flex-wrap">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-full border ${
              on
                ? 'bg-primary border-primary'
                : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk'
            }`}>
            <Text
              className={`text-xs font-medium ${
                on ? 'text-white' : 'text-ink-2 dark:text-ink-2-dk'
              }`}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
