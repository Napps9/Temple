import { ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';

export default function Book() {
  const { data: membership } = useGymMembership();

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6">
        <View className="gap-1">
          <Text className="text-gray-500 text-sm uppercase tracking-widest">Book a class</Text>
          <Text className="text-gray-900 text-3xl font-semibold">
            {membership?.gymName ?? 'Temple'}
          </Text>
        </View>
        <View className="bg-white rounded-xl p-4 gap-2">
          <Text className="text-gray-900 font-semibold">Coming soon</Text>
          <Text className="text-gray-500">
            When your gym adds classes to its schedule, they'll appear
            here for you to reserve a spot.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
