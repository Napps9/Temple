import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  customRuleHint,
  customRuleValue,
  unitsFor,
  type CustomUnit,
  type RuleChoices,
  type RuleField,
} from '@/lib/setup-flow';

// The presets answer most gyms; this answers the rest. Opened from the
// "Something else" chip on a rule question or a sheet token, it takes a
// number and the unit the owner would say it in and converts to whatever
// the column stores. A value outside what the column can hold is refused
// here rather than silently clamped, because a booking window quietly
// halved is worse than being told the limit.
export function CustomRuleValue({
  field,
  onSet,
  onCancel,
}: {
  field: RuleField;
  onSet: (value: RuleChoices[RuleField]) => void;
  onCancel: () => void;
}) {
  const units = unitsFor(field);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<CustomUnit | null>(units?.[0] ?? null);
  const [error, setError] = useState<string | null>(null);
  if (!units || !unit) return null;

  const hint = customRuleHint(field);
  // The cancel rule's absolute shape asks for an hour of the evening, not
  // a length of time, so the field's own prompt changes with the unit.
  const absolute = unit.per === 0;

  function submit() {
    const n = Number(amount.trim());
    if (!amount.trim() || !Number.isFinite(n)) {
      setError('Give me a number');
      return;
    }
    const value = customRuleValue(field, n, unit!);
    if (value === null) {
      setError(hint ? `That one has to be ${hint}` : "That's outside what I can set");
      return;
    }
    onSet(value);
  }

  return (
    <View className="gap-2 pb-1">
      <View className="flex-row flex-wrap gap-1.5">
        {units.map((u) => {
          const on = u.label === unit.label;
          return (
            <Pressable
              key={u.label}
              onPress={() => {
                setUnit(u);
                setError(null);
              }}
              className={`px-3 py-1.5 rounded-full border active:opacity-70 ${
                on
                  ? 'bg-primary/10 border-primary'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              }`}>
              <Text
                className={`text-[13px] font-semibold ${
                  on ? 'text-primary' : 'text-gray-700 dark:text-gray-300'
                }`}>
                {u.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={amount}
          onChangeText={(t) => {
            setAmount(t);
            setError(null);
          }}
          keyboardType="number-pad"
          autoFocus
          placeholder={absolute ? 'Hour, 0–23' : hint ?? ''}
          placeholderTextColor="#9CA3AF"
          onSubmitEditing={submit}
          className="w-28 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-50"
        />
        <Pressable
          onPress={submit}
          className="px-4 py-2 rounded-full bg-primary active:opacity-70">
          <Text className="text-white text-[13px] font-semibold">Set it</Text>
        </Pressable>
        <Pressable onPress={onCancel} hitSlop={6}>
          <Text className="text-gray-400 dark:text-gray-500 text-[13px]">Cancel</Text>
        </Pressable>
      </View>
      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-[12.5px]">{error}</Text>
      ) : null}
    </View>
  );
}
