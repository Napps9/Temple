import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';

import { useThemePreference } from '@/lib/theme';

// Light/dark switch for the logged-out auth surfaces — mirrors the
// in-app TopNav toggle (sun when dark, moon when light) and flips the
// same persisted, app-wide scheme.
export function ThemeToggle() {
  const { scheme, set } = useThemePreference();
  const dark = scheme === 'dark';
  return (
    <Pressable
      onPress={() => set(dark ? 'light' : 'dark')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="w-9 h-9 rounded-full items-center justify-center bg-surface dark:bg-surface-dk border border-line dark:border-line-dk active:opacity-70">
      <Ionicons
        name={dark ? 'sunny-outline' : 'moon-outline'}
        size={18}
        color={dark ? '#E5E7EB' : '#1F2937'}
      />
    </Pressable>
  );
}
