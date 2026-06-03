import { Link } from 'expo-router';
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
        className="flex-1 justify-center">
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
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
            />
          </View>
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          <Button onPress={onSubmit} loading={loading}>
            Sign in
          </Button>
          <View className="items-center">
            <Link href="/accept-invite" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-primary">Have an invite code?</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
