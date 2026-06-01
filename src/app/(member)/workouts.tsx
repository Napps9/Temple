import { ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';

export default function Workouts() {
  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6">
        <View className="gap-1">
          <Text className="text-bone text-2xl font-semibold">Workouts</Text>
          <Text className="text-bone/60">Your training history and personal records.</Text>
        </View>
        <View className="bg-ink-soft rounded-xl p-4 gap-2">
          <Text className="text-bone font-semibold">Coming soon</Text>
          <Text className="text-bone/60">
            Log results after class, see your time / weight / reps over
            the weeks, and watch your PRs climb.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
