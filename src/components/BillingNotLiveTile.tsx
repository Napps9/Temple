import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { FieldLabel } from './SectionLabel';
import { Text } from './Text';

import { useThemeColors } from '@/lib/theme';

// Empty-state tile used by the insights screen for Paying + Conversion
// when no billing_events have been recorded yet (pre-Stripe). When
// Stripe lands, billing_live flips and the real numbers replace this.

export function BillingNotLiveTile({ title }: { title: string }) {
  const colors = useThemeColors();
  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2 opacity-70">
      <View className="flex-row justify-between items-center">
        <FieldLabel>
          {title}
        </FieldLabel>
        <Ionicons name="card-outline" size={16} color={colors.ink3} />
      </View>
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
        Billing not yet live — connect Stripe to populate.
      </Text>
    </View>
  );
}
