import { ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';

export default function Workouts() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Workouts
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Your training history and personal records.
          </Text>
        </View>
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Coming soon
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Log results after class, see your time / weight / reps over
            the weeks, and watch your PRs climb.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
