import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { NavAccountMenu } from './NavAccountMenu';
import { renderIconSlot, type IconSlot } from './icon-slot';
import { FieldLabel } from './SectionLabel';
import { Text } from './Text';
import { TempleWordmark } from './TempleMark';
import type { NavSection } from './TopNav';
import { useGymMembership } from '@/lib/auth';
import { haptic } from '@/lib/haptic';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';
import { useGymNavLinks } from '@/lib/useGymNavLinks';

// The staff rail, at 768 and up.
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
export function SideNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const brand = useGymBrand();
  const { data: membership } = useGymMembership();
  const colors = useThemeColors();

  const gymLinks = useGymNavLinks();

  return (
    <View className="w-[246px] flex-none bg-surface dark:bg-surface-dk border-r border-line dark:border-line-dk">
      <ScrollView contentContainerClassName="p-3 gap-3.5 flex-1">
        <View className="px-1 pt-1">
          <TempleWordmark size={17} />
        </View>

        <Pressable
          onPress={() => {
            haptic.selection();
            router.replace('/timeline' as never);
          }}
          accessibilityRole="button"
          accessibilityLabel={brand.gymName}
          className="flex-row items-center rounded-ctl border border-line dark:border-line-dk px-2.5 py-2 hover:bg-raised dark:hover:bg-raised-dk active:bg-raised dark:active:bg-raised-dk">
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
            <FieldLabel className="px-3 pt-1.5 pb-1">The gym</FieldLabel>
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
          className="flex-row items-center gap-2 rounded-ctl border border-blue-500/40 bg-blue-500/10 px-3 py-2 hover:opacity-80 active:opacity-70">
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
        className={`flex-row items-center gap-2.5 rounded-ctl px-3 py-2 ${
          active
            ? 'bg-raised dark:bg-raised-dk'
            : 'hover:bg-raised/60 dark:hover:bg-raised-dk/60'
        }`}>
        {renderIconSlot(icon, 18, active ? colors.ink : colors.ink3)}
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
