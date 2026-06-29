import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { TempleLockup } from '@/components/TempleLockup';
import { ThemeToggle } from '@/components/ThemeToggle';
import { acceptInvite } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

export default function AcceptInviteScreen() {
  // Invites arrive only as an emailed link carrying the single-use code,
  // so the code is read from the URL — there's no manual code entry.
  const params = useLocalSearchParams<{ code?: string }>();
  const code = (params.code ?? '').trim();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) return setError('Enter your full name');
    if (!trimmedEmail) return setError('Enter your email');
    if (!password) return setError('Enter a password');
    setLoading(true);
    try {
      await acceptInvite(code, trimmedEmail, password, trimmedName);
    } catch (e) {
      setError(errorMessage(e, 'Invite could not be accepted'));
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
        className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center py-8 px-4">
          <View className="gap-6 w-full max-w-md mx-auto">
            <View className="items-center">
              <TempleLockup width={160} height={40} />
            </View>

            {code ? (
              <>
                <View className="gap-2">
                  <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
                    Join your gym
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400">
                    Create your account to accept the invite.
                  </Text>
                </View>
                <View className="gap-4">
                  <Input
                    label="Full name"
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    textContentType="name"
                    autoComplete="name"
                  />
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
                    textContentType="newPassword"
                    autoComplete="new-password"
                  />
                </View>
                {error ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
                ) : null}
                <Button onPress={onSubmit} loading={loading}>
                  Create account
                </Button>
              </>
            ) : (
              <View className="gap-2">
                <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
                  Open your invite link
                </Text>
                <Text className="text-gray-500 dark:text-gray-400">
                  Invites are sent by email — open the link your gym emailed
                  you to join. If you can't find it, ask them to resend it.
                </Text>
              </View>
            )}

            <View className="items-center">
              <Link href="/sign-in" asChild>
                <Pressable hitSlop={8}>
                  <Text className="text-primary">Already have an account? Sign in</Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
