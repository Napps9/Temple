import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';

import { AvatarUploader } from './AvatarUploader';
import { BackLink } from './BackLink';
import { Button } from './Button';
import { ChipButton } from './ChipButton';
import { CoachEarningsCard } from './CoachEarningsCard';
import { GymShareCard } from './GymShareCard';
import { Input } from './Input';
import { LeaderboardPrivacyCard } from './LeaderboardPrivacyCard';
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
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useSavedFlag } from '@/lib/useSavedFlag';

export function AccountScreen() {
  const colors = useThemeColors();
  const session = useSession();
  const role = useRole();
  const { data: membership } = useGymMembership();
  const { data: profile } = useMyProfile();
  const signOut = useSignOut();
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsMessage, setDetailsMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [detailsSaved, markDetailsSaved] = useSavedFlag();
  const [passwordSaved, markPasswordSaved] = useSavedFlag();
  const [showLeave, setShowLeave] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showPasswordFields, setShowPasswordFields] = useState(false);
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
      setShowWithdraw(false);
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

  const myEmergencyContact = useQuery({
    queryKey: ['my-emergency-contact', membership?.gymId, session?.user.id],
    enabled: !!membership?.gymId && !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('emergency_contact')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.emergency_contact ?? null) as string | null;
    },
  });

  useEffect(() => {
    if (profile?.full_name) setFullName(profile.full_name);
  }, [profile?.full_name]);

  useEffect(() => {
    if (session?.user.email) setEmail(session.user.email);
  }, [session?.user.email]);

  useEffect(() => {
    if (profile?.phone) setPhone(profile.phone);
  }, [profile?.phone]);

  useEffect(() => {
    if (myEmergencyContact.data) setEmergencyContact(myEmergencyContact.data);
  }, [myEmergencyContact.data]);

  const saveDetails = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not signed in');
      const name = fullName.trim();
      const nextEmail = email.trim();
      const nextPhone = phone.trim();
      const nextContact = emergencyContact.trim();
      if (!name) throw new Error('Name is required');
      if (!nextEmail) throw new Error('Email is required');

      const nameChanged = name !== (profile?.full_name ?? '');
      const emailChanged = nextEmail !== session.user.email;
      const phoneChanged = nextPhone !== (profile?.phone ?? '');
      const contactChanged = nextContact !== (myEmergencyContact.data ?? '');

      if (nameChanged) {
        const { error } = await supabase
          .from('profiles')
          .update({ full_name: name })
          .eq('id', session.user.id);
        if (error) throw error;
      }

      // Separate table since 0179 — phone is not something the rest of the
      // gym gets to read off the profile row.
      if (phoneChanged) {
        const { error } = await supabase
          .from('member_contact_details')
          .upsert(
            { profile_id: session.user.id, phone: nextPhone || null,
              updated_at: new Date().toISOString() },
            { onConflict: 'profile_id' },
          );
        if (error) throw error;
      }
      if (emailChanged) {
        const { error } = await supabase.auth.updateUser({ email: nextEmail });
        if (error) throw error;
      }
      if (contactChanged && membership) {
        const { error } = await supabase.rpc('update_my_emergency_contact', {
          p_gym_id: membership.gymId,
          p_contact: nextContact,
        });
        if (error) throw error;
      }
      return {
        emailChanged,
        anyChanged: nameChanged || emailChanged || phoneChanged || contactChanged,
      };
    },
    onSuccess: ({ emailChanged, anyChanged }) => {
      setDetailsError(null);
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      queryClient.invalidateQueries({ queryKey: ['my-emergency-contact'] });
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
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-3xl lg:max-w-5xl md:mx-auto md:w-full">
        <BackLink />
        <View className="gap-2">
          <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
            Account
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk">
            Manage your name, email, and password.
          </Text>
        </View>

        {/* Two-column dashboard on desktop; the two groups stack in the
            same order on mobile. Left = identity + gym; right = account
            details, security and data controls. */}
        <View className="gap-6 lg:flex-row lg:items-start">
        <View className="gap-6 lg:flex-1">

        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
          <AvatarUploader
            currentUrl={profile?.avatar_url}
            fullName={displayName}
            size={56}
          />
          <View>
            <Text
              className="text-ink dark:text-ink-dk font-semibold"
              numberOfLines={1}>
              {displayName}
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk capitalize">
              {role ?? 'member'} · {membership?.gymName ?? 'Temple'}
            </Text>
          </View>
        </View>

        {role === 'coach' || role === 'owner' ? <CoachEarningsCard /> : null}

        <GymShareCard />

        <LeaderboardPrivacyCard />

        {membership && session ? (
          <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-2 shadow-card">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Family
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Add children you look after and book their classes.
            </Text>
            <ChipButton
              tone="neutral"
              className="self-start"
              label="Manage children"
              icon="people-outline"
              onPress={() => router.push('/family' as never)}
            />
          </View>
        ) : null}

        {membership && session ? (
          <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-2 shadow-card">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Communication preferences
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Choose which topics you hear from this gym about — newsletter,
              programming, promos, billing.
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
          </View>
        ) : null}

        </View>
        <View className="gap-6 lg:flex-1">

        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-ink dark:text-ink-dk font-semibold">
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
          <Input
            label="Mobile number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
          />
          {membership ? (
            <Input
              label="Emergency contact"
              value={emergencyContact}
              onChangeText={setEmergencyContact}
              placeholder="Name and phone number"
            />
          ) : null}
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
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
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

        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
          <Pressable
            onPress={() => setShowPasswordFields((v) => !v)}
            className="flex-row items-center gap-2 hover:opacity-80 active:opacity-70">
            <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
              Password
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {showPasswordFields ? 'Cancel' : 'Change'}
            </Text>
            <Ionicons
              name={showPasswordFields ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.iconTertiary}
            />
          </Pressable>
          {showPasswordFields ? (
            <>
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
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
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
            </>
          ) : null}
        </View>

        {membership && session ? (
          <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-2 shadow-card">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Health data & consent
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Permanently deletes your PAR-Q answers and any injuries you've
              logged. You'll be asked to consent again before training.
            </Text>
            <ChipButton
              tone="amber"
              className="self-start"
              label="Withdraw consent & erase health data"
              icon="shield-outline"
              onPress={() => setShowWithdraw(true)}
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
          </View>
        ) : null}

        {role && role !== 'owner' && membership && session ? (
          <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-2 shadow-card">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Leave this gym
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Cancels any active subscriptions, removes your access, and
              erases your health data (PAR-Q + injuries).
            </Text>
            <ChipButton
              tone="red"
              className="self-start"
              label="Leave this gym"
              icon="log-out-outline"
              onPress={() => setShowLeave(true)}
            />
          </View>
        ) : null}

        </View>
        </View>

        <View className="mt-4">
          <Button variant="ghost" onPress={() => signOut.mutate()}>
            Sign out
          </Button>
        </View>

        <View className="mt-2 mb-4 flex-row items-center justify-center gap-3">
          <Link href="/terms" asChild>
            <Pressable hitSlop={6}>
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs underline">
                Terms of Service
              </Text>
            </Pressable>
          </Link>
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">·</Text>
          <Link href="/privacy" asChild>
            <Pressable hitSlop={6}>
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs underline">
                Privacy Policy
              </Text>
            </Pressable>
          </Link>
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

      <Modal
        visible={showWithdraw}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWithdraw(false)}>
        <Pressable
          onPress={() => setShowWithdraw(false)}
          className="flex-1 bg-black/60 items-center justify-center px-6">
          <Pressable
            onPress={() => {}}
            className="bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk p-6 w-full max-w-md md:max-w-lg gap-4">
            <Text className="text-ink dark:text-ink-dk text-xl font-semibold">
              Erase your health data?
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk">
              This permanently deletes your PAR-Q answers and any injuries
              you've logged, and withdraws your data-processing consent. This
              can't be undone — you'll be asked to consent again before your
              next training session.
            </Text>
            {withdrawError ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {withdrawError}
              </Text>
            ) : null}
            <View className="flex-row gap-2 justify-end">
              <Button variant="secondary" onPress={() => setShowWithdraw(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onPress={() => withdrawConsent.mutate()}
                loading={withdrawConsent.isPending}>
                Erase data
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
