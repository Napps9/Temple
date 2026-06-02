import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
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
    setLoading(true);
    try {
      await acceptInvite(code.trim(), email.trim(), password, name.trim());
    } catch (e) {
      setError(errorMessage(e, 'Invite could not be accepted'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center py-8">
          <View className="gap-6 w-full max-w-md mx-auto">
            <View className="gap-2">
              <Text className="text-gray-900 text-3xl font-semibold">Join your gym</Text>
              <Text className="text-gray-500">Enter the invite code your gym gave you.</Text>
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
              />
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
                textContentType="newPassword"
              />
            </View>
            {error ? <Text className="text-red-500">{error}</Text> : null}
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
