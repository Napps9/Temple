import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

type Props = TextInputProps & {
  label: string;
  error?: string;
};

// Field shell that also handles the password show/hide affordance when
// `secureTextEntry` is set. Splitting the border + background onto a
// wrapper View (rather than the TextInput itself) lets the eye toggle
// sit inside the field's box without absolute positioning quirks on
// react-native-web.
export function Input({ label, error, secureTextEntry, ...props }: Props) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = !!secureTextEntry;
  // When the user reveals a password the field flips to a plain text
  // input, but we keep `secureTextEntry` on the prop chain whenever
  // the user has chosen to hide it so iOS / Android still treat it as
  // a credential (no autocorrect / no learning the value, etc.).
  const effectiveSecure = isPassword && !revealed;

  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label}
      </Text>
      <View className="flex-row items-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
        <TextInput
          className={`flex-1 px-4 py-3 text-gray-900 dark:text-gray-50 text-base ${
            isPassword ? 'pr-2' : ''
          }`}
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={effectiveSecure}
          {...props}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            className="px-3 py-3 active:opacity-70">
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color="#6B7280"
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
      ) : null}
    </View>
  );
}
