import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { PageScroll } from '@/components/PageScroll';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Sheet, SheetAction } from '@/components/Sheet';
import {
  blockRangeText,
  yearLanes,
  type ProgrammingBlock,
} from '@/lib/programming-roadmap';
import { CLASS_TYPE_PALETTE } from '@/lib/setup-flow';
import { supabase } from '@/lib/supabase';

// The Year view of the programming calendar (docs/roadmap.md phase 5):
// named training blocks on a twelve-month band, set by the owner or head
// coach, visible to the whole team. Sharing is existence — a block saved
// here is on every coach's calendar strip the moment they open the week
// they're writing.

export function useProgrammingBlocks(gymId: string | undefined) {
  return useQuery({
    queryKey: ['programming-blocks', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<ProgrammingBlock[]> => {
      const { data, error } = await supabase
        .from('programming_blocks')
        .select('*')
        .eq('gym_id', gymId!)
        .order('starts_on');
      if (error) throw error;
      return (data ?? []) as ProgrammingBlock[];
    },
  });
}

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

type Draft = {
  id: string | null;
  name: string;
  starts_on: string;
  ends_on: string;
  color: string;
  note: string;
};

export function ProgrammingRoadmap({
  gymId,
  canEdit,
}: {
  gymId: string | undefined;
  canEdit: boolean;
}) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [draft, setDraft] = useState<Draft | null>(null);
  const blocks = useProgrammingBlocks(gymId);
  const lanes = yearLanes(blocks.data ?? [], year);

  const openNew = () =>
    setDraft({
      id: null,
      name: '',
      starts_on: '',
      ends_on: '',
      color: CLASS_TYPE_PALETTE[(blocks.data?.length ?? 0) % CLASS_TYPE_PALETTE.length],
      note: '',
    });
  const openEdit = (b: ProgrammingBlock) =>
    setDraft({
      id: b.id,
      name: b.name,
      starts_on: b.starts_on,
      ends_on: b.ends_on,
      color: b.color,
      note: b.note ?? '',
    });

  return (
    <PageScroll className="flex-1" contentContainerClassName="pb-10">
      <View className="w-full max-w-5xl mx-auto px-2 gap-4">
        <View className="flex-row items-center justify-center gap-0.5 pt-1">
          <Pressable
            onPress={() => setYear((y) => y - 1)}
            hitSlop={8}
            accessibilityLabel="Previous year"
            className="w-8 h-8 items-center justify-center">
            <Text className="text-ink-3 dark:text-ink-3-dk text-lg">‹</Text>
          </Pressable>
          <Text className="text-ink dark:text-ink-dk text-base font-semibold px-1.5">
            {year}
          </Text>
          <Pressable
            onPress={() => setYear((y) => y + 1)}
            hitSlop={8}
            accessibilityLabel="Next year"
            className="w-8 h-8 items-center justify-center">
            <Text className="text-ink-3 dark:text-ink-3-dk text-lg">›</Text>
          </Pressable>
        </View>

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <View className="gap-1.5">
            <View className="h-8 rounded-ctl bg-raised dark:bg-raised-dk overflow-hidden">
              {lanes.map((l) => (
                <View
                  key={l.block.id}
                  style={{
                    position: 'absolute',
                    left: `${l.leftPct}%`,
                    width: `${l.widthPct}%`,
                    top: 0,
                    bottom: 0,
                    backgroundColor: l.block.color,
                  }}
                  className="items-center justify-center px-1">
                  <Text
                    numberOfLines={1}
                    className="text-white text-[10px] font-bold uppercase tracking-wide">
                    {l.block.name}
                  </Text>
                </View>
              ))}
            </View>
            <View className="flex-row">
              {MONTH_LETTERS.map((m, i) => (
                <Text
                  key={i}
                  className="flex-1 text-center text-[10px] font-semibold text-ink-3 dark:text-ink-3-dk">
                  {m}
                </Text>
              ))}
            </View>
          </View>

          {lanes.length === 0 ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-sm">
              {canEdit
                ? 'No blocks yet — lay out the year and every coach sees it.'
                : 'No blocks yet.'}
            </Text>
          ) : (
            <View className="gap-3">
              {lanes.map((l) => (
                <View key={l.block.id} className="flex-row items-start gap-3">
                  <View
                    className="w-3 h-3 rounded-full mt-1"
                    style={{ backgroundColor: l.block.color }}
                  />
                  <View className="flex-1 gap-0.5">
                    <Text className="text-ink dark:text-ink-dk font-semibold">
                      {l.block.name}
                    </Text>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                      {blockRangeText(l.block)}
                      {l.block.note ? ` · “${l.block.note}”` : ''}
                    </Text>
                  </View>
                  {canEdit ? (
                    <ChipButton
                      label="Edit"
                      icon="create-outline"
                      onPress={() => openEdit(l.block)}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {canEdit ? (
            <View className="flex-row">
              <ChipButton label="Add a block" icon="add" onPress={openNew} />
            </View>
          ) : null}
        </View>
      </View>

      {draft ? (
        <BlockModal
          gymId={gymId}
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </PageScroll>
  );
}

function BlockModal({
  gymId,
  draft,
  onChange,
  onClose,
}: {
  gymId: string | undefined;
  draft: Draft;
  onChange: (d: Draft) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    draft.name.trim().length >= 2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.starts_on) &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.ends_on) &&
    draft.ends_on >= draft.starts_on;

  const save = async () => {
    if (!gymId || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fields = {
        name: draft.name.trim(),
        starts_on: draft.starts_on,
        ends_on: draft.ends_on,
        color: draft.color,
        note: draft.note.trim() || null,
      };
      if (draft.id) {
        const { error: e } = await supabase
          .from('programming_blocks')
          .update(fields)
          .eq('id', draft.id);
        if (e) throw e;
      } else {
        const { data: userResp } = await supabase.auth.getUser();
        if (!userResp.user) throw new Error('Not signed in');
        const { error: e } = await supabase.from('programming_blocks').insert({
          gym_id: gymId,
          created_by: userResp.user.id,
          ...fields,
        });
        if (e) throw e;
      }
      qc.invalidateQueries({ queryKey: ['programming-blocks', gymId] });
      onClose();
    } catch {
      setError("That didn't save — check the dates and try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!gymId || !draft.id || busy) return;
    setBusy(true);
    try {
      const { error: e } = await supabase
        .from('programming_blocks')
        .delete()
        .eq('id', draft.id);
      if (e) throw e;
      qc.invalidateQueries({ queryKey: ['programming-blocks', gymId] });
      onClose();
    } catch {
      setError("That didn't save — try again.");
      setBusy(false);
    }
  };

  return (
    // This was already a sheet below md and a dialog above it, hand-rolled
    // — the same rule Sheet encodes, written out a second time.
    <Sheet
      visible
      title={draft.id ? 'Edit block' : 'Add a block'}
      onClose={onClose}
      dialogWidth={440}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={onClose} disabled={busy}>
              Cancel
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button onPress={save} loading={busy} disabled={!valid}>
              {draft.id ? 'Save' : 'Add block'}
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-4 pb-1">
          <Input
            label="Name"
            value={draft.name}
            onChangeText={(name: string) => onChange({ ...draft, name })}
            placeholder="Squat strength"
          />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <DatePicker
                label="From"
                value={draft.starts_on}
                onChange={(starts_on: string) => onChange({ ...draft, starts_on })}
              />
            </View>
            <View className="flex-1">
              <DatePicker
                label="To"
                value={draft.ends_on}
                onChange={(ends_on: string) => onChange({ ...draft, ends_on })}
                min={draft.starts_on || undefined}
              />
            </View>
          </View>
          <Input
            label="Note (optional)"
            value={draft.note}
            onChangeText={(note: string) => onChange({ ...draft, note })}
            placeholder="Build to a heavy 5RM by half term"
          />
          <View className="gap-1.5">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
              Colour
            </Text>
            <View className="flex-row gap-2">
              {CLASS_TYPE_PALETTE.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => onChange({ ...draft, color: c })}
                  accessibilityLabel={`Colour ${c}`}
                  className={`w-8 h-8 rounded-full items-center justify-center ${
                    draft.color === c ? 'border-2 border-ink dark:border-ink-dk' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </View>
          </View>
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-600 dark:text-red-400 text-[13px]">
              {error}
            </Text>
          ) : null}
          {draft.id ? (
            <Pressable
              onPress={remove}
              disabled={busy}
              hitSlop={6}
              accessibilityRole="button"
              className="py-1">
              <Text className="text-red-600 dark:text-red-400 text-[13px] font-semibold text-center">
                Remove this block
              </Text>
            </Pressable>
          ) : null}
      </View>
    </Sheet>
  );
}
