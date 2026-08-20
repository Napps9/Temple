import { createElement } from 'react';
import { Platform, View } from 'react-native';
import { Text, TextInput } from './Text';

import { formatDate } from '@/lib/format-date';
import { useThemePreference } from '@/lib/theme';

type Props = {
  label: string;
  value: string; // ISO YYYY-MM-DD (Postgres-friendly), or '' for empty
  onChange: (next: string) => void;
  placeholder?: string;
  error?: string;
  min?: string; // ISO YYYY-MM-DD
  max?: string; // ISO YYYY-MM-DD
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Cross-platform date picker. On web the browser's <input type="date">
// gives a native calendar UI and returns ISO YYYY-MM-DD (which is what
// we pass to Postgres). On native we fall back to a plain text input
// — adding a true native picker would mean pulling in
// @react-native-community/datetimepicker, which is out of scope here
// since the deployment is web-first.
//
// Display label beneath the picker always shows the value as
// DD/MM/YYYY so the format is unambiguous regardless of the browser's
// locale-driven rendering inside the field.
export function DatePicker({
  label,
  value,
  onChange,
  placeholder,
  error,
  min,
  max,
}: Props) {
  const { scheme } = useThemePreference();
  const display = formatDate(value);

  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label}
      </Text>
      {Platform.OS === 'web' ? (
        // Native HTML date input — RNW's TextInput doesn't expose
        // type="date", so render the element directly. Browser
        // user-agent stylesheets ignore `color: inherit` for date
        // inputs and fall back to black, which was invisible against
        // the dark-mode page background. Wire the colour + colorScheme
        // off the current theme so both the value text AND the native
        // picker chrome match.
        createElement('input', {
          type: 'date',
          value: ISO_DATE_RE.test(value) ? value : '',
          min,
          max,
          onChange: (e: { target: { value: string } }) => onChange(e.target.value),
          placeholder,
          // The visible label above is an unassociated sibling — name
          // the raw HTML input directly.
          'aria-label': label,
          style: scheme === 'dark' ? webInputStyleDark : webInputStyleLight,
          className: 'date-picker-input',
        })
      ) : (
        <TextInput
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
          placeholderTextColor="#9CA3AF"
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder ?? 'YYYY-MM-DD'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
        />
      )}
      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        {display ? display : 'DD/MM/YYYY'}
      </Text>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-red-500 dark:text-red-400 text-xs">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// Shared shape between light + dark; only colours change. Matches
// Input.tsx visually: gray-200 border + gray-900 text in light,
// gray-700 border + gray-50 text in dark.
const webInputBase = {
  backgroundColor: 'transparent',
  borderWidth: 1,
  borderRadius: 8,
  paddingTop: 12,
  paddingBottom: 12,
  paddingLeft: 16,
  paddingRight: 16,
  fontSize: 16,
  fontFamily: 'inherit',
  outline: 'none',
} as const;

const webInputStyleLight = {
  ...webInputBase,
  borderColor: '#E5E7EB', // gray-200
  color: '#111827', // gray-900
  // colorScheme tells the browser's native picker UI which palette to
  // render — without it, the calendar popup stays in light-mode chrome
  // even when the rest of the app is dark.
  colorScheme: 'light' as const,
} as const;

const webInputStyleDark = {
  ...webInputBase,
  borderColor: '#374151', // gray-700
  color: '#F9FAFB', // gray-50
  colorScheme: 'dark' as const,
} as const;
