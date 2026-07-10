import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/lib/theme';
import { useAudienceCount, useGymTagLabels } from '@/lib/comms';
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
