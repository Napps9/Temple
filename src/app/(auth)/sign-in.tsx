import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { signIn } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      // Navigate explicitly — the (auth) layout redirect only fires for
      // users WITH a membership, so without this a gymless (or
      // unreadable-membership) account signed in and just sat here.
      // Root index routes: staff → /classes, member → /book or /parq,
      // no membership → /welcome.
      router.replace('/' as never);
    } catch (e) {
      setError(errorMessage(e, 'Sign-in failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center px-4">
        <View className="gap-6 w-full max-w-md mx-auto">
          <View className="gap-2">
            <Text className="text-gray-900 dark:text-gray-50 text-4xl font-semibold">
              Temple
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Sign in to continue
            </Text>
          </View>
          <View className="gap-4">
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
            />
          </View>
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          <Button onPress={onSubmit} loading={loading}>
            Sign in
          </Button>
          <View className="items-center gap-3">
            <Link href="/accept-invite" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-primary">Have an invite code?</Text>
              </Pressable>
            </Link>
            <Link href="/create-gym" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-primary">Start a new gym</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
