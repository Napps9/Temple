import type { Session } from '@supabase/supabase-js';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
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
      // Oldest active membership wins. .maybeSingle() here once turned a
      // double-membership (a data bug the RPCs now prevent) into a thrown
      // error, which routed the user to /welcome — whose only CTA mints
      // yet another gym. limit(1) degrades gracefully instead.
      // gyms!gym_id pins the embed to the direct gym_id FK. Without the
      // hint PostgREST throws "more than one relationship was found for
      // 'gym_memberships' and 'gyms'" — the composite (gym_id, profile_id)
      // FKs that newer tables point at gym_memberships gave it a second
      // candidate join path, and an ambiguous embed is an ERROR, which
      // broke sign-in routing everywhere (prod + local) at once.
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('gym_id, role, gyms!gym_id ( name )')
        .eq('profile_id', session.user.id)
        .is('left_at', null)
        .order('created_at', { ascending: true })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] ?? null;
      return parseMembershipRow(row as MembershipRowInput | null);
    },
  });
}

export function useRole(): GymRole | null {
  const { data } = useGymMembership();
  return data?.role ?? null;
}

// The one sanctioned way to update the membership cache after a
// mutation changes it (create gym, join gym, leave gym). Refetch — not
// invalidate — and await it: useGymMembership is pinned to
// refetchOnMount: false, and navigation usually reads the result
// immediately after, so a passive invalidate leaves the redirect
// reading the stale row (the /welcome bounce loop).
export async function refreshMembership(queryClient: QueryClient): Promise<void> {
  await queryClient.refetchQueries({ queryKey: ['gym-membership'] });
}

export function useMyProfile() {
  const session = useSession();
  return useQuery({
    queryKey: ['my-profile', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      // Phone lives on member_contact_details (0179) — off profiles, which
      // every gym-mate can read. Self-only RLS there, so this is one row.
      const [{ data, error }, { data: contact }] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, avatar_url')
          .eq('id', session!.user.id)
          .single(),
        supabase
          .from('member_contact_details')
          .select('phone')
          .eq('profile_id', session!.user.id)
          .maybeSingle(),
      ]);
      if (error) throw error;
      return {
        ...(data as { full_name: string | null; avatar_url: string | null }),
        phone: contact?.phone ?? null,
      };
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

// Where Supabase redirects after the user clicks the email-confirmation
// link. On web, send them to /sign-in — the account now exists and just
// needs a login; without this the link lands on the Site URL root, which
// drops a logged-out visitor on the marketing landing. Native falls back
// to the project Site URL.
export function confirmRedirectTo(): string | undefined {
  return typeof window !== 'undefined'
    ? `${window.location.origin}/sign-in`
    : undefined;
}

// Where Supabase redirects after the user clicks the password-reset link
// — the app screen that turns the recovery token into a session and lets
// them set a new password. Same native fallback as confirmRedirectTo:
// undefined defers to the project Site URL.
function resetRedirectTo(): string | undefined {
  return typeof window !== 'undefined'
    ? `${window.location.origin}/reset-password`
    : undefined;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: resetRedirectTo(),
  });
  if (error) throw error;
}

export type AcceptInviteResult =
  | { status: 'accepted' }
  | { status: 'pending_confirmation'; email: string };

export async function acceptInvite(
  code: string,
  email: string,
  password: string,
  fullName: string,
): Promise<AcceptInviteResult> {
  const trimmedEmail = email.trim().toLowerCase();

  // Invited users have already proved they own the address by clicking the
  // link we emailed there, so we skip the (globally-on) email-confirmation
  // step: the accept-invite edge function creates the account pre-confirmed
  // via the admin API — gated on a valid, unused invite code — and we sign
  // straight in. on_auth_user_created (0042) builds the profiles row from the
  // full_name metadata, then accept_invite binds the membership.
  const { error } = await supabase.functions.invoke('accept-invite', {
    body: { code, email: trimmedEmail, password, full_name: fullName },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let msg = error.message;
    let errCode: string | undefined;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const b = await ctx.json();
        if (b?.error) msg = String(b.error);
        if (b?.code) errCode = String(b.code);
      } catch {
        // not JSON — keep the generic message
      }
    }
    // The address already has an account — a double-submit, a first
    // attempt that created the account but got interrupted before the
    // membership bound, or a returning invitee. The invite code is the
    // authorisation, so if the password they typed unlocks that account,
    // sign them in and bind the membership rather than dead-ending them
    // on "sign in to accept". Only a genuinely wrong password falls
    // through to that message.
    if (errCode === 'account_exists' || /already exists/i.test(msg)) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (!signInErr) {
        const { error: rpcError } = await supabase.rpc('accept_invite', {
          invite_code: code,
        });
        // A consumed code here means a prior attempt already bound this
        // account's membership — they're in, so treat it as accepted.
        if (rpcError && !/already used/i.test(rpcError.message)) throw rpcError;
        await clearPendingInviteMetadata();
        return { status: 'accepted' };
      }
    }
    throw new Error(msg);
  }

  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });
  if (signInErr) throw signInErr;

  const { error: rpcError } = await supabase.rpc('accept_invite', { invite_code: code });
  if (rpcError) throw rpcError;
  await clearPendingInviteMetadata();
  return { status: 'accepted' };
}

// Accept an invite from an already-authenticated session (a member who
// opens an invite link while signed in — one tap, no signup).
export async function joinGymByInvite(code: string): Promise<void> {
  const { error } = await supabase.rpc('accept_invite', { invite_code: code });
  if (error) throw error;
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => queryClient.clear(),
  });
}

// Self-serve gym creation. Signs the visitor up as an auth user,
// createGymWithSignup + joinGymWithSignup both call supabase.auth.signUp
// followed immediately by an RPC that needs auth.uid(). On Supabase
// projects with email confirmation enabled, signUp returns a user but
// session: null — the RPC then fails with "Not signed in". The helpers
// below either establish a session by signing in (confirmations off),
// surface a recovery-ready 'pending_confirmation' state (confirmations
// on), or throw a clear error otherwise.
type SessionResolution =
  | { status: 'signed_in' }
  | { status: 'pending_confirmation' };

async function ensureSessionAfterSignUp(
  email: string,
  password: string,
  session: unknown,
): Promise<SessionResolution> {
  if (session) return { status: 'signed_in' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return { status: 'signed_in' };
  // Email-confirmation gate: Supabase returns either "Email not
  // confirmed" or the obfuscated "Invalid login credentials" (so account
  // existence isn't leaked) — both mean the same thing for our flow.
  if (/confirm/i.test(error.message) || /invalid login/i.test(error.message)) {
    return { status: 'pending_confirmation' };
  }
  throw error;
}

// Resend a confirmation email for a signup that hasn't been verified.
// Used by the create-gym "Check your email" panel and the sign-in
// recovery hint.
export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) throw error;
}

export type CreateGymWithSignupResult =
  | { status: 'created'; gymId: string }
  | { status: 'pending_confirmation'; email: string };

// Create the gym from an authenticated session. Shared by the
// immediate-signup path and the post-confirmation resume. It used to
// stamp three brand colours onto the new gym straight afterwards.
async function createGym(args: { name: string; slug: string }): Promise<string> {
  const { data: gymId, error } = await supabase.rpc('create_gym', {
    p_name: args.name,
    p_slug: args.slug,
  });
  if (error) throw error;
  return gymId as unknown as string;
}

// creates a profiles row + the gym + the owner membership. When email
// confirmation is required, returns 'pending_confirmation' instead — the
// gym name and slug are stashed in user_metadata so the post-confirmation
// resume finishes the job in one tap.
export async function createGymWithSignup(
  args: {
    email: string;
    password: string;
    fullName: string;
    gymName: string;
    gymSlug: string;
  },
): Promise<CreateGymWithSignupResult> {
  const { email, password, fullName, gymName, gymSlug } = args;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmRedirectTo(),
      data: {
        full_name: fullName,
        pending_gym_name: gymName,
        pending_gym_slug: gymSlug,
      },
    },
  });
  if (error) throw error;
  const resolved = await ensureSessionAfterSignUp(email, password, data.session);
  if (resolved.status === 'pending_confirmation') {
    return { status: 'pending_confirmation', email };
  }
  const gymId = await createGym({ name: gymName, slug: gymSlug });
  await clearPendingGymMetadata();
  return { status: 'created', gymId };
}

// Called after the post-confirmation create_gym so the pending hints
// don't keep showing up on the welcome screen. Failure isn't fatal —
// the metadata is just a hint, the gym already exists.
async function clearPendingGymMetadata(): Promise<void> {
  try {
    await supabase.auth.updateUser({
      data: {
        pending_gym_name: null,
        pending_gym_slug: null,
      },
    });
  } catch {
    // Ignore — best effort.
  }
}

// Reads the pending-gym hint left by createGymWithSignup. The welcome
// page uses this to offer a one-tap "finish creating <name>" instead
// of making the user re-enter everything after email confirmation.
export function pendingGymFromSession(
  session: { user: { user_metadata?: Record<string, unknown> | null } } | null,
): { name: string; slug: string } | null {
  const meta = session?.user.user_metadata ?? null;
  if (!meta) return null;
  const name = typeof meta.pending_gym_name === 'string' ? meta.pending_gym_name : '';
  const slug = typeof meta.pending_gym_slug === 'string' ? meta.pending_gym_slug : '';
  if (!name || !slug) return null;
  return { name, slug };
}

// Finishes a gym creation deferred by email confirmation: the user has
// now signed in, so create the gym they named before confirming.
export async function completePendingGym(
  args: { name: string; slug: string },
): Promise<{ gymId: string }> {
  const gymId = await createGym(args);
  await clearPendingGymMetadata();
  return { gymId };
}

// Joining via a public /join/[slug] link. Signs up a new auth user
// and calls join_gym_by_slug to create the member membership.
export async function joinGymWithSignup(args: {
  email: string;
  password: string;
  fullName: string;
  slug: string;
}): Promise<
  | { status: 'joined'; gymId: string }
  | { status: 'pending_confirmation'; email: string }
> {
  const { email, password, fullName, slug } = args;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmRedirectTo(),
      data: { full_name: fullName, pending_join_slug: slug },
    },
  });
  if (error) throw error;
  const resolved = await ensureSessionAfterSignUp(email, password, data.session);
  if (resolved.status === 'pending_confirmation') {
    return { status: 'pending_confirmation', email };
  }
  const { data: gymId, error: rpcError } = await supabase.rpc('join_gym_by_slug', {
    p_slug: slug,
  });
  if (rpcError) throw rpcError;
  await clearPendingJoinMetadata();
  return { status: 'joined', gymId: gymId as unknown as string };
}

// Joining a gym from an already-authenticated session (e.g. an
// owner adding themselves to a second gym they discovered via a
// link). Doesn't touch profiles or auth.
export async function joinGymBySlug(slug: string): Promise<{ gymId: string }> {
  const { data, error } = await supabase.rpc('join_gym_by_slug', {
    p_slug: slug,
  });
  if (error) throw error;
  return { gymId: data as unknown as string };
}

// Clears the pending-join hint once the membership exists.
async function clearPendingJoinMetadata(): Promise<void> {
  try {
    await supabase.auth.updateUser({ data: { pending_join_slug: null } });
  } catch {
    // Ignore — best effort.
  }
}

// Reads the pending-join hint left by joinGymWithSignup when email
// confirmation deferred the join. Mirror of pendingGymFromSession.
export function pendingJoinFromSession(
  session: { user: { user_metadata?: Record<string, unknown> | null } } | null,
): { slug: string } | null {
  const meta = session?.user.user_metadata ?? null;
  const slug =
    typeof meta?.pending_join_slug === 'string' ? meta.pending_join_slug : '';
  return slug ? { slug } : null;
}

// Finishes a join deferred by email confirmation: bind the membership
// from the saved slug now that the user has signed in.
export async function completePendingJoin(args: {
  slug: string;
}): Promise<{ gymId: string }> {
  const { data, error } = await supabase.rpc('join_gym_by_slug', {
    p_slug: args.slug,
  });
  if (error) throw error;
  await clearPendingJoinMetadata();
  return { gymId: data as unknown as string };
}

// Redeeming a trial link as a brand-new person. Signs up, then claims
// the free class — which HOLDS the seat rather than booking it: the
// waiver, PAR-Q and consent are still signed by their own hand first,
// and the booking happens on the far side of those screens.
//
// Public links go through ordinary signUp with email confirmation. A
// posted link proves nothing about the address typed next to it, so it
// must not reach the pre-confirmed account path an addressed invite
// earns.
export async function redeemTrialWithSignup(args: {
  email: string;
  password: string;
  fullName: string;
  token: string;
  sessionId?: string | null;
}): Promise<
  | { status: 'claimed'; gymId: string; sessionId: string | null }
  | { status: 'pending_confirmation'; email: string }
> {
  const { email, password, fullName, token, sessionId } = args;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmRedirectTo(),
      data: {
        full_name: fullName,
        pending_trial_token: token,
        pending_trial_session: sessionId ?? null,
      },
    },
  });
  if (error) throw error;
  const resolved = await ensureSessionAfterSignUp(email, password, data.session);
  if (resolved.status === 'pending_confirmation') {
    return { status: 'pending_confirmation', email };
  }
  return completePendingTrial({ token, sessionId: sessionId ?? null });
}

// Claims a trial link from a session that already exists — somebody
// signed in, or somebody who just confirmed their email.
export async function completePendingTrial(args: {
  token: string;
  sessionId: string | null;
}): Promise<{ status: 'claimed'; gymId: string; sessionId: string | null }> {
  const { data, error } = await supabase.rpc('redeem_trial_pass', {
    p_token: args.token,
    p_session_id: args.sessionId,
  });
  if (error) throw error;
  const claim = (data ?? {}) as { gym_id?: string; session_id?: string | null };
  await clearPendingTrialMetadata();
  return {
    status: 'claimed',
    gymId: (claim.gym_id ?? '') as string,
    sessionId: claim.session_id ?? null,
  };
}

async function clearPendingTrialMetadata(): Promise<void> {
  try {
    await supabase.auth.updateUser({
      data: { pending_trial_token: null, pending_trial_session: null },
    });
  } catch {
    // Ignore — best effort.
  }
}

// Reads the pending-trial hint left by redeemTrialWithSignup when email
// confirmation deferred the claim. Mirror of pendingJoinFromSession.
export function pendingTrialFromSession(
  session: { user: { user_metadata?: Record<string, unknown> | null } } | null,
): { token: string; sessionId: string | null } | null {
  const meta = session?.user.user_metadata ?? null;
  const token =
    typeof meta?.pending_trial_token === 'string' ? meta.pending_trial_token : '';
  if (!token) return null;
  const sid = meta?.pending_trial_session;
  return { token, sessionId: typeof sid === 'string' ? sid : null };
}

// Clears the pending-invite hint once the membership exists.
async function clearPendingInviteMetadata(): Promise<void> {
  try {
    await supabase.auth.updateUser({ data: { pending_invite_code: null } });
  } catch {
    // Ignore — best effort.
  }
}

// Reads the pending-invite hint left by acceptInvite when email
// confirmation deferred binding the invite. Mirror of pendingJoinFromSession.
export function pendingInviteFromSession(
  session: { user: { user_metadata?: Record<string, unknown> | null } } | null,
): { code: string } | null {
  const meta = session?.user.user_metadata ?? null;
  const code =
    typeof meta?.pending_invite_code === 'string' ? meta.pending_invite_code : '';
  return code ? { code } : null;
}

// Finishes an invite deferred by email confirmation: apply the stashed
// code now that the user has signed in.
export async function completePendingInvite(args: { code: string }): Promise<void> {
  const { error } = await supabase.rpc('accept_invite', { invite_code: args.code });
  if (error) throw error;
  await clearPendingInviteMetadata();
}
