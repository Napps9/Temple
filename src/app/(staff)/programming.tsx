import { ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';

export default function StaffProgramming() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6">
        <View className="gap-1">
          <Text className="text-gray-900 text-2xl font-semibold">Programming</Text>
          <Text className="text-gray-500">Plan the workouts your members will train.</Text>
        </View>
        <View className="bg-white rounded-xl p-4 gap-2">
          <Text className="text-gray-900 font-semibold">Coming soon</Text>
          <Text className="text-gray-500">
            Build daily and weekly programming. Members see it in their
            Programming tab and log their results after class.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
