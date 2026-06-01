import { ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';

export default function StaffClasses() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6">
        <View className="gap-1">
          <Text className="text-bone text-2xl font-semibold">Classes</Text>
          <Text className="text-bone/60">
            Create and schedule the classes your gym runs each week.
          </Text>
        </View>
        <View className="bg-ink-soft rounded-xl p-4 gap-2">
          <Text className="text-bone font-semibold">Coming soon</Text>
          <Text className="text-bone/60">
            Build a weekly schedule, assign a coach and capacity to each
            class, and members will see the slots in their Book tab.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
