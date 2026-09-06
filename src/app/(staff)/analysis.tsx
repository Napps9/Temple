import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState, useEffect } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { PageScroll } from '@/components/PageScroll';
import { Text } from '@/components/Text';

import { BodyMap } from '@/components/BodyMap';
import { CardHeading } from '@/components/CardHeading';
import {
  DATE_RE,
  DateRangeCta,
  isoDate,
  presetRange,
  type Preset,
} from '@/components/DateRangeCta';
import { BackLink } from '@/components/BackLink';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { FieldLabel, LABEL_TYPE } from '@/components/SectionLabel';
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
  applyAiTag,
  computeLoadMix,
  computeTimeDomainMix,
  correlateAiTags,
  dedupeSections,
  fingerprintDigest,
  LOAD_COLOURS,
  LOAD_LABELS,
  movementVocab,
  sectionFingerprint,
  type AiSectionTag,
  type ClassifiableSection,
  type TaggedSection,
} from '@/lib/programming-ai-tags';
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
import {
  heavyShareVerdict,
  pushPullVerdict,
  topTimeDomainVerdict,
  type Verdict,
} from '@/lib/programming-verdicts';
import { supabase } from '@/lib/supabase';
import { formatSeconds } from '@/lib/track';
import { useCan } from '@/lib/useCan';
import { useClassTypes } from '@/lib/useClassCatalog';
import { useThemeColors } from '@/lib/theme';
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
  const colors = useThemeColors();
  const canSeeHealth = useCan('can_see_health_flag') ?? false;
  // undefined = capabilities still resolving. Denial copy keys off the
  // resolved false, so a cold start doesn't flash "no permission" at
  // an owner while the overrides load.
  const canSeeLogsResolved = useCan('can_see_workout_logs');
  const canSeeLogs = canSeeLogsResolved ?? false;

  const injuries = useQuery({
    queryKey: ['gym-open-injuries', membership?.gymId],
    enabled: !!membership?.gymId && canSeeHealth,
    queryFn: async (): Promise<OpenInjury[]> => {
      // Through the RPC, not the table: staff reads of health data have to
      // leave an audit row, and this one — every open injury in the gym at
      // once — was the loudest of the three that never did (0180).
      const { data, error } = await supabase.rpc('gym_open_injuries', {
        p_gym_id: membership!.gymId,
        p_surface: 'gym_overview',
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...(r as unknown as Omit<OpenInjury, 'profiles'>),
        profiles: { full_name: (r as { full_name: string | null }).full_name },
      })) as OpenInjury[];
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
          'profile_id, movement_key, track_key, performed_at, section:tracked_workout_sections(section_format, total_time_seconds, total_rounds, total_distance_m, total_calories, entries:tracked_section_entries(weight_numeric, reps, time_seconds, distance_numeric, calories))',
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

  const pb = useProgrammingBalance(membership?.gymId, canSeeLogs);
  const [showUntagged, setShowUntagged] = useState(false);

  // The three verdicts derive from the same aggregations the cards
  // below render, so a tile can never disagree with its card. A null
  // verdict (no data on that axis) simply drops its tile.
  const verdictTiles = useMemo(() => {
    const out: { label: string; verdict: Verdict }[] = [];
    const push = pushPullVerdict(pb.balance);
    if (push) out.push({ label: 'Push : pull', verdict: push });
    const domain = topTimeDomainVerdict(pb.timeDomains);
    if (domain) out.push({ label: 'Top time domain', verdict: domain });
    const heavy = heavyShareVerdict(pb.loadMix);
    if (heavy) out.push({ label: 'Heavy share', verdict: heavy });
    return out;
  }, [pb.balance, pb.timeDomains, pb.loadMix]);

  // Cards that source purely from AI tags can be empty while the rest
  // of the page has data — don't strand their group label over
  // nothing, and let a lone card take the full row.
  const hasTimeData = pb.timeDomains.some((m) => m.count > 0);
  const hasLoadData = pb.loadMix.some((m) => m.count > 0);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <PageScroll contentContainerClassName="gap-5 py-6 px-4 md:max-w-4xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/(staff)/programming" coveredByNav />
        <PageHead
          title="Programming analysis"
          subtitle="Is the month balanced? Start with the verdicts, then drill into the cards."
        />

        {canSeeLogsResolved === false ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            You don't have permission to view workout logs, so the
            programming balance is hidden.
          </Text>
        ) : !canSeeLogs ? null : (
          <>
            {verdictTiles.length > 0 ? (
              <View className="flex-row gap-2 md:gap-3">
                {verdictTiles.map((t) => (
                  <VerdictTile
                    key={t.label}
                    label={t.label}
                    verdict={t.verdict}
                  />
                ))}
              </View>
            ) : null}

            <View className="gap-3 md:flex-row md:items-center">
              <View className="md:flex-1">
                <DateRangeCta
                  preset={pb.preset}
                  range={pb.range}
                  customStart={pb.customStart}
                  customEnd={pb.customEnd}
                  onChange={pb.onRangeChange}
                />
              </View>
              {pb.chipSet.length > 1 ? (
                // The wrapper bounds the chip strip to its half of the
                // row — a bare ScrollView keeps grow:1/basis:auto and
                // a long chip set would shrink the range pill to
                // nothing.
                <View className="md:flex-1">
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerClassName="gap-2 pb-1 md:pb-0">
                    <ClassTypeChip
                      label="All"
                      color={colors.ink3}
                      active={pb.classTypeFilter === null}
                      onPress={() => pb.setClassTypeFilter(null)}
                    />
                    {pb.chipSet.map((ct) => (
                      <ClassTypeChip
                        key={ct.id}
                        label={ct.name}
                        color={ct.color}
                        archived={ct.archived}
                        active={pb.classTypeFilter === ct.id}
                        onPress={() => pb.setClassTypeFilter(ct.id)}
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            {pb.isLoading ? (
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                Loading programming…
              </Text>
            ) : !pb.hasData ? (
              <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  No programmed sections in this window. Programme a few
                  classes and the matrices will populate.
                </Text>
              </View>
            ) : (
              <>
                <GroupLabel label="What you're training" />
                {/* The matrix keeps the full row — its full pattern
                    labels and three-cell grid don't survive a half
                    column on tablet widths. */}
                <PatternEnergyMatrix matrix={pb.matrix} balance={pb.balance} />
                <View className="gap-3 md:flex-row md:items-start">
                  <View className="md:flex-1">
                    <EnergyMixCard mix={pb.energyMix} />
                  </View>
                  <View className="md:flex-1">
                    <PatternMixCard mix={pb.patternMix} />
                  </View>
                </View>

                {hasTimeData || hasLoadData ? (
                  <>
                    <GroupLabel label="How it's dosed" />
                    <View className="gap-3 md:flex-row md:items-start">
                      {hasTimeData ? (
                        <View className="md:flex-1">
                          <TimeDomainCard mix={pb.timeDomains} />
                        </View>
                      ) : null}
                      {hasLoadData ? (
                        <View className="md:flex-1">
                          <LoadBalanceCard mix={pb.loadMix} />
                        </View>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </>
            )}
          </>
        )}

        <GroupLabel label="Bodies & people" />
        <View className="gap-3 md:flex-row md:items-start">
          <View className="gap-3 md:flex-1">
            <RegionInjuriesCard
              regionVolume={pb.regionVolume}
              showVolume={canSeeLogs && pb.hasData}
              injuryTints={highlights.map}
              injuryCounts={highlights.counts}
              openCount={open.length}
              canSeeHealth={canSeeHealth}
            />
            {open.map((r) => (
              <Pressable
                key={r.id}
                onPress={() =>
                  router.push(`/management/members/${r.profile_id}` as never)
                }
                className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 flex-row items-center gap-3 active:opacity-70">
                <View
                  style={{ backgroundColor: painColour(r.pain_level) }}
                  className="w-7 h-7 rounded-full items-center justify-center">
                  <Text className="text-white text-[11px] font-bold">
                    {r.pain_level}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-ink dark:text-ink-dk font-medium">
                    {r.profiles?.full_name ?? 'Member'} —{' '}
                    {injuryTitle(r.body_region, r.side).toLowerCase()}
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
                <Ionicons
                  name="chevron-forward"
                  size={15}
                  color={colors.ink3}
                />
              </Pressable>
            ))}
          </View>

          <View className="gap-3 md:flex-1">
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Movement trends — first vs latest logged result per member
              over the last 12 weeks, from the movement tracker.
            </Text>
            {canSeeLogsResolved === false ? (
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                You don't have permission to view workout logs.
              </Text>
            ) : !canSeeLogs || results.isLoading || tags.isLoading ? (
              <Text className="text-ink-2 dark:text-ink-2-dk">
                Loading…
              </Text>
            ) : trends.length === 0 ? (
              <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
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
        </View>

        {canSeeLogs && pb.untagged.length > 0 ? (
          <View className="gap-3">
            <Pressable
              onPress={() => setShowUntagged((v) => !v)}
              className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card px-4 py-3 flex-row items-center gap-3 active:opacity-70">
              <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-xs">
                {pb.untagged.length === 1
                  ? "1 section couldn't be classified"
                  : `${pb.untagged.length} sections couldn't be classified`}{' '}
                — spell out the movements so they count.
              </Text>
              <Text className="text-primary text-xs font-semibold">
                {showUntagged ? 'Hide' : 'Review'}
              </Text>
            </Pressable>
            {showUntagged ? <UntaggedCard sections={pb.untagged} /> : null}
          </View>
        ) : null}
      </PageScroll>
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

// AI tags for the window's sections — deduped by fingerprint, fetched
// through the classify-programming edge function (cached per section
// server-side). Failures reject so react-query retries and never
// caches an empty read as success; the render path treats missing
// data as "no AI" and shows the rule-based view either way.
async function fetchAiTags(
  gymId: string,
  sections: ClassifiableSection[],
): Promise<Map<string, AiSectionTag>> {
  const { fingerprints, unique } = dedupeSections(sections);
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.functions.invoke(
    'classify-programming',
    {
      body: {
        gym_id: gymId,
        sections: unique.map((s) => ({
          section_format: s.section_format,
          section_category: s.section_category,
          title: s.title,
          body: s.body,
        })),
        vocab: movementVocab(),
      },
    },
  );
  if (error) throw error;
  if (!data) throw new Error('classify-programming returned no data');
  return correlateAiTags(fingerprints, (data as { tags?: unknown }).tags);
}

// The state + aggregations behind the balance surfaces: the scoped
// window, the class-type chips, the classified sections and every
// per-card rollup. A hook rather than a block component since the
// reorganised page interleaves these with the injuries/trends data
// the screen already owns.
// The chosen view state, across unmounts — session-only, the
// GymSetupChecklist / list-scroll-position idiom.
let lastAnalysisRange: { preset: Preset; customStart: string; customEnd: string } | null =
  null;

function useProgrammingBalance(
  gymId: string | undefined,
  canSeeLogs: boolean,
) {
  const [preset, setPreset] = useState<Preset>(lastAnalysisRange?.preset ?? 'month');
  const [customStart, setCustomStart] = useState(
    () => lastAnalysisRange?.customStart ?? isoDate(new Date()),
  );
  const [customEnd, setCustomEnd] = useState(
    () => lastAnalysisRange?.customEnd ?? isoDate(new Date()),
  );
  useEffect(() => {
    lastAnalysisRange = { preset, customStart, customEnd };
  }, [preset, customStart, customEnd]);
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
    enabled: !!gymId && canSeeLogs && rangeValid,
    queryFn: async (): Promise<ProgrammingRow[]> => {
      const { data, error } = await supabase
        .from('class_programming')
        .select('id, date, class_type_id, sections')
        .eq('gym_id', gymId!)
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

  // Flatten programming rows once, keeping the parsed Section beside
  // its date/class-type — the AI tag merge needs the raw body/format.
  const parsed = useMemo(() => {
    const out: { section: Section; date: string; classTypeId: string }[] = [];
    for (const row of programming.data ?? []) {
      const sections = parseSections(row.sections) as Section[];
      for (const s of sections) {
        out.push({
          section: s,
          date: row.date,
          classTypeId: row.class_type_id,
        });
      }
    }
    return out;
  }, [programming.data]);

  // AI read of the same sections: movements the alias lexicon missed,
  // an estimated duration, and a load level. Keyed on a digest of the
  // section fingerprints, so any content edit refetches — cheap,
  // because the edge function caches per section server-side.
  const contentDigest = useMemo(
    () =>
      fingerprintDigest(
        dedupeSections(parsed.map((p) => p.section)).fingerprints,
      ),
    [parsed],
  );
  const aiTags = useQuery({
    queryKey: ['programming-ai-tags', gymId, contentDigest],
    enabled: !!gymId && canSeeLogs && rangeValid && parsed.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => fetchAiTags(gymId!, parsed.map((p) => p.section)),
  });

  // Rule-based classification first, AI merged on top, filter
  // client-side when the user taps a class-type chip.
  const classified = useMemo<TaggedSection[]>(() => {
    const tags = aiTags.data ?? new Map<string, AiSectionTag>();
    return parsed.map(({ section: s, date, classTypeId }) =>
      applyAiTag(
        classifyProgrammedSection(s, date, classTypeId),
        s,
        tags.get(sectionFingerprint(s)),
      ),
    );
  }, [parsed, aiTags.data]);

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
  const timeDomains = useMemo(() => computeTimeDomainMix(filtered), [filtered]);
  const loadMix = useMemo(() => computeLoadMix(filtered), [filtered]);

  const onRangeChange = (
    next:
      | { preset: Exclude<Preset, 'custom'> }
      | { preset: 'custom'; start: string; end: string },
  ) => {
    setPreset(next.preset);
    if (next.preset === 'custom') {
      setCustomStart(next.start);
      setCustomEnd(next.end);
    }
  };

  return {
    preset,
    customStart,
    customEnd,
    range,
    onRangeChange,
    classTypeFilter,
    setClassTypeFilter,
    chipSet,
    isLoading: programming.isLoading,
    hasData: filtered.length > 0,
    filtered,
    matrix,
    energyMix,
    patternMix,
    regionVolume,
    balance,
    untagged,
    timeDomains,
    loadMix,
  };
}

// Section eyebrow — the labelled question each group of cards answers.
function GroupLabel({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-2.5 mt-1">
      <FieldLabel>
        {label}
      </FieldLabel>
      <View className="flex-1 h-px bg-sunken dark:bg-raised-dk" />
    </View>
  );
}

const VERDICT_OK = '#10B981';
const VERDICT_DRIFT = '#F59E0B';

function VerdictTile({ label, verdict }: { label: string; verdict: Verdict }) {
  return (
    <View className="flex-1 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card px-3 py-2.5">
      <Text
        className="text-ink-3 dark:text-ink-3-dk text-[9px] font-bold uppercase tracking-wider"
        numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={{ color: verdict.ok ? VERDICT_OK : VERDICT_DRIFT }}
        className="text-lg font-bold"
        numberOfLines={1}>
        {verdict.value}
      </Text>
      <Text
        className="text-ink-2 dark:text-ink-2-dk text-[9px] leading-3"
        numberOfLines={2}>
        {verdict.caption}
      </Text>
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
          ? 'border-transparent bg-raised dark:bg-raised-dk'
          : 'border-line dark:border-line-dk bg-surface dark:bg-surface-dk'
      }`}>
      <View
        style={{ backgroundColor: color, opacity: archived ? 0.5 : 1 }}
        className="w-2 h-2 rounded-full"
      />
      <Text
        className={`text-xs font-semibold ${
          active ? 'text-ink dark:text-ink-dk font-semibold' : 'text-ink-2 dark:text-ink-2-dk'
        } ${archived ? 'line-through opacity-70' : ''}`}>
        {label}
      </Text>
      {archived ? (
        <Text className="text-ink-3 dark:text-ink-3-dk text-[9px] uppercase tracking-wider">
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
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 md:p-4 gap-3">
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
                className={LABEL_TYPE}>
                {energyLabels[e]}
              </Text>
            </View>
          ))}
        </View>

        {rows.length === 0 ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm pt-3">
            No movements classified yet.
          </Text>
        ) : (
          rows.map((r) => (
            <View key={r.pattern} className="flex-row items-center gap-1 mt-1">
              <Text
                style={{ width: labelColumnWidth }}
                className="text-ink-2 dark:text-ink-2-dk text-xs"
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
                        ? 'text-ink dark:text-ink-dk'
                        : 'text-ink-3 dark:text-ink-2'
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
    <View className="bg-raised dark:bg-raised-dk rounded-full px-3 py-1">
      <FieldLabel>
        {label}
      </FieldLabel>
      <Text className="text-ink dark:text-ink-dk text-sm font-semibold">
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
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 md:p-4 gap-3">
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
              className={LABEL_TYPE}>
              {ENERGY_LABELS[m.system]}
            </Text>
            <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-xs">
              {m.count} {m.count === 1 ? 'section' : 'sections'}
            </Text>
            <Text className="text-ink dark:text-ink-dk text-xs font-semibold">
              {m.pct}%
            </Text>
          </View>
          <View className="h-2 rounded-full bg-raised dark:bg-raised-dk overflow-hidden">
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

function TimeDomainCard({
  mix,
}: {
  mix: ReturnType<typeof computeTimeDomainMix>;
}) {
  const total = mix.reduce((n, m) => n + m.count, 0);
  if (total === 0) return null;
  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 md:p-4 gap-3">
      <CardHeading
        title="Time domains"
        subtitle="How long your conditioning pieces run, read by AI from what you wrote."
        what="Every scored conditioning piece in the window — for time, AMRAP, EMOM, intervals, cardio — bucketed by how long it runs. Explicit clocks and caps are used where you wrote them; otherwise AI estimates the length from the programmed volume. Strength work is deliberately excluded."
        why="Each time domain trains a different engine: sprint pieces under 5 minutes, the classic 10–15 minute metcon and true 20-plus-minute aerobic work are not interchangeable. If one bucket owns the whole month, members are only ever training one of them."
      />
      {mix.map((m) => (
        <View key={m.key} className="gap-1">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-medium">
              {m.label}
            </Text>
            <Text className="flex-1 text-ink-3 dark:text-ink-3-dk text-[10px]">
              {m.pct}%
            </Text>
            <Text className="text-ink dark:text-ink-dk text-xs font-semibold">
              {m.count}
            </Text>
          </View>
          <View className="h-1.5 rounded-full bg-raised dark:bg-raised-dk overflow-hidden">
            <View
              style={{ width: `${m.pct}%` }}
              className="h-full rounded-full bg-primary"
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function LoadBalanceCard({
  mix,
}: {
  mix: ReturnType<typeof computeLoadMix>;
}) {
  const total = mix.reduce((n, m) => n + m.count, 0);
  if (total === 0) return null;
  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 md:p-4 gap-3">
      <CardHeading
        title="Load balance"
        subtitle="The heavy / light split, read by AI from what you wrote."
        what="The share of sections programmed heavy, moderate, light or bodyweight — read by AI from the loading cues in your programming: percentages, 'build to a heavy single', dumbbell weights, or no external load at all."
        why="The heavy/light rhythm is the axis programmes drift on most quietly. Weeks where every barbell piece reads heavy break people down; all-light months stall strength. Seeing the split at a glance surfaces the drift before the fatigue does."
      />
      {mix.map((m) => (
        <View key={m.level} className="gap-1">
          <View className="flex-row items-baseline gap-2">
            <Text
              style={{ color: LOAD_COLOURS[m.level] }}
              className={LABEL_TYPE}>
              {LOAD_LABELS[m.level]}
            </Text>
            <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-xs">
              {m.count} {m.count === 1 ? 'section' : 'sections'}
            </Text>
            <Text className="text-ink dark:text-ink-dk text-xs font-semibold">
              {m.pct}%
            </Text>
          </View>
          <View className="h-2 rounded-full bg-raised dark:bg-raised-dk overflow-hidden">
            <View
              style={{
                width: `${m.pct}%`,
                backgroundColor: LOAD_COLOURS[m.level],
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
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 md:p-4 gap-3">
      <CardHeading
        title="Movement pattern volume"
        what="How many sections touched each movement pattern, ranked highest to lowest."
        why="Shows where your programming's centre of gravity sits. If hinge and pull sit at the bottom week after week while squat and push dominate, that's the imbalance to correct — for both performance and joint health."
      />
      {nonzero.map((m) => (
        <View key={m.pattern} className="gap-1">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-medium">
              {PATTERN_LABELS[m.pattern]}
            </Text>
            <Text className="flex-1 text-ink-3 dark:text-ink-3-dk text-[10px]">
              {m.pct}%
            </Text>
            <Text className="text-ink dark:text-ink-dk text-xs font-semibold">
              {m.count}
            </Text>
          </View>
          <View className="h-1.5 rounded-full bg-raised dark:bg-raised-dk overflow-hidden">
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

// The programmed-volume region heat and the open-injuries map, in one
// card so the cross-reference the two exist for is built in rather
// than a scroll apart. Degrades per permission: without workout-log
// access only the injuries half renders (and vice versa without
// health access).
function RegionInjuriesCard({
  regionVolume,
  showVolume,
  injuryTints,
  injuryCounts,
  openCount,
  canSeeHealth,
}: {
  regionVolume: Record<string, number>;
  showVolume: boolean;
  injuryTints: Record<string, string>;
  injuryCounts: Map<string, number>;
  openCount: number;
  canSeeHealth: boolean;
}) {
  const { width } = useWindowDimensions();
  // Two side-by-side figures + the 24 px gap need ~240 px on mobile;
  // the 120 px default fits, but anything smaller than ~360 wide gets
  // cramped, so step the figure down a little for the iPhone SE end.
  const figureWidth = width < 360 ? 96 : width < 768 ? 110 : 120;
  const both = showVolume && canSeeHealth;

  const volEntries = Object.entries(regionVolume)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const volMax = volEntries[0]?.[1] ?? 0;
  const volTint: Record<string, string> = {};
  for (const [key, count] of volEntries) {
    const ratio = volMax === 0 ? 0 : count / volMax;
    const i = ratio >= 0.75 ? 3 : ratio >= 0.5 ? 2 : ratio >= 0.25 ? 1 : 0;
    volTint[key] = REGION_RAMP[i];
  }
  const injEntries = [...injuryCounts.entries()].sort((a, b) => b[1] - a[1]);

  if (!showVolume && !canSeeHealth) {
    return (
      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          You don't have permission to view health data.
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 md:p-4 gap-3">
      <CardHeading
        title={
          both
            ? 'Region load vs open injuries'
            : showVolume
              ? 'Region heat'
              : 'Injury map'
        }
        subtitle={
          both
            ? "What you're loading, next to where members already hurt."
            : undefined
        }
        what={
          both
            ? 'Two reads of the same silhouette: how often the movements you programmed load each region (hotter means more volume), and where members currently carry open injuries.'
            : showVolume
              ? 'Lights up the body silhouette by how often the movements you programmed load each region — hotter means more volume.'
              : 'Every open injury across the gym, plotted on the body silhouette; the list below links to each member.'
        }
        why={
          both
            ? "The cross-reference is the point: a region running hot in the programming while members already have open injuries there is the clearest early signal to ease off before a niggle becomes a pattern."
            : showVolume
              ? "A fast read of what's getting hammered week to week."
              : 'A cluster in one region is rarely coincidence — check what you have been programming for that area.'
        }
      />

      {showVolume ? (
        <View className="gap-2">
          {both ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] font-semibold uppercase tracking-wider text-center">
              Programmed volume
            </Text>
          ) : null}
          <BodyMap highlights={volTint} figureWidth={figureWidth} />
          {volEntries.length === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs text-center">
              No region-tagged movements yet.
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-1 justify-center">
              {volEntries.map(([region, n]) => (
                <View
                  key={region}
                  style={{ borderColor: volTint[region] }}
                  className="rounded-full border px-2 py-0.5">
                  <Text
                    style={{ color: volTint[region] }}
                    className="text-[10px] font-semibold">
                    {regionLabel(region)} · {n}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {canSeeHealth ? (
        <View className="gap-2">
          {both ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] font-semibold uppercase tracking-wider text-center">
              Open injuries
            </Text>
          ) : null}
          <BodyMap highlights={injuryTints} figureWidth={figureWidth} />
          {openCount === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
              No open injuries. Happy days.
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-1 justify-center">
              {injEntries.map(([region, n]) => (
                <View
                  key={region}
                  style={{ borderColor: injuryTints[region] }}
                  className="rounded-full border px-2 py-0.5">
                  <Text
                    style={{ color: injuryTints[region] }}
                    className="text-[10px] font-semibold">
                    {regionLabel(region)} · {n}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          You don't have permission to view health data.
        </Text>
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
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
      <CardHeading
        title="Untagged sections"
        subtitle="No movement we recognise in these sections' bodies, even after an AI read. Add specific movement names so they get counted."
        what="Sections where neither our movement list nor the AI read could find a movement, so they couldn't be classified into the matrices above."
        why="Every untagged section is volume that's invisible to this analysis. Spelling out the movements in the body (e.g. 'back squat', not just 'squats') makes the numbers above trustworthy."
      />
      {shown.map((s, i) => (
        <View
          key={i}
          className="flex-row items-baseline gap-2 border-t border-line dark:border-line-dk pt-2">
          <FieldLabel className="w-20">
            {s.date.slice(5)}
          </FieldLabel>
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk text-sm font-medium">
              {s.title || categoryLabel(s.section_category)}
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] uppercase tracking-wider">
              {categoryLabel(s.section_category)}
            </Text>
          </View>
        </View>
      ))}
      {sections.length > shown.length ? (
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs pt-1">
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
  const colors = useThemeColors();
  const scheme = findScheme(trend.movement_key, trend.track_key);
  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card">
      <Pressable
        onPress={() => setOpenCard((v) => !v)}
        className="p-3 md:p-4 gap-1 active:opacity-70">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
            {movementName(trend.movement_key)}
            <Text className="text-ink-3 dark:text-ink-3-dk font-normal">
              {'  '}
              {scheme?.label ?? trend.track_key}
            </Text>
          </Text>
          <Ionicons
            name={openCard ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.ink3}
          />
        </View>
        <View className="flex-row items-center gap-3">
          <TrendStat icon="trending-up" colour="#10B981" n={trend.improving} />
          <TrendStat icon="trending-down" colour="#EF4444" n={trend.declining} />
          <TrendStat icon="remove" colour="#9CA3AF" n={trend.flat} />
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            {trend.members.length}{' '}
            {trend.members.length === 1 ? 'member' : 'members'}
          </Text>
        </View>
      </Pressable>
      {openCard ? (
        <View className="px-3 md:px-4 pb-3 gap-1.5 border-t border-line dark:border-line-dk pt-2">
          {trend.members.map((m) => (
            <View key={m.profile_id} className="flex-row items-center gap-2">
              <Text
                className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm"
                numberOfLines={1}>
                {nameOf(m.profile_id)}
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                {fmtValue(trend.movement_key, trend.track_key, m.first)} →{' '}
                {fmtValue(trend.movement_key, trend.track_key, m.last)}
              </Text>
              <View
                className={`rounded-full px-2 py-0.5 ${
                  m.trend === 'improving'
                    ? 'bg-emerald-500/10'
                    : m.trend === 'declining'
                      ? 'bg-red-500/10'
                      : 'bg-ink-3/10'
                }`}>
                <Text
                  className={`text-[10px] font-bold ${
                    m.trend === 'improving'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : m.trend === 'declining'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-ink-2 dark:text-ink-2-dk'
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
