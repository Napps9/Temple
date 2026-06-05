import type { Session } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import {
  parseMembershipRow,
  type GymMembership,
  type MembershipRowInput,
} from './membership';
import { supabase } from './supabase';
import type { GymRole } from '@/types/database';

export type { GymMembership } from './membership';

// Module-level session state, shared across every useSession() caller.
//
// Before this was an in-component useState(undefined), which produced
// a subtle navigation bug: when (auth)/_layout unmounted and
// (staff)/_layout mounted (e.g. an owner being redirected from
// /sign-in to /classes), the new layout's useSession started fresh at
// undefined for one render. useGymMembership's queryKey includes
// session.user.id, so during that render the key was
// ['gym-membership', undefined] — a cache miss against the
// ['gym-membership', <uuid>] entry the prior layout had populated.
// useCan therefore saw role: null and returned false, and the staff
// layout's `if (canAccessStaff === false)` redirect bounced the owner
// straight back to /book before the layout's own useSession effect
// had a chance to resolve.
//
// useSyncExternalStore + a single module-level currentSession means
// every component reads the same value synchronously, so the moment
// onAuthStateChange fires, every layout sees it on the next render.

let currentSession: Session | null | undefined = undefined;
const sessionListeners = new Set<() => void>();
let sessionInitialised = false;

function notifySessionListeners(): void {
  for (const listener of sessionListeners) listener();
}

function ensureSessionInitialised(): void {
  if (sessionInitialised) return;
  sessionInitialised = true;
  supabase.auth.getSession().then(({ data }) => {
    currentSession = data.session;
    notifySessionListeners();
  });
  supabase.auth.onAuthStateChange((_event, next) => {
    currentSession = next;
    notifySessionListeners();
  });
}

function subscribeSession(listener: () => void): () => void {
  ensureSessionInitialised();
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function getSessionSnapshot(): Session | null | undefined {
  return currentSession;
}

export function useSession(): Session | null | undefined {
  return useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getSessionSnapshot,
  );
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
