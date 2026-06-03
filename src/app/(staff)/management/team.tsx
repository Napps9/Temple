import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSavedFlag } from '@/lib/useSavedFlag';
import type { GymRole } from '@/types/database';

// Owners can mint any role. Admins can mint coach / staff / member only
// — the create_invite RPC enforces this at the DB layer; the UI hides
// the disallowed options so the picker doesn't reveal a path the RPC
// will reject.
const ALL_ROLES: GymRole[] = ['owner', 'admin', 'coach', 'staff', 'member'];
const ADMIN_ROLES: GymRole[] = ['coach', 'staff', 'member'];

export default function TeamScreen() {
  const { data: membership } = useGymMembership();
  const callerRole = useRole();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<GymRole>('member');
  const [generated, markGenerated] = useSavedFlag();

  const roleOptions =
    callerRole === 'owner' ? ALL_ROLES : ADMIN_ROLES;

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
      markGenerated();
      queryClient.invalidateQueries({ queryKey: ['invite-codes'] });
    },
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Issue invite
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Pick a role and generate a code.
          </Text>
        </View>

        <View className="flex-row flex-wrap gap-2">
          {roleOptions.map((r) => {
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

        <Button
          onPress={() => create.mutate()}
          loading={create.isPending}
          success={generated}>
          Generate code
        </Button>

        {create.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(create.error, 'Could not generate code')}
          </Text>
        ) : null}

        {create.data ? (
          <View className="bg-primary/10 border border-primary/40 rounded-xl p-4 gap-1">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              New code (share with the invitee)
            </Text>
            <Text className="text-primary text-2xl tracking-widest">{create.data}</Text>
          </View>
        ) : null}

        <View className="gap-3 mt-4">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            All invites
          </Text>
          {codes.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
          ) : null}
          {codes.data?.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400">No invites yet.</Text>
          ) : null}
          {codes.data?.map((c) => (
            <View
              key={c.id}
              className="flex-row justify-between items-center bg-white dark:bg-gray-900 rounded-lg p-3">
              <View>
                <Text className="text-gray-900 dark:text-gray-50 tracking-widest">
                  {c.code}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase">
                  {c.role}
                </Text>
              </View>
              <Text
                className={`text-xs ${
                  c.used_at ? 'text-gray-400 dark:text-gray-500' : 'text-primary'
                }`}>
                {c.used_at ? 'used' : 'unused'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
