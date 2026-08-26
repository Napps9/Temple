// A coach's macro prescription for one member, and the member's own view
// of it. One component, because the numbers and the way they are read are
// the same thing — only the ability to change them differs.
//
// Calories are shown, never stored (0268): 4/4/9 from the three fields, so
// the figure on the card cannot drift from the prescription behind it.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from './Button';
import { ChipButton } from './ChipButton';
import { Input } from './Input';
import { SectionLabel } from './SectionLabel';
import { Text } from './Text';

import { errorMessage } from '@/lib/errors';
import { kcalFromMacros, macroError, macroSplit } from '@/lib/macros';
import { supabase } from '@/lib/supabase';

type Row = {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  updated_at: string;
};

type Draft = { protein: string; carbs: string; fat: string };

const EMPTY: Draft = { protein: '', carbs: '', fat: '' };

export function MacroTargetsCard({
  gymId,
  profileId,
  canEdit,
}: {
  gymId: string;
  profileId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = useQuery({
    queryKey: ['macro-targets', gymId, profileId],
    queryFn: async (): Promise<Row | null> => {
      const { data, error: e } = await supabase
        .from('member_macro_targets')
        .select('protein_g, carbs_g, fat_g, updated_at')
        .eq('gym_id', gymId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (e) throw e;
      return (data as Row | null) ?? null;
    },
  });

  // Seed the draft once. Reseeding on refetch would throw away an edit
  // half-typed while the query revalidated — the per-card-save rule.
  useEffect(() => {
    if (seeded || targets.data === undefined) return;
    const row = targets.data;
    setDraft(
      row
        ? {
            protein: String(row.protein_g),
            carbs: String(row.carbs_g),
            fat: String(row.fat_g),
          }
        : EMPTY,
    );
    setSeeded(true);
  }, [targets.data, seeded]);

  const save = useMutation({
    mutationFn: async () => {
      const problem = macroError(draft);
      if (problem) throw new Error(problem);
      const { error: e } = await supabase.rpc('set_member_macro_targets', {
        p_gym_id: gymId,
        p_profile_id: profileId,
        p_protein_g: Number(draft.protein.trim()),
        p_carbs_g: Number(draft.carbs.trim()),
        p_fat_g: Number(draft.fat.trim()),
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['macro-targets', gymId, profileId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save')),
  });

  const clear = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('clear_member_macro_targets', {
        p_gym_id: gymId,
        p_profile_id: profileId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setDraft(EMPTY);
      queryClient.invalidateQueries({ queryKey: ['macro-targets', gymId, profileId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not clear')),
  });

  const saved = targets.data;

  if (!canEdit) {
    if (!saved) return null;
    const kcal = kcalFromMacros(saved);
    const split = macroSplit(saved);
    return (
      <View className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-3">
        <View className="flex-row gap-3">
          <Figure label="Protein" grams={saved.protein_g} pct={split.protein} />
          <Figure label="Carbs" grams={saved.carbs_g} pct={split.carbs} />
          <Figure label="Fat" grams={saved.fat_g} pct={split.fat} />
        </View>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {kcal.toLocaleString()} kcal a day, set by your coach.
        </Text>
      </View>
    );
  }

  // A live figure off the draft, so a coach sees the calories move as they
  // type rather than after they save.
  const previewable = macroError(draft) === null;
  const preview = previewable
    ? {
        protein_g: Number(draft.protein.trim()),
        carbs_g: Number(draft.carbs.trim()),
        fat_g: Number(draft.fat.trim()),
      }
    : null;

  return (
    <View className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-3">
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Input
            label="Protein (g)"
            value={draft.protein}
            onChangeText={(v) => setDraft({ ...draft, protein: v })}
            keyboardType="number-pad"
            placeholder="180"
          />
        </View>
        <View className="flex-1">
          <Input
            label="Carbs (g)"
            value={draft.carbs}
            onChangeText={(v) => setDraft({ ...draft, carbs: v })}
            keyboardType="number-pad"
            placeholder="220"
          />
        </View>
        <View className="flex-1">
          <Input
            label="Fat (g)"
            value={draft.fat}
            onChangeText={(v) => setDraft({ ...draft, fat: v })}
            keyboardType="number-pad"
            placeholder="70"
          />
        </View>
      </View>

      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        {preview
          ? `${kcalFromMacros(preview).toLocaleString()} kcal a day`
          : 'Grams per day. Calories follow.'}
      </Text>

      <View className="flex-row items-center gap-2">
        <Button
          loading={save.isPending}
          success={save.isSuccess && !save.isPending}
          onPress={() => save.mutate()}>
          Save targets
        </Button>
        {saved ? (
          <ChipButton
            tone="red"
            label="Clear"
            icon="close-circle-outline"
            onPress={() => clear.mutate()}
            disabled={clear.isPending}
          />
        ) : null}
      </View>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
      ) : null}
    </View>
  );
}

function Figure({
  label,
  grams,
  pct,
}: {
  label: string;
  grams: number;
  pct: number;
}) {
  return (
    <View className="flex-1 gap-0.5">
      <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] uppercase tracking-wider">
        {label}
      </Text>
      <Text className="text-ink dark:text-ink-dk text-xl font-semibold">
        {grams}
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs font-normal">g</Text>
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-[11px]">
        {pct.toFixed(0)}%
      </Text>
    </View>
  );
}

// The member's own view, with its heading. Separate so the heading can
// disappear with the card — a gym that does not coach nutrition should
// see no trace of it on Track, not an empty section.
export function MemberMacroTargets({
  gymId,
  profileId,
}: {
  gymId: string;
  profileId: string;
}) {
  const targets = useQuery({
    queryKey: ['macro-targets', gymId, profileId],
    queryFn: async (): Promise<Row | null> => {
      const { data, error } = await supabase
        .from('member_macro_targets')
        .select('protein_g, carbs_g, fat_g, updated_at')
        .eq('gym_id', gymId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) throw error;
      return (data as Row | null) ?? null;
    },
  });

  if (!targets.data) return null;

  return (
    <>
      <SectionLabel>Your targets</SectionLabel>
      <MacroTargetsCard gymId={gymId} profileId={profileId} canEdit={false} />
    </>
  );
}
