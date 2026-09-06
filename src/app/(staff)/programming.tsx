import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { PageTopRow } from '@/components/PageTopRow';
import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';
import { ProgrammingRoadmap } from '@/components/ProgrammingRoadmap';
import { Segmented } from '@/components/Segmented';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { useCan } from '@/lib/useCan';

// The chosen view state, across unmounts — session-only, the
// GymSetupChecklist / list-scroll-position idiom.
let lastProgrammingView: 'week' | 'year' = 'week';

export default function StaffProgramming() {
  const canEdit = useCan('can_edit_classes') ?? false;
  const canProgramMembers = useCan('can_program_members') ?? false;
  const { data: membership } = useGymMembership();
  const [view, setViewState] = useState<'week' | 'year'>(lastProgrammingView);
  const setView = (v: 'week' | 'year') => {
    lastProgrammingView = v;
    setViewState(v);
  };

  const toggle = (
    <Segmented
      options={[
        { key: 'week', label: 'Week' },
        { key: 'year', label: 'Year' },
      ]}
      value={view}
      onChange={setView}
    />
  );

  if (view === 'year') {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="-mx-6 md:mx-auto md:w-full md:max-w-5xl md:px-2">
          <PageTopRow className="pt-3 pb-1" left={toggle} />
        </View>
        <ProgrammingRoadmap gymId={membership?.gymId} canEdit={canEdit} />
      </Screen>
    );
  }

  return (
    <ProgrammingCalendar
      mode={canEdit ? 'manage' : 'view'}
      roadmap
      headerAction={
        <View className="flex-row items-center gap-2">
          {toggle}
          {canProgramMembers ? (
            <ChipButton
              label="Individuals"
              icon="person-outline"
              iconOnlyBelow={375}
              onPress={() => router.push('/management/member-programming' as never)}
            />
          ) : null}
          <ChipButton
            label="Analysis"
            icon="analytics-outline"
            iconOnlyBelow={375}
            onPress={() => router.push('/analysis' as never)}
          />
        </View>
      }
    />
  );
}
