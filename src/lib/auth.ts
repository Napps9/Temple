import type { Session } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  parseMembershipRow,
  type GymMembership,
  type MembershipRowInput,
} from './membership';
import { supabase } from './supabase';
import type { GymRole } from '@/types/database';

export type { GymMembership } from './membership';

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

export function useGymMembership() {
  const session = useSession();
  return useQuery({
    queryKey: ['gym-membership', session?.user.id],
    enabled: !!session?.user.id,
    // Membership rarely changes within a session, and refetching on
    // every observer remount is what produced the apparent "infinite
    // retry" loop on the deployed app: each useCan() call in a child
    // component attaches a new observer, and with staleTime: 0 (RQ's
    // default) the new observer triggered an immediate refetch even
    // though the prior fetch had succeeded. Pinning this lets RQ
    // serve the cached row to every observer without re-hitting the
    // network until someone explicitly invalidates (sign-out clears
    // the entire cache via useSignOut).
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<GymMembership | null> => {
      if (!session) return null;
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('gym_id, role, gyms ( name )')
        .eq('profile_id', session.user.id)
        .maybeSingle();
      if (error) throw error;
      return parseMembershipRow(data as MembershipRowInput | null);
    },
  });
}

export function useRole(): GymRole | null {
  const { data } = useGymMembership();
  return data?.role ?? null;
}

export function useMyProfile() {
  const session = useSession();
  return useQuery({
    queryKey: ['my-profile', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', session!.user.id)
        .single();
      if (error) throw error;
      return data as { full_name: string | null; avatar_url: string | null };
    },
  });
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
