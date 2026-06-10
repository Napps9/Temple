import { router } from 'expo-router';

import { ChipButton } from '@/components/ChipButton';
import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';
import { useCan } from '@/lib/useCan';

export default function StaffProgramming() {
  const canEdit = useCan('can_edit_classes') ?? false;
  return (
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
  );
}
