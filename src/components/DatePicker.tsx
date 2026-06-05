import { createElement } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

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

// Display an ISO date as DD/MM/YYYY for the helper label. Empty input
// returns empty string; malformed input returns the original so the
// user can see what they typed.
function isoToDdmmyyyy(iso: string): string {
  if (!iso) return '';
  if (!ISO_DATE_RE.test(iso)) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

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
  const display = isoToDdmmyyyy(value);

  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label}
      </Text>
      {Platform.OS === 'web' ? (
        // Native HTML date input — RNW's TextInput doesn't expose
        // type="date", so render the element directly. Inline styles
        // are kept narrow on purpose: matching the Input component
        // visually is more reliable than trying to thread NativeWind
        // class names through createElement.
        createElement('input', {
          type: 'date',
          value: ISO_DATE_RE.test(value) ? value : '',
          min,
          max,
          onChange: (e: { target: { value: string } }) => onChange(e.target.value),
          placeholder,
          style: webInputStyle,
          className: 'date-picker-input',
        })
      ) : (
        <TextInput
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
          placeholderTextColor="#9CA3AF"
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
        <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
      ) : null}
    </View>
  );
}

// Inline style that approximates Input.tsx so the date picker doesn't
// look out of place. Border colours are the gray-200 / gray-700 pair;
// dark-mode handling on raw <input> isn't covered by NativeWind so the
// border colour is a single value that reads OK against both palettes.
const webInputStyle = {
  backgroundColor: 'transparent',
  borderWidth: 1,
  borderColor: '#4B5563',
  borderRadius: 8,
  paddingTop: 12,
  paddingBottom: 12,
  paddingLeft: 16,
  paddingRight: 16,
  fontSize: 16,
  color: 'inherit',
  fontFamily: 'inherit',
  outline: 'none',
} as const;
