import { router } from 'expo-router';
import { View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';
import { useCan } from '@/lib/useCan';

export default function StaffProgramming() {
  const canEdit = useCan('can_edit_classes') ?? false;
  const canProgramMembers = useCan('can_program_members') ?? false;
  return (
    <ProgrammingCalendar
      mode={canEdit ? 'manage' : 'view'}
      headerAction={
        <View className="flex-row gap-2">
          {canProgramMembers ? (
            <ChipButton
              label="Individuals"
              icon="person-outline"
              onPress={() => router.push('/management/member-programming' as never)}
            />
          ) : null}
          <ChipButton
            label="Analysis"
            icon="analytics-outline"
            onPress={() => router.push('/analysis' as never)}
          />
        </View>
      }
    />
  );
}
