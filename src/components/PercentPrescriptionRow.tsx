import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { movementName, searchMovements } from '@/lib/movements';
import { formatWeight, percentWeight, type ResolvedMax } from '@/lib/one-rep-max';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import { findPrescriptions } from '@/lib/percent-prescription';
import { useMovementPreferences } from '@/lib/useMovementPreferences';
import type { RepMaxLookup } from '@/lib/useOneRepMaxes';

type Props = {
  section: { title?: string | null; body?: string | null };
  // Resolved from one query at the calendar level — never fetched per
  // section, which would be an N+1 across a day's cards.
  lookup: RepMaxLookup;
  // Opens the recorder for a movement the member has no max for.
  onRecord?: (movementKey: string) => void;
};

// Turns the "@ 75%" a coach wrote into the weight this member should
// load. Renders nothing when there's nothing confident to say — a wrong
// number on a barbell is worse than no number.
export function PercentPrescriptionRow({ section, lookup, onRecord }: Props) {
  const { preferences, set } = useMovementPreferences();
  const [asking, setAsking] = useState<string | null>(null);

  const prescriptions = useMemo(
    () => findPrescriptions(section),
    [section.title, section.body],
  );

  // An ambiguous term the member has already answered resolves like any
  // other movement from then on.
  const resolved = prescriptions
    .filter((p) => !p.skipped)
    .map((p) => {
      if (p.movementKey) return p;
      if (p.ambiguousTerm) {
        const remembered = preferences.get(p.ambiguousTerm);
        if (remembered) return { ...p, movementKey: remembered };
      }
      return p;
    });

  const chips: { pct: number; movementKey: string; max: ResolvedMax }[] = [];
  const missingMax = new Set<string>();

  for (const p of resolved) {
    if (!p.movementKey) continue;
    const max = lookup(p.movementKey);
    if (!max) {
      missingMax.add(p.movementKey);
      continue;
    }
    chips.push({ pct: p.pct, movementKey: p.movementKey, max });
  }

  const unanswered = [
    ...new Set(
      resolved
        .filter((p) => !p.movementKey && p.ambiguousTerm)
        .map((p) => p.ambiguousTerm as string),
    ),
  ];

  if (
    chips.length === 0 &&
    unanswered.length === 0 &&
    missingMax.size === 0
  ) {
    return null;
  }

  return (
    <View className="flex-row flex-wrap items-center gap-2 mt-1">
      {chips.map((c, i) => (
        <PercentChip
          key={`${c.movementKey}-${c.pct}-${i}`}
          pct={c.pct}
          max={c.max}
          movementKey={c.movementKey}
        />
      ))}

      {[...missingMax].map((key) => (
        <ChipButton
          key={`add-${key}`}
          tone="neutral"
          icon="add-circle-outline"
          label={`Add your ${movementName(key)} max`}
          onPress={() => onRecord?.(key)}
        />
      ))}

      {unanswered.map((term) => (
        <ChipButton
          key={`ask-${term}`}
          tone="amber"
          icon="help-circle-outline"
          label={`Which ${term}?`}
          onPress={() => setAsking(term)}
        />
      ))}

      <MovementPickerModal
        term={asking}
        onClose={() => setAsking(null)}
        onPick={(movementKey) => {
          if (asking) set.mutate({ term: asking, movementKey });
          setAsking(null);
        }}
      />
    </View>
  );
}

function PercentChip({
  pct,
  max,
  movementKey,
}: {
  pct: number;
  max: ResolvedMax;
  movementKey: string;
}) {
  const [showSource, setShowSource] = useState(false);
  const unit = useGymWeightUnit();
  const weight = percentWeight(max.value, pct);
  const name = movementName(movementKey);
  const provenance =
    max.source === 'recorded'
      ? `${pct}% of your ${formatWeight(max.value, unit)} ${name} 1RM`
      : `${pct}% of ~${formatWeight(max.value, unit)}, estimated from your ${
          max.fromReps
        } rep max (${formatWeight(max.fromValue, unit)} × ${max.fromReps})`;

  return (
    <Pressable
      onPress={() => setShowSource((v) => !v)}
      accessibilityLabel={`${formatWeight(weight, unit)}. ${provenance}`}
      className="rounded-full bg-primary/10 border border-primary/30 px-3 py-1 active:bg-primary/20">
      <Text className="text-primary text-xs font-semibold">
        {pct}% · {max.source === 'estimated' ? '≈' : ''}
        {formatWeight(weight, unit)}
      </Text>
      {showSource ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] mt-0.5">
          {provenance}
        </Text>
      ) : null}
    </Pressable>
  );
}

// Only movements that can carry a percentage are offerable — a
// percentage of a 5k time is meaningless.
function weightedHits(query: string) {
  return searchMovements(query).filter((h) =>
    h.movement.schemes.some(
      (s) => s.metric === 'weight' && s.better === 'higher',
    ),
  );
}

function MovementPickerModal({
  term,
  onClose,
  onPick,
}: {
  term: string | null;
  onClose: () => void;
  onPick: (movementKey: string) => void;
}) {
  const hits = useMemo(() => (term ? weightedHits(term) : []), [term]);

  return (
    <Modal
      visible={term !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk p-6 w-full max-w-md md:max-w-lg gap-4">
          <Text className="text-ink dark:text-ink-dk text-lg font-semibold">
            Which lift is “{term}”?
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            Your programming says “{term}” without saying which variant.
            Pick the one you train and we'll use it whenever it comes up
            again.
          </Text>
          <ScrollView className="max-h-72">
            {hits.length === 0 ? (
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                No matching lift in the movement catalogue.
              </Text>
            ) : (
              <View className="gap-1">
                {hits.map((h) => (
                  <Pressable
                    key={h.movement.key}
                    onPress={() => onPick(h.movement.key)}
                    className="px-3 py-3 rounded-lg active:bg-gray-50 dark:active:bg-gray-800">
                    <Text className="text-ink dark:text-ink-dk">
                      {h.movement.name}
                    </Text>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      {h.group.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
