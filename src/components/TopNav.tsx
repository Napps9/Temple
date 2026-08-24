import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ManageNavSheet } from './ManageNavSheet';
import { NavAccountMenu } from './NavAccountMenu';
import { haptic } from '@/lib/haptic';
import { BRAND, useThemeColors } from '@/lib/theme';
import { useCan } from '@/lib/useCan';
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
// row. Every pill carries its visible label at every width: a bare
// glyph row failed first-time users, who could not tell the dumbbell
// from the calendar until a section was already active. The
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
  const canAccessStaff = useCan('can_access_staff_area') ?? false;
  const [manageOpen, setManageOpen] = useState(false);

  const gymName = brand.gymName;

  const homeHref = variant === 'staff' ? '/timeline' : '/book';
  const showCrossLink = variant === 'staff' || canAccessStaff;
  const crossHref = variant === 'staff' ? '/book' : '/classes';
  // States the CURRENT context ("Viewing Staff"), not the destination —
  // the old "Member view" label read as where-you-are to half of users
  // and where-you're-going to the rest.
  const crossLabel = variant === 'staff' ? 'Viewing Staff' : 'Viewing Member';

  // staff = blue, member = green: the switch doubles as a "which side
  // am I on" indicator, so the tint must change with the variant.
  const crossTint = variant === 'staff' ? '#3B82F6' : '#10B981';
  const crossClasses =
    variant === 'staff'
      ? 'border-blue-500/40 bg-blue-500/10'
      : 'border-emerald-500/40 bg-emerald-500/10';
  const crossTextClass =
    variant === 'staff' ? 'text-blue-500' : 'text-emerald-500';

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

  // Two renderings of the same sections: inline pills beside the logo at
  // md+, a stacked icon-over-label row of their own below it. Every pill
  // carries its visible label in both.
  const pillRow = (stacked: boolean) => (
    <View className={stacked ? 'flex-row justify-center gap-0.5' : 'flex-row gap-1'}>
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
            className={`${
              stacked
                ? 'flex-col items-center gap-0.5 px-2 py-1.5 rounded-ctl'
                : 'flex-row items-center gap-1.5 px-3.5 py-1.5 rounded-full'
            } active:opacity-70 ${
              active
                ? 'bg-brand/10'
                : 'hover:bg-raised/60 dark:hover:bg-raised-dk/60'
            }`}>
            <Ionicons
              name={s.icon}
              size={stacked ? 19 : 17}
              color={active ? BRAND : colors.ink3}
            />
            <Text
              className={`${stacked ? 'text-[11px]' : 'text-sm'} ${
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

  return (
    <View
      style={{ paddingTop: insets.top + 10 }}
      className="bg-ground dark:bg-ground-dk px-3 md:px-6 pb-3 gap-2">
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

        <View className="items-center hidden md:flex">{pillRow(false)}</View>
        {/* flexGrow + justify-center: centred while the pills fit,
            a scroll strip on screens too narrow for all of them. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-1 md:hidden"
          contentContainerClassName="flex-grow items-center justify-center">
          {pillRow(true)}
        </ScrollView>

        <View className="flex-none md:flex-1 flex-row items-center justify-end gap-1.5 md:gap-2">
        {showCrossLink ? (
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace(crossHref as never);
            }}
            hitSlop={4}
            accessibilityLabel={crossLabel}
            className={`h-9 w-9 md:w-auto md:px-3 rounded-full border flex-row items-center justify-center gap-1.5 hover:opacity-80 active:opacity-70 ${crossClasses}`}>
            <Ionicons name="swap-horizontal-outline" size={16} color={crossTint} />
            <Text className={`text-xs font-semibold hidden md:flex ${crossTextClass}`}>
              {crossLabel}
            </Text>
          </Pressable>
        ) : null}

        <NavAccountMenu variant={variant} anchor="top-right" />
        </View>
      </View>

      {variant === 'staff' ? (
        <ManageNavSheet visible={manageOpen} onClose={() => setManageOpen(false)} />
      ) : null}
    </View>
  );
}
