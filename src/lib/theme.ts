import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';

import { useGymBrand } from './useGymBrand';

const KEY = 'app_theme';

export type Scheme = 'light' | 'dark';

// Light is the platform default. nativewind's useColorScheme would
// otherwise fall back to the OS preference, which surprises new
// signups whose device is on dark — Temple's first impression is
// always the lighter palette unless the user has explicitly chosen
// dark from the in-app toggle.
export function useThemePreference() {
  const { colorScheme, setColorScheme } = useColorScheme();

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(KEY).then((v) => {
      if (!mounted) return;
      if (v === 'light' || v === 'dark') setColorScheme(v);
      else setColorScheme('light');
    });
    return () => {
      mounted = false;
    };
  }, [setColorScheme]);

  function set(next: Scheme) {
    setColorScheme(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }

  return { scheme: (colorScheme ?? 'light') as Scheme, set };
}

export function useThemeColors() {
  const { scheme } = useThemePreference();
  const brand = useGymBrand();
  const dark = scheme === 'dark';
  return {
    screenBg: dark ? '#030712' : '#F1F5F9',
    iconPrimary: dark ? '#E5E7EB' : '#1F2937',
    // Foreground for the "inverse" tonal chip — always reads against
    // the opposite scheme so it pops against ordinary chrome.
    iconInverse: dark ? '#111827' : '#FFFFFF',
    iconSecondary: '#6B7280',
    iconTertiary: dark ? '#6B7280' : '#9CA3AF',
    statusBar: dark ? ('light' as const) : ('dark' as const),
    // Runtime brand primary — components calling `colors.primary`
    // for an Ionicon tint etc. follow the gym's saved colour. Drives
    // solid fills, active-state emphasis and icon tints.
    primary: brand.primaryColor,
    // Brand "Text" colour — links and CTA copy (the `link` Tailwind
    // token / `text-link`). Resolved per scheme.
    text: brand.textColor,
    // Brand "Secondary" colour — accent chips and tints (the
    // `secondary` Tailwind token).
    secondary: brand.secondaryColor,
    white: '#FFFFFF',

    // The neutral ramp, for the places a colour has to be a runtime value
    // rather than a class: Ionicon tints, SVG fills, shadow colours. Same
    // values as the `ground` / `surface` / `ink` Tailwind tokens, so a
    // component can mix classes and props without drifting.
    ground: dark ? '#0A0B0D' : '#F7F7F8',
    surface: dark ? '#131519' : '#FFFFFF',
    raised: dark ? '#1B1E23' : '#F1F1F4',
    sunken: dark ? '#23272D' : '#E9E9EE',
    line: dark ? '#26282D' : '#E9E9EE',
    lineStrong: dark ? '#34373D' : '#DCDCE3',
    ink: dark ? '#F4F5F6' : '#14161A',
    ink2: dark ? '#9AA0A9' : '#5B606A',
    ink3: dark ? '#6C727B' : '#8B909A',
  };
}
