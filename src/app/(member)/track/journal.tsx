import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { PageScroll } from '@/components/PageScroll';
import { PageHead } from '@/components/PageHead';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { EmptyState } from '@/components/EmptyState';
import { ListRow, RuledList } from '@/components/ListRow';
import { PillNav } from '@/components/PillNav';
import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { useSession } from '@/lib/auth';
import { groupByMonth, resultLine } from '@/lib/journal-directory';
import {
  categoryLabel,
  type SectionCategoryKey,
  type SectionFormatKey,
} from '@/lib/programming';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

type SectionRow = {
  id: string;
  section_category: SectionCategoryKey;
  section_format: SectionFormatKey;
  title: string | null;
  body: string | null;
  notes: string | null;
  sort_order: number;
  total_time_seconds: number | null;
  total_rounds: number | null;
  total_extra_reps: number | null;
  total_distance_m: number | null;
  total_calories: number | null;
  did_not_finish: boolean | null;
  free_text_result: string | null;
};

type WorkoutRow = {
  id: string;
  performed_at: string;
  title: string | null;
  class_session_id: string | null;
  class_sessions: {
    class_types: { name: string; color: string } | null;
  } | null;
  sections: SectionRow[];
  legacy_results: { id: string }[];
};

// The selected category filter survives leaving the page — same
// session-only idiom as every other remembered view.
let lastJournalFilter = 'all';

export default function Journal() {
  const colors = useThemeColors();
  const session = useSession();
  const [recording, setRecording] = useState(false);
  const [filter, setFilterState] = useState(lastJournalFilter);
  const setFilter = (next: string) => {
    lastJournalFilter = next;
    setFilterState(next);
  };

  // The directory needs section totals for the one-line summary, not
  // every entry — the per-set rows live on the workout page this list
  // opens into.
  const journal = useQuery({
    queryKey: ['tracked-journal', session?.user.id, 'directory'],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<WorkoutRow[]> => {
      const { data, error } = await supabase
        .from('tracked_workouts')
        .select(
          [
            'id, performed_at, title, class_session_id',
            'class_sessions(class_types(name, color))',
            'sections:tracked_workout_sections(id, section_category, section_format, title, body, notes, sort_order, total_time_seconds, total_rounds, total_extra_reps, total_distance_m, total_calories, did_not_finish, free_text_result)',
            'legacy_results:tracked_movement_results(id)',
          ].join(', '),
        )
        .eq('profile_id', session!.user.id)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as WorkoutRow[]).map((w) => ({
        ...w,
        sections: (w.sections ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order),
      }));
    },
  });

  const rows = journal.data ?? [];

  // Who else logged the same class sessions — one batch call, consent
  // riding the leaderboard gate server-side (0258).
  const classSessionIds = [
    ...new Set(
      rows
        .map((w) => w.class_session_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const partners = useQuery({
    queryKey: ['training-partners', session?.user.id, classSessionIds],
    enabled: classSessionIds.length > 0,
    queryFn: async (): Promise<Map<string, TrainingPartner[]>> => {
      const { data, error } = await supabase.rpc(
        'class_session_training_partners',
        { p_session_ids: classSessionIds },
      );
      if (error) throw error;
      const by = new Map<string, TrainingPartner[]>();
      for (const r of data ?? []) {
        const list = by.get(r.class_session_id) ?? [];
        list.push(r);
        by.set(r.class_session_id, list);
      }
      return by;
    },
  });
  const partnersFor = (sessionId: string | null): TrainingPartner[] =>
    (sessionId ? partners.data?.get(sessionId) : undefined) ?? [];
  const categories = [
    ...new Set(
      rows.flatMap((w) => w.sections.map((s) => s.section_category)),
    ),
  ];
  const activeFilter =
    filter === 'all' || categories.includes(filter as SectionCategoryKey)
      ? filter
      : 'all';
  const shown =
    activeFilter === 'all'
      ? rows
      : rows.filter((w) =>
          w.sections.some((s) => s.section_category === activeFilter),
        );

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <PageScroll contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <PageHead
          lead={<BackLink inline fallbackHref="/track" />}
          title="Journal"
          subtitle="Every workout you've logged."
          action={
            <Pressable
              onPress={() => setRecording(true)}
              hitSlop={6}
              className="bg-primary active:bg-primary-dark rounded-full px-3 py-1.5 flex-row items-center gap-1">
              <Ionicons name="add" size={14} color={colors.onPrimary} />
              <Text className="text-on-primary text-xs font-semibold">Record</Text>
            </Pressable>
          }
        />

        {categories.length > 1 ? (
          <PillNav
            items={[
              { key: 'all', label: 'All' },
              ...categories.map((c) => ({ key: c, label: categoryLabel(c) })),
            ]}
            active={activeFilter}
            onSelect={setFilter}
          />
        ) : null}

        {journal.isLoading ? (
          <EmptyState kind="loading" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="barbell-outline"
            title="No workouts yet"
            description="Log a session and it lands here, PRs and all."
            actionLabel="Record a workout"
            onAction={() => setRecording(true)}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            kind="filtered"
            title="Nothing under that filter"
            description="Try All — every workout is still here."
          />
        ) : (
          groupByMonth(shown).map((g) => (
            <View key={g.key} className="gap-2">
              <SectionLabel>{g.label}</SectionLabel>
              <RuledList>
                {g.rows.map((w, i) => (
                  <ListRow
                    key={w.id}
                    ruled
                    first={i === 0}
                    href={`/track/workout/${w.id}` as never}
                    lead={<DateGutter iso={w.performed_at} />}
                    title={w.title?.trim() || 'Workout'}
                    subtitle={resultLine(w.sections, w.legacy_results.length)}
                    chip={
                      w.class_sessions?.class_types ? (
                        <View
                          style={{
                            backgroundColor: w.class_sessions.class_types.color,
                          }}
                          className="w-2 h-2 rounded-full"
                        />
                      ) : undefined
                    }
                    foot={
                      partnersFor(w.class_session_id).length > 0 ? (
                        <PartnerStack people={partnersFor(w.class_session_id)} />
                      ) : undefined
                    }
                  />
                ))}
              </RuledList>
            </View>
          ))
        )}
      </PageScroll>

      <RecordWorkoutModal
        visible={recording}
        onClose={() => setRecording(false)}
      />
    </Screen>
  );
}

type TrainingPartner = {
  class_session_id: string;
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
};

// Up to three faces, then "+N" — the same people the class leaderboard
// shows, because it is the same consent.
function PartnerStack({ people }: { people: TrainingPartner[] }) {
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  const firstNames = shown.map((p) => p.full_name.split(' ')[0]);
  return (
    <View className="flex-row items-center gap-1.5 pt-1">
      <View className="flex-row">
        {shown.map((p, i) => (
          <View
            key={p.profile_id}
            style={i > 0 ? { marginLeft: -6 } : undefined}
            className="w-5 h-5 rounded-full bg-raised dark:bg-raised-dk border border-surface dark:border-surface-dk items-center justify-center overflow-hidden">
            {p.avatar_url ? (
              <Image source={{ uri: p.avatar_url }} className="w-5 h-5" />
            ) : (
              <Text className="text-ink-2 dark:text-ink-2-dk text-[9px] font-semibold">
                {p.full_name.charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
        ))}
      </View>
      <Text className="text-ink-3 dark:text-ink-3-dk text-xs" numberOfLines={1}>
        with {firstNames.join(', ')}
        {extra > 0 ? ` +${extra}` : ''}
      </Text>
    </View>
  );
}

// The board's date gutter: weekday over day number, fixed width so the
// titles align down the list.
function DateGutter({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <View className="w-9 items-center">
      <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] uppercase tracking-wider">
        {d.toLocaleDateString(undefined, { weekday: 'short' })}
      </Text>
      <Text className="text-ink dark:text-ink-dk font-semibold text-base leading-5">
        {d.getDate()}
      </Text>
    </View>
  );
}
