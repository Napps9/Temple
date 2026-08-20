import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from './Text';

import {
  customRuleHint,
  customRuleValue,
  unitsFor,
  type RuleChoices,
  type RuleField,
} from '@/lib/setup-flow';

// The off-menu answer, as one more chip in the same row. It is not a mode
// you enter: the presets stay tappable the whole time, because a picker
// that hides the choices to let you type is worse than the short menu it
// was meant to widen. Number, then the unit you'd say it in — tap the
// unit to cycle — then the arrow, or just press enter.
export function CustomRuleChip({
  field,
  onSet,
  size = 'lg',
}: {
  field: RuleField;
  onSet: (value: RuleChoices[RuleField]) => void;
  // Sized to sit level with the chips beside it: the question chips are
  // roomier than the rule sheet's.
  size?: 'sm' | 'lg';
}) {
  const units = unitsFor(field);
  const [amount, setAmount] = useState('');
  const [unitIndex, setUnitIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  if (!units) return null;

  const unit = units[unitIndex % units.length];
  const ready = amount.trim().length > 0;
  const big = size === 'lg';

  function submit() {
    const n = Number(amount.trim());
    if (!ready || !Number.isFinite(n)) {
      setError('That needs to be a number');
      return;
    }
    const value = customRuleValue(field, n, unit);
    if (value === null) {
      const hint = customRuleHint(field);
      setError(hint ? `Has to be ${hint}` : "That's outside what I can set");
      return;
    }
    setAmount('');
    setError(null);
    onSet(value);
  }

  return (
    <View className="gap-1">
      <View
        className={`flex-row items-center gap-1 rounded-full border border-dashed ${
          big ? 'pl-4 pr-1.5 py-1.5' : 'pl-3 pr-1 py-1'
        } ${
          error
            ? 'border-red-400 dark:border-red-500'
            : 'border-gray-300 dark:border-gray-600'
        }`}>
        <TextInput
          value={amount}
          onChangeText={(t) => {
            setAmount(t.replace(/[^\d]/g, ''));
            setError(null);
          }}
          keyboardType="number-pad"
          placeholder="00"
          placeholderTextColor="#9CA3AF"
          onSubmitEditing={submit}
          accessibilityLabel="A different amount"
          className={`text-center text-gray-900 dark:text-gray-50 font-semibold ${
            big ? 'w-10 text-[15px]' : 'w-9 text-[13px]'
          }`}
        />
        <Pressable
          onPress={() => {
            setUnitIndex((i) => i + 1);
            setError(null);
          }}
          disabled={units.length === 1}
          hitSlop={6}
          accessibilityLabel={`Unit: ${unit.label}. Tap to change.`}>
          <Text
            className={`text-gray-500 dark:text-gray-400 font-semibold ${
              big ? 'text-sm' : 'text-[13px]'
            }`}>
            {unit.label}
            {units.length > 1 ? ' ⌄' : ''}
          </Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={!ready}
          accessibilityLabel="Use this"
          className={`rounded-full items-center justify-center ${
            big ? 'w-8 h-8' : 'w-6 h-6'
          } ${ready ? 'bg-primary' : 'bg-gray-100 dark:bg-gray-800'}`}>
          <Ionicons
            name="arrow-forward"
            size={big ? 15 : 13}
            color={ready ? '#FFFFFF' : '#9CA3AF'}
          />
        </Pressable>
      </View>
      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-[11.5px] pl-3">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
