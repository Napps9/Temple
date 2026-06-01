import { Link } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { isStaffRole, useGymMembership, useRole, useSignOut } from '@/lib/auth';

export default function MemberHome() {
  const role = useRole();
  const { data: membership } = useGymMembership();
  const signOut = useSignOut();
  const isStaff = isStaffRole(role);

  return (
    <Screen>
      {isStaff ? (
        <Link href="/(staff)" asChild>
          <Pressable hitSlop={8} className="pt-2">
            <Text className="text-brand">← Back to staff view</Text>
          </Pressable>
        </Link>
      ) : null}
      <ScrollView contentContainerClassName="gap-6 py-6">
        <View className="gap-1">
          <Text className="text-bone/60 text-sm uppercase tracking-widest">Welcome to</Text>
          <Text className="text-bone text-3xl font-semibold">
            {membership?.gymName ?? 'Temple'}
          </Text>
        </View>

        <View className="gap-2 bg-ink-soft rounded-xl p-4">
          <Text className="text-bone font-semibold">Book a class</Text>
          <Text className="text-bone/60">Coming soon</Text>
        </View>

        <View className="gap-2 bg-ink-soft rounded-xl p-4">
          <Text className="text-bone font-semibold">Membership</Text>
          <Text className="text-bone/60">Coming soon</Text>
        </View>

        {!isStaff ? (
          <View className="mt-4">
            <Button variant="ghost" onPress={() => signOut.mutate()}>
              Sign out
            </Button>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
