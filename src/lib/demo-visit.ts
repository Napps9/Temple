import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { normaliseRoute } from './route-usage';
import { readSelectedGym } from './selected-gym';
import { supabase } from './supabase';

// The second half of the marketing funnel (0279).
//
// A visitor reads jointemple.io, presses "Use this account", and the
// credentials are postMessage'd into an iframe of the real sign-in screen.
// Everything after that happens on a different origin, inside a frame the
// marketing page is not allowed to read — so the site's last observation is
// "credentials were sent". Whether they signed in, and what they went and
// looked at, can only be recorded from in here.
//
// DEMO TENANTS ONLY, and that is enforced server-side rather than here:
// record_demo_event refuses any gym that is not is_demo (0278). The client
// checks too, but only to avoid a pointless round-trip on every navigation
// in every real gym — the guard that matters is the one a client cannot
// skip. route_opens (0233) is deliberately untouched by any of this: it
// promised in its own migration never to be able to say who opened a
// screen, and a visitor id anywhere near it would break that.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deliberately a module variable and not storage. The visitor signs in
// inside the iframe and browses in that one SPA session, so nothing needs
// to survive a reload — and the app's origin gains no new key on anybody's
// device, which is what lets the aggregate half of this run without a
// consent banner at all.
let visitor: string | null = null;

export function setDemoVisitor(id: unknown): void {
  visitor = typeof id === 'string' && UUID.test(id) ? id : null;
}

export function demoVisitor(): string | null {
  return visitor;
}

export function recordDemoEvent(
  gymId: string,
  event: string,
  page: string,
): void {
  void supabase.rpc('record_demo_event', {
    p_gym_id: gymId,
    p_event: event,
    p_page: page,
    p_visitor: visitor,
  });
}

/**
 * The step between "pressed the button on the marketing site" and "looked
 * at something" — which is where a sign-in that silently failed shows up as
 * a drop rather than as nothing.
 *
 * Called only when the marketing site named a screen to land on, so an
 * ordinary sign-in pays nothing for it. The gym has to be looked up because
 * at this moment the membership query has not run yet; every guard that
 * matters is still server-side.
 */
export async function recordDemoAuthentication(page: string): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    const [{ data }, chosen] = await Promise.all([
      supabase
        .from('gym_memberships')
        .select('gym_id')
        .eq('profile_id', userId)
        .is('left_at', null)
        .order('created_at', { ascending: true }),
      readSelectedGym(userId),
    ]);
    const rows = data ?? [];
    const gymId = (rows.find((r) => r.gym_id === chosen) ?? rows[0])?.gym_id;
    if (gymId) recordDemoEvent(gymId, 'demo_authenticated', page);
  } catch {
    // A counter must never be the reason a sign-in appears to fail.
  }
}

/**
 * Record every screen a demo visitor opens.
 *
 * Same shape as useRouteOpens in the staff layout, and for the same reason
 * documented there: a ref rather than state, because a layout that
 * re-renders on every navigation commit is what once crashed production
 * with React #185. It renders nothing and swallows everything — a counter
 * must never be the reason a screen change fails.
 *
 * Unlike useRouteOpens this is not limited to staff surfaces. /book and
 * /track are two of the ten screens the marketing site can land a visitor
 * on, and both are member routes, so limiting this the same way would make
 * two of the five tour stops invisible.
 */
export function useDemoViews(
  gymId: string | null | undefined,
  isDemo: boolean,
): void {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!gymId || !isDemo) return;
    const route = normaliseRoute(pathname);
    if (route === last.current) return;
    last.current = route;
    recordDemoEvent(gymId, 'demo_stop_viewed', route);
  }, [pathname, gymId, isDemo]);
}
