import { Pressable, View } from 'react-native';

import { Text } from './Text';
import { haptic } from '@/lib/haptic';

// The view switcher under a date header — Day/Week/Month on Classes,
// Week/Year on Programming — as one control, so the two rows read as
// the same row. A sunken track, the chosen segment lifted to white. The
// segments are px-3 rather than px-4 so Programming's row (two segments
// and two chips) still fits a 390-wide phone beside its chips.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View className="flex-row bg-sunken dark:bg-raised-dk rounded-full p-1">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              haptic.selection();
              onChange(o.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            className={`px-3 py-1.5 rounded-full ${
              active ? 'bg-white dark:bg-sunken-dk' : 'hover:bg-surface/50 dark:hover:bg-sunken-dk/40'
            }`}>
            <Text
              className={`text-[13px] font-semibold ${
                active ? 'text-ink dark:text-ink-dk' : 'text-ink-2 dark:text-ink-2-dk'
              }`}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
