import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  fieldLabel,
  ruleSheet,
  RULE_FIELD_OPTIONS,
  type RuleChoices,
  type RuleField,
} from '@/lib/setup-flow';

// The whole settings surface as sentences. Tapping a value token opens
// that field's options as chips under the line — the same options the
// question chips use, so a rule reads identically however it was set.
// Shared between day-one setup and the permanent "Your rules" card on
// the Timeline: one sheet, for the life of the gym.
export function RuleSheet({
  choices,
  editable,
  onEdit,
}: {
  choices: RuleChoices;
  editable: boolean;
  onEdit: (field: RuleField, value: RuleChoices[RuleField]) => void;
}) {
  const [openField, setOpenField] = useState<RuleField | null>(null);
  const [showFine, setShowFine] = useState(false);

  const groups = ruleSheet(choices).filter((g) => !g.fine || showFine);
  const fineCount = ruleSheet(choices)
    .filter((g) => g.fine)
    .reduce((n, g) => n + g.lines.length, 0);

  return (
    <View className="gap-3">
      <Text className="text-gray-900 dark:text-gray-50 text-base font-bold">Your rules</Text>
      {groups.map((g) => (
        <View key={g.group} className="gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-bold uppercase tracking-wide">
            {g.group}
          </Text>
          {g.lines.map((l, li) => {
            const lineField = l.parts.find((p) => 'f' in p);
            const field = lineField && 'f' in lineField ? lineField.f : null;
            return (
              <View key={li} className="gap-1.5">
                <Text className="text-gray-700 dark:text-gray-300 text-sm leading-5">
                  {l.parts.map((p, pi) =>
                    't' in p ? (
                      <Text key={pi}>{p.t}</Text>
                    ) : (
                      <Text
                        key={pi}
                        onPress={
                          editable
                            ? () => setOpenField(openField === p.f ? null : p.f)
                            : undefined
                        }
                        className="text-link font-semibold">
                        {fieldLabel(p.f, choices)}
                        {editable ? ' ▾' : ''}
                      </Text>
                    ),
                  )}
                </Text>
                {editable && field && openField === field ? (
                  <View className="flex-row flex-wrap gap-1.5 pb-1">
                    {RULE_FIELD_OPTIONS[field].map((o) => {
                      const selected = choices[field] === o.value;
                      return (
                        <Pressable
                          key={o.label}
                          onPress={() => {
                            onEdit(field, o.value);
                            setOpenField(null);
                          }}
                          className={`px-3 py-1.5 rounded-full border active:opacity-70 ${
                            selected
                              ? 'bg-primary border-primary'
                              : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
                          }`}>
                          <Text
                            className={`text-[13px] font-semibold ${
                              selected ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                            }`}>
                            {o.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      {editable ? (
        <Pressable
          onPress={() => setShowFine((v) => !v)}
          className="flex-row items-center gap-1.5 active:opacity-70">
          <Ionicons
            name={showFine ? 'chevron-up' : 'chevron-down'}
            size={14}
            color="#9CA3AF"
          />
          <Text className="text-gray-500 dark:text-gray-400 text-[13px] font-medium">
            {showFine ? 'Hide the small print' : `The small print — ${fineCount} sensible defaults`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
