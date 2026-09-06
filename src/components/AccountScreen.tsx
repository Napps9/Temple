import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Switch, View } from 'react-native';
import { PageScroll } from '@/components/PageScroll';
import { PageHead } from './PageHead';
import { Text } from './Text';

import { AvatarUploader } from './AvatarUploader';
import { BackLink } from './BackLink';
import { Button } from './Button';
import { ChipButton } from './ChipButton';
import { ConfirmDialog } from './ConfirmDialog';
import { CoachEarningsCard } from './CoachEarningsCard';
import { GymShareCard } from './GymShareCard';
import { Input } from './Input';
import { LeaderboardPrivacyCard } from './LeaderboardPrivacyCard';
import { SmsOptInCard } from './SmsOptInCard';
import { LeaveGymDialog } from './LeaveGymDialog';
import { ListRow, RuledList } from './ListRow';
import { Screen } from './Screen';
import { SectionLabel } from './SectionLabel';
import {
  useGymMembership,
  useMyProfile,
  useRole,
  useSession,
  useSignOut,
  useSwitchGym,
} from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useThemeColors, useThemePreference } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';
import { useMyGyms } from '@/lib/useMyGyms';
import { useSavedFlag } from '@/lib/useSavedFlag';

function fmtMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  });
}

export function AccountScreen() {
  const colors = useThemeColors();
  const session = useSession();
  const role = useRole();
  const { data: membership } = useGymMembership();
  const { isDemo } = useGymBrand();
  const { data: profile } = useMyProfile();
  const signOut = useSignOut();
  const queryClient = useQueryClient();
  const themePref = useThemePreference();

  const myGyms = useMyGyms();
  const switchGym = useSwitchGym();

  const exportData = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('export_my_account_data');
      if (error) throw error;
      if (Platform.OS !== 'web' || typeof document === 'undefined') {
        throw new Error('Download from the web app for now.');
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `temple-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

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
      // gym gets to read off the profile row. Through the RPC since 0270,
      // which normalises to E.164 alongside what was typed and refuses a
      // number nobody could dial, here where the field is still on screen.
      if (phoneChanged) {
        const { error } = await supabase.rpc('set_my_contact_phone', {
          p_phone: nextPhone,
        });
        if (error) throw error;
      }
      if (emailChanged) {
        // The one send no server guard of ours can reach: Supabase Auth
        // mails the address, not any code in this repo, and config.toml sets
        // double_confirm_changes so it mails the old one too. On a shared
        // demo tenant a confirmed change would also move the owner's login
        // out from under the published credentials (0278). The field stays
        // editable and says why rather than disappearing.
        if (isDemo) {
          throw new Error(
            'This is a demo gym, so Temple won’t email a confirmation to change the address.',
          );
        }
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
      <PageScroll contentContainerClassName="gap-6 py-6 px-4 md:max-w-3xl lg:max-w-5xl md:mx-auto md:w-full">
        <BackLink />
        <PageHead title="Account" subtitle="Manage your name, email, and password." />

        {/* Two-column dashboard on desktop; the two groups stack in the
            same order on mobile. Left = identity + gym; right = account
            details, security and data controls.
            xl rather than lg because this screen renders on both sides:
            on staff it sits inside the 246px rail, so an lg: split gave
            it two 380px columns in a 1024 window. */}
        <View className="gap-6 xl:flex-row xl:items-start">
        <View className="gap-6 xl:flex-1">

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
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

        <SmsOptInCard />

        {membership && session ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
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
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
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

        {(myGyms.data?.length ?? 0) > 0 ? (
          <View className="gap-2">
            <SectionLabel>Your gyms</SectionLabel>
            <RuledList>
              {myGyms.data!.map((g, i) => {
                const current = !g.left_at && g.gym_id === membership?.gymId;
                const switchable = !g.left_at && !current;
                return (
                  <ListRow
                    key={g.gym_id}
                    ruled
                    first={i === 0}
                    title={g.gym_name}
                    subtitle={
                      g.left_at
                        ? `Left ${fmtMonthYear(g.left_at)} \u00B7 history kept`
                        : switchable
                          ? `Joined ${fmtMonthYear(g.joined_at)} \u00B7 tap to switch`
                          : `Joined ${fmtMonthYear(g.joined_at)}`
                    }
                    onPress={
                      switchable
                        ? () => {
                            if (!switchGym.isPending) switchGym.mutate(g.gym_id);
                          }
                        : undefined
                    }
                    chip={
                      <View
                        className={`rounded-full px-2 py-0.5 ${
                          current ? 'bg-emerald-500/10' : 'bg-raised dark:bg-raised-dk'
                        }`}>
                        <Text
                          className={`text-[10px] font-semibold ${
                            current
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-ink-2 dark:text-ink-2-dk'
                          }`}>
                          {g.left_at ? 'Past' : current ? 'Current' : 'Active'}
                        </Text>
                      </View>
                    }
                  />
                );
              })}
            </RuledList>
          </View>
        ) : null}

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Your data
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Download everything Temple holds about your account — your
            training history, bookings, messages, purchases and health
            screening, as one file. Free, always.
          </Text>
          <ChipButton
            tone="neutral"
            className="self-start"
            label={exportData.isPending ? 'Preparing\u2026' : 'Download everything'}
            icon="download-outline"
            onPress={() => exportData.mutate()}
            disabled={exportData.isPending}
          />
          {exportData.error ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">
              {errorMessage(exportData.error, 'Could not prepare the export')}
            </Text>
          ) : null}
        </View>

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-ink dark:text-ink-dk font-semibold">
                Appearance
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Dark mode swaps the whole app, and your choice sticks on
                this device.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Dark mode"
              value={themePref.scheme === 'dark'}
              onValueChange={(v) => themePref.set(v ? 'dark' : 'light')}
            />
          </View>
        </View>

        </View>
        <View className="gap-6 xl:flex-1">

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
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
            <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-card p-3 gap-2">
              <Text className="text-amber-700 dark:text-amber-300 text-sm">
                Pending email confirmation: {pendingEmail}
              </Text>
              <ChipButton
                tone="amber"
                className="self-start"
                label="Resend confirmation"
                icon="mail-outline"
                onPress={() =>
                  isDemo
                    ? setDetailsError(
                        'This is a demo gym, so Temple won’t send the confirmation.',
                      )
                    : supabase.auth
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

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
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
              color={colors.ink3}
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
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
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
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
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
      </PageScroll>

      {membership && session ? (
        <LeaveGymDialog
          visible={showLeave}
          gymId={membership.gymId}
          profileId={session.user.id}
          gymName={membership.gymName ?? 'this gym'}
          onClose={() => setShowLeave(false)}
          onLeft={() => signOut.mutate()}
        />
      ) : null}

      {/* This is the destructive-confirm shape exactly — a question, its
          consequence, one red action and a named way out — so it is
          ConfirmDialog rather than a fourth hand-rolled copy of it. */}
      <ConfirmDialog
        visible={showWithdraw}
        title="Erase your health data?"
        body="This permanently deletes your PAR-Q answers and any injuries you've logged, and withdraws your data-processing consent. This can't be undone — you'll be asked to consent again before your next training session."
        confirmLabel="Erase data"
        cancelLabel="Keep it"
        pending={withdrawConsent.isPending}
        error={withdrawError}
        onConfirm={() => withdrawConsent.mutate()}
        onCancel={() => setShowWithdraw(false)}
      />
    </Screen>
  );
}
