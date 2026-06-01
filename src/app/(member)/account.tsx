import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole, useSession, useSignOut } from '@/lib/auth';

export default function Account() {
  const session = useSession();
  const role = useRole();
  const { data: membership } = useGymMembership();
  const signOut = useSignOut();

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6">
        <View className="gap-1">
          <Text className="text-bone/60 text-sm uppercase tracking-widest">Account</Text>
          <Text className="text-bone text-2xl font-semibold">{session?.user.email}</Text>
        </View>

        <View className="bg-ink-soft rounded-xl p-4 gap-1">
          <Text className="text-bone font-semibold">{membership?.gymName ?? 'Temple'}</Text>
          <Text className="text-bone/60 capitalize">{role ?? 'member'}</Text>
        </View>

        <View className="bg-ink-soft rounded-xl p-4 gap-2">
          <Text className="text-bone font-semibold">Profile</Text>
          <Text className="text-bone/60">
            Coming soon — edit your name, photo, and contact details.
          </Text>
        </View>

        <View className="bg-ink-soft rounded-xl p-4 gap-2">
          <Text className="text-bone font-semibold">Membership</Text>
          <Text className="text-bone/60">
            Coming soon — manage your plan, payments, and billing history.
          </Text>
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
