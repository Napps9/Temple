import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TempleMark } from './TempleMark';
import { NavAccountMenu } from './NavAccountMenu';
import { haptic } from '@/lib/haptic';
import { useThemeColors } from '@/lib/theme';
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
//   [logo + gym name] … [section pills, centred] … [view-switch] [avatar] [inbox] [theme]
// Section pills live in a single rounded track (same idiom as the
// calendar's segmented control) with the active section lit in the
// gym's brand colour. Labels collapse to icons below md. The
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
  const pills = (
    <View className="flex-row gap-1">
      {sections.map((s) => {
        const active = pathname.startsWith(s.href);
        return (
          <Pressable
            key={s.name}
            onPress={() => {
              haptic.selection();
              router.replace((s.navigateTo ?? s.href) as never);
            }}
            hitSlop={4}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            // The label Text is display:none on phones for inactive
            // pills, so the accessible name must not depend on it.
            accessibilityLabel={s.label}
            className={`flex-row items-center gap-1.5 px-3 md:px-3.5 py-1.5 rounded-full active:opacity-70 ${
              active
                ? 'bg-raised dark:bg-raised-dk'
                : 'hover:bg-raised/60 dark:hover:bg-raised-dk/60'
            }`}>
            <Ionicons
              name={s.icon}
              size={17}
              color={active ? colors.ink : colors.ink3}
            />
            {/* Inline with the logo on the phone means space is tight, so
                only the active pill keeps its label there; wide screens
                show them all. */}
            <Text
              className={`text-sm ${active ? 'flex' : 'hidden md:flex'} ${
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
        {/* Three equal zones (flex-1 left/right) keep the pills on the
            bar's true centre regardless of how wide the side clusters
            are. The pills sit inline on every size now that the right
            cluster is a single avatar — on the phone the inactive pills
            drop to icons so all three fit next to the logo. */}
        <View className="flex-1 flex-row items-center">
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace(homeHref as never);
            }}
            hitSlop={6}
            className="flex-row items-center gap-3 hover:opacity-80 active:opacity-70">
            <TempleMark size={30} />
            <Text
              className="text-ink dark:text-ink-dk font-semibold text-base hidden lg:flex"
              numberOfLines={1}>
              {gymName}
            </Text>
          </Pressable>
        </View>

        <View className="items-center">{pills}</View>

        <View className="flex-1 flex-row items-center justify-end gap-1.5 md:gap-2">
        {showCrossLink ? (
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace(crossHref as never);
            }}
            hitSlop={4}
            accessibilityLabel={crossLabel}
            className={`h-9 px-3 rounded-full border flex-row items-center gap-1.5 hover:opacity-80 active:opacity-70 ${crossClasses}`}>
            <Ionicons name="swap-horizontal-outline" size={16} color={crossTint} />
            <Text className={`text-xs font-semibold hidden md:flex ${crossTextClass}`}>
              {crossLabel}
            </Text>
          </Pressable>
        ) : null}

        <NavAccountMenu variant={variant} anchor="top-right" />
        </View>
      </View>

    </View>
  );
}
