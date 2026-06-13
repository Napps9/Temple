import { Pressable, View } from 'react-native';

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
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {PALETTE.map((c) => {
        const selected = value.toUpperCase() === c.hex.toUpperCase();
        return (
          <Pressable
            key={c.hex}
            onPress={() => onChange(c.hex)}
            hitSlop={4}
            style={{ backgroundColor: c.hex }}
            className={`w-8 h-8 rounded-full ${
              selected
                ? 'border-2 border-gray-900 dark:border-gray-50'
                : 'border border-white dark:border-gray-900'
            }`}
          />
        );
      })}
    </View>
  );
}
