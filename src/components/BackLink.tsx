import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { haptic } from '@/lib/haptic';
import { useThemeColors } from '@/lib/theme';

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
// Two navigation contracts, chosen by `preferBack`:
//
//   - Named destination (default): when `fallbackHref` is given, that
//     path is ALWAYS the destination — the label is a promise about
//     where you'll land ("Manage", "Email campaigns"), so we honour it
//     regardless of the back stack. (Earlier behaviour preferred
//     router.back() when any history existed, which broke for a user
//     who navigated Classes → Analysis → a Manage sub-page: tapping
//     "Manage" went to Analysis because that's what router.back() saw.)
//
//   - Came-from (`preferBack`): return to wherever the user actually
//     came from via router.back(), and only fall back to `fallbackHref`
//     when there's no history (a deep-link / cold open). This is the
//     right contract for content pages reachable from many places — a
//     movement opened from Track, Journal, a workout, or a group should
//     go back to whichever of those the user was on, not to one fixed
//     parent. Pair it with the bare chevron (`inline`) so no visible
//     label over-promises a single destination.
//
// Without a fallbackHref the component falls back to router.back() and
// the label should just be "Back" — the destination genuinely is
// wherever the user came from.
export function BackLink({
  label = 'Back',
  fallbackHref,
  inline = false,
  preferBack = false,
}: {
  label?: string;
  fallbackHref?: Href;
  inline?: boolean;
  preferBack?: boolean;
}) {
  const colors = useThemeColors();
  function onPress() {
    haptic.selection();
    if (preferBack) {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      if (fallbackHref) router.replace(fallbackHref);
      return;
    }
    if (fallbackHref) {
      router.replace(fallbackHref);
      return;
    }
    if (router.canGoBack()) {
      router.back();
    }
  }

  const a11yLabel = label === 'Back' ? 'Back' : `Back to ${label}`;

  if (inline) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        className="active:opacity-70">
        <Ionicons name="chevron-back" size={22} color={colors.iconTertiary} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      className="flex-row items-center gap-1 self-start py-1 active:opacity-70">
      <Ionicons name="chevron-back" size={18} color={colors.iconSecondary} />
      <Text className="text-gray-500 dark:text-gray-400">{label}</Text>
    </Pressable>
  );
}
