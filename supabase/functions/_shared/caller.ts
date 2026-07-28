// Who is asking, and are they allowed to ask about THIS gym.
//
// Every send-* worker took gym_id straight off the request body and never
// checked that the caller belonged to that gym. verify_jwt only proves the
// caller is *someone*, not that they are someone at this gym — so any
// authenticated Temple account could name another gym's id and learn how
// many of its members had a queued email. On send-payment-notifications the
// same body also carried `origin`, which becomes the only link in a
// gym-branded "we couldn't take your payment" email.
//
// send-invite already had the shape (it builds a caller-scoped client and
// does the privileged step as them); this is that, extracted.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export type CallerCheck =
  | { ok: true; profileId: string; role: string }
  | { ok: false; status: number; error: string };

export async function requireGymMember(
  req: Request,
  gymId: string,
  supabaseUrl: string,
  anonKey: string,
  serviceKey: string,
): Promise<CallerCheck> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return { ok: false, status: 401, error: 'Not signed in' };

  // Trusted server-to-server call. stripe-webhook invokes the payment
  // worker with the service key and no user in sight, so this has to be a
  // recognised caller rather than a hole — the key never leaves the
  // platform, and anything holding it can already read the table directly.
  if (authHeader === `Bearer ${serviceKey}`) {
    return { ok: true, profileId: '', role: 'service' };
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: uErr } = await caller.auth.getUser();
  const profileId = userRes?.user?.id;
  if (uErr || !profileId) {
    return { ok: false, status: 401, error: 'Not signed in' };
  }

  // Read the membership under the service role. The caller-scoped client
  // would work too, but only because gym_memberships happens to be
  // self-readable — leaning on that would make this check silently
  // dependent on a policy elsewhere.
  const service = createClient(supabaseUrl, serviceKey);
  const { data: membership } = await service
    .from('gym_memberships')
    .select('role')
    .eq('gym_id', gymId)
    .eq('profile_id', profileId)
    .is('left_at', null)
    .maybeSingle();

  if (!membership) {
    // Deliberately the same message and status as a bad gym id: a caller
    // who is not in the gym should not be able to tell "no such gym" from
    // "not your gym".
    return { ok: false, status: 403, error: 'Not authorised' };
  }
  return { ok: true, profileId, role: membership.role as string };
}

// Membership is the floor, not the ceiling. A worker whose response says
// anything about the gym's business needs the same capability as the screen
// that calls it, or every member gets an oracle: POST a gym id, read back
// how many of your gym-mates have a failing card.
//
// Checked through the CALLER's client so effective_can sees their auth.uid()
// and applies the same per-member overrides the UI does. The service-key
// caller passes straight through — cron and stripe-webhook have no user.
export async function requireGymCapability(
  req: Request,
  gymId: string,
  capability: string,
  supabaseUrl: string,
  anonKey: string,
  serviceKey: string,
): Promise<CallerCheck> {
  const who = await requireGymMember(req, gymId, supabaseUrl, anonKey, serviceKey);
  if (!who.ok || who.role === 'service') return who;

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data, error } = await caller.rpc('effective_can', {
    p_gym_id: gymId,
    p_capability: capability,
  });
  if (error || data !== true) {
    return { ok: false, status: 403, error: 'Not authorised' };
  }
  return who;
}

// A caller-supplied origin lands in an email as a clickable link, so it is
// not free text. Allow the configured app URL and the gym's own verified
// custom domain; anything else falls back rather than erroring, because a
// slightly wrong link is not worth failing a send over.
//
// The host-matching half is pure and mirrored in
// src/lib/safe-origin.test.ts — keep the two in sync (same arrangement as
// personalize.test.ts, which exists because these files are Deno-only).
export function originHost(
  supplied: string | undefined,
  fallback: string,
): string | null {
  const clean = (supplied ?? '').replace(/\/+$/, '');
  if (!clean || clean === fallback) return null;
  try {
    const u = new URL(clean);
    if (u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function hostAllowed(host: string, domain: string | null): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

export async function safeOrigin(
  supplied: string | undefined,
  gymId: string,
  supabaseUrl: string,
  serviceKey: string,
  fallback = 'https://app.jointemple.io',
): Promise<string> {
  const clean = (supplied ?? '').replace(/\/+$/, '');
  const host = originHost(supplied, fallback);
  if (!host) return clean === fallback ? clean : fallback;

  const service = createClient(supabaseUrl, serviceKey);
  const { data: domain } = await service
    .from('gym_sending_domains')
    .select('domain, status')
    .eq('gym_id', gymId)
    .maybeSingle();
  if (domain?.status === 'verified' &&
      hostAllowed(host, domain.domain as string | null)) {
    return clean;
  }

  const { data: site } = await service
    .from('gym_website_domains')
    .select('domain, status')
    .eq('gym_id', gymId)
    .maybeSingle();
  if (site?.status === 'verified' &&
      hostAllowed(host, site.domain as string | null)) {
    return clean;
  }

  return fallback;
}
