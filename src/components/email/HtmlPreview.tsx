import { Ionicons } from '@expo/vector-icons';
import { Text, View, type DimensionValue } from 'react-native';

import { useThemeColors } from '@/lib/theme';

// Native fallback. The HTML email preview is a web-only surface (it needs
// an iframe); on native the in-app WYSIWYG canvas already shows the
// layout, so we just point the user at the web build for an exact render.
export function HtmlPreview({
  height = 200,
}: {
  html: string;
  height?: number | string;
  editable?: boolean;
  syncKey?: number;
  onFieldChange?: (path: string, value: string) => void;
  selectedBlockId?: string | null;
  onCanvasSelect?: (blockId: string | null) => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={{ height: height as DimensionValue }}
      className="items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6">
      <Ionicons name="desktop-outline" size={28} color={colors.iconTertiary} />
      <Text className="text-gray-500 dark:text-gray-400 text-sm mt-2 text-center">
        Open Temple on the web to preview the rendered HTML email.
      </Text>
    </View>
  );
}
