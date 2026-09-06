import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { useThemeColors } from '@/lib/theme';

// Shared "jump to today" CTA — same pill on the Classes/Book calendar,
// the Programming calendar and the Timeline, so the screens read as one
// system. Below md it is the locate glyph alone: the date row is the top
// row there and shares its width with the account cluster.
export function TodayButton({ onPress }: { onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Jump to today"
      className="rounded-full border border-line dark:border-line-dk w-9 md:w-auto md:px-4 h-9 items-center justify-center hover:bg-raised dark:hover:bg-raised-dk/60 active:bg-raised dark:active:bg-raised-dk">
      <View className="md:hidden">
        <Ionicons name="locate-outline" size={18} color={colors.ink2} />
      </View>
      <Text className="hidden md:flex text-ink-2 dark:text-ink-2-dk text-sm font-medium">
        Today
      </Text>
    </Pressable>
  );
}
