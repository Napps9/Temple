import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ManageNavMenu } from './ManageNavMenu';
import { NavAccountMenu } from './NavAccountMenu';
import type { NavSection } from './TopNav';
import { setDockExpanded, setDockTop, useDockExpanded } from '@/lib/dock';
import { haptic } from '@/lib/haptic';
import { BRAND, useThemeColors } from '@/lib/theme';

// The phone's navigation: a floating pill above the bottom edge, owner's
// call over the old top strip — the sections sit where thumbs are, and
// the top of the screen goes back to the page. Rendered by the layouts
// below md as a sibling of the tab content (absolute within the layout's
// full-height container), so it floats over every screen and the page
// scrolls under it; PageScroll keeps a page's last rows reachable, and a
// screen with a composer pinned to its bottom pads by `pb-dock`
// (tailwind.config's twin of DOCK_CLEARANCE) instead.
//
// Glyphs only, by the owner's call: the label lives in the
// accessibilityLabel so screen readers still name the section. The
// active pill is the brand tint, and the Manage pill opens a menu of
// the gym's destinations (the same popover as the avatar) rather than
// navigating — on these widths there is no rail, so they would
// otherwise all route through the hub. The
// avatar closes the row: on a phone the account menu lives here rather
// than in a top bar, and it carries the staff/member switch.
//
// Two sizes (lib/dock): full at the top of a page, compact once the
// reader scrolls down into it, full again on a scroll up or a section
// press. A drag on the pill sets it by hand — up for full, down for
// compact — the way a browser's toolbar can be pulled back. The change
// is a scale about the pill's bottom edge, so the compact dock hugs the
// same baseline and the clearance the pages keep is for the full size.
// The pill's measured top edge is published for the popovers (lib/dock).
export const DOCK_CLEARANCE = 84;
const COMPACT_SCALE = 0.8;
const DOCK_HEIGHT = 56;

export function BottomDock({
  sections,
  variant,
}: {
  sections: NavSection[];
  variant: 'staff' | 'member';
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const colors = useThemeColors();
  const [manageOpen, setManageOpen] = useState(false);
  const expanded = useDockExpanded();
  const size = useRef(new Animated.Value(1)).current;
  const bottomOffset = Math.max(insets.bottom, 10) + 6;

  useEffect(() => {
    Animated.spring(size, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: Platform.OS !== 'web',
      damping: 18,
      stiffness: 220,
      mass: 0.8,
    }).start();
  }, [expanded, size]);

  const scale = size.interpolate({
    inputRange: [0, 1],
    outputRange: [COMPACT_SCALE, 1],
  });
  // A scale is about the centre; this keeps the bottom edge where it is.
  const translateY = size.interpolate({
    inputRange: [0, 1],
    outputRange: [((1 - COMPACT_SCALE) * DOCK_HEIGHT) / 2, 0],
  });

  const drag = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-12, 12])
    .failOffsetX([-16, 16])
    .onEnd((e) => {
      if (e.translationY < -12) {
        haptic.selection();
        setDockExpanded(true);
      } else if (e.translationY > 12) {
        haptic.selection();
        setDockExpanded(false);
      }
    });

  const onPressSection = (s: NavSection) => {
    haptic.selection();
    setDockExpanded(true);
    if (s.name === 'management') {
      setManageOpen(true);
      return;
    }
    router.replace((s.navigateTo ?? s.href) as never);
  };

  return (
    <>
      <View
        pointerEvents="box-none"
        className="md:hidden absolute left-0 right-0 items-center"
        style={{ bottom: bottomOffset }}
        onLayout={(e) => setDockTop(bottomOffset + e.nativeEvent.layout.height)}>
        <GestureDetector gesture={drag}>
        {/* The transform sits on its own wrapper: NativeWind does not
            style Animated.View, so the pill's classes stay on a View. */}
        <Animated.View style={{ transform: [{ translateY }, { scale }] }}>
        <View className="flex-row gap-1 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-full px-4 py-1.5 shadow-float">
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
                className={`items-center justify-center px-4 py-2.5 rounded-full active:opacity-70 ${
                  active ? 'bg-brand/10' : ''
                }`}>
                <Ionicons name={s.icon} size={22} color={active ? BRAND : colors.ink3} />
              </Pressable>
            );
          })}
          <View className="w-px h-6 self-center mx-1 bg-line dark:bg-line-dk" />
          <View className="justify-center pl-1 pr-0.5">
            <NavAccountMenu variant={variant} anchor="bottom-right" />
          </View>
        </View>
        </Animated.View>
        </GestureDetector>
      </View>

      {variant === 'staff' ? (
        <ManageNavMenu visible={manageOpen} onClose={() => setManageOpen(false)} />
      ) : null}
    </>
  );
}
