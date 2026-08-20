import { Platform, View } from 'react-native';
import { Text } from './Text';

import { ChipButton } from '@/components/ChipButton';
import { joinUrl } from '@/lib/brand';
import { useGymBrand } from '@/lib/useGymBrand';

// Shown on every member's Account screen so they can share the gym's
// public join link with friends. Hidden when the owner has flipped
// public signup off.
export function GymShareCard() {
  const brand = useGymBrand();
  if (!brand.slug || !brand.publicSignupEnabled) return null;

  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.temple';
  const url = joinUrl(origin, brand.slug);

  function copy() {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(url);
    }
  }

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
      <Text className="text-ink dark:text-ink-dk font-semibold">
        Invite a friend
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        Share this link to bring someone new into {brand.gymName}.
      </Text>
      <View className="flex-row items-center gap-2 bg-raised dark:bg-raised-dk rounded-lg p-3">
        <Text
          className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm font-mono"
          numberOfLines={1}>
          {url}
        </Text>
        <ChipButton label="Copy" icon="copy-outline" onPress={copy} />
      </View>
    </View>
  );
}
