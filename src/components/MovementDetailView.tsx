import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PageHead } from './PageHead';
import { FieldLabel } from './SectionLabel';
import { Text } from './Text';

import { BackLink } from '@/components/BackLink';
import { ChipButton } from '@/components/ChipButton';
import { RecordHyroxRaceModal } from '@/components/RecordHyroxRaceModal';
import { EmptyState } from '@/components/EmptyState';
import { ListRow, RuledList } from '@/components/ListRow';
import { PillNav } from '@/components/PillNav';
import { RecordMovementResultModal } from '@/components/RecordMovementResultModal';
import { Screen } from '@/components/Screen';
import { Sparkline } from '@/components/Sparkline';
import { StrengthLeaderboard } from '@/components/StrengthLeaderboard';
import { useGymMembership, useSession } from '@/lib/auth';
import { HYROX_SIM } from '@/lib/hyrox';
import { findMovement, type Metric, type Movement } from '@/lib/movements';
import {
  bestOfMerged,
  deriveTagValue,
  mergeJournal,
  prRowIds,
  type JournalRow,
  type SectionForDerivation,
  type TagInputRow,
} from '@/lib/movement-journal';
import { normaliseForPlot, trendPoints } from '@/lib/movement-trend';
import {
  formatWeight,
  percentWeight,
  resolveOneRepMax,
  PERCENT_STEPS,
} from '@/lib/one-rep-max';
import { useGymDiscipline } from '@/lib/useGymDiscipline';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import { useMovementFavourites } from '@/lib/useFavouriteMovements';
import {
  categoryLabel,
  type SectionCategoryKey,
  type SectionFormatKey,
} from '@/lib/programming';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import {
  fmtDateShort,
  formatResultValue,
  type TrackedResultRow,
} from '@/lib/track';

// Shared per-movement detail, rendered by both the member route
// (full: record + leaderboard + workout links) and the gymless
// athlete route (read-only: just best-of, PR badges, trend, journal).
// `mode` is the single switch so the two route files stay thin and the
// fetch/merge/PR logic lives in exactly one place.
type Mode = 'member' | 'athlete';

type RawTagRow = {
  id: string;
  movement_key: string;
  track_key: string | null;
  performed_at: string;
  notes: string | null;
  section: {
    workout_id: string | null;
    section_category: SectionCategoryKey;
    title: string | null;
    section_format: SectionFormatKey;
    total_time_seconds: number | null;
    total_rounds: number | null;
    total_distance_m: number | null;
    total_calories: number | null;
    entries: {
      weight_numeric: number | null;
      reps: number | null;
      time_seconds: number | null;
      distance_numeric: number | null;
      calories: number | null;
    }[];
  } | null;
};

export function MovementDetailView({
  movementKey,
  mode,
}: {
  movementKey: string;
  mode: Mode;
}) {
  const isMember = mode === 'member';
  const session = useSession();
  const colors = useThemeColors();
  const discipline = useGymDiscipline();
  const weightUnit = useGymWeightUnit();
  const meta = movementKey ? findMovement(movementKey) : undefined;
  const fav = useMovementFavourites(discipline);
  const starred = fav.movements.has(movementKey);
  const [recording, setRecording] = useState<{ trackKey?: string } | null>(
    null,
  );
  const [recordingRace, setRecordingRace] = useState(false);
  // ?tab= deep-links a tab open (and lets the harness photograph each);
  // read once so it doesn't fight later taps.
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'history' | 'percentages' | 'leaderboard'>(
    params.tab === 'percentages' || params.tab === 'leaderboard'
      ? params.tab
      : 'history',
  );
  const [heroWidth, setHeroWidth] = useState(0);

  const direct = useQuery({
    queryKey: ['tracked-results-by-movement', session?.user.id, movementKey],
    enabled: !!session?.user.id && !!movementKey,
    queryFn: async (): Promise<TrackedResultRow[]> => {
      const { data, error } = await supabase
        .from('tracked_movement_results')
        .select(
          'id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at',
        )
        .eq('profile_id', session!.user.id)
        .eq('movement_key', movementKey)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrackedResultRow[];
    },
  });

  const tags = useQuery({
    queryKey: ['tracked-tags-by-movement', session?.user.id, movementKey],
    enabled: !!session?.user.id && !!movementKey,
    queryFn: async (): Promise<RawTagRow[]> => {
      const { data, error } = await supabase
        .from('tracked_section_movement_tags')
        .select(
          'id, movement_key, track_key, performed_at, notes, section:tracked_workout_sections(workout_id, section_category, title, section_format, total_time_seconds, total_rounds, total_distance_m, total_calories, entries:tracked_section_entries(weight_numeric, reps, time_seconds, distance_numeric, calories))',
        )
        .eq('profile_id', session!.user.id)
        .eq('movement_key', movementKey)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RawTagRow[];
    },
  });

  const merged = useMemo<JournalRow[]>(() => {
    if (!meta) return [];
    const direct_inputs = (direct.data ?? []).map((r) => ({
      id: r.id,
      workout_id: r.workout_id,
      movement_key: r.movement_key,
      track_key: r.track_key,
      value_numeric: r.value_numeric,
      value_seconds: r.value_seconds,
      value_unit: r.value_unit,
      notes: r.notes,
      performed_at: r.performed_at,
    }));
    const tag_inputs: TagInputRow[] = (tags.data ?? []).map((t) => {
      const scheme = t.track_key
        ? meta.movement.schemes.find((s) => s.key === t.track_key)
        : undefined;
      const derived =
        scheme && t.section
          ? deriveTagValue(scheme, t.section as SectionForDerivation)
          : { value_numeric: null, value_seconds: null };
      const sectionTitle = t.section
        ? t.section.title?.trim() || categoryLabel(t.section.section_category)
        : null;
      return {
        id: t.id,
        workout_id: t.section?.workout_id ?? null,
        section_title: sectionTitle,
        movement_key: t.movement_key,
        track_key: t.track_key,
        notes: t.notes,
        performed_at: t.performed_at,
        value_numeric: derived.value_numeric,
        value_seconds: derived.value_seconds,
        value_unit:
          scheme?.metric === 'weight'
            ? 'kg'
            : scheme?.metric === 'distance'
              ? 'm'
              : null,
      };
    });
    return mergeJournal(direct_inputs, tag_inputs);
  }, [meta, direct.data, tags.data]);

  const prIds = useMemo(() => {
    if (!meta) return new Set<string>();
    return prRowIds(merged, (key) =>
      meta.movement.schemes.find((s) => s.key === key),
    );
  }, [meta, merged]);

  if (!meta) {
    return (
      <Screen>
        <Text className="text-ink-2 dark:text-ink-2-dk mt-8">
          Unknown movement.
        </Text>
      </Screen>
    );
  }

  const { group, movement } = meta;
  const backHref = isMember ? `/track/group/${group.key}` : '/athlete';

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <PageHead
          lead={<BackLink inline fallbackHref={backHref as Href} />}
          title={movement.name}
          subtitle={group.name}
          action={
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => fav.toggleMovement(movementKey, !starred)}
                hitSlop={8}
                accessibilityLabel={starred ? 'Unstar movement' : 'Star movement'}
                className="w-9 h-9 rounded-full items-center justify-center hover:opacity-80 active:opacity-60">
                <Ionicons
                  name={starred ? 'star' : 'star-outline'}
                  size={20}
                  color={starred ? '#F59E0B' : colors.ink2}
                />
              </Pressable>
              {isMember ? (
                <Pressable
                  onPress={() => setRecording({})}
                  hitSlop={6}
                  className="bg-primary hover:opacity-90 active:bg-primary-dark rounded-full px-3 py-1.5 flex-row items-center gap-1">
                  <Ionicons name="add" size={14} color={colors.onPrimary} />
                  <Text className="text-on-primary text-xs font-semibold">Record</Text>
                </Pressable>
              ) : null}
            </View>
          }
        />

        <View className="gap-3">
          {(() => {
            const primary = movement.schemes[0];
            if (!primary) return null;
            const best = bestOfMerged(merged, primary.key, primary);
            const display = best
              ? formatResultValue(best, primary.metric, weightUnit)
              : null;
            const series = normaliseForPlot(
              trendPoints(merged, primary.key, primary.metric),
              primary.better,
            );
            return (
              <Pressable
                disabled={!isMember}
                onPress={() => setRecording({ trackKey: primary.key })}
                onLayout={(e) => setHeroWidth(e.nativeEvent.layout.width)}
                className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2 active:opacity-80">
                <View className="flex-row items-center justify-between">
                  <FieldLabel>
                    {`Best ${primary.label.toLowerCase()}`}
                  </FieldLabel>
                  {isMember && movement.key === HYROX_SIM.key ? (
                    <Pressable
                      onPress={() => setRecordingRace(true)}
                      hitSlop={6}
                      className="flex-row items-center gap-1 active:opacity-70">
                      <Ionicons
                        name="flag-outline"
                        size={13}
                        color={colors.primary}
                      />
                      <Text className="text-primary text-xs font-semibold">
                        Log full splits
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <View className="flex-row items-end justify-between gap-3">
                  <Text
                    className={
                      display
                        ? 'text-ink dark:text-ink-dk text-[34px] font-bold leading-10 tracking-[-0.5px]'
                        : 'text-ink-3 dark:text-ink-3-dk text-lg'
                    }>
                    {display ?? (isMember ? 'Tap to log one' : 'No result yet')}
                  </Text>
                  {best ? (
                    <View className="rounded-full bg-amber-500/15 px-2 py-0.5 flex-row items-center gap-1">
                      <Ionicons name="trophy" size={10} color="#F59E0B" />
                      <Text className="text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
                        {`PR \u00B7 ${fmtDateShort(best.performed_at)}`}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {series.length >= 2 && heroWidth > 0 ? (
                  <Sparkline
                    values={series}
                    color={colors.primary}
                    width={heroWidth - 32}
                    height={44}
                    label={`${primary.label} trend, ${series.length} results`}
                  />
                ) : null}
              </Pressable>
            );
          })()}

          {movement.schemes.length > 1 ? (
            <RuledList>
              {movement.schemes.slice(1).map((scheme, i) => {
                const best = bestOfMerged(merged, scheme.key, scheme);
                const display = best
                  ? formatResultValue(best, scheme.metric, weightUnit)
                  : null;
                return (
                  <ListRow
                    key={scheme.key}
                    ruled
                    first={i === 0}
                    title={scheme.label}
                    subtitle={
                      best
                        ? `Set ${fmtDateShort(best.performed_at)}${
                            best.source === 'tag' ? ' \u00B7 from session' : ''
                          }`
                        : isMember
                          ? 'Tap to log one'
                          : 'No result logged'
                    }
                    onPress={
                      isMember
                        ? () => setRecording({ trackKey: scheme.key })
                        : undefined
                    }
                    trailing={
                      <Text
                        className={
                          display
                            ? 'text-ink dark:text-ink-dk text-base font-semibold'
                            : 'text-ink-3 dark:text-ink-3-dk text-sm'
                        }>
                        {display ?? (isMember ? '+' : '\u2014')}
                      </Text>
                    }
                  />
                );
              })}
            </RuledList>
          ) : null}
        </View>

        <PillNav
          items={[
            { key: 'history' as const, label: 'History' },
            ...(movement.schemes.some(
              (sch) => sch.metric === 'weight' && sch.better === 'higher',
            )
              ? [{ key: 'percentages' as const, label: 'Percentages' }]
              : []),
            ...(isMember
              ? [{ key: 'leaderboard' as const, label: 'Leaderboard' }]
              : []),
          ]}
          active={tab}
          onSelect={setTab}
        />

        {tab === 'percentages' ? (
          <MovementPercentagesCard
            movement={movement}
            merged={merged}
            onRecord={isMember ? () => setRecording({ trackKey: '1rm' }) : null}
          />
        ) : tab === 'leaderboard' && isMember ? (
          <MovementLeaderboardSection
            movementKey={movement.key}
            schemes={movement.schemes}
          />
        ) : (
          <View className="gap-3">
            {direct.isLoading || tags.isLoading ? (
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                Loading…
              </Text>
            ) : merged.length === 0 ? (
              <EmptyState
                icon="trending-up-outline"
                title={`No results for ${movement.name} yet`}
                description="Record one and your history and PRs start here."
                actionLabel={isMember ? 'Record a result' : undefined}
                onAction={isMember ? () => setRecording({}) : undefined}
              />
            ) : (
              <View className="gap-2">
                {merged.map((r) => (
                  <JournalRowView
                    key={r.id}
                    row={r}
                    schemeLabel={
                      movement.schemes.find((s) => s.key === r.track_key)
                        ?.label ??
                      r.track_key ??
                      'Untagged'
                    }
                    metric={
                      movement.schemes.find((s) => s.key === r.track_key)
                        ?.metric
                    }
                    isPR={prIds.has(r.id)}
                    linkable={isMember}
                  />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {isMember ? (
        <RecordMovementResultModal
          visible={recording !== null}
          discipline={discipline}
          onClose={() => setRecording(null)}
          initialMovementKey={movement.key}
          initialTrackKey={recording?.trackKey}
        />
      ) : null}

      {isMember && movement.key === HYROX_SIM.key ? (
        <RecordHyroxRaceModal
          visible={recordingRace}
          onClose={() => setRecordingRace(false)}
        />
      ) : null}
    </Screen>
  );
}

// What to load for a given percentage of this member's 1RM. Resolved
// from the journal already fetched above rather than a second query.
// Only for movements you can actually load — a percentage of a 5k time
// means nothing.
function MovementPercentagesCard({
  movement,
  merged,
  onRecord,
}: {
  movement: Movement;
  merged: JournalRow[];
  onRecord: (() => void) | null;
}) {
  const weightUnit = useGymWeightUnit();
  const loadable = movement.schemes.some(
    (s) => s.metric === 'weight' && s.better === 'higher',
  );
  if (!loadable) return null;

  const resolved = resolveOneRepMax(merged, movement);

  return (
    <View className="gap-3">
      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
        {resolved === null ? (
          <>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Log a 1 rep max — or a 3, 5 or 10 rep max — and we'll work
              out your percentages here and in your programming.
            </Text>
            {onRecord ? (
              <ChipButton
                className="self-start"
                tone="primary"
                icon="add-circle-outline"
                label="Log a 1 rep max"
                onPress={onRecord}
              />
            ) : null}
          </>
        ) : (
          <>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              {resolved.source === 'recorded'
                ? `Of your ${formatWeight(resolved.value, weightUnit)} 1RM, set ${fmtDateShort(resolved.performedAt)}`
                : `Of ~${formatWeight(resolved.value, weightUnit)}, estimated from your ${resolved.fromReps} rep max (${formatWeight(resolved.fromValue, weightUnit)} × ${resolved.fromReps}, ${fmtDateShort(resolved.performedAt)})`}
            </Text>
            <View className="flex-row flex-wrap -m-1">
              {PERCENT_STEPS.map((pct) => (
                <View key={pct} className="w-1/2 md:w-1/3 p-1">
                  <View className="flex-row items-baseline justify-between rounded-ctl bg-raised dark:bg-raised-dk px-3 py-2">
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-semibold">
                      {pct}%
                    </Text>
                    <Text className="text-ink dark:text-ink-dk font-semibold">
                      {formatWeight(percentWeight(resolved.value, pct), weightUnit)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function MovementLeaderboardSection({
  movementKey,
  schemes,
}: {
  movementKey: string;
  schemes: { key: string; label: string; metric: Metric; better: 'higher' | 'lower' }[];
}) {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const enabled = useQuery({
    queryKey: ['gym-leaderboard-flags', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gyms')
        .select('strength_leaderboards_enabled')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data.strength_leaderboards_enabled;
    },
  });
  const [activeScheme, setActiveScheme] = useState<string>(schemes[0]?.key ?? '');
  if (enabled.data === false) return null;
  if (schemes.length === 0) return null;
  const scheme = schemes.find((s) => s.key === activeScheme) ?? schemes[0];
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        {schemes.map((s) => (
          <Pressable
            key={s.key}
            onPress={() => setActiveScheme(s.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: s.key === scheme.key }}
            className={`rounded-full px-3 py-1 border active:opacity-70 ${
              s.key === scheme.key
                ? 'bg-raised dark:bg-raised-dk border-transparent'
                : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk'
            }`}>
            <Text
              className={
                s.key === scheme.key
                  ? 'text-ink dark:text-ink-dk text-xs font-semibold'
                  : 'text-ink-2 dark:text-ink-2-dk text-xs'
              }>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <StrengthLeaderboard
        movementKey={movementKey}
        scheme={scheme}
        limit={5}
      />
    </View>
  );
}

function JournalRowView({
  row,
  schemeLabel,
  metric,
  isPR,
  linkable,
}: {
  row: JournalRow;
  schemeLabel: string;
  metric: Metric | undefined;
  isPR: boolean;
  linkable: boolean;
}) {
  const weightUnit = useGymWeightUnit();
  const display = metric ? formatResultValue(row, metric, weightUnit) : null;
  const body = (
    <>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-ink dark:text-ink-dk text-sm font-medium">
            {row.section_title ?? schemeLabel}
          </Text>
          {isPR ? (
            <View className="rounded-full bg-amber-500/15 px-1.5 py-0.5 flex-row items-center gap-0.5">
              <Ionicons name="trophy" size={9} color="#F59E0B" />
              <Text className="text-amber-600 dark:text-amber-400 text-[9px] font-semibold uppercase tracking-wider">
                PR
              </Text>
            </View>
          ) : null}
          {row.source === 'tag' ? (
            <View className="rounded-full bg-primary/10 px-1.5 py-0.5">
              <Text className="text-primary text-[9px] font-semibold uppercase tracking-wider">
                Session
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {row.section_title ? `${schemeLabel} · ` : ''}
          {fmtDateShort(row.performed_at)}
          {row.notes ? ` · ${row.notes}` : ''}
        </Text>
      </View>
      <Text className="text-ink dark:text-ink-dk font-semibold">
        {display ?? '—'}
      </Text>
    </>
  );
  if (!linkable) {
    return (
      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 flex-row items-center gap-3">
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() =>
        row.workout_id
          ? router.push(`/track/workout/${row.workout_id}` as never)
          : router.push('/track/journal' as never)
      }
      className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 flex-row items-center gap-3 active:opacity-70">
      {body}
    </Pressable>
  );
}
