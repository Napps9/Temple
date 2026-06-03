import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';
import { can } from '@/lib/can';

export default function Index() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();

  if (session === undefined) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  if (isLoading) return <Loading />;
  if (!membership) return <Redirect href="/sign-in" />;
  return <Redirect href={can(membership.role, 'can_access_staff_area') ? '/classes' : '/book'} />;
}

function Loading() {
  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950 items-center justify-center">
      <ActivityIndicator color="#2563EB" />
    </View>
  );
}
