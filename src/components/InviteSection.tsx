import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
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

  const showRolePicker = roles.length > 1;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());

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
      return data as { ok: boolean; sent: boolean; error?: string };
    },
    onSuccess: (data) => {
      if (data.sent) {
        setEmailNotice({ tone: 'ok', text: `Invite sent to ${inviteEmail.trim()}.` });
        setInviteEmail('');
      } else {
        const reason = data.error ? ` (${data.error})` : '';
        setEmailNotice({
          tone: 'warn',
          text: `Couldn't send the invite${reason}. Check the address and try again.`,
        });
      }
    },
    onError: () => setEmailNotice(null),
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
        {emailInvite.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(emailInvite.error, 'Could not send the invite')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
