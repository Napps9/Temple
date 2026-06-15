import { router } from 'expo-router';
import { View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';
import { SetupBanner } from '@/components/SetupBanner';
import { useCan } from '@/lib/useCan';

export default function StaffProgramming() {
  const canEdit = useCan('can_edit_classes') ?? false;
  return (
    <View className="flex-1">
      <SetupBanner />
      <View className="flex-1">
        <ProgrammingCalendar
          mode={canEdit ? 'manage' : 'view'}
          headerAction={
            <ChipButton
              label="Analysis"
              icon="analytics-outline"
              onPress={() => router.push('/analysis' as never)}
            />
          }
        />
      </View>
    </View>
  );
}
