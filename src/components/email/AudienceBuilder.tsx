import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { MemberPickerSheet } from '@/components/email/MemberPickerSheet';

import { useThemeColors } from '@/lib/theme';
import {
  useAudienceCount,
  useDeleteAudience,
  useGymTagLabels,
  useSaveAudience,
  useSavedAudiences,
} from '@/lib/comms';
import {
  COHORT_OPTIONS,
  describeAudience,
  type AudienceDefinition,
  type AudienceKind,
  type CohortKey,
} from '@/lib/email/audience';

const KIND_OPTIONS: { kind: AudienceKind; label: string; icon: string }[] = [
  { kind: 'all_members', label: 'All members', icon: 'people-outline' },
  { kind: 'cohort', label: 'By lifecycle', icon: 'pulse-outline' },
  { kind: 'tags', label: 'By tag', icon: 'pricetag-outline' },
  { kind: 'manual', label: 'Pick members', icon: 'checkbox-outline' },
];

function PillToggle({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-2 rounded-full border ${
        selected
          ? 'bg-raised dark:bg-raised-dk border-transparent'
          : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk'
      } active:opacity-70`}>
      <Text
        className={`text-sm font-medium ${
          selected ? 'text-ink dark:text-ink-dk' : 'text-ink-2 dark:text-ink-2-dk'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AudienceBuilder({
  value,
  onChange,
}: {
  value: AudienceDefinition;
  onChange: (def: AudienceDefinition) => void;
}) {
  const colors = useThemeColors();
  const tagLabels = useGymTagLabels();
  const count = useAudienceCount(value);
  const [picking, setPicking] = useState(false);
  const saved = useSavedAudiences();
  const saveAudience = useSaveAudience();
  const deleteAudience = useDeleteAudience();
  const [segmentName, setSegmentName] = useState('');

  function toggleCohort(key: CohortKey) {
    const current = value.kind === 'cohort' ? value.cohorts : [];
    const next = current.includes(key)
      ? current.filter((c) => c !== key)
      : [...current, key];
    onChange({ kind: 'cohort', cohorts: next });
  }

  function toggleTag(label: string) {
    const current = value.kind === 'tags' ? value.tags : [];
    const next = current.includes(label)
      ? current.filter((t) => t !== label)
      : [...current, label];
    onChange({ kind: 'tags', tags: next });
  }

  function selectKind(kind: AudienceKind) {
    if (kind === 'all_members') onChange({ kind: 'all_members' });
    else if (kind === 'cohort')
      onChange({ kind: 'cohort', cohorts: value.kind === 'cohort' ? value.cohorts : [] });
    else if (kind === 'tags')
      onChange({ kind: 'tags', tags: value.kind === 'tags' ? value.tags : [] });
    else if (kind === 'manual') {
      onChange({
        kind: 'manual',
        profile_ids: value.kind === 'manual' ? value.profile_ids : [],
      });
      // Straight into the picker: choosing "Pick members" and then being
      // shown an empty audience with no obvious next tap is a dead end.
      setPicking(true);
    }
  }

  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        {KIND_OPTIONS.map((opt) => {
          const selected = value.kind === opt.kind;
          return (
            <Pressable
              key={opt.kind}
              onPress={() => selectKind(opt.kind)}
              className={`flex-1 items-center gap-1 py-3 rounded-xl border ${
                selected
                  ? 'border-transparent bg-raised dark:bg-raised-dk'
                  : 'border-line dark:border-line-dk bg-surface dark:bg-surface-dk'
              } active:opacity-70`}>
              <Ionicons
                name={opt.icon as keyof typeof Ionicons.glyphMap}
                size={18}
                color={selected ? colors.primary : colors.ink3}
              />
              <Text
                className={`text-xs font-medium text-center ${
                  selected ? 'text-ink dark:text-ink-dk font-semibold' : 'text-ink-2 dark:text-ink-2-dk'
                }`}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {value.kind === 'cohort' ? (
        <View className="gap-2">
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Include members in any of these states:
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {COHORT_OPTIONS.map((opt) => (
              <PillToggle
                key={opt.key}
                label={opt.label}
                selected={value.cohorts.includes(opt.key)}
                onPress={() => toggleCohort(opt.key)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {value.kind === 'manual' ? (
        <View className="gap-2">
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {value.profile_ids.length === 0
              ? 'Nobody picked yet.'
              : `${value.profile_ids.length} member${
                  value.profile_ids.length === 1 ? '' : 's'
                } picked.`}
          </Text>
          <Pressable
            onPress={() => setPicking(true)}
            className="self-start rounded-full border border-primary/40 bg-primary/5 px-3 py-2 active:opacity-70">
            <Text className="text-primary text-sm font-medium">
              {value.profile_ids.length === 0 ? 'Choose members' : 'Change'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <MemberPickerSheet
        visible={picking}
        selected={value.kind === 'manual' ? value.profile_ids : []}
        onClose={() => setPicking(false)}
        onConfirm={(ids) => onChange({ kind: 'manual', profile_ids: ids })}
      />

      {value.kind === 'pending_members' ? (
        <View className="bg-primary/5 border border-primary/20 rounded-xl p-3">
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            Set to the members you just imported. Pick a different audience
            above to send to someone else instead.
          </Text>
        </View>
      ) : null}

      {value.kind === 'tags' ? (
        <View className="gap-2">
          {tagLabels.isLoading ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading tags…</Text>
          ) : (tagLabels.data ?? []).length === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              No member tags yet. Add tags from Manage → Members first.
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {(tagLabels.data ?? []).map((label) => (
                <PillToggle
                  key={label}
                  label={label}
                  selected={value.tags.includes(label)}
                  onPress={() => toggleTag(label)}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* Saved segments — email_audiences has existed since 0044 with
          nothing reading it. Load one, or keep the audience you just built
          so the next campaign does not start from scratch. */}
      <View className="gap-2">
        {(saved.data ?? []).length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {(saved.data ?? []).map((seg) => (
              <Pressable
                key={seg.id}
                onPress={() => onChange(seg.definition)}
                onLongPress={() => deleteAudience.mutate(seg.id)}
                className="flex-row items-center gap-1.5 rounded-full border border-line dark:border-line-dk bg-surface dark:bg-surface-dk px-3 py-2 active:opacity-70">
                <Ionicons
                  name="bookmark-outline"
                  size={14}
                  color={colors.ink3}
                />
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  {seg.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View className="flex-row items-center gap-2">
          <TextInput
            value={segmentName}
            onChangeText={setSegmentName}
            placeholder="Save this audience as…"
            placeholderTextColor={colors.ink3}
            className="flex-1 bg-surface dark:bg-surface-dk rounded-xl px-3 py-2 text-sm text-ink dark:text-ink-dk border border-line dark:border-line-dk"
          />
          <Pressable
            disabled={!segmentName.trim() || saveAudience.isPending}
            onPress={() => {
              saveAudience.mutate(
                { name: segmentName, definition: value },
                { onSuccess: () => setSegmentName('') },
              );
            }}
            className={`rounded-xl px-3 py-2 border ${
              segmentName.trim()
                ? 'border-transparent bg-raised dark:bg-raised-dk'
                : 'border-line dark:border-line-dk'
            } active:opacity-70`}>
            <Text
              className={`text-sm font-medium ${
                segmentName.trim()
                  ? 'text-ink dark:text-ink-dk font-semibold'
                  : 'text-ink-3 dark:text-ink-3-dk'
              }`}>
              Save
            </Text>
          </Pressable>
        </View>
        {(saved.data ?? []).length > 0 ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Tap a segment to load it. Long-press to delete.
          </Text>
        ) : null}
      </View>

      {/* Live recipient count */}
      <View className="flex-row items-center gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3">
        <View className="w-10 h-10 rounded-full bg-primary/10 items-center justify-center">
          <Ionicons name="send-outline" size={18} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            {count.isLoading
              ? 'Counting recipients…'
              : count.isError
                ? 'Could not count recipients'
                : `${count.data ?? 0} ${count.data === 1 ? 'recipient' : 'recipients'}`}
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {describeAudience(value)} · with a valid email, minus unsubscribes
          </Text>
        </View>
      </View>
    </View>
  );
}
