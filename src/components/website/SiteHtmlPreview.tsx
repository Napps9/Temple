import { Ionicons } from '@expo/vector-icons';
import { Text, View, type DimensionValue } from 'react-native';

import { useThemeColors } from '@/lib/theme';

// Native fallback — the rendered-HTML preview (and on-canvas editing)
// needs an iframe, web-only. On native, the block list in SiteEditor
// already shows the content and order and stays fully editable there;
// this just points the owner at the web build for an exact render.
export function SiteHtmlPreview({
  height = 200,
}: {
  html: string;
  height?: DimensionValue;
  editable?: boolean;
  syncKey?: number;
  onFieldChange?: (path: string, value: string) => void;
  selectedBlockId?: string | null;
  onCanvasSelect?: (blockId: string | null) => void;
  onNavigatePage?: (slug: string) => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={{ height }}
      className="items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6">
      <Ionicons name="desktop-outline" size={28} color={colors.iconTertiary} />
      <Text className="text-gray-500 dark:text-gray-400 text-sm mt-2 text-center">
        Open Temple on the web to preview the rendered site.
      </Text>
    </View>
  );
}
