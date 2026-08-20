import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { getCookieConsent, setCookieConsent } from '@/lib/cookie-consent';

// Web-only cookie-consent banner, mounted once at the app root. Shows until
// the visitor accepts or rejects non-essential storage; the choice persists
// in localStorage so it doesn't reappear. Accept and Reject are equally
// prominent (PECR). No analytics runs today — this is the forward-looking
// gate a future tracking tool reads via hasAnalyticsConsent().
export function CookieBanner() {
  const [decided, setDecided] = useState(() => getCookieConsent() !== null);

  if (Platform.OS !== 'web' || decided) return null;

  function choose(value: 'accepted' | 'rejected') {
    setCookieConsent(value);
    setDecided(true);
  }

  return (
    <View
      accessibilityRole="alert"
      className="absolute bottom-0 left-0 right-0 z-50 border-t border-line dark:border-line-dk bg-surface dark:bg-surface-dk px-4 py-4">
      <View className="w-full max-w-3xl mx-auto gap-3 md:flex-row md:items-center md:justify-between">
        <Text className="flex-1 text-sm leading-5 text-ink-2 dark:text-ink-2-dk">
          We use only essential storage to run the app. We’d also like to use
          non-essential analytics to improve it — your choice.{' '}
          <Text
            className="text-[#3B6BA5] underline dark:text-[#6E97C6]"
            onPress={() => router.push('/privacy' as never)}>
            Privacy Policy
          </Text>
          .
        </Text>
        <View className="flex-row gap-2">
          <Button variant="secondary" onPress={() => choose('rejected')}>
            Reject
          </Button>
          <Button variant="primary" onPress={() => choose('accepted')}>
            Accept
          </Button>
        </View>
      </View>
    </View>
  );
}
