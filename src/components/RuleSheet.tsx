import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { CustomRuleChip } from '@/components/CustomRuleValue';
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
      <Text className="text-ink dark:text-ink-dk text-base font-bold">Your rules</Text>
      {groups.map((g) => (
        <View key={g.group} className="gap-2">
          <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] font-bold uppercase tracking-wide">
            {g.group}
          </Text>
          {g.lines.map((l, li) => {
            const lineField = l.parts.find((p) => 'f' in p);
            const field = lineField && 'f' in lineField ? lineField.f : null;
            return (
              <View key={li} className="gap-1.5">
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
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
                  <View className="flex-row flex-wrap items-start gap-1.5 pb-1">
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
                              ? 'bg-raised dark:bg-raised-dk border-transparent'
                              : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk'
                          }`}>
                          <Text
                            className={`text-[13px] font-semibold ${
                              selected ? 'text-ink dark:text-ink-dk' : 'text-ink-2 dark:text-ink-2-dk'
                            }`}>
                            {o.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <CustomRuleChip
                      field={field}
                      size="sm"
                      onSet={(value) => {
                        onEdit(field, value);
                        setOpenField(null);
                      }}
                    />
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
          <Text className="text-ink-2 dark:text-ink-2-dk text-[13px] font-medium">
            {showFine ? 'Hide the small print' : `The small print — ${fineCount} sensible defaults`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
