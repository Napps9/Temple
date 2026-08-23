import { Ionicons } from '@expo/vector-icons';
import { View, type DimensionValue } from 'react-native';
import { Text } from '@/components/Text';

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
      className="items-center justify-center rounded-ctl border border-line dark:border-line-dk bg-surface dark:bg-surface-dk px-6">
      <Ionicons name="desktop-outline" size={28} color={colors.ink3} />
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm mt-2 text-center">
        Open Temple on the web to preview the rendered HTML email.
      </Text>
    </View>
  );
}
