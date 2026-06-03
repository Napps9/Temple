import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Avatar } from './Avatar';
import { Button } from './Button';
import { Input } from './Input';
import { Screen } from './Screen';
import {
  useGymMembership,
  useMyProfile,
  useRole,
  useSession,
  useSignOut,
} from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSavedFlag } from '@/lib/useSavedFlag';

export function AccountScreen() {
  const session = useSession();
  const role = useRole();
  const { data: membership } = useGymMembership();
  const { data: profile } = useMyProfile();
  const signOut = useSignOut();
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsMessage, setDetailsMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [detailsSaved, markDetailsSaved] = useSavedFlag();
  const [passwordSaved, markPasswordSaved] = useSavedFlag();

  useEffect(() => {
    if (profile?.full_name) setFullName(profile.full_name);
  }, [profile?.full_name]);

  useEffect(() => {
    if (session?.user.email) setEmail(session.user.email);
  }, [session?.user.email]);

  const saveDetails = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not signed in');
      const name = fullName.trim();
      const nextEmail = email.trim();
      if (!name) throw new Error('Name is required');
      if (!nextEmail) throw new Error('Email is required');

      const nameChanged = name !== (profile?.full_name ?? '');
      const emailChanged = nextEmail !== session.user.email;

      if (nameChanged) {
        const { error } = await supabase
          .from('profiles')
          .update({ full_name: name })
          .eq('id', session.user.id);
        if (error) throw error;
      }
      if (emailChanged) {
        const { error } = await supabase.auth.updateUser({ email: nextEmail });
        if (error) throw error;
      }
      return { emailChanged, anyChanged: nameChanged || emailChanged };
    },
    onSuccess: ({ emailChanged, anyChanged }) => {
      setDetailsError(null);
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      if (emailChanged) {
        setDetailsMessage(
          'Check your new email for a confirmation link before the change takes effect.',
        );
      } else if (anyChanged) {
        setDetailsMessage(null);
      } else {
        setDetailsMessage(null);
      }
      if (anyChanged) markDetailsSaved();
    },
    onError: (e) => {
      setDetailsMessage(null);
      setDetailsError(errorMessage(e, 'Could not save details'));
    },
  });

  const updatePassword = useMutation({
    mutationFn: async () => {
      if (!password) throw new Error('Enter a new password');
      if (password.length < 8) throw new Error('Password must be at least 8 characters');
      if (password !== confirmPassword) throw new Error('Passwords do not match');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      setPasswordError(null);
      setPasswordMessage(null);
      setPassword('');
      setConfirmPassword('');
      markPasswordSaved();
    },
    onError: (e) => {
      setPasswordMessage(null);
      setPasswordError(errorMessage(e, 'Could not update password'));
    },
  });

  const displayName = profile?.full_name?.trim() || session?.user.email || '';

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Account
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Manage your name, email, and password.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3">
          <Avatar name={displayName} size={48} />
          <View className="flex-1">
            <Text
              className="text-gray-900 dark:text-gray-50 font-semibold"
              numberOfLines={1}>
              {displayName}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 capitalize">
              {role ?? 'member'} · {membership?.gymName ?? 'Temple'}
            </Text>
          </View>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Your details
          </Text>
          <Input
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
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
          {detailsMessage ? (
            <Text className="text-gray-600 dark:text-gray-300 text-sm">
              {detailsMessage}
            </Text>
          ) : null}
          {detailsError ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {detailsError}
            </Text>
          ) : null}
          <Button
            onPress={() => saveDetails.mutate()}
            loading={saveDetails.isPending}
            success={detailsSaved}>
            Save changes
          </Button>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Password
          </Text>
          <Input
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="newPassword"
          />
          <Input
            label="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            textContentType="newPassword"
          />
          {passwordMessage ? (
            <Text className="text-gray-600 dark:text-gray-300 text-sm">
              {passwordMessage}
            </Text>
          ) : null}
          {passwordError ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {passwordError}
            </Text>
          ) : null}
          <Button
            onPress={() => updatePassword.mutate()}
            loading={updatePassword.isPending}
            success={passwordSaved}>
            Update password
          </Button>
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
