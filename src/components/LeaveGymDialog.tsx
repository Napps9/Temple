import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';

import { Button } from './Button';
import { Sheet, SheetAction } from './Sheet';

import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

// The member's own leave confirm. It used to reuse the staff
// RemoveMemberDialog with memberName="yourself", so a member leaving
// their gym read "Remove yourself from the gym?" followed by staff copy
// about "them" and a "Keep them" button — an audience error on the most
// consequential thing a member can do here. This one speaks to the
// person leaving and names each consequence the way the GDPR surfaces
// implement them: history stays, health data is erased (leave_gym calls
// the erasure), the waiver is kept as a liability record.
export function LeaveGymDialog({
  visible,
  gymId,
  profileId,
  gymName,
  onClose,
  onLeft,
}: {
  visible: boolean;
  gymId: string;
  profileId: string;
  gymName: string;
  onClose: () => void;
  onLeft: () => void;
}) {
  const colors = useThemeColors();
  const [error, setError] = useState<string | null>(null);

  const leave = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('leave_gym', {
        p_gym_id: gymId,
        p_profile_id: profileId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.warning();
      setError(null);
      onLeft();
    },
    onError: (e) => setError(errorMessage(e, 'Could not leave the gym')),
  });

  const consequence = (
    icon: React.ComponentProps<typeof Ionicons>['name'],
    title: string,
    body: string,
  ) => (
    <View className="flex-row items-start gap-3">
      <View className="w-8 h-8 rounded-ctl bg-raised dark:bg-raised-dk items-center justify-center mt-0.5">
        <Ionicons name={icon} size={16} color={colors.ink2} />
      </View>
      <View className="flex-1">
        <Text className="text-ink dark:text-ink-dk text-sm font-medium">
          {title}
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs leading-4">
          {body}
        </Text>
      </View>
    </View>
  );

  return (
    <Sheet
      visible={visible}
      title={`Leave ${gymName}?`}
      subtitle="Your membership ends now — any active plan stops and unused credits are lost."
      onClose={onClose}
      actions={
        <>
          <SheetAction grow>
            <Button variant="secondary" onPress={onClose}>
              Stay a member
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button
              variant="destructive"
              loading={leave.isPending}
              onPress={() => leave.mutate()}>
              Leave the gym
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-3 pb-1">
        {consequence(
          'barbell-outline',
          'Your training history stays with you',
          'Workouts, PRs and your journal remain on your account.',
        )}
        {consequence(
          'heart-outline',
          'Your health data is erased',
          'PAR-Q answers and injury notes are deleted permanently.',
        )}
        {consequence(
          'document-text-outline',
          'Your signed waiver is kept',
          'It stays on record as a legal document, as the waiver says.',
        )}
        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
      </View>
    </Sheet>
  );
}
