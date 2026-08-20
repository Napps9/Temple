import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, type TextInputProps, View } from 'react-native';
import { LABEL_TYPE } from './SectionLabel';
import { Text, TextInput } from './Text';

import { useThemeColors } from '@/lib/theme';

// The dark end of the ramp, for the forceDark screens — a runtime value
// cannot come from a `dark:` class when the scheme is light.
const DARK_INK_3 = '#6C727B';

// `label` draws the small-caps rule above the field. It is optional
// because a questionnaire prompt — a full sentence ending in a question
// mark — is not a field label and reads as shouting in caps; those
// screens draw the question themselves and name the field for a screen
// reader instead. The union makes that a requirement rather than an
// invitation: drop the label and you owe an accessibilityLabel.
type Base = TextInputProps & {
  error?: string;
  // Opt into dark styling regardless of the system colour scheme — used by
  // the always-dark logged-out auth surfaces, where NativeWind's `dark:`
  // variant wouldn't otherwise fire.
  forceDark?: boolean;
};

type Props = Base &
  ({ label: string } | { label?: undefined; accessibilityLabel: string });

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
  const colors = useThemeColors();
  const [revealed, setRevealed] = useState(false);
  const isPassword = !!secureTextEntry;
  // Keep `secureTextEntry` on the prop chain whenever hidden so iOS /
  // Android still treat the value as a credential.
  const effectiveSecure = isPassword && !revealed;

  // forceDark is for the screens that are dark whatever the scheme — the
  // logged-out landing. It names the dark end of the ramp directly rather
  // than relying on a `dark:` variant that the light scheme would win.
  const labelCls = forceDark ? 'text-ink-3-dk' : 'text-ink-3 dark:text-ink-3-dk';
  const boxCls = forceDark
    ? 'bg-surface-dk border-line-dk'
    : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk';
  const inputCls = forceDark ? 'text-ink-dk' : 'text-ink dark:text-ink-dk';
  const errorCls = forceDark ? 'text-red-400' : 'text-red-500 dark:text-red-400';

  return (
    <View className="gap-1.5">
      {label ? (
        <Text className={`${LABEL_TYPE} ${labelCls}`}>{label}</Text>
      ) : null}
      <View className={`flex-row items-center border rounded-lg ${boxCls}`}>
        <TextInput
          className={`flex-1 px-4 py-3 text-base ${inputCls} ${
            isPassword ? 'pr-2' : ''
          }`}
          placeholderTextColor={forceDark ? DARK_INK_3 : colors.ink3}
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
