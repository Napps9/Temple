import { ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';

export default function MemberProgramming() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6">
        <View className="gap-1">
          <Text className="text-gray-900 text-2xl font-semibold">Programming</Text>
          <Text className="text-gray-500">Today's workout and the week ahead.</Text>
        </View>
        <View className="bg-white rounded-xl p-4 gap-2">
          <Text className="text-gray-900 font-semibold">Coming soon</Text>
          <Text className="text-gray-500">
            Once your coaches publish programming, you'll see the WOD,
            warm-up, and any scaling options here before class.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
