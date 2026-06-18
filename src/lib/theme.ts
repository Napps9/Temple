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
    // for an Ionicon tint etc. follow the gym's saved colour.
    primary: brand.primaryColor,
    // Brand text colour, resolved for the active scheme. Drives the gym
    // name in the top bar so the Text branding setting is visible in the
    // chrome (dark mode auto-derives a readable value — see useGymBrand).
    text: brand.textColor,
    white: '#FFFFFF',
  };
}
