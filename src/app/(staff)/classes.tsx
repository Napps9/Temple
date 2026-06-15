import { View } from 'react-native';

import { ClassesCalendar } from '@/components/ClassesCalendar';
import { SetupBanner } from '@/components/SetupBanner';

export default function StaffClasses() {
  return (
    <View className="flex-1">
      <SetupBanner />
      <View className="flex-1">
        <ClassesCalendar mode="manage" />
      </View>
    </View>
  );
}
