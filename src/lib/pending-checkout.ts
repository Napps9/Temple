import { Platform } from 'react-native';

// A short-lived, client-only marker that a Stripe checkout just
// completed for a gym. The webhook records the subscription a few
// seconds later, so the Membership and Account surfaces use this to
// show a "setting up your membership" state and poll until it lands.
//
// Stored in localStorage so it survives the full-page redirect back
// from Stripe and a later navigation to the Account screen. Checkout is
// web-only (useStartCheckout throws on native), so native is a no-op.

const TTL_MS = 15 * 60 * 1000;
const storageKey = (gymId: string) => `temple.pendingCheckout.${gymId}`;

function store(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function markPendingCheckout(gymId: string): void {
  store()?.setItem(storageKey(gymId), String(Date.now()));
}

export function clearPendingCheckout(gymId: string): void {
  store()?.removeItem(storageKey(gymId));
}

// True when a checkout completed within the TTL and hasn't been cleared
// (which happens once a current subscription is observed).
export function hasPendingCheckout(gymId: string | undefined): boolean {
  if (!gymId) return false;
  const raw = store()?.getItem(storageKey(gymId));
  if (!raw) return false;
  const ts = Number(raw);
  return Number.isFinite(ts) && Date.now() - ts <= TTL_MS;
}
