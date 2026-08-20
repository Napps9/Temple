import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { TempleLockup } from '@/components/TempleMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { requestPasswordReset } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your email');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(trimmed);
      setSentTo(trimmed);
    } catch (e) {
      setError(errorMessage(e, 'Could not send the reset email'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View className="absolute top-3 right-3 z-10">
        <ThemeToggle />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center px-4">
        <View className="gap-6 w-full max-w-md mx-auto">
          <View className="items-center gap-3">
            <TempleLockup size={28} />
            <View className="items-center gap-1">
              <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
                Reset your password
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-center">
                {sentTo
                  ? 'Check your email for the link.'
                  : "Enter your email and we'll send you a link to choose a new one."}
              </Text>
            </View>
          </View>

          {sentTo ? (
            <View className="gap-4">
              <Text className="text-gray-500 dark:text-gray-400 text-center">
                We sent a password reset link to{' '}
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  {sentTo}
                </Text>
                . Click it, then come back and sign in with your new password.
              </Text>
              <Pressable
                onPress={() => {
                  setSentTo(null);
                  setError(null);
                }}
                className="self-center">
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  Use a different email
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
              />
              {error ? (
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-red-500 dark:text-red-400 text-sm">
                  {error}
                </Text>
              ) : null}
              <Button onPress={onSubmit} loading={loading}>
                Send reset link
              </Button>
            </>
          )}

          <View className="items-center">
            <Link href="/sign-in" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-primary">Back to sign in</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
