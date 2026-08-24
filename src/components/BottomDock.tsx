import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ManageNavSheet } from './ManageNavSheet';
import { Text } from './Text';
import type { NavSection } from './TopNav';
import { haptic } from '@/lib/haptic';
import { BRAND, useThemeColors } from '@/lib/theme';

// The phone's navigation: a floating pill above the bottom edge, owner's
// call over the old top strip — the sections sit where thumbs are, and
// the top of the screen goes back to the page. Rendered by the layouts
// below md as a sibling of the tab content (absolute within the layout's
// full-height container), so it floats over every screen; the layouts pad
// the scene's bottom to keep the last rows reachable underneath it.
//
// Same rules as the bar it replaces: every pill carries its visible
// label (a bare glyph row failed first-time users), the active pill is
// the brand tint, and the Manage pill opens the sheet rather than
// navigating — on these widths there is no rail, so the gym's
// destinations would otherwise all route through the hub.
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
        <View className="flex-row gap-0.5 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-full px-4 py-1.5 shadow-float">
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
                className={`flex-col items-center gap-0.5 px-3.5 py-1.5 rounded-full active:opacity-70 ${
                  active ? 'bg-brand/10' : ''
                }`}>
                <Ionicons name={s.icon} size={19} color={active ? BRAND : colors.ink3} />
                <Text
                  className={`text-[11px] ${
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
      </View>

      {variant === 'staff' ? (
        <ManageNavSheet visible={manageOpen} onClose={() => setManageOpen(false)} />
      ) : null}
    </>
  );
}
