import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { NavAccountMenu } from './NavAccountMenu';
import { renderIconSlot, type IconSlot } from './icon-slot';
import { FieldLabel } from './SectionLabel';
import { Text } from './Text';
import type { NavSection } from './TopNav';
import { useGymMembership } from '@/lib/auth';
import { haptic } from '@/lib/haptic';
import { BRAND, useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';
import { useGymNavLinks } from '@/lib/useGymNavLinks';

// The staff rail, at 1024 and up.
//
// Four sections in a top bar centred in a 1400px window left the top third
// of the screen doing nothing and gave the gym's own destinations —
// Members, Plans, Communications, Billing — nowhere to live except behind
// Manage. A rail puts them one click deep and gives the width back to the
// page.
//
// It is chrome only. The tab router underneath, its backBehavior and every
// route are untouched; the destinations below are ordinary pushes, not new
// routes.
//
// One width, always, and the page lays out beside it. It has now been
// through both ways of not being that and each broke the page in its own
// way. A fold tweened the rail between 68 and 246 and the flex row
// re-centred every frame, so reaching for a destination slid the calendar
// sideways under the cursor. Replacing that with a strip that floated the
// full panel out OVER the page stopped the sliding and started covering
// the thing you were reading — the panel landed on the page heading, the
// first row of cards and whatever sat in the top-left of the screen. The
// rail is a permanent part of the layout, so it takes permanent room:
// nothing moves, and nothing is hidden behind it.
export const RAIL_WIDTH = 246;

export function SideNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const brand = useGymBrand();
  const { data: membership } = useGymMembership();
  const colors = useThemeColors();

  const gymLinks = useGymNavLinks();

  return (
    <View
      style={{ width: RAIL_WIDTH }}
      className="flex-none h-full bg-surface dark:bg-surface-dk border-r border-line dark:border-line-dk">
      <ScrollView contentContainerClassName="p-3 gap-3.5 flex-1">
        <View className="h-11 flex-row items-center">
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace('/timeline' as never);
            }}
            accessibilityRole="button"
            accessibilityLabel={brand.gymName}
            className="h-11 flex-1 min-w-0 px-2.5 flex-row items-center rounded-ctl border border-line dark:border-line-dk hover:bg-raised dark:hover:bg-raised-dk active:bg-raised dark:active:bg-raised-dk">
            <View className="flex-1 min-w-0">
              <Text
                className="text-ink dark:text-ink-dk text-[13.5px] font-semibold"
                numberOfLines={1}>
                {brand.gymName}
              </Text>
              <Text
                className="text-ink-3 dark:text-ink-3-dk text-[12px]"
                numberOfLines={1}>
                {membership?.role ? titleCase(membership.role) : 'Staff'}
              </Text>
            </View>
          </Pressable>
        </View>

        <View className="gap-0.5">
          {sections.map((s) => (
            <NavRow
              key={s.name}
              icon={s.icon}
              label={s.label}
              active={pathname.startsWith(s.href)}
              onPress={() => {
                haptic.selection();
                router.replace((s.navigateTo ?? s.href) as never);
              }}
            />
          ))}
        </View>

        {gymLinks.length ? (
          <View className="gap-0.5">
            <View className="h-6 justify-center">
              <FieldLabel className="px-3">The gym</FieldLabel>
            </View>
            {gymLinks.map((l) => (
              <NavRow
                key={l.href}
                icon={l.icon}
                label={l.label}
                active={pathname.startsWith(l.href)}
                onPress={() => {
                  haptic.selection();
                  router.push(l.href as never);
                }}
              />
            ))}
          </View>
        ) : null}

        <View className="flex-1" />

        <Pressable
          onPress={() => {
            haptic.selection();
            router.replace('/book' as never);
          }}
          accessibilityRole="button"
          accessibilityLabel="Viewing Staff"
          className="h-9 flex-row items-center gap-2 px-3 rounded-ctl border border-blue-500/40 bg-blue-500/10 hover:opacity-80 active:opacity-70">
          <Ionicons name="swap-horizontal-outline" size={16} color="#3B82F6" />
          <Text className="text-blue-500 text-[12.5px] font-semibold">
            Viewing Staff
          </Text>
        </Pressable>

        <View className="border-t border-line dark:border-line-dk pt-2">
          <NavAccountMenu variant="staff" anchor="bottom-left" showLabel />
        </View>
      </ScrollView>
    </View>
  );

  function NavRow({
    icon,
    label,
    active,
    onPress,
  }: {
    icon: IconSlot;
    label: string;
    active: boolean;
    onPress: () => void;
  }) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        className={`h-9 flex-row items-center gap-2.5 px-3 rounded-ctl ${
          active
            ? 'bg-brand/10'
            : 'hover:bg-raised/60 dark:hover:bg-raised-dk/60'
        }`}>
        {renderIconSlot(icon, 18, active ? BRAND : colors.ink2)}
        <Text
          className={`flex-1 text-[14px] ${
            active
              ? 'text-ink dark:text-ink-dk font-semibold'
              : 'text-ink-2 dark:text-ink-2-dk font-medium'
          }`}
          numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  }
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
