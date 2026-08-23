import { Link, usePathname } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';

import { Screen } from '@/components/Screen';

// Custom unmatched-route screen. Expo Router's default page says
// "Unmatched Route" with a "Sitemap" link that's misleading in
// production. This one keeps the user on rails: a clear "we couldn't
// find that page", the offending path so a screenshot is a complete
// diagnostic, and the same three entry points the sign-in page offers.
export default function NotFound() {
  const path = usePathname();
  return (
    <Screen>
      <View className="flex-1 items-center justify-center p-6 gap-8">
        <View className="gap-2 items-center max-w-md">
          <Text className="text-ink dark:text-ink-dk text-3xl font-semibold text-center">
            We couldn't find that page
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-center">
            The link you followed may be broken, or the page may have been
            moved.
          </Text>
        </View>
        <View className="w-full max-w-xs gap-3">
          <Link href="/" asChild>
            <Pressable className="bg-primary rounded-ctl p-3 items-center active:opacity-80">
              <Text className="text-on-primary font-semibold">Go to home</Text>
            </Pressable>
          </Link>
          <Link href="/sign-in" asChild>
            <Pressable className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 items-center active:opacity-80">
              <Text className="text-ink dark:text-ink-dk font-semibold">
                Sign in
              </Text>
            </Pressable>
          </Link>
        </View>
        {path ? (
          <Text className="text-ink-3 dark:text-ink-2 text-xs font-mono text-center">
            Path: {path}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
