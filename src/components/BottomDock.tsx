import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ManageNavSheet } from './ManageNavSheet';
import type { NavSection } from './TopNav';
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
// active pill is the brand tint, and the Manage pill opens the sheet
// rather than navigating — on these widths there is no rail, so the
// gym's destinations would otherwise all route through the hub.
export const DOCK_CLEARANCE = 84;

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

  const onPressSection = (s: NavSection) => {
    haptic.selection();
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
        style={{ bottom: Math.max(insets.bottom, 10) + 6 }}>
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
        </View>
      </View>

      {variant === 'staff' ? (
        <ManageNavSheet visible={manageOpen} onClose={() => setManageOpen(false)} />
      ) : null}
    </>
  );
}
