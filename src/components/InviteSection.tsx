import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { GymRole } from '@/types/database';

const origin =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : 'https://app.temple';

type InviteSectionProps = {
  title: string;
  subtitle: string;
  // Selectable roles for the invite. When only one is supplied the
  // chip picker is hidden — the form is implicitly for that role.
  roles: GymRole[];
  initialRole: GymRole;
};

// Email-only invites: the owner/admin enters an address and the
// send-invite edge function mints a single-use code (so the role gate
// still applies) and emails the accept link via Resend. The recipient
// joins by clicking that link — there are no codes or QRs to hand out.
export function InviteSection({
  title,
  subtitle,
  roles,
  initialRole,
}: InviteSectionProps) {
  const { data: membership } = useGymMembership();
  const [role, setRole] = useState<GymRole>(initialRole);
  const [inviteEmail, setInviteEmail] = useState('');
  const [emailNotice, setEmailNotice] = useState<
    { tone: 'ok' | 'warn'; text: string } | null
  >(null);
  // Set when the code was minted but the email couldn't be sent (no
  // sending domain / from-address configured) — the owner can still
  // share this link manually rather than being stuck.
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const showRolePicker = roles.length > 1;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());

  function copyLink() {
    if (!manualLink) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(manualLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  const emailInvite = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym membership found');
      const { data, error } = await supabase.functions.invoke('send-invite', {
        body: {
          gym_id: membership.gymId,
          role,
          email: inviteEmail.trim(),
          origin,
        },
      });
      if (error) throw error;
      return data as { ok: boolean; sent: boolean; code?: string; error?: string };
    },
    onSuccess: (data) => {
      setCopied(false);
      if (data.sent) {
        setManualLink(null);
        setEmailNotice({ tone: 'ok', text: `Invite sent to ${inviteEmail.trim()}.` });
        setInviteEmail('');
      } else if (data.code) {
        // Email delivery isn't set up, but the invite itself is valid.
        // Hand over the link so the owner can send it themselves.
        setManualLink(`${origin}/accept-invite?code=${encodeURIComponent(data.code)}`);
        setEmailNotice({
          tone: 'warn',
          text: 'Email delivery isn’t set up yet, so we couldn’t send this automatically. The invite is ready — copy the link below and share it directly.',
        });
      } else {
        const reason = data.error ? ` (${data.error})` : '';
        setManualLink(null);
        setEmailNotice({
          tone: 'warn',
          text: `Couldn't create the invite${reason}. Please try again.`,
        });
      }
    },
    onError: () => {
      setManualLink(null);
      setEmailNotice(null);
    },
  });

  return (
    <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 gap-5">
      <View className="gap-1">
        <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
          {title}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400">{subtitle}</Text>
      </View>

      <View className="gap-3">
        {showRolePicker ? (
          <View className="flex-row flex-wrap gap-2">
            {roles.map((r) => {
              const selected = role === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  className={`px-4 py-2 rounded-full border ${
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Text
                    className={
                      selected ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
                    }>
                    {r}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Input
          label="Email address"
          value={inviteEmail}
          onChangeText={(v) => {
            setInviteEmail(v);
            setEmailNotice(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
          autoComplete="email"
          placeholder={`${role}@example.com`}
        />
        <Button
          onPress={() => emailInvite.mutate()}
          loading={emailInvite.isPending}
          disabled={!validEmail}>
          Email {role} invite
        </Button>

        {emailNotice ? (
          <Text
            className={`text-sm ${
              emailNotice.tone === 'ok'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}>
            {emailNotice.text}
          </Text>
        ) : null}
        {manualLink ? (
          <View className="flex-row items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
            <Text
              className="flex-1 text-gray-700 dark:text-gray-200 text-sm font-mono"
              numberOfLines={1}>
              {manualLink}
            </Text>
            <ChipButton
              label={copied ? 'Copied' : 'Copy'}
              icon={copied ? 'checkmark' : 'copy-outline'}
              onPress={copyLink}
            />
          </View>
        ) : null}
        {emailInvite.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(emailInvite.error, 'Could not send the invite')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
