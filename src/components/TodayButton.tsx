import { Pressable, Text } from 'react-native';

// Shared "jump to today" CTA — same pill on the Classes/Book calendar
// and the Programming calendar, so the two screens read as one system.
export function TodayButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Jump to today"
      className="rounded-full border border-gray-200 dark:border-gray-700 px-4 h-9 items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800/60 active:bg-gray-100 dark:active:bg-gray-800">
      <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">
        Today
      </Text>
    </Pressable>
  );
}
