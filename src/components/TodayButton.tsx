import { Pressable } from 'react-native';
import { Text } from './Text';

// Shared "jump to today" CTA — same pill on the Classes/Book calendar
// and the Programming calendar, so the two screens read as one system.
export function TodayButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Jump to today"
      className="rounded-full border border-line dark:border-line-dk px-4 h-9 items-center justify-center hover:bg-raised dark:hover:bg-raised-dk/60 active:bg-raised dark:active:bg-raised-dk">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
        Today
      </Text>
    </Pressable>
  );
}
