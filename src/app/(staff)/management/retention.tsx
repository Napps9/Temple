import { Redirect } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { useCan } from '@/lib/useCan';

export default function RetentionScreen() {
  const canSeeRetention = useCan('can_see_retention');

  // undefined = still resolving session/membership/overrides; only a
  // definitive false redirects, so the gate never flashes on load.
  if (canSeeRetention === false) {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Retention
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Members at risk of leaving, and the one thing to do about each.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-5 gap-2">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Nothing to show yet
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            At-risk detection is being wired up. Once it lands, this is where
            you'll see members whose membership is expiring, whose payment has
            failed, or whose attendance is dropping off.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
