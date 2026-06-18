import { Text, TextInput, View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { ColorSwatchPicker } from '@/components/ColorSwatchPicker';
import { ColourArea } from '@/components/ColourArea';
import { normaliseHex } from '@/lib/brand';
import { useThemeColors } from '@/lib/theme';

// Hex field + live swatch + picker toggle. When open, the full
// saturation/hue picker renders inline directly beneath — no modal, so the
// live preview stays visible during every drag. Shared by the owner
// branding screen and the create-gym brand step so both pick colours the
// same way.
export function ColourField({
  label,
  hint,
  value,
  onChange,
  onPick,
  pickerOpen,
  placeholderHex,
}: {
  label: string;
  // One-line note on what this colour drives in the live app.
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onPick: () => void;
  pickerOpen: boolean;
  // When supplied, the swatch shows the placeholder colour faded so an
  // empty input visibly previews what the auto-derived value would be.
  placeholderHex?: string;
}) {
  const colors = useThemeColors();
  const valid = normaliseHex(value);
  const swatchColour = valid ?? placeholderHex ?? '#00000000';
  const swatchFaded = !valid && !!placeholderHex;
  return (
    <View className="gap-1.5">
      <View>
        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          {label}
        </Text>
        {hint ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs mt-0.5">
            {hint}
          </Text>
        ) : null}
      </View>
      <View className="flex-row items-center gap-2">
        <View
          style={{
            backgroundColor: swatchColour,
            opacity: swatchFaded ? 0.5 : 1,
          }}
          className="w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-700"
        />
        <View className="flex-1">
          <TextInput
            value={value}
            onChangeText={onChange}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={placeholderHex ?? colors.primary}
            placeholderTextColor="#9CA3AF"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50 text-base"
          />
        </View>
        <ChipButton
          tone={pickerOpen ? 'primary' : 'neutral'}
          label={pickerOpen ? 'Done' : 'Pick'}
          icon={pickerOpen ? 'checkmark' : 'color-palette-outline'}
          onPress={onPick}
        />
      </View>
      {pickerOpen ? (
        <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 gap-3 mt-1">
          <ColourArea
            value={valid ?? placeholderHex ?? colors.primary}
            onChange={onChange}
          />
          <ColorSwatchPicker value={valid ?? ''} onChange={onChange} />
        </View>
      ) : null}
    </View>
  );
}
