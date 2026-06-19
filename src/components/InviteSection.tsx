import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { InviteQRModal } from '@/components/InviteQRModal';
import { WalkInQRCard } from '@/components/WalkInQRCard';
import { useGymMembership } from '@/lib/auth';
import { inviteUrl } from '@/lib/brand';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useGymBrand } from '@/lib/useGymBrand';
import { useThemeColors } from '@/lib/theme';
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
  // Which issued codes this section's list shows. The query pulls every
  // code for the gym; staff and member surfaces each filter to their own.
  filterRole: (role: GymRole) => boolean;
  canDelete: boolean;
  showWalkIn?: boolean;
  listTitle?: string;
};

export function InviteSection({
  title,
  subtitle,
  roles,
  initialRole,
  filterRole,
  canDelete,
  showWalkIn = false,
  listTitle = 'All invites',
}: InviteSectionProps) {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const brand = useGymBrand();
  const [role, setRole] = useState<GymRole>(initialRole);
  const [inviteEmail, setInviteEmail] = useState('');
  const [emailNotice, setEmailNotice] = useState<
    { tone: 'ok' | 'warn'; text: string } | null
  >(null);
  const [newQrOpen, setNewQrOpen] = useState(false);

  const showRolePicker = roles.length > 1;

  const codes = useQuery({
    queryKey: ['invite-codes', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invite_codes')
        .select('id, code, role, used_at, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym membership found');
      const { data, error } = await supabase.rpc('create_invite', {
        p_gym_id: membership.gymId,
        p_role: role,
        p_expires_at: null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-codes'] });
    },
  });

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());

  // Email the invite directly via the send-invite edge function — it
  // mints the code through create_invite (so the role gate still
  // applies) and sends the accept link through Resend.
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
      return data as {
        ok: boolean;
        sent: boolean;
        code: string;
        error?: string;
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invite-codes'] });
      if (data.sent) {
        setEmailNotice({ tone: 'ok', text: `Invite sent to ${inviteEmail.trim()}.` });
        setInviteEmail('');
      } else {
        const reason = data.error ? ` (${data.error})` : '';
        setEmailNotice({
          tone: 'warn',
          text: `Code ${data.code} created, but the email didn't send${reason}. Copy it from "${listTitle}" and share it manually.`,
        });
      }
    },
    onError: () => setEmailNotice(null),
  });

  const visibleCodes = (codes.data ?? []).filter((c) => filterRole(c.role));

  return (
    <>
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
                        selected
                          ? 'text-primary'
                          : 'text-gray-600 dark:text-gray-300'
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
          <Pressable
            onPress={() => create.mutate()}
            disabled={create.isPending}
            hitSlop={6}
            className="self-center py-1 active:opacity-70">
            <Text className="text-primary text-sm">
              {create.isPending ? 'Generating…' : 'No email? Generate a code & QR'}
            </Text>
          </Pressable>

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
          {create.error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {errorMessage(create.error, 'Could not generate code')}
            </Text>
          ) : null}

          {create.data ? (
            <View className="bg-primary/10 border border-primary/40 rounded-xl p-4 gap-2">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                New code — share with the invitee
              </Text>
              <Text className="text-primary text-2xl tracking-widest">
                {create.data}
              </Text>
              <View className="flex-row gap-2 pt-1">
                <ChipButton
                  label="Show QR"
                  icon="qr-code-outline"
                  onPress={() => setNewQrOpen(true)}
                />
              </View>
              <InviteQRModal
                visible={newQrOpen}
                onClose={() => setNewQrOpen(false)}
                title={`Join ${brand.gymName}`}
                subtitle={`Invite code · ${create.data}`}
                url={inviteUrl(origin, create.data)}
                primaryColor={brand.primaryColor}
              />
            </View>
          ) : null}
        </View>

        {showWalkIn ? (
          <>
            <View className="border-t border-gray-200 dark:border-gray-800" />
            <WalkInQRCard bare />
          </>
        ) : null}
      </View>

      <View className="gap-3 mt-4">
        <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
          {listTitle}
        </Text>
        {codes.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : null}
        {!codes.isLoading && visibleCodes.length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400">No invites yet.</Text>
        ) : null}
        {visibleCodes.map((c) => (
          <InviteCodeRow
            key={c.id}
            id={c.id}
            code={c.code}
            role={c.role}
            usedAt={c.used_at}
            canDelete={canDelete}
          />
        ))}
      </View>
    </>
  );
}

function InviteCodeRow({
  id,
  code,
  role,
  usedAt,
  canDelete,
}: {
  id: string;
  code: string;
  role: GymRole;
  usedAt: string | null;
  canDelete: boolean;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const brand = useGymBrand();
  const [qrOpen, setQrOpen] = useState(false);
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('invite_codes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-codes'] });
    },
  });

  // Used codes can't be redeemed again, so we hide the QR button for
  // them — showing it would suggest the link still works.
  const showQr = !usedAt;

  return (
    <View className="flex-row justify-between items-center bg-white dark:bg-gray-900 rounded-lg p-3 gap-3">
      <View className="flex-1">
        <Text className="text-gray-900 dark:text-gray-50 tracking-widest">
          {code}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase">
          {role}
        </Text>
      </View>
      <Text
        className={`text-xs ${
          usedAt ? 'text-gray-400 dark:text-gray-500' : 'text-primary'
        }`}>
        {usedAt ? 'used' : 'unused'}
      </Text>
      {showQr ? (
        <Pressable
          onPress={() => setQrOpen(true)}
          hitSlop={8}
          className="w-8 h-8 rounded-md items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
          <Ionicons name="qr-code-outline" size={18} color={colors.primary} />
        </Pressable>
      ) : null}
      {canDelete ? (
        <Pressable
          onPress={() => remove.mutate()}
          disabled={remove.isPending}
          hitSlop={8}
          className="w-8 h-8 rounded-md items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
          <Ionicons
            name="close"
            size={18}
            color={remove.isPending ? '#9CA3AF' : '#DC2626'}
          />
        </Pressable>
      ) : null}
      <InviteQRModal
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`Join ${brand.gymName}`}
        subtitle={`${role} invite · ${code}`}
        url={inviteUrl(origin, code)}
        primaryColor={brand.primaryColor}
      />
    </View>
  );
}
