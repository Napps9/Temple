import { Ionicons } from '@expo/vector-icons';
import { View, type DimensionValue } from 'react-native';
import { Text } from '@/components/Text';

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
      className="items-center justify-center rounded-ctl border border-line dark:border-line-dk bg-surface dark:bg-surface-dk px-6">
      <Ionicons name="desktop-outline" size={28} color={colors.ink3} />
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm mt-2 text-center">
        Open Temple on the web to preview the rendered site.
      </Text>
    </View>
  );
}
