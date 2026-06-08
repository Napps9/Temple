import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useSignOut } from '@/lib/auth';

// Shown when a user is signed in but has no gym membership yet —
// either they just created an auth account via /join/[slug] that
// failed to bind, or they cleared their membership somewhere.
// Offers the same three choices as the sign-in page so they can
// pick a path forward.
export default function WelcomeScreen() {
  const signOut = useSignOut();
  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-6 p-6">
        <View className="gap-2 items-center">
          <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
            Welcome
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            You're signed in but not in a gym yet. Create one or join with an
            invite.
          </Text>
        </View>
        <View className="w-full max-w-xs gap-3">
          <Link href="/create-gym" asChild>
            <Pressable className="bg-primary rounded-lg p-3 items-center active:opacity-80">
              <Text className="text-white font-semibold">Start a new gym</Text>
            </Pressable>
          </Link>
          <Link href="/accept-invite" asChild>
            <Pressable className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 items-center active:opacity-80">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Use an invite code
              </Text>
            </Pressable>
          </Link>
          <Pressable
            onPress={() => signOut.mutate()}
            className="self-center pt-2">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Sign out
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
