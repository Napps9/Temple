import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';

import { useGymBrand } from './useGymBrand';

const KEY = 'app_theme';

export type Scheme = 'light' | 'dark';

export function useThemePreference() {
  const { colorScheme, setColorScheme } = useColorScheme();

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(KEY).then((v) => {
      if (!mounted) return;
      if (v === 'light' || v === 'dark') setColorScheme(v);
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
    iconSecondary: '#6B7280',
    iconTertiary: dark ? '#6B7280' : '#9CA3AF',
    statusBar: dark ? ('light' as const) : ('dark' as const),
    // Runtime brand primary — components calling `colors.primary`
    // for an Ionicon tint etc. follow the gym's saved colour.
    primary: brand.primaryColor,
    white: '#FFFFFF',
  };
}
