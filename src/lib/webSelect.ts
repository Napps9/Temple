import type { CSSProperties } from 'react';

// Theme-aware inline style for the raw web <select> elements the import
// wizards use (react-native-web has no styleable Picker on web). Without
// an explicit dark background + colour the native control keeps a light
// border and a transparent body, so in dark mode the border glares and
// the option popup renders light text on a light background. Callers pass
// their own size props (fontSize / padding).
export function webSelectStyle(
  dark: boolean,
  extra?: CSSProperties,
): CSSProperties {
  return {
    borderRadius: 8,
    border: `1px solid ${dark ? '#374151' : '#D1D5DB'}`,
    backgroundColor: dark ? '#111827' : '#FFFFFF',
    color: dark ? '#F9FAFB' : '#111827',
    ...extra,
  };
}
