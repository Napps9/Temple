import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';
import { useCan } from '@/lib/useCan';

export default function Index() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();
  const canAccessStaff = useCan('can_access_staff_area');

  if (session === undefined) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  if (isLoading) return <Loading />;
  if (!membership) return <Redirect href="/sign-in" />;
  if (canAccessStaff === undefined) return <Loading />;
  return <Redirect href={canAccessStaff ? '/classes' : '/book'} />;
}

function Loading() {
  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950 items-center justify-center">
      <ActivityIndicator color="#2563EB" />
    </View>
  );
}
