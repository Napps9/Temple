import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AvatarUploader } from './AvatarUploader';
import { BackLink } from './BackLink';
import { Button } from './Button';
import { ChipButton } from './ChipButton';
import { CoachEarningsCard } from './CoachEarningsCard';
import { GymShareCard } from './GymShareCard';
import { Input } from './Input';
import { LeaderboardPrivacyCard } from './LeaderboardPrivacyCard';
import { MembershipCard } from './MembershipCard';
import { RemoveMemberDialog } from './RemoveMemberDialog';
import { Screen } from './Screen';
import {
  useGymMembership,
  useMyProfile,
  useRole,
  useSession,
  useSignOut,
} from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { useGymStoreConfig } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { useSavedFlag } from '@/lib/useSavedFlag';

export function AccountScreen() {
  const session = useSession();
  const role = useRole();
  const { data: membership } = useGymMembership();
  const { data: profile } = useMyProfile();
  const storeConfig = useGymStoreConfig(membership?.gymId);
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
  const [showLeave, setShowLeave] = useState(false);
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // Withdraw consent = erase the member's own health data (PAR-Q +
  // injuries) and drop the consent record, which re-gates them at the
  // consent screen on next entry. Fulfils the "withdraw at any time"
  // promise on the consent form.
  const withdrawConsent = useMutation({
    mutationFn: async () => {
      if (!membership || !session) throw new Error('No gym');
      const { error } = await supabase.rpc('erase_member_health_data', {
        p_gym_id: membership.gymId,
        p_profile: session.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setWithdrawError(null);
      setWithdrawMessage(
        'Consent withdrawn and your health data erased. You will be asked ' +
          'to re-consent next time you enter.',
      );
      queryClient.invalidateQueries({ queryKey: ['member-consent'] });
      queryClient.invalidateQueries({ queryKey: ['my-injuries'] });
      queryClient.invalidateQueries({ queryKey: ['parq-state'] });
    },
    onError: (e) =>
      setWithdrawError(errorMessage(e, 'Could not withdraw consent')),
  });

  // user.new_email is the Supabase-side authoritative "pending email change"
  // — it survives reloads and clears once the confirmation link is clicked.
  const pendingEmail = (session?.user as { new_email?: string } | undefined)
    ?.new_email;

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
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Account
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Manage your name, email, and password.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <AvatarUploader
            currentUrl={profile?.avatar_url}
            fullName={displayName}
            size={56}
          />
          <View>
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

        {role === 'coach' || role === 'owner' ? <CoachEarningsCard /> : null}

        {role === 'member' ? <MembershipCard /> : null}

        <GymShareCard />

        <LeaderboardPrivacyCard />

        {membership && session && storeConfig.data?.store_enabled ? (
          <View className="gap-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Store
            </Text>
            <Link href="/store" asChild>
              <ChipButton
                tone="neutral"
                className="self-start"
                label="Visit the store"
                icon="bag-handle-outline"
                iconSide="right"
              />
            </Link>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Buy merch, programmes and tickets from{' '}
              {membership.gymName ?? 'your gym'}.
            </Text>
          </View>
        ) : null}

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
          {pendingEmail ? (
            <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-3 gap-2">
              <Text className="text-amber-700 dark:text-amber-300 text-sm">
                Pending email confirmation: {pendingEmail}
              </Text>
              <ChipButton
                tone="amber"
                className="self-start"
                label="Resend confirmation"
                icon="mail-outline"
                onPress={() =>
                  supabase.auth
                    .updateUser({ email: pendingEmail })
                    .then(() => {
                      setDetailsMessage('Confirmation email re-sent.');
                    })
                    .catch((e: unknown) =>
                      setDetailsError(errorMessage(e, 'Could not resend')),
                    )
                }
              />
            </View>
          ) : null}
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
            autoComplete="new-password"
          />
          <Input
            label="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
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

        {membership && session ? (
          <View className="mt-4 gap-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Communication preferences
            </Text>
            <Link href="/email-preferences" asChild>
              <ChipButton
                tone="neutral"
                className="self-start"
                label="Manage email preferences"
                icon="mail-outline"
                iconSide="right"
              />
            </Link>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Choose which topics you hear from this gym about — newsletter,
              programming, promos, billing.
            </Text>
          </View>
        ) : null}

        {membership && session ? (
          <View className="mt-4 gap-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Health data & consent
            </Text>
            <ChipButton
              tone="amber"
              className="self-start"
              label="Withdraw consent & erase health data"
              icon="shield-outline"
              onPress={() => withdrawConsent.mutate()}
              disabled={withdrawConsent.isPending}
            />
            {withdrawMessage ? (
              <Text className="text-emerald-600 dark:text-emerald-400 text-xs">
                {withdrawMessage}
              </Text>
            ) : null}
            {withdrawError ? (
              <Text className="text-red-500 dark:text-red-400 text-xs">
                {withdrawError}
              </Text>
            ) : null}
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Permanently deletes your PAR-Q answers and any injuries you've
              logged. You'll be asked to consent again before training.
            </Text>
          </View>
        ) : null}

        {role && role !== 'owner' && membership && session ? (
          <View className="mt-4 gap-2">
            <ChipButton
              tone="red"
              className="self-start"
              label="Leave this gym"
              icon="log-out-outline"
              onPress={() => setShowLeave(true)}
            />
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Cancels any active subscriptions, removes your access, and
              erases your health data (PAR-Q + injuries).
            </Text>
          </View>
        ) : null}

        <View className="mt-4">
          <Button variant="ghost" onPress={() => signOut.mutate()}>
            Sign out
          </Button>
        </View>
      </ScrollView>

      {membership && session ? (
        <RemoveMemberDialog
          visible={showLeave}
          gymId={membership.gymId}
          profileId={session.user.id}
          memberName="yourself"
          onClose={() => setShowLeave(false)}
          onRemoved={() => signOut.mutate()}
        />
      ) : null}
    </Screen>
  );
}
