import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { ColorSwatchPicker } from '@/components/ColorSwatchPicker';
import { normaliseHex } from '@/lib/brand';

// Compact colour control for the email editor: a swatch that toggles a
// palette, plus a hex field. Keeps a local draft string so a half-typed
// hex doesn't blow away the committed value — onChange only fires on a
// valid 6-char hex (or a tapped palette swatch).
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const valid = normaliseHex(draft);

  return (
    <View className="gap-1.5">
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-medium">
        {label}
      </Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={() => setOpen((v) => !v)}
          style={{ backgroundColor: valid ?? value }}
          className="w-9 h-9 rounded-lg border border-line dark:border-line-dk active:opacity-70"
        />
        <TextInput
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            const hex = normaliseHex(t);
            if (hex) onChange(hex);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="#000000"
          placeholderTextColor="#9CA3AF"
          className="flex-1 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-lg px-3 py-2 text-ink dark:text-ink-dk text-sm"
        />
      </View>
      {open ? (
        <View className="bg-raised dark:bg-raised-dk rounded-lg p-3 mt-1">
          <ColorSwatchPicker
            value={valid ?? value}
            onChange={(hex) => {
              setDraft(hex);
              onChange(hex);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
