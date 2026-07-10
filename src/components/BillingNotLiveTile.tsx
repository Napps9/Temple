import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

// Empty-state tile used by the insights screen for Paying + Conversion
// when no billing_events have been recorded yet (pre-Stripe). When
// Stripe lands, billing_live flips and the real numbers replace this.

export function BillingNotLiveTile({ title }: { title: string }) {
  const colors = useThemeColors();
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 opacity-70 shadow-card">
      <View className="flex-row justify-between items-center">
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          {title}
        </Text>
        <Ionicons name="card-outline" size={16} color={colors.iconTertiary} />
      </View>
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        Billing not yet live — connect Stripe to populate.
      </Text>
    </View>
  );
}
