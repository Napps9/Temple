import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native';

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
//
// At rest it is an icon strip, and pointing at it floats the full rail
// out OVER the page rather than pushing it. That is the whole difference
// from the fold this replaces: the fold tweened the rail's width and the
// flex row re-centred every frame, so reaching for a destination slid the
// calendar sideways under the cursor. The page now lays out around one
// width and only one, and the panel is chrome above it.
//
// Pinning is still there, and is what a pointer cannot do the job for: a
// touch screen has no hover, and a keyboard has no cursor. Pinned, the
// rail is part of the row again and the page lays out beside it — the old
// behaviour, kept for the people who were relying on it.
export const RAIL_WIDTH = 246;
export const RAIL_COLLAPSED_WIDTH = 68;
const PINNED_KEY = 'staff_rail_pinned';
// The fold's key. '1' meant collapsed; '0' was written only by someone who
// collapsed it and then opened it again, which is the one case that says
// "I want this open" rather than "I never touched it".
const LEGACY_FOLD_KEY = 'staff_rail_collapsed';

export function useRailPinned(): [boolean, () => void] {
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(PINNED_KEY);
        if (v !== null) {
          if (live) setPinned(v === '1');
          return;
        }
        const legacy = await AsyncStorage.getItem(LEGACY_FOLD_KEY);
        if (live && legacy === '0') setPinned(true);
      } catch {
        // A rail that cannot read a preference still opens on hover.
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const toggle = () => {
    haptic.selection();
    setPinned((p) => {
      AsyncStorage.setItem(PINNED_KEY, p ? '0' : '1').catch(() => {});
      return !p;
    });
  };
  return [pinned, toggle];
}

export function SideNav({
  sections,
  pinned,
  onTogglePinned,
}: {
  sections: NavSection[];
  pinned: boolean;
  onTogglePinned: () => void;
}) {
  const pathname = usePathname();
  const brand = useGymBrand();
  const { data: membership } = useGymMembership();
  const colors = useThemeColors();

  const gymLinks = useGymNavLinks();

  // Pointing at it, or tabbing into it, opens it. Focus counts because a
  // keyboard has no cursor, and React's focus/blur bubble from the rows,
  // so the pair reads as "is anything in here focused".
  const [peeking, setPeeking] = useState(false);
  const open = pinned || peeking;
  const collapsed = !open;

  // Width still can't ride the native driver — but now only the panel
  // moves. Unpinned, the panel is absolute, so the row it sits in keeps
  // one width and the page never re-centres under the cursor.
  const widthAnim = useRef(
    new Animated.Value(open ? RAIL_WIDTH : RAIL_COLLAPSED_WIDTH),
  ).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: open ? RAIL_WIDTH : RAIL_COLLAPSED_WIDTH,
      duration: 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [open, widthAnim]);

  return (
    <View
      // The strip's own width is all the page lays out around. zIndex puts
      // the floating panel over the page rather than under it.
      style={{ width: pinned ? RAIL_WIDTH : RAIL_COLLAPSED_WIDTH, zIndex: 30 }}
      onPointerEnter={() => setPeeking(true)}
      onPointerLeave={() => setPeeking(false)}
      onFocus={() => setPeeking(true)}
      onBlur={() => setPeeking(false)}
      className="flex-none h-full">
    <Animated.View
      style={[
        { width: widthAnim, overflow: 'hidden' },
        pinned
          ? null
          : ({ position: 'absolute', left: 0, top: 0, bottom: 0 } as const),
      ]}
      className={`h-full bg-surface dark:bg-surface-dk border-r border-line dark:border-line-dk ${
        peeking && !pinned ? 'shadow-float' : ''
      }`}>
      <ScrollView contentContainerClassName="p-3 gap-3.5 flex-1">
        {/* Every block in here is a FIXED height, the same in both states,
            because the panel opens over the strip: an icon that sits at a
            different y once the labels arrive slides out from under the
            cursor that went to press it. The badge sets that height and
            the pin sits beside it, so both states are one 44px row. */}
        <View
          className={`h-11 flex-row items-center gap-1.5 ${
            collapsed ? 'justify-center' : ''
          }`}>
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace('/timeline' as never);
            }}
            accessibilityRole="button"
            accessibilityLabel={brand.gymName}
            className={`h-11 flex-row items-center rounded-ctl border border-line dark:border-line-dk hover:bg-raised dark:hover:bg-raised-dk active:bg-raised dark:active:bg-raised-dk ${
              collapsed ? 'w-11 justify-center px-0' : 'flex-1 min-w-0 px-2.5'
            }`}>
            {collapsed ? (
              <Text className="text-ink dark:text-ink-dk text-[15px] font-semibold">
                {brand.gymName.charAt(0).toUpperCase()}
              </Text>
            ) : (
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
            )}
          </Pressable>
          {/* Only while the panel is open. In the strip it was an arrow
              pointing at nothing, and it is the one control here that is
              about the rail rather than about the gym. */}
          {open ? (
            <Pressable
              onPress={onTogglePinned}
              accessibilityRole="button"
              accessibilityState={{ selected: pinned }}
              accessibilityLabel={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
              hitSlop={4}
              className="h-6 w-7 items-center justify-center rounded-ctl hover:bg-raised dark:hover:bg-raised-dk active:opacity-70">
              <Ionicons
                name={pinned ? 'chevron-back-outline' : 'chevron-forward-outline'}
                size={15}
                color={pinned ? colors.ink : colors.ink2}
              />
            </Pressable>
          ) : null}
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
            {/* A heading and a rule are not the same height, and the six
                rows under them moved by the difference. */}
            <View className="h-6 justify-center">
              {collapsed ? (
                <View className="border-t border-line dark:border-line-dk mx-2" />
              ) : (
                <FieldLabel className="px-3">The gym</FieldLabel>
              )}
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
          className={`h-9 flex-row items-center rounded-ctl border border-blue-500/40 bg-blue-500/10 hover:opacity-80 active:opacity-70 ${
            collapsed ? 'justify-center px-0' : 'gap-2 px-3'
          }`}>
          <Ionicons name="swap-horizontal-outline" size={16} color="#3B82F6" />
          {collapsed ? null : (
            <Text className="text-blue-500 text-[12.5px] font-semibold">
              Viewing Staff
            </Text>
          )}
        </Pressable>

        <View className="border-t border-line dark:border-line-dk pt-2">
          <NavAccountMenu variant="staff" anchor="bottom-left" showLabel={!collapsed} />
        </View>
      </ScrollView>
    </Animated.View>
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
        className={`h-9 flex-row items-center rounded-ctl ${
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-3'
        } ${
          active
            ? 'bg-brand/10'
            : 'hover:bg-raised/60 dark:hover:bg-raised-dk/60'
        }`}>
        {/* ink2, not ink3: collapsed there is no label beside these, so
            the icon is the whole destination and has to read like one. */}
        {renderIconSlot(icon, 18, active ? BRAND : colors.ink2)}
        {collapsed ? null : (
          <Text
            className={`flex-1 text-[14px] ${
              active
                ? 'text-ink dark:text-ink-dk font-semibold'
                : 'text-ink-2 dark:text-ink-2-dk font-medium'
            }`}
            numberOfLines={1}>
            {label}
          </Text>
        )}
      </Pressable>
    );
  }
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
