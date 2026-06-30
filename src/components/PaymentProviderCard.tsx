import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode } from 'react';
import { Text, View } from 'react-native';

type IconName = ComponentProps<typeof Ionicons>['name'];

// 'connected'   — the gym has authorised this provider.
// 'available'   — connectable now; the caller supplies the action via children.
// 'coming_soon' — visible so owners know it's planned, not yet connectable.
type Status = 'connected' | 'available' | 'coming_soon';

type Props = {
  name: string;
  blurb: string;
  icon: IconName;
  status: Status;
  // Connect button / extra detail rendered under the header.
  children?: ReactNode;
};

function StatusBadge({ status }: { status: Status }) {
  if (status === 'connected') {
    return (
      <View className="flex-row items-center gap-1.5">
        <Ionicons name="checkmark-circle" size={16} color="#10B981" />
        <Text className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold uppercase tracking-widest">
          Connected
        </Text>
      </View>
    );
  }
  if (status === 'coming_soon') {
    return (
      <View className="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1">
        <Text className="text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase tracking-widest">
          Coming soon
        </Text>
      </View>
    );
  }
  return null;
}

export function PaymentProviderCard({ name, blurb, icon, status, children }: Props) {
  const dim = status === 'coming_soon';
  return (
    <View
      className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 gap-3 ${
        dim ? 'opacity-70' : ''
      }`}>
      <View className="flex-row items-center gap-3">
        <Ionicons name={icon} size={20} color="#6B7280" />
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">{name}</Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">{blurb}</Text>
        </View>
        <StatusBadge status={status} />
      </View>
      {children}
    </View>
  );
}
