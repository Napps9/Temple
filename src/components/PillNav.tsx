import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { Text } from './Text';

import { useThemeColors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export type PillNavItem<K extends string = string> = {
  key: K;
  label: string;
  icon?: IconName;
};

// The one section-pill strip. It existed three times before this — the
// Manage hub's and the Leads section's were byte-identical copies,
// comment included, and the Store's was a third shape with its own
// radius, no icons and a capitalize on the raw union.
//
// Selected is a soft tint, not the gym's colour: a nav is on screen the
// whole time and is never the one action a page exists for. A single
// horizontal strip that bleeds to the screen edges (the parent's content
// padding is px-4) rather than wrapping into ragged rows — the last pill
// peeking off the right edge is the scroll affordance, and on a wide
// window everything fits and there is nothing to scroll.
export function PillNav<K extends string>({
  items,
  active,
  onSelect,
}: {
  items: PillNavItem<K>[];
  active: K;
  onSelect: (key: K) => void;
}) {
  const colors = useThemeColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-4"
      contentContainerClassName="flex-row gap-2 px-4">
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            className={`flex-row items-center gap-2.5 rounded-ctl px-3 py-2.5 active:opacity-80 ${
              selected
                ? 'bg-raised dark:bg-raised-dk'
                : 'bg-surface dark:bg-surface-dk border border-line dark:border-line-dk hover:border-line-strong dark:hover:border-line-strong-dk'
            }`}>
            {item.icon ? (
              <Ionicons
                name={item.icon}
                size={17}
                color={selected ? colors.ink : colors.ink3}
              />
            ) : null}
            <Text
              className={`text-sm ${
                selected
                  ? 'text-ink dark:text-ink-dk font-semibold'
                  : 'text-ink-2 dark:text-ink-2-dk font-medium'
              }`}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
