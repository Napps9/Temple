import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { TempleLockup } from '@/components/TempleLockup';
import { ThemeToggle } from '@/components/ThemeToggle';
import { acceptInvite } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

export default function AcceptInviteScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.code) setCode(params.code);
  }, [params.code]);

  async function onSubmit() {
    setError(null);
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedCode) return setError('Enter your invite code');
    if (!trimmedName) return setError('Enter your full name');
    if (!trimmedEmail) return setError('Enter your email');
    if (!password) return setError('Enter a password');
    setLoading(true);
    try {
      await acceptInvite(trimmedCode, trimmedEmail, password, trimmedName);
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
            <View className="gap-2">
              <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
                Join your gym
              </Text>
              <Text className="text-gray-500 dark:text-gray-400">
                Enter the invite code your gym gave you.
              </Text>
            </View>
            <View className="gap-4">
              <Input
                label="Invite code"
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                placeholder="ABCD1234"
              />
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
