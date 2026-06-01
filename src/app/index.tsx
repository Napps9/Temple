import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';

export default function Index() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();

  if (session === undefined) return <Loading />;
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (isLoading) return <Loading />;
  if (!membership) return <Redirect href="/(auth)/sign-in" />;
  return <Redirect href={membership.role === 'member' ? '/(member)' : '/(staff)'} />;
}

function Loading() {
  return (
    <View className="flex-1 bg-ink items-center justify-center">
      <ActivityIndicator color="#C5A572" />
    </View>
  );
}
