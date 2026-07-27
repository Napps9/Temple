import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

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
          ? 'bg-primary border-primary'
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
      } active:opacity-70`}>
      <Text
        className={`text-sm font-medium ${
          selected ? 'text-white' : 'text-gray-700 dark:text-gray-200'
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
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
              } active:opacity-70`}>
              <Ionicons
                name={opt.icon as keyof typeof Ionicons.glyphMap}
                size={18}
                color={selected ? colors.primary : colors.iconTertiary}
              />
              <Text
                className={`text-xs font-medium text-center ${
                  selected ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
                }`}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {value.kind === 'cohort' ? (
        <View className="gap-2">
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
          <Text className="text-gray-700 dark:text-gray-200 text-sm">
            Set to the members you just imported. Pick a different audience
            above to send to someone else instead.
          </Text>
        </View>
      ) : null}

      {value.kind === 'tags' ? (
        <View className="gap-2">
          {tagLabels.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading tags…</Text>
          ) : (tagLabels.data ?? []).length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
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
                className="flex-row items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 active:opacity-70">
                <Ionicons
                  name="bookmark-outline"
                  size={14}
                  color={colors.iconTertiary}
                />
                <Text className="text-gray-700 dark:text-gray-200 text-sm">
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
            placeholderTextColor={colors.iconTertiary}
            className="flex-1 bg-white dark:bg-gray-900 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-gray-50 border border-gray-200 dark:border-gray-700"
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
                ? 'border-primary bg-primary/5'
                : 'border-gray-200 dark:border-gray-700'
            } active:opacity-70`}>
            <Text
              className={`text-sm font-medium ${
                segmentName.trim()
                  ? 'text-primary'
                  : 'text-gray-400 dark:text-gray-500'
              }`}>
              Save
            </Text>
          </Pressable>
        </View>
        {(saved.data ?? []).length > 0 ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Tap a segment to load it. Long-press to delete.
          </Text>
        ) : null}
      </View>

      {/* Live recipient count */}
      <View className="flex-row items-center gap-3 bg-white dark:bg-gray-900 rounded-xl p-3 shadow-card">
        <View className="w-10 h-10 rounded-full bg-primary/10 items-center justify-center">
          <Ionicons name="send-outline" size={18} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {count.isLoading
              ? 'Counting recipients…'
              : count.isError
                ? 'Could not count recipients'
                : `${count.data ?? 0} ${count.data === 1 ? 'recipient' : 'recipients'}`}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {describeAudience(value)} · with a valid email, minus unsubscribes
          </Text>
        </View>
      </View>
    </View>
  );
}
