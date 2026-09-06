import { Pressable, View } from 'react-native';

import { Text } from './Text';
import { haptic } from '@/lib/haptic';

// The week under a date header: seven days, today's letter and number in
// the brand, the selected day ringed in it, a dot under any day that has
// something on it. Book, Classes and Programming all draw this strip, and
// they used to draw it three ways — one with a solid ink disc for the
// selected day, two with the ring — so a week did not look like the same
// week from one section to the next.
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function WeekStrip({
  days,
  selected,
  onSelect,
  hasContent,
  className,
}: {
  days: Date[];
  selected: Date;
  onSelect: (day: Date) => void;
  hasContent?: (day: Date) => boolean;
  className?: string;
}) {
  const today = new Date();
  return (
    <View className={`flex-row gap-2 md:gap-3 md:justify-center pt-1 pb-4 ${className ?? ''}`}>
      {days.map((d) => {
        const isSelected = isSameDay(d, selected);
        const isToday = isSameDay(d, today);
        return (
          <Pressable
            key={d.toISOString()}
            onPress={() => {
              haptic.selection();
              onSelect(d);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            className="flex-1 md:flex-none md:w-12 items-center gap-1.5">
            <Text
              className={`text-xs font-semibold uppercase ${
                isToday ? 'text-brand' : 'text-ink-3 dark:text-ink-3-dk'
              }`}>
              {DAY_LETTERS[d.getDay()]}
            </Text>
            <View
              className={`w-9 h-9 rounded-full items-center justify-center ${
                isSelected ? 'bg-brand/10 border border-brand' : ''
              }`}>
              <Text
                className={`font-bold text-base ${
                  isToday ? 'text-brand' : 'text-ink dark:text-ink-dk'
                }`}>
                {d.getDate()}
              </Text>
            </View>
            <View
              className={`w-1 h-1 rounded-full ${
                hasContent?.(d) ? 'bg-ink-3 dark:bg-ink-3-dk' : 'bg-transparent'
              }`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
