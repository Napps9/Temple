import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { Pressable, useWindowDimensions } from 'react-native';
import { Text } from './Text';

import { LG } from '@/lib/breakpoint';
import { haptic } from '@/lib/haptic';
import { useThemeColors } from '@/lib/theme';

// Standard back affordance for deep-link sub-pages.
//
// One navigation contract, everywhere: go back to the screen the user
// actually came from (router.back()), and use `fallbackHref` — the page's
// logical parent — only when there is no history, which means a cold open
// or a deep link. The label is always "Back", because the destination
// varies with the journey; the old destination labels ("Manage",
// "Members") were promises this contract cannot keep, so they are gone.
// `fallbackHref` navigates by replace, not push: after a cold open the
// deep-linked page shouldn't linger as a history entry.
//
// Two visual variants share the contract:
//
//   - default: a `chevron + Back` row that sits above the page title.
//   - inline: just the chevron, sized to sit beside an inline title in
//     a flex-row header.
//
// The one exception is `?backTo=setup|checklist`, which relabels to
// "Setup" and hard-replaces into the flow the owner was working through.
// It beats router.back() deliberately: after a Stripe OAuth round-trip
// history exists but points at the provider's redirect chain, not at
// setup, so only a fixed destination gets the owner home.
//
// With no history and no fallbackHref there is genuinely nowhere to go,
// so the component renders nothing rather than a dead chevron.
// canGoBack() isn't reactive — a phantom render can only degrade to a
// safe no-op in onPress, never a wrong navigation.
//
// `railDestination` is for pages that have their own entry in the staff
// rail: with the rail visible the nav already names where the user is and
// every way back, so a "Back" above the title is redundant chrome and the
// component renders nothing. Below the rail width those pages are reached
// through the Manage hub and the affordance returns. Pass it gated the
// way the rail gates the link (capability / role) — a viewer whose rail
// has no entry for the page still needs the way back. The
// `?backTo=setup|checklist` override still renders regardless: the setup
// flow has no rail entry to lean on.
export function BackLink({
  fallbackHref,
  inline = false,
  railDestination = false,
}: {
  fallbackHref?: Href;
  inline?: boolean;
  railDestination?: boolean;
}) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const { backTo } = useLocalSearchParams<{ backTo?: string }>();
  const toSetup = backTo === 'setup' || backTo === 'checklist';
  const label = toSetup ? 'Setup' : 'Back';

  if (railDestination && !toSetup && width >= LG) return null;
  if (!toSetup && !fallbackHref && !router.canGoBack()) return null;

  function onPress() {
    haptic.selection();
    if (toSetup) {
      router.replace(backTo === 'checklist' ? '/onboarding' : '/setup');
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (fallbackHref) router.replace(fallbackHref);
  }

  const a11yLabel = toSetup ? 'Back to Setup' : 'Back';

  if (inline) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        className="active:opacity-70">
        <Ionicons name="chevron-back" size={22} color={colors.ink3} />
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
      <Ionicons name="chevron-back" size={18} color={colors.ink2} />
      <Text className="text-ink-2 dark:text-ink-2-dk">{label}</Text>
    </Pressable>
  );
}
