import { Pressable, View } from 'react-native';

import { Text } from './Text';

// The centre of a main screen's top row: the visible day or month with
// a step either side, tap the label to jump. One control for Classes,
// Programming and Timeline so the date sits at the same size and weight
// on every tab. Below md it is the phone's compact stepper; at md+ it
// takes the Classes calendar's ringed arrows and larger label.
export function DateNav({
  label,
  onPrev,
  onNext,
  onPress,
  prevDisabled,
  nextDisabled,
  prevLabel = 'Previous',
  nextLabel = 'Next',
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onPress?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
}) {
  const arrow =
    'w-8 h-8 items-center justify-center md:w-9 md:h-9 md:rounded-full md:border md:border-line md:dark:border-line-dk md:hover:bg-raised md:dark:hover:bg-raised-dk';
  const glyph = (disabled?: boolean) =>
    `text-lg ${
      disabled ? 'text-ink-3 dark:text-ink-2' : 'text-ink-3 dark:text-ink-3-dk md:text-ink-2 md:dark:text-ink-2-dk'
    }`;
  return (
    <View className="flex-row items-center gap-0.5 md:gap-4">
      <Pressable
        onPress={onPrev}
        disabled={prevDisabled}
        hitSlop={8}
        accessibilityLabel={prevLabel}
        className={arrow}>
        <Text className={glyph(prevDisabled)}>‹</Text>
      </Pressable>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Pick a date"
        className="px-1.5 py-1 items-center justify-center active:opacity-70">
        <Text className="text-ink dark:text-ink-dk text-base md:text-xl font-semibold">{label}</Text>
      </Pressable>
      <Pressable
        onPress={onNext}
        disabled={nextDisabled}
        hitSlop={8}
        accessibilityLabel={nextLabel}
        className={arrow}>
        <Text className={glyph(nextDisabled)}>›</Text>
      </Pressable>
    </View>
  );
}
