import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ManageNavSheet } from './ManageNavSheet';
import { TopBarCluster, useTopBarOwned } from './PageTopRow';
import { MD } from '@/lib/breakpoint';
import { haptic } from '@/lib/haptic';
import { BRAND, useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';

type IoniconName = keyof typeof Ionicons.glyphMap;

export type NavSection = {
  name: string;
  href: string;
  // Only needed when `href` also matches a route in the OTHER top-level
  // group — Programming exists under both (member) and (staff), so a bare
  // router.replace('/programming') is ambiguous and can land on the wrong
  // one. When set, this group-qualified path (e.g. '/(staff)/programming')
  // is what actually gets navigated to; `href` still drives the active-
  // pill match against the real (group-stripped) pathname.
  navigateTo?: string;
  label: string;
  icon: IoniconName;
};

// Persistent top bar — replaced the old NavModal popup. Layout:
//   [gym name, md+] … [section pills, centred] … [view-switch] [avatar]
// One row at every width. The Temple mark used to hold the top-left;
// it went (the owner's call) so a phone gets its vertical space back —
// the pills join the bar as icon-over-label instead of renting a second
// row. The pills here carry their visible label; below md they move to
// the BottomDock, which is glyph-only by the owner's call. The
// day/week/month switcher lives with the calendar itself, not here.
export function TopNav({
  sections,
  variant,
}: {
  sections: NavSection[];
  variant: 'staff' | 'member';
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const brand = useGymBrand();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const owned = useTopBarOwned();
  const [manageOpen, setManageOpen] = useState(false);

  const gymName = brand.gymName;

  const homeHref = variant === 'staff' ? '/timeline' : '/book';

  // Selected is a soft tint, not a fill. The track it used to sit in has
  // gone: a filled slate rail around three pills was the loudest thing on
  // a screen whose job is to show a gym's own content, and the selected
  // pill inside it needed a shadow to separate from it.
  //
  // The active icon is ink rather than the gym's colour. The accent is
  // spent on the one action a page exists for; a nav that is always on
  // screen is not that, and tinting it made every gym's chrome a
  // different colour before any of their content had loaded.
  const onPressSection = (s: NavSection) => {
    haptic.selection();
    // The widths that show this bar have no rail, so the gym's
    // destinations would otherwise all route through the hub.
    // The Manage pill opens them as a sheet instead; the hub
    // leads the sheet, where the pill used to land.
    if (s.name === 'management') {
      setManageOpen(true);
      return;
    }
    router.replace((s.navigateTo ?? s.href) as never);
  };

  // The md+ rendering of the sections; below md they live in BottomDock.
  const pillRow = () => (
    <View className="flex-row gap-1">
      {sections.map((s) => {
        const active = pathname.startsWith(s.href);
        return (
          <Pressable
            key={s.name}
            onPress={() => onPressSection(s)}
            hitSlop={4}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={s.label}
            className={`flex-row items-center gap-1.5 px-3.5 py-1.5 rounded-full active:opacity-70 ${
              active
                ? 'bg-brand/10'
                : 'hover:bg-raised/60 dark:hover:bg-raised-dk/60'
            }`}>
            <Ionicons name={s.icon} size={17} color={active ? BRAND : colors.ink3} />
            <Text
              className={`text-sm ${
                active
                  ? 'text-ink dark:text-ink-dk font-semibold'
                  : 'text-ink-3 dark:text-ink-3-dk font-medium'
              }`}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  // Below md the bar pays only the status-bar inset in flow, so the
  // pinned notice and the page start below it, and the cluster floats
  // over the page (zIndex lifts it above the scene rendered after it)
  // so content scrolls under the buttons the way it does under the
  // dock. A focused page can take the row over instead (PageTopRow) and
  // draws the cluster itself.
  if (width < MD) {
    return (
      <>
        <View style={{ height: insets.top }} className="bg-ground dark:bg-ground-dk" />
        {owned ? null : (
          <View
            pointerEvents="box-none"
            className="absolute right-4 flex-row items-center gap-1.5"
            style={{ top: insets.top + 10, zIndex: 10 }}>
            <TopBarCluster variant={variant} />
          </View>
        )}
      </>
    );
  }

  return (
    <View
      style={{ paddingTop: insets.top + 10 }}
      className="bg-ground dark:bg-ground-dk px-4 md:px-6 pb-3 gap-2">
      <View className="flex-row items-center gap-2 md:gap-3">
        {/* Three zones (flex-1 left/right) keep the pills on the bar's
            true centre at md+. Below md the left zone disappears
            entirely — an empty flex-1 spacer there forced the pills
            onto the bar's centre and slid them under the right
            cluster on staff, whose four pills don't fit centred. */}
        <View className="hidden md:flex flex-1 flex-row items-center">
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace(homeHref as never);
            }}
            hitSlop={6}
            className="hidden md:flex flex-row items-center hover:opacity-80 active:opacity-70">
            <Text
              className="text-ink dark:text-ink-dk font-semibold text-base"
              numberOfLines={1}>
              {gymName}
            </Text>
          </Pressable>
        </View>

        <View className="items-center hidden md:flex">{pillRow()}</View>
        {/* Below md the sections live in the BottomDock; the bar keeps
            only the right cluster, and the page gets the top back. */}
        <View className="flex-1 md:hidden" />

        <View className="flex-none md:flex-1 flex-row items-center justify-end gap-1.5 md:gap-2">
          <TopBarCluster variant={variant} />
        </View>
      </View>

      {variant === 'staff' ? (
        <ManageNavSheet visible={manageOpen} onClose={() => setManageOpen(false)} />
      ) : null}
    </View>
  );
}
