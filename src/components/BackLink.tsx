import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { haptic } from '@/lib/haptic';

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
// When `fallbackHref` is given, that path is always the destination —
// the label is a promise about where you'll land, so we honour it
// regardless of what's on the back stack. (Earlier behaviour preferred
// router.back() when any history existed, which broke for a user who
// navigated Classes → Analysis → a Manage sub-page: tapping "Manage"
// went to Analysis because that's what router.back() saw.)
//
// Without a fallbackHref the component falls back to router.back() and
// the label should just be "Back" — the destination genuinely is
// wherever the user came from.
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
    haptic.selection();
    if (fallbackHref) {
      router.replace(fallbackHref);
      return;
    }
    if (router.canGoBack()) {
      router.back();
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
