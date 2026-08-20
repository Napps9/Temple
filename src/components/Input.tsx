import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, type TextInputProps, View } from 'react-native';
import { Text, TextInput } from './Text';

type Props = TextInputProps & {
  label: string;
  error?: string;
  // Opt into dark styling regardless of the system colour scheme — used by
  // the always-dark logged-out auth surfaces, where NativeWind's `dark:`
  // variant wouldn't otherwise fire.
  forceDark?: boolean;
};

// Field shell that also handles the password show/hide affordance when
// `secureTextEntry` is set. The border + background live on a wrapper View
// (not the TextInput) so the eye toggle sits inside the field box without
// absolute-positioning quirks on react-native-web.
export function Input({
  label,
  error,
  secureTextEntry,
  forceDark,
  ...props
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = !!secureTextEntry;
  // Keep `secureTextEntry` on the prop chain whenever hidden so iOS /
  // Android still treat the value as a credential.
  const effectiveSecure = isPassword && !revealed;

  const labelCls = forceDark
    ? 'text-gray-200'
    : 'text-ink-2 dark:text-ink-2-dk';
  const boxCls = forceDark
    ? 'bg-gray-900 border-gray-700'
    : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk';
  const inputCls = forceDark
    ? 'text-gray-50'
    : 'text-ink dark:text-ink-dk';
  const errorCls = forceDark ? 'text-red-400' : 'text-red-500 dark:text-red-400';

  return (
    <View className="gap-1.5">
      <Text className={`text-sm font-medium ${labelCls}`}>{label}</Text>
      <View className={`flex-row items-center border rounded-lg ${boxCls}`}>
        <TextInput
          className={`flex-1 px-4 py-3 text-base ${inputCls} ${
            isPassword ? 'pr-2' : ''
          }`}
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={effectiveSecure}
          // The visible label above is a sibling Text with no
          // programmatic link, so screen readers need the name here.
          // Before the spread so callers can override.
          accessibilityLabel={label}
          aria-invalid={!!error}
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
              color={forceDark ? '#9CA3AF' : '#6B7280'}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" className={`text-xs ${errorCls}`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
