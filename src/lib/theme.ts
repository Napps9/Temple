import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';

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
  const dark = scheme === 'dark';
  return {
    screenBg: dark ? '#030712' : '#F9FAFB',
    iconPrimary: dark ? '#E5E7EB' : '#1F2937',
    iconSecondary: '#6B7280',
    iconTertiary: dark ? '#6B7280' : '#9CA3AF',
    statusBar: dark ? ('light' as const) : ('dark' as const),
    primary: '#2563EB',
    white: '#FFFFFF',
  };
}
