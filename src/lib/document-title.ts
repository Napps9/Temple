import { useSyncExternalStore } from 'react';

// The browser tab. Expo Router turns React Navigation's document title
// off and the static export writes an empty <title>, so every tab read as
// the bare URL. The root layout renders the title through expo-router's
// Head from two sources: the section, read off the path, and the page's
// own heading when PageHead has rendered one for this path. Going through
// Head rather than document.title means the static export carries the
// section title too, and react-helmet never overwrites a value it does
// not own.

const SUFFIX = 'Temple';

const SECTIONS: Record<string, string> = {
  timeline: 'Timeline',
  classes: 'Classes',
  programming: 'Programming',
  analysis: 'Analysis',
  management: 'Manage',
  setup: 'Setup',
  book: 'Book',
  bookings: 'Bookings',
  track: 'Track',
  inbox: 'Messages',
  account: 'Account',
  membership: 'Membership',
  store: 'Store',
  purchases: 'Purchases',
  family: 'Family',
  athlete: 'Athlete',
  consent: 'Consent',
  waiver: 'Waiver',
  parq: 'Health check',
  onboarding: 'Welcome',
  'sign-in': 'Sign in',
  'get-started': 'Get started',
  'create-gym': 'Start a gym',
  'forgot-password': 'Forgot password',
  'reset-password': 'Reset password',
  'accept-invite': 'Invite',
  'start-solo': 'Train solo',
  welcome: 'Welcome',
  join: 'Join',
  lead: 'Enquire',
  trial: 'Free trial',
  privacy: 'Privacy',
  terms: 'Terms',
  'email-preferences': 'Email preferences',
};

type Claim = { pathname: string; title: string } | null;

let claim: Claim = null;
const listeners = new Set<() => void>();

export function claimDocumentTitle(pathname: string, title: string): void {
  if (claim?.pathname === pathname && claim.title === title) return;
  claim = { pathname, title };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function useClaim(): Claim {
  return useSyncExternalStore(
    subscribe,
    () => claim,
    () => null,
  );
}

export function sectionTitle(pathname: string): string | null {
  const first = pathname.split('/').filter(Boolean)[0];
  return first ? (SECTIONS[first] ?? null) : null;
}

export function documentTitle(pathname: string, claimed: Claim): string {
  const page = claimed?.pathname === pathname ? claimed.title : sectionTitle(pathname);
  return page ? `${page} · ${SUFFIX}` : SUFFIX;
}

export function useDocumentTitle(pathname: string): string {
  return documentTitle(pathname, useClaim());
}
