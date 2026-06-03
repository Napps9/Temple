import { Pressable, View } from 'react-native';

export const PALETTE = [
  { hex: '#2563EB', label: 'Blue' },
  { hex: '#8B5CF6', label: 'Purple' },
  { hex: '#EC4899', label: 'Pink' },
  { hex: '#F97316', label: 'Orange' },
  { hex: '#EF4444', label: 'Red' },
  { hex: '#10B981', label: 'Green' },
  { hex: '#14B8A6', label: 'Teal' },
  { hex: '#6366F1', label: 'Indigo' },
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
