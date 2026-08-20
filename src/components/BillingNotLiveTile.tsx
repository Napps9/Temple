import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { Text } from './Text';

import { useThemeColors } from '@/lib/theme';

// Empty-state tile used by the insights screen for Paying + Conversion
// when no billing_events have been recorded yet (pre-Stripe). When
// Stripe lands, billing_live flips and the real numbers replace this.

export function BillingNotLiveTile({ title }: { title: string }) {
  const colors = useThemeColors();
  return (
    <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-2 opacity-70 shadow-card">
      <View className="flex-row justify-between items-center">
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-widest">
          {title}
        </Text>
        <Ionicons name="card-outline" size={16} color={colors.iconTertiary} />
      </View>
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
        Billing not yet live — connect Stripe to populate.
      </Text>
    </View>
  );
}
