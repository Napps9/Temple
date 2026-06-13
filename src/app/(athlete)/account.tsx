import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useSession, useSignOut } from '@/lib/auth';

export default function AthleteAccount() {
  const session = useSession();
  const signOut = useSignOut();

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityLabel="Back"
            className="active:opacity-70">
            <Ionicons name="chevron-back" size={22} color="#9CA3AF" />
          </Pressable>
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Account
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-1">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Signed in as
          </Text>
          <Text className="text-gray-900 dark:text-gray-50">
            {session?.user.email ?? '—'}
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Train with a gym
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Join an existing gym with an invite link, or start your own. Your
            training history comes with you.
          </Text>
          <View className="flex-row gap-2">
            <Link href="/accept-invite" asChild>
              <Pressable className="flex-1 bg-primary active:bg-primary-dark rounded-xl px-4 py-3 items-center">
                <Text className="text-white font-semibold">Join a gym</Text>
              </Pressable>
            </Link>
            <Link href="/create-gym" asChild>
              <Pressable className="flex-1 rounded-xl px-4 py-3 items-center border border-gray-200 dark:border-gray-700 active:opacity-70">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  Start a gym
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <Button
          variant="secondary"
          onPress={() => signOut.mutate()}
          loading={signOut.isPending}>
          Sign out
        </Button>
      </ScrollView>
    </Screen>
  );
}
