import { router } from 'expo-router';
import { View } from 'react-native';

import { ChipButton } from './ChipButton';
import { Text } from './Text';
import type { FirstClassResult } from '@/lib/first-class';

export function FirstClassBanner({ result }: { result: FirstClassResult | null }) {
  if (!result) return null;

  if (result.ok) {
    return (
      <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-card p-4">
        <Text className="text-emerald-700 dark:text-emerald-300 text-sm">
          You're booked into {result.name} on{' '}
          {new Date(result.starts_at).toLocaleString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          — see you there.
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-amber-500/10 border border-amber-500/30 rounded-card p-4 gap-2">
      <Text className="text-amber-800 dark:text-amber-300 text-sm">
        We couldn't book {result.name} automatically
        {result.detail ? ` — ${result.detail}` : ''}. Pick any class that suits
        you instead.
      </Text>
      <ChipButton
        label="Open booking"
        icon="calendar-outline"
        tone="amber"
        onPress={() => router.push('/book' as never)}
      />
    </View>
  );
}
