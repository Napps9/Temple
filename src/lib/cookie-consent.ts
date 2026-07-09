import { Platform } from 'react-native';

// Web-only cookie/consent preference. Mirrors pending-checkout.ts's
// localStorage guard. 'accepted' | 'rejected'; absent means undecided (the
// banner shows). No analytics runs today — hasAnalyticsConsent() is the gate
// any future tracking init must check before loading, so a "reject" (or an
// undecided visitor) never gets non-essential storage.

const KEY = 'temple.cookieConsent';

export type CookieConsent = 'accepted' | 'rejected';

function store(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getCookieConsent(): CookieConsent | null {
  const s = store();
  if (!s) return null;
  const v = s.getItem(KEY);
  return v === 'accepted' || v === 'rejected' ? v : null;
}

export function setCookieConsent(value: CookieConsent): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(KEY, value);
  } catch {
    // best-effort; a full/blocked store just means the banner shows again
  }
}

export function hasAnalyticsConsent(): boolean {
  return getCookieConsent() === 'accepted';
}
