import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

// Native fallback. The HTML email preview is a web-only surface (it needs
// an iframe); on native the in-app WYSIWYG canvas already shows the
// layout, so we just point the user at the web build for an exact render.
export function HtmlPreview({ height = 200 }: { html: string; height?: number }) {
  return (
    <View
      style={{ height }}
      className="items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6">
      <Ionicons name="desktop-outline" size={28} color="#9CA3AF" />
      <Text className="text-gray-500 dark:text-gray-400 text-sm mt-2 text-center">
        Open Temple on the web to preview the rendered HTML email.
      </Text>
    </View>
  );
}
