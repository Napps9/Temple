import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BodyMap } from '@/components/BodyMap';
import {
  DATE_RE,
  DateRangeCta,
  isoDate,
  presetRange,
  type Preset,
} from '@/components/DateRangeCta';
import { Screen } from '@/components/Screen';
import {
  computeMovementTrends,
  type MovementTrendSummary,
} from '@/lib/analysis';
import { useGymMembership } from '@/lib/auth';
import {
  daysAgo,
  injuryTitle,
  painColour,
  regionLabel,
  STATUS_META,
} from '@/lib/injuries';
import {
  ENERGY_COLOURS,
  ENERGY_LABELS,
  ENERGY_LABELS_SHORT,
  ENERGY_SYSTEMS,
  PATTERN_LABELS,
  PATTERN_LABELS_SHORT,
  type EnergySystem,
  type MovementPattern,
} from '@/lib/movement-classification';
import {
  deriveTagValue,
  type SectionForDerivation,
} from '@/lib/movement-journal';
import { findScheme, movementName } from '@/lib/movements';
import {
  categoryLabel,
  parseSections,
  type Section,
} from '@/lib/programming';
import {
  classifyProgrammedSection,
  computeBalance,
  computeEnergyMix,
  computePatternEnergyMatrix,
  computePatternMix,
  computeRegionVolume,
  untaggedSections,
  type ClassifiedSection,
} from '@/lib/programming-balance';
import { supabase } from '@/lib/supabase';
import { formatSeconds } from '@/lib/track';
import { useCan } from '@/lib/useCan';
import { useClassTypes } from '@/lib/useClassCatalog';
import type { InjurySide, InjuryStatus } from '@/types/database';

const TWELVE_WEEKS_MS = 12 * 7 * 24 * 60 * 60 * 1000;

type OpenInjury = {
  id: string;
  profile_id: string;
  body_region: string;
  side: InjurySide;
  pain_level: number;
  status: InjuryStatus;
  movements_hurt: string[];
  updated_at: string;
  profiles: { full_name: string | null } | null;
};

type ResultRow = {
  profile_id: string;
  movement_key: string;
  track_key: string;
  value_numeric: number | null;
  value_seconds: number | null;
  performed_at: string;
};

// A movement tagged onto a recorded workout section. The section
// carries the raw data we derive the headline value from (same shape
// the movement-journal page uses).
type TagRow = {
  profile_id: string;
  movement_key: string;
  track_key: string | null;
  performed_at: string;
  section: SectionForDerivation | null;
};

// Coach-facing programming analysis: where the gym is hurting (open
// injuries on a body-map heat view) and how movements are trending
// per member and collectively, from deliberate PR logs over the last
// twelve weeks.
export default function AnalysisScreen() {
  const { data: membership } = useGymMembership();
  const canSeeHealth = useCan('can_see_health_flag') ?? false;
  const canSeeLogs = useCan('can_see_workout_logs') ?? false;

  const injuries = useQuery({
    queryKey: ['gym-open-injuries', membership?.gymId],
    enabled: !!membership?.gymId && canSeeHealth,
    queryFn: async (): Promise<OpenInjury[]> => {
      const { data, error } = await supabase
        .from('member_injuries')
        .select(
          'id, profile_id, body_region, side, pain_level, status, movements_hurt, updated_at, profiles!profile_id(full_name)',
        )
        .eq('gym_id', membership!.gymId)
        .neq('status', 'resolved')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OpenInjury[];
    },
  });

  const results = useQuery({
    queryKey: ['gym-movement-results', membership?.gymId],
    enabled: !!membership?.gymId && canSeeLogs,
    queryFn: async (): Promise<ResultRow[]> => {
      const sinceIso = new Date(Date.now() - TWELVE_WEEKS_MS).toISOString();
      const { data, error } = await supabase
        .from('tracked_movement_results')
        .select(
          'profile_id, movement_key, track_key, value_numeric, value_seconds, performed_at',
        )
        .eq('gym_id', membership!.gymId)
        .gte('performed_at', sinceIso);
      if (error) throw error;
      return (data ?? []) as ResultRow[];
    },
  });

  // Movements tagged onto recorded workout sections also count toward
  // the trend — a member who hits a new back-squat 1RM inside a
  // Strength & Skill section should move the needle the same as a
  // direct PR log.
  const tags = useQuery({
    queryKey: ['gym-section-movement-tags', membership?.gymId],
    enabled: !!membership?.gymId && canSeeLogs,
    queryFn: async (): Promise<TagRow[]> => {
      const sinceIso = new Date(Date.now() - TWELVE_WEEKS_MS).toISOString();
      const { data, error } = await supabase
        .from('tracked_section_movement_tags')
        .select(
          'profile_id, movement_key, track_key, performed_at, section:tracked_workout_sections(section_format, total_time_seconds, total_rounds, entries:tracked_section_entries(weight_numeric, reps, time_seconds, distance_numeric, calories))',
        )
        .eq('gym_id', membership!.gymId)
        .gte('performed_at', sinceIso);
      if (error) throw error;
      return (data ?? []) as unknown as TagRow[];
    },
  });

  const names = useQuery({
    queryKey: ['gym-member-names', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .is('left_at', null);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data ?? []) as unknown as {
        profile_id: string;
        profiles: { full_name: string | null } | null;
      }[]) {
        map.set(r.profile_id, r.profiles?.full_name ?? 'Member');
      }
      return map;
    },
  });

  const trends = useMemo(() => {
    const directPoints = (results.data ?? [])
      .map((r) => {
        const metric = findScheme(r.movement_key, r.track_key)?.metric;
        const value = metric === 'time' ? r.value_seconds : r.value_numeric;
        if (value == null) return null;
        return {
          profile_id: r.profile_id,
          movement_key: r.movement_key,
          track_key: r.track_key,
          value,
          performed_at: r.performed_at,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // Derive a comparable value from each section tag using the same
    // format-aware logic the movement journal uses, so a tagged result
    // sits in the same (movement, track) bucket as a direct log.
    const tagPoints = (tags.data ?? [])
      .map((t) => {
        if (!t.track_key || !t.section) return null;
        const scheme = findScheme(t.movement_key, t.track_key);
        if (!scheme) return null;
        const derived = deriveTagValue(scheme, t.section);
        const value =
          scheme.metric === 'time'
            ? derived.value_seconds
            : derived.value_numeric;
        if (value == null) return null;
        return {
          profile_id: t.profile_id,
          movement_key: t.movement_key,
          track_key: t.track_key,
          value,
          performed_at: t.performed_at,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    return computeMovementTrends(
      [...directPoints, ...tagPoints],
      (m, t) => findScheme(m, t)?.better ?? 'higher',
    );
  }, [results.data, tags.data]);

  const open = injuries.data ?? [];

  // Heat tint per region: more open injuries = hotter.
  const highlights = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of open)
      counts.set(r.body_region, (counts.get(r.body_region) ?? 0) + 1);
    const map: Record<string, string> = {};
    for (const [region, n] of counts)
      map[region] = n >= 3 ? '#EF4444' : n === 2 ? '#F97316' : '#F59E0B';
    return { map, counts };
  }, [open]);

  const { width } = useWindowDimensions();
  const figureWidth = width < 360 ? 96 : width < 768 ? 110 : 120;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Programming analysis
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Balance across energy systems, movement patterns and body
            regions — plus open injuries and member trends.
          </Text>
        </View>

        {membership?.gymId ? (
          <ProgrammingBalanceBlock
            gymId={membership.gymId}
            canSeeLogs={canSeeLogs}
          />
        ) : null}

        {/* ----------------------------- Injuries ----------------------------- */}
        <View className="gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Injury map
          </Text>
          {!canSeeHealth ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              You don't have permission to view health data.
            </Text>
          ) : (
            <View className="bg-white dark:bg-gray-900 rounded-xl p-3 md:p-4 gap-3">
              <BodyMap highlights={highlights.map} figureWidth={figureWidth} />
              {open.length === 0 ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
                  No open injuries. Happy days.
                </Text>
              ) : (
                <View className="flex-row flex-wrap gap-1 justify-center">
                  {[...highlights.counts.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([region, n]) => (
                      <View
                        key={region}
                        style={{ borderColor: highlights.map[region] }}
                        className="rounded-full border px-2 py-0.5">
                        <Text
                          style={{ color: highlights.map[region] }}
                          className="text-[10px] font-semibold">
                          {regionLabel(region)} · {n}
                        </Text>
                      </View>
                    ))}
                </View>
              )}
            </View>
          )}

          {open.map((r) => (
            <Pressable
              key={r.id}
              onPress={() =>
                router.push(`/management/members/${r.profile_id}` as never)
              }
              className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
              <View
                style={{ backgroundColor: painColour(r.pain_level) }}
                className="w-7 h-7 rounded-full items-center justify-center">
                <Text className="text-white text-[11px] font-bold">
                  {r.pain_level}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  {r.profiles?.full_name ?? 'Member'} —{' '}
                  {injuryTitle(r.body_region, r.side).toLowerCase()}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {STATUS_META[r.status].label} · updated{' '}
                  {daysAgo(r.updated_at) === 0
                    ? 'today'
                    : `${daysAgo(r.updated_at)}d ago`}
                  {r.movements_hurt.length > 0
                    ? ` · avoid ${r.movements_hurt
                        .slice(0, 3)
                        .map(movementName)
                        .join(', ')}${r.movements_hurt.length > 3 ? '…' : ''}`
                    : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            </Pressable>
          ))}
        </View>

        {/* ------------------------- Movement trends -------------------------- */}
        <View className="gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Movement trends
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            First vs latest logged result per member over the last 12
            weeks, from the movement tracker.
          </Text>
          {!canSeeLogs ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              You don't have permission to view workout logs.
            </Text>
          ) : results.isLoading || tags.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
          ) : trends.length === 0 ? (
            <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Not enough logged results yet — trends need at least two
                results per member on a movement.
              </Text>
            </View>
          ) : (
            trends.map((t) => (
              <TrendCard
                key={`${t.movement_key}-${t.track_key}`}
                trend={t}
                nameOf={(id) => names.data?.get(id) ?? 'Member'}
              />
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

// ===========================================================================
// Programming balance — pattern × energy matrix + supporting cards
// ===========================================================================

type ProgrammingRow = {
  id: string;
  date: string;
  class_type_id: string;
  sections: unknown;
};

function ProgrammingBalanceBlock({
  gymId,
  canSeeLogs,
}: {
  gymId: string;
  canSeeLogs: boolean;
}) {
  const [preset, setPreset] = useState<Preset>('month');
  const [customStart, setCustomStart] = useState(() => isoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const range = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetRange(preset, new Date());
  }, [preset, customStart, customEnd]);
  const rangeValid =
    DATE_RE.test(range.start) &&
    DATE_RE.test(range.end) &&
    range.start <= range.end;

  const [classTypeFilter, setClassTypeFilter] = useState<string | null>(null);

  const programming = useQuery({
    queryKey: ['gym-programming', gymId, range.start, range.end],
    enabled: canSeeLogs && rangeValid,
    queryFn: async (): Promise<ProgrammingRow[]> => {
      const { data, error } = await supabase
        .from('class_programming')
        .select('id, date, class_type_id, sections')
        .eq('gym_id', gymId)
        .gte('date', range.start)
        .lte('date', range.end);
      if (error) throw error;
      return (data ?? []) as ProgrammingRow[];
    },
  });

  // Use the canonical catalog hook (one queryKey, one queryFn — see
  // useClassCatalog.ts). It returns archived class types too, which
  // is what we want here: a class type that was archived but still
  // has programming inside the window should remain analyseable.
  const classTypes = useClassTypes();

  // The chip set is the union of (any class types loaded) and
  // (any class_type_id present in the actual programming data),
  // so even a class type that was hard-deleted but still has rows
  // gets a chip. We also keep archived class types in the chip
  // set with an 'archived' tag — coaches lose CrossFit from the
  // dropdown the moment they archive it, but historical analysis
  // shouldn't disappear with it.

  // Flatten programming rows → ClassifiedSection[] once, filter
  // client-side when the user taps a class-type chip.
  const classified = useMemo<ClassifiedSection[]>(() => {
    const out: ClassifiedSection[] = [];
    for (const row of programming.data ?? []) {
      const sections = parseSections(row.sections) as Section[];
      for (const s of sections) {
        out.push(classifyProgrammedSection(s, row.date, row.class_type_id));
      }
    }
    return out;
  }, [programming.data]);

  const filtered = useMemo(
    () =>
      classTypeFilter === null
        ? classified
        : classified.filter((s) => s.class_type_id === classTypeFilter),
    [classified, classTypeFilter],
  );

  type ChipSpec = { id: string; name: string; color: string; archived: boolean };

  // Build chip set: every active class type, plus any archived or
  // orphaned class_type_id that appears in this window's programming.
  const chipSet = useMemo<ChipSpec[]>(() => {
    const byId = new Map<string, ChipSpec>();
    for (const ct of classTypes.data ?? []) {
      byId.set(ct.id, {
        id: ct.id,
        name: ct.name,
        color: ct.color,
        archived: ct.archived_at !== null,
      });
    }
    // Any programming row whose class_type_id we don't recognise yet
    // (deleted class type, or a row we couldn't join) still gets a
    // chip so its data isn't silently dropped.
    const seenInData = new Set<string>();
    for (const s of classified) {
      if (s.class_type_id) seenInData.add(s.class_type_id);
    }
    for (const id of seenInData) {
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: 'Unknown class type',
          color: '#9CA3AF',
          archived: true,
        });
      }
    }
    return [...byId.values()].sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [classTypes.data, classified]);

  const matrix = useMemo(
    () => computePatternEnergyMatrix(filtered),
    [filtered],
  );
  const energyMix = useMemo(() => computeEnergyMix(filtered), [filtered]);
  const patternMix = useMemo(() => computePatternMix(filtered), [filtered]);
  const regionVolume = useMemo(
    () => computeRegionVolume(filtered),
    [filtered],
  );
  const balance = useMemo(() => computeBalance(filtered), [filtered]);
  const untagged = useMemo(() => untaggedSections(filtered), [filtered]);

  if (!canSeeLogs) {
    return (
      <View className="gap-3">
        <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
          Programming balance
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          You don't have permission to view workout logs.
        </Text>
      </View>
    );
  }

  const hasData = filtered.length > 0;

  return (
    <View className="gap-3">
      <CardHeading
        size="section"
        title="Programming balance"
        subtitle="Movement patterns × energy systems across what you programmed in the window."
        what="Reads every section you programmed in the selected window and classifies each one by the movement patterns and energy systems it trains. Use the date picker to change the window and the class-type chips to scope it to a single programme."
        why="It's built from what you wrote in the programming, not what members logged — so it answers 'what am I actually asking of people?'. Spotting a blind spot here, a pattern or energy system you keep skipping, is far easier than catching it class by class."
      />

      <DateRangeCta
        preset={preset}
        range={range}
        customStart={customStart}
        customEnd={customEnd}
        onChange={(next) => {
          setPreset(next.preset);
          if (next.preset === 'custom') {
            setCustomStart(next.start);
            setCustomEnd(next.end);
          }
        }}
      />

      {chipSet.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 pb-1">
          <ClassTypeChip
            label="All"
            color="#9CA3AF"
            active={classTypeFilter === null}
            onPress={() => setClassTypeFilter(null)}
          />
          {chipSet.map((ct) => (
            <ClassTypeChip
              key={ct.id}
              label={ct.name}
              color={ct.color}
              archived={ct.archived}
              active={classTypeFilter === ct.id}
              onPress={() => setClassTypeFilter(ct.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      {programming.isLoading ? (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Loading programming…
        </Text>
      ) : !hasData ? (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            No programmed sections in this window. Programme a few
            classes and the matrices will populate.
          </Text>
        </View>
      ) : (
        <>
          <PatternEnergyMatrix matrix={matrix} balance={balance} />
          <EnergyMixCard mix={energyMix} />
          <PatternMixCard mix={patternMix} />
          <RegionHeatCard regions={regionVolume} />
          {untagged.length > 0 ? (
            <UntaggedCard sections={untagged} />
          ) : null}
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Info disclosure — a small (i) toggle that reveals a "what this shows /
// why it matters" panel in the card's white space. Coaches see plain
// language explaining the jargon (energy systems, patterns) and how to
// act on each view, without it cluttering the default read.
// ---------------------------------------------------------------------------

function InfoButton({
  active,
  onPress,
}: {
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="What this shows"
      className="w-6 h-6 items-center justify-center rounded-full active:bg-gray-100 dark:active:bg-gray-800">
      <Ionicons
        name={active ? 'information-circle' : 'information-circle-outline'}
        size={18}
        color={active ? '#2563EB' : '#9CA3AF'}
      />
    </Pressable>
  );
}

function InfoPanel({ what, why }: { what: string; why: string }) {
  return (
    <View className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 gap-2">
      <View className="gap-0.5">
        <Text className="text-gray-400 dark:text-gray-500 text-[10px] font-semibold uppercase tracking-wider">
          What this shows
        </Text>
        <Text className="text-gray-600 dark:text-gray-300 text-xs leading-5">
          {what}
        </Text>
      </View>
      <View className="gap-0.5">
        <Text className="text-gray-400 dark:text-gray-500 text-[10px] font-semibold uppercase tracking-wider">
          Why it matters
        </Text>
        <Text className="text-gray-600 dark:text-gray-300 text-xs leading-5">
          {why}
        </Text>
      </View>
    </View>
  );
}

// Titled header with an (i) toggle. `size='section'` is the larger
// block heading; the default is a white-card heading. Owns its own
// open state so each card's info is independent.
function CardHeading({
  title,
  subtitle,
  what,
  why,
  size = 'card',
}: {
  title: string;
  subtitle?: string;
  what: string;
  why: string;
  size?: 'card' | 'section';
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2">
      <View className="flex-row items-start gap-2">
        <View className="flex-1">
          <Text
            className={
              size === 'section'
                ? 'text-gray-900 dark:text-gray-50 text-lg font-semibold'
                : 'text-gray-900 dark:text-gray-50 font-semibold'
            }>
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <InfoButton active={open} onPress={() => setOpen((v) => !v)} />
      </View>
      {open ? <InfoPanel what={what} why={why} /> : null}
    </View>
  );
}

function ClassTypeChip({
  label,
  color,
  active,
  archived,
  onPress,
}: {
  label: string;
  color: string;
  active: boolean;
  archived?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-full border ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
      }`}>
      <View
        style={{ backgroundColor: color, opacity: archived ? 0.5 : 1 }}
        className="w-2 h-2 rounded-full"
      />
      <Text
        className={`text-xs font-semibold ${
          active ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
        } ${archived ? 'line-through opacity-70' : ''}`}>
        {label}
      </Text>
      {archived ? (
        <Text className="text-gray-400 dark:text-gray-500 text-[9px] uppercase tracking-wider">
          arch
        </Text>
      ) : null}
    </Pressable>
  );
}

// 4-stop ramp tied to the column's max, so colour intensity reads as
// "how loaded is this energy column" rather than absolute volume.
function cellTint(value: number, columnMax: number): string {
  if (value === 0 || columnMax === 0) return 'transparent';
  const ratio = value / columnMax;
  if (ratio >= 0.75) return 'rgba(37,99,235,0.55)';
  if (ratio >= 0.5) return 'rgba(37,99,235,0.4)';
  if (ratio >= 0.25) return 'rgba(37,99,235,0.25)';
  return 'rgba(37,99,235,0.12)';
}

function PatternEnergyMatrix({
  matrix,
  balance,
}: {
  matrix: Record<MovementPattern, Record<EnergySystem, number>>;
  balance: ReturnType<typeof computeBalance>;
}) {
  const { width } = useWindowDimensions();
  // Below 480 px (every phone) we use the compact label set so the
  // 3-column grid stops bumping into the row labels. The narrowest
  // viewport this still has to clear is ~320 px (older iPhone SE)
  // minus 32 px page padding minus 24 px card padding = 264 px; that
  // leaves ~67 px per cell after the 60 px label column.
  const compact = width < 480;
  const patternLabels = compact ? PATTERN_LABELS_SHORT : PATTERN_LABELS;
  const energyLabels = compact ? ENERGY_LABELS_SHORT : ENERGY_LABELS;
  const labelColumnWidth = compact ? 60 : 132;

  const rows = (Object.keys(matrix) as MovementPattern[])
    .map((p) => ({
      pattern: p,
      cells: matrix[p],
      total:
        matrix[p].phosphagen + matrix[p].glycolytic + matrix[p].oxidative,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  const columnMax: Record<EnergySystem, number> = {
    phosphagen: 0,
    glycolytic: 0,
    oxidative: 0,
  };
  for (const r of rows) {
    for (const e of ENERGY_SYSTEMS) {
      if (r.cells[e] > columnMax[e]) columnMax[e] = r.cells[e];
    }
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-3 md:p-4 gap-3">
      <CardHeading
        title="Pattern × energy"
        what="Rows are movement patterns, columns are the three energy systems — phosphagen (short, heavy, near-maximal), glycolytic (hard 1–10 min efforts), oxidative (longer aerobic work). Each cell counts the sections that train that pattern through that system. The badges show your push-to-pull and front-to-back (anterior vs posterior) balance."
        why="Empty cells and lopsided rows are your gaps — squats only ever trained heavy and never under fatigue, or no oxidative pulling all month. A push:pull or front:back ratio that drifts far from even over weeks is a common driver of overuse niggles, and it's hard to feel without seeing it laid out."
      />
      {/* Ratio badges share width so they balance visually instead of
          wrapping into stranded chips on a phone. */}
      <View className="flex-row gap-2">
        <View className="flex-1">
          <RatioBadge
            label="Push : Pull"
            left={balance.push}
            right={balance.pull}
          />
        </View>
        <View className="flex-1">
          <RatioBadge
            label="Front : Back"
            left={balance.anterior}
            right={balance.posterior}
          />
        </View>
      </View>

      <View>
        {/* Column headers */}
        <View className="flex-row items-center gap-1">
          <View style={{ width: labelColumnWidth }} />
          {ENERGY_SYSTEMS.map((e) => (
            <View key={e} className="flex-1 items-center">
              <Text
                style={{ color: ENERGY_COLOURS[e] }}
                className="text-[10px] font-semibold uppercase tracking-wider">
                {energyLabels[e]}
              </Text>
            </View>
          ))}
        </View>

        {rows.length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm pt-3">
            No movements classified yet.
          </Text>
        ) : (
          rows.map((r) => (
            <View key={r.pattern} className="flex-row items-center gap-1 mt-1">
              <Text
                style={{ width: labelColumnWidth }}
                className="text-gray-700 dark:text-gray-200 text-xs"
                numberOfLines={1}>
                {patternLabels[r.pattern]}
              </Text>
              {ENERGY_SYSTEMS.map((e) => (
                <View
                  key={e}
                  style={{
                    backgroundColor: cellTint(r.cells[e], columnMax[e]),
                    borderColor:
                      r.cells[e] > 0 ? ENERGY_COLOURS[e] : 'transparent',
                  }}
                  className="flex-1 h-9 rounded-md border items-center justify-center">
                  <Text
                    className={`text-sm font-semibold ${
                      r.cells[e] > 0
                        ? 'text-gray-900 dark:text-gray-50'
                        : 'text-gray-300 dark:text-gray-700'
                    }`}>
                    {r.cells[e]}
                  </Text>
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function RatioBadge({
  label,
  left,
  right,
}: {
  label: string;
  left: number;
  right: number;
}) {
  return (
    <View className="bg-gray-50 dark:bg-gray-800 rounded-full px-3 py-1">
      <Text className="text-gray-400 dark:text-gray-500 text-[9px] uppercase tracking-widest">
        {label}
      </Text>
      <Text className="text-gray-900 dark:text-gray-50 text-sm font-semibold">
        {left} : {right}
      </Text>
    </View>
  );
}

function EnergyMixCard({
  mix,
}: {
  mix: ReturnType<typeof computeEnergyMix>;
}) {
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-3 md:p-4 gap-3">
      <CardHeading
        title="Energy system mix"
        what="The share of your programmed sections that fall under each energy system across the window."
        why="A balanced general programme spreads work across all three systems rather than living in one. If you're almost entirely glycolytic 'pain cave', members gain conditioning but little maximal strength or true aerobic base — and fatigue faster. This is the quick sanity check."
      />
      {mix.map((m) => (
        <View key={m.system} className="gap-1">
          <View className="flex-row items-baseline gap-2">
            <Text
              style={{ color: ENERGY_COLOURS[m.system] }}
              className="text-xs font-semibold uppercase tracking-wider">
              {ENERGY_LABELS[m.system]}
            </Text>
            <Text className="flex-1 text-gray-500 dark:text-gray-400 text-xs">
              {m.count} {m.count === 1 ? 'section' : 'sections'}
            </Text>
            <Text className="text-gray-900 dark:text-gray-50 text-xs font-semibold">
              {m.pct}%
            </Text>
          </View>
          <View className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <View
              style={{
                width: `${m.pct}%`,
                backgroundColor: ENERGY_COLOURS[m.system],
              }}
              className="h-full rounded-full"
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function PatternMixCard({
  mix,
}: {
  mix: ReturnType<typeof computePatternMix>;
}) {
  const nonzero = mix.filter((m) => m.count > 0);
  const max = nonzero[0]?.count ?? 0;
  if (nonzero.length === 0) return null;
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-3 md:p-4 gap-3">
      <CardHeading
        title="Movement pattern volume"
        what="How many sections touched each movement pattern, ranked highest to lowest."
        why="Shows where your programming's centre of gravity sits. If hinge and pull sit at the bottom week after week while squat and push dominate, that's the imbalance to correct — for both performance and joint health."
      />
      {nonzero.map((m) => (
        <View key={m.pattern} className="gap-1">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-gray-700 dark:text-gray-200 text-xs font-medium">
              {PATTERN_LABELS[m.pattern]}
            </Text>
            <Text className="flex-1 text-gray-400 dark:text-gray-500 text-[10px]">
              {m.pct}%
            </Text>
            <Text className="text-gray-900 dark:text-gray-50 text-xs font-semibold">
              {m.count}
            </Text>
          </View>
          <View className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <View
              style={{ width: `${(m.count / max) * 100}%` }}
              className="h-full rounded-full bg-primary"
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const REGION_RAMP = ['#FCD34D', '#F59E0B', '#F97316', '#EF4444'];

function RegionHeatCard({ regions }: { regions: Record<string, number> }) {
  const { width } = useWindowDimensions();
  // Two side-by-side figures + the 24 px gap need ~240 px on mobile;
  // the 120 px default fits, but anything smaller than ~360 wide gets
  // cramped, so step the figure down a little for the iPhone SE end.
  const figureWidth = width < 360 ? 96 : width < 768 ? 110 : 120;
  const entries = Object.entries(regions)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 0;
  const tint: Record<string, string> = {};
  for (const [key, count] of entries) {
    const ratio = max === 0 ? 0 : count / max;
    const i =
      ratio >= 0.75 ? 3 : ratio >= 0.5 ? 2 : ratio >= 0.25 ? 1 : 0;
    tint[key] = REGION_RAMP[i];
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-3 md:p-4 gap-3">
      <CardHeading
        title="Region heat"
        what="Lights up the body silhouette by how often the movements you programmed load each region — hotter means more volume."
        why="A fast read of what's getting hammered. Cross-reference the Injury map below: if a region runs hot here and you already have open injuries there, that's a signal to ease off before it becomes a pattern."
      />
      <BodyMap highlights={tint} figureWidth={figureWidth} />
      {entries.length === 0 ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs text-center">
          No region-tagged movements yet.
        </Text>
      ) : (
        <View className="flex-row flex-wrap gap-1 justify-center">
          {entries.map(([region, n]) => (
            <View
              key={region}
              style={{ borderColor: tint[region] }}
              className="rounded-full border px-2 py-0.5">
              <Text
                style={{ color: tint[region] }}
                className="text-[10px] font-semibold">
                {regionLabel(region)} · {n}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function UntaggedCard({ sections }: { sections: ClassifiedSection[] }) {
  // Show the freshest 6 — keep the card scannable; the rest stay
  // discoverable via the Programming page itself.
  const shown = sections
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
      <CardHeading
        title="Untagged sections"
        subtitle="These sections' bodies don't mention a movement we recognise. Add specific movement names so they get counted."
        what="Sections whose written body doesn't contain a movement name we recognise, so they couldn't be classified into the matrices above."
        why="Every untagged section is volume that's invisible to this analysis. Spelling out the movements in the body (e.g. 'back squat', not just 'squats') makes the numbers above trustworthy."
      />
      {shown.map((s, i) => (
        <View
          key={i}
          className="flex-row items-baseline gap-2 border-t border-gray-100 dark:border-gray-800 pt-2">
          <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest w-20">
            {s.date.slice(5)}
          </Text>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
              {s.title || categoryLabel(s.section_category)}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-[10px] uppercase tracking-wider">
              {categoryLabel(s.section_category)}
            </Text>
          </View>
        </View>
      ))}
      {sections.length > shown.length ? (
        <Text className="text-gray-400 dark:text-gray-500 text-xs pt-1">
          +{sections.length - shown.length} more.
        </Text>
      ) : null}
    </View>
  );
}

function fmtValue(movementKey: string, trackKey: string, v: number): string {
  const metric = findScheme(movementKey, trackKey)?.metric;
  if (metric === 'time') return formatSeconds(v);
  return `${Number.isInteger(v) ? v : v.toFixed(1)}`;
}

function TrendCard({
  trend,
  nameOf,
}: {
  trend: MovementTrendSummary;
  nameOf: (profileId: string) => string;
}) {
  const [openCard, setOpenCard] = useState(false);
  const scheme = findScheme(trend.movement_key, trend.track_key);
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl">
      <Pressable
        onPress={() => setOpenCard((v) => !v)}
        className="p-3 md:p-4 gap-1 active:opacity-70">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
            {movementName(trend.movement_key)}
            <Text className="text-gray-400 dark:text-gray-500 font-normal">
              {'  '}
              {scheme?.label ?? trend.track_key}
            </Text>
          </Text>
          <Ionicons
            name={openCard ? 'chevron-up' : 'chevron-down'}
            size={16}
            color="#9CA3AF"
          />
        </View>
        <View className="flex-row items-center gap-3">
          <TrendStat icon="trending-up" colour="#10B981" n={trend.improving} />
          <TrendStat icon="trending-down" colour="#EF4444" n={trend.declining} />
          <TrendStat icon="remove" colour="#9CA3AF" n={trend.flat} />
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            {trend.members.length}{' '}
            {trend.members.length === 1 ? 'member' : 'members'}
          </Text>
        </View>
      </Pressable>
      {openCard ? (
        <View className="px-3 md:px-4 pb-3 gap-1.5 border-t border-gray-100 dark:border-gray-800 pt-2">
          {trend.members.map((m) => (
            <View key={m.profile_id} className="flex-row items-center gap-2">
              <Text
                className="flex-1 text-gray-700 dark:text-gray-200 text-sm"
                numberOfLines={1}>
                {nameOf(m.profile_id)}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {fmtValue(trend.movement_key, trend.track_key, m.first)} →{' '}
                {fmtValue(trend.movement_key, trend.track_key, m.last)}
              </Text>
              <View
                className={`rounded-full px-2 py-0.5 ${
                  m.trend === 'improving'
                    ? 'bg-emerald-500/10'
                    : m.trend === 'declining'
                      ? 'bg-red-500/10'
                      : 'bg-gray-500/10'
                }`}>
                <Text
                  className={`text-[10px] font-bold ${
                    m.trend === 'improving'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : m.trend === 'declining'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-500 dark:text-gray-400'
                  }`}>
                  {m.deltaPct === null
                    ? '—'
                    : `${m.deltaPct > 0 ? '+' : ''}${m.deltaPct.toFixed(1)}%`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TrendStat({
  icon,
  colour,
  n,
}: {
  icon: 'trending-up' | 'trending-down' | 'remove';
  colour: string;
  n: number;
}) {
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons name={icon} size={13} color={colour} />
      <Text style={{ color: colour }} className="text-xs font-semibold">
        {n}
      </Text>
    </View>
  );
}
