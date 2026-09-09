import { createElement } from 'react';
import { Platform, View } from 'react-native';
import { FieldLabel } from './SectionLabel';
import { Text, TextInput } from './Text';

import { formatDate } from '@/lib/format-date';
import { useThemeColors, useThemePreference } from '@/lib/theme';

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
  const colors = useThemeColors();
  const { scheme } = useThemePreference();
  const display = formatDate(value);

  return (
    <View className="gap-1.5">
      <FieldLabel>{label}</FieldLabel>
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
        })
      ) : (
        <TextInput
          className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-ctl px-4 py-3 text-ink dark:text-ink-dk text-base"
          placeholderTextColor={colors.ink3}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder ?? 'YYYY-MM-DD'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
        />
      )}
      <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
        {display ? display : 'DD/MM/YYYY'}
      </Text>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-red-600 dark:text-red-400 text-xs">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// Shared shape between light + dark; only colours change. Matches
// Input.tsx visually: the ramp's `line` border over `ink` text in
// light, `line-strong-dk` over `ink-dk` in dark. Hexes rather than
// classes because a native date input is styled by prop, not className.
const webInputBase = {
  backgroundColor: 'transparent',
  // A raw DOM input is not a react-native-web component, so none of RNW's
  // resets reach it — including the min-width:0 that Text.tsx's TextInput
  // wrapper now applies. Without it the browser's `min-width: auto` floors
  // the field at the intrinsic width of a date plus its calendar chrome,
  // about 165px, and a flex-1 column on a 390px sheet is about 173px. It
  // overflowed and was clipped by the sheet's own overflow-x.
  minWidth: 0,
  width: '100%',
  borderWidth: 1,
  // `rounded-ctl`, the radius every other field in a row draws.
  borderRadius: 12,
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
  borderColor: '#E9E9EE', // line
  color: '#14161A', // ink
  // colorScheme tells the browser's native picker UI which palette to
  // render — without it, the calendar popup stays in light-mode chrome
  // even when the rest of the app is dark.
  colorScheme: 'light' as const,
} as const;

const webInputStyleDark = {
  ...webInputBase,
  borderColor: '#34373D', // line-strong-dk
  color: '#F4F5F6', // ink-dk
  colorScheme: 'dark' as const,
} as const;
