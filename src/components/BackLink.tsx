import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

// Standard back affordance for deep-link sub-pages. Uses router.back()
// so the destination follows the navigation stack — coming from the
// Manage home → Manage, deep-linked in from elsewhere → wherever the
// user actually was. The label is shown alongside the chevron so the
// user knows the destination, not just "go back somewhere."
export function BackLink({ label = 'Back' }: { label?: string }) {
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      className="flex-row items-center gap-1 self-start py-1 active:opacity-70">
      <Ionicons name="chevron-back" size={18} color="#6B7280" />
      <Text className="text-gray-500 dark:text-gray-400">{label}</Text>
    </Pressable>
  );
}
