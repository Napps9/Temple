import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSavedFlag } from '@/lib/useSavedFlag';
import type { GymRole } from '@/types/database';

const ROLE_OPTIONS: GymRole[] = ['owner', 'coach', 'staff', 'member'];

function generateCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export default function TeamScreen() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<GymRole>('member');
  const [generated, markGenerated] = useSavedFlag();

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
      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) throw userErr ?? new Error('Not signed in');
      const code = generateCode();
      const { error } = await supabase.from('invite_codes').insert({
        gym_id: membership.gymId,
        code,
        role,
        created_by: userResp.user.id,
      });
      if (error) throw error;
      return code;
    },
    onSuccess: () => {
      markGenerated();
      queryClient.invalidateQueries({ queryKey: ['invite-codes'] });
    },
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6">
        <View className="gap-2">
          <Text className="text-gray-900 text-2xl font-semibold">Issue invite</Text>
          <Text className="text-gray-500">Pick a role and generate a code.</Text>
        </View>

        <View className="flex-row flex-wrap gap-2">
          {ROLE_OPTIONS.map((r) => {
            const selected = role === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                className={`px-4 py-2 rounded-full border ${
                  selected ? 'border-primary bg-primary/10' : 'border-gray-200'
                }`}>
                <Text className={selected ? 'text-primary' : 'text-gray-600'}>{r}</Text>
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
          <Text className="text-red-500 text-sm">
            {errorMessage(create.error, 'Could not generate code')}
          </Text>
        ) : null}

        {create.data ? (
          <View className="bg-primary/10 border border-primary/40 rounded-xl p-4 gap-1">
            <Text className="text-gray-500 text-sm">New code (share with the invitee)</Text>
            <Text className="text-primary text-2xl tracking-widest">{create.data}</Text>
          </View>
        ) : null}

        <View className="gap-3 mt-4">
          <Text className="text-gray-900 text-xl font-semibold">All invites</Text>
          {codes.isLoading ? <Text className="text-gray-500">Loading…</Text> : null}
          {codes.data?.length === 0 ? (
            <Text className="text-gray-500">No invites yet.</Text>
          ) : null}
          {codes.data?.map((c) => (
            <View
              key={c.id}
              className="flex-row justify-between items-center bg-white rounded-lg p-3">
              <View>
                <Text className="text-gray-900 tracking-widest">{c.code}</Text>
                <Text className="text-gray-500 text-xs uppercase">{c.role}</Text>
              </View>
              <Text className={`text-xs ${c.used_at ? 'text-gray-400' : 'text-primary'}`}>
                {c.used_at ? 'used' : 'unused'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
