import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

// The tick box, for every list you pick from. Four modals had rolled
// their own — different sizes, different corner radii, one drawing the
// tick as a literal "✓" text node inside a 20px square, which lands a
// pixel or two off centre on Android.
//
// Ink rather than the gym's brand colour when on: a ticked row is a
// state, not an action, and the accent is spent on the one thing the
// modal exists to do.
export function Check({
  on,
  partial,
}: {
  on: boolean;
  // Half-ticked: a group whose children are some-but-not-all picked.
  partial?: boolean;
}) {
  const colors = useThemeColors();
  const filled = on || partial;
  return (
    <View
      className={`w-5 h-5 rounded-md items-center justify-center flex-none border-[1.5px] ${
        filled
          ? 'bg-ink dark:bg-ink-dk border-ink dark:border-ink-dk'
          : 'border-line-strong dark:border-line-strong-dk'
      }`}>
      {partial ? (
        <View className="w-2.5 h-0.5 rounded-full bg-surface dark:bg-surface-dk" />
      ) : on ? (
        <Ionicons name="checkmark" size={13} color={colors.surface} />
      ) : null}
    </View>
  );
}
