import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { Pressable, Text } from 'react-native';

// Standard back affordance for deep-link sub-pages.
//
// Two visual variants share one navigation contract:
//
//   - default: a `chevron + label` row that sits above the page title,
//     used on Manage sub-pages and Account where there's vertical room
//     for an explicit destination label.
//   - inline: just the chevron, sized to sit beside an inline title in
//     a flex-row header — the pattern Track / Inbox / Athlete / Member
//     deep pages reach for.
//
// Both call `router.back()` so the destination follows the actual
// navigation stack (coming from a Manage card → Manage; deep-linked in
// from a notification → wherever the user was). When there is no stack
// to go back to (a shared URL opened cold, or a push-notification
// entry), `fallbackHref` is taken instead so the user never lands on a
// dead-end / app-close.
export function BackLink({
  label = 'Back',
  fallbackHref,
  inline = false,
}: {
  label?: string;
  fallbackHref?: Href;
  inline?: boolean;
}) {
  function onPress() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (fallbackHref) {
      router.replace(fallbackHref);
    }
  }

  if (inline) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Back to ${label}`}
        className="active:opacity-70">
        <Ionicons name="chevron-back" size={22} color="#9CA3AF" />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      className="flex-row items-center gap-1 self-start py-1 active:opacity-70">
      <Ionicons name="chevron-back" size={18} color="#6B7280" />
      <Text className="text-gray-500 dark:text-gray-400">{label}</Text>
    </Pressable>
  );
}
