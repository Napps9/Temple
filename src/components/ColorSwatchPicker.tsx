import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { haptic } from '@/lib/haptic';

// Hand-tuned 16-stop palette. Hues are spaced wide enough that
// adjacent chips don't read as the same colour at thumbnail size
// (the previous 8-stop set put blue / indigo as neighbours, which
// gyms with several class types couldn't distinguish at a glance).
// Two neutral darks at the end so coaches can mark "default" or
// "open gym" without burning a brand hue on them.
export const PALETTE = [
  { hex: '#2563EB', label: 'Blue' },
  { hex: '#0EA5E9', label: 'Sky' },
  { hex: '#14B8A6', label: 'Teal' },
  { hex: '#10B981', label: 'Green' },
  { hex: '#84CC16', label: 'Lime' },
  { hex: '#EAB308', label: 'Yellow' },
  { hex: '#F97316', label: 'Orange' },
  { hex: '#EF4444', label: 'Red' },
  { hex: '#EC4899', label: 'Pink' },
  { hex: '#D946EF', label: 'Fuchsia' },
  { hex: '#8B5CF6', label: 'Purple' },
  { hex: '#6366F1', label: 'Indigo' },
  { hex: '#A16207', label: 'Bronze' },
  { hex: '#4D7C0F', label: 'Olive' },
  { hex: '#475569', label: 'Slate' },
  { hex: '#1F2937', label: 'Charcoal' },
] as const;

export function ColorSwatchPicker({
  value,
  onChange,
  inUse,
}: {
  value: string;
  onChange: (color: string) => void;
  // Hexes already taken by other items (e.g. sibling class types).
  // Marked with a dot so the user can avoid collisions — not disabled,
  // since sharing a colour is allowed, just discouraged.
  inUse?: string[];
}) {
  const used = new Set((inUse ?? []).map((h) => h.toUpperCase()));
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-2">
        {PALETTE.map((c) => {
          const selected = value.toUpperCase() === c.hex.toUpperCase();
          const taken = !selected && used.has(c.hex.toUpperCase());
          return (
            <Pressable
              key={c.hex}
              onPress={() => {
                haptic.selection();
                onChange(c.hex);
              }}
              hitSlop={4}
              style={{ backgroundColor: c.hex }}
              className={`w-8 h-8 rounded-full items-center justify-center ${
                selected
                  ? 'border-2 border-ink dark:border-ink-dk'
                  : 'border border-white dark:border-line-dk'
              }`}>
              {taken ? (
                <View className="w-2.5 h-2.5 rounded-full bg-white border border-ink/30" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {used.size > 0 ? (
        <View className="flex-row items-center gap-1.5">
          <View className="w-2.5 h-2.5 rounded-full bg-white border border-ink/30" />
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Already used by another class type
          </Text>
        </View>
      ) : null}
    </View>
  );
}
