import type { Session } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { supabase } from './supabase';
import type { GymRole } from '@/types/database';

export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return session;
}

export type GymMembership = {
  gymId: string;
  gymName: string;
  role: GymRole;
};

export function useGymMembership() {
  const session = useSession();
  return useQuery({
    queryKey: ['gym-membership', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<GymMembership | null> => {
      if (!session) return null;
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('gym_id, role, status, gyms ( name )')
        .eq('profile_id', session.user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const gymName = Array.isArray(data.gyms) ? data.gyms[0]?.name : data.gyms?.name;
      return {
        gymId: data.gym_id,
        gymName: gymName ?? '',
        role: data.role,
      };
    },
  });
}

export function useRole(): GymRole | null {
  const { data } = useGymMembership();
  return data?.role ?? null;
}

export function isStaffRole(role: GymRole | null | undefined): boolean {
  return role === 'owner' || role === 'coach' || role === 'staff';
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function acceptInvite(
  code: string,
  email: string,
  password: string,
  fullName: string,
) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (data.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: data.user.id, full_name: fullName });
    if (profileError) throw profileError;
  }
  const { error: rpcError } = await supabase.rpc('accept_invite', { invite_code: code });
  if (rpcError) throw rpcError;
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => queryClient.clear(),
  });
}
