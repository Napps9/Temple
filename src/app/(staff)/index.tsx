import { Link } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole, useSignOut } from '@/lib/auth';

export default function StaffHome() {
  const role = useRole();
  const { data: membership } = useGymMembership();
  const signOut = useSignOut();

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-6 py-6">
        <View className="gap-1">
          <Text className="text-bone/60 text-sm uppercase tracking-widest">{role}</Text>
          <Text className="text-bone text-3xl font-semibold">
            {membership?.gymName ?? 'Temple'}
          </Text>
        </View>

        {role === 'owner' && (
          <View className="gap-2 bg-ink-soft rounded-xl p-4">
            <Text className="text-bone font-semibold">Revenue</Text>
            <Text className="text-bone/60">Coming soon</Text>
          </View>
        )}

        {role === 'coach' && (
          <View className="gap-2 bg-ink-soft rounded-xl p-4">
            <Text className="text-bone font-semibold">Classes</Text>
            <Text className="text-bone/60">Coming soon</Text>
          </View>
        )}

        {role === 'staff' && (
          <View className="gap-2 bg-ink-soft rounded-xl p-4">
            <Text className="text-bone font-semibold">Tasks</Text>
            <Text className="text-bone/60">Coming soon</Text>
          </View>
        )}

        <View className="gap-3">
          <Link href="/(member)" asChild>
            <Button variant="secondary">Book a class →</Button>
          </Link>

          {role === 'owner' && (
            <Link href="/(staff)/team" asChild>
              <Button variant="secondary">Manage team</Button>
            </Link>
          )}
        </View>

        <View className="mt-4">
          <Button variant="ghost" onPress={() => signOut.mutate()}>
            Sign out
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}
