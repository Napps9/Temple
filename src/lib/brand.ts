// Pure gym helpers — slug suggestion, the share URLs, and the hex
// normaliser the content colour pickers use. The React hook that reads
// the gym's row from Supabase lives separately in useGymBrand.ts so this
// module stays free of React / RN deps and is unit-testable in vitest.

// Who a gym is. Colours and logos used to live here too — a gym set six
// hexes and uploaded two logos, and the app rendered itself in them.
// Temple's chrome is Temple's now, so a gym is its name and its slug.
export type GymIdentity = {
  gymId: string | null;
  gymName: string;
  slug: string | null;
  publicSignupEnabled: boolean;
  // 0278 — a public demo tenant. The guards that matter live server-side,
  // at the point each edge function calls a vendor. This exists for the one
  // path no server guard of ours can reach: changing an account's email,
  // where Supabase Auth sends the mail and no code in this repo makes the
  // call. On a shared demo tenant a confirmed change would also move the
  // owner's login out from under the published credentials.
  //
  // Deliberately NOT used for the magic link on a gym's public join page,
  // or for the password reset on the sign-in screen. Those are self-service
  // auth flows any stranger can use for any address from anywhere; the gym
  // in the URL does not cause them, so a demo gym is not what makes them
  // reachable.
  isDemo: boolean;
};

export const FALLBACK_GYM: GymIdentity = {
  gymId: null,
  gymName: 'Temple',
  slug: null,
  publicSignupEnabled: true,
  // Not-yet-loaded is not a demo gym: this fallback is what every signed-in
  // member sees for a moment on first paint, and refusing their email change
  // for that moment would be a bug in every real gym.
  isDemo: false,
};

// Normalise a hex input the user typed into the colour fields:
//   - prepends '#'
//   - upper-cases
//   - returns null when the value isn't a valid 6-char hex (so the
//     UI can keep the draft string while disabling Save).
export function normaliseHex(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, '');
  if (!/^[0-9A-Fa-f]{6}$/.test(trimmed)) return null;
  return `#${trimmed.toUpperCase()}`;
}

// Lowercased, regex-cleaned slug suggestion from a gym name. Keep the
// rule in sync with the SQL helper inside create_gym / set_gym_slug
// so the client preview matches what the server stores.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// First grapheme of the gym name in upper-case, for the placeholder
// avatar fallback when no logo is uploaded.
export function gymInitial(name: string): string {
  const t = name.trim();
  if (!t) return 'T';
  return t.charAt(0).toUpperCase();
}

// Construct the public join URL the gym can share with members.
// `origin` is provided by the caller so we don't need to read the
// window in lib code (keeps it unit-testable on RN).
export function joinUrl(origin: string, slug: string): string {
  const cleanedOrigin = origin.replace(/\/+$/, '');
  return `${cleanedOrigin}/join/${slug}`;
}

// Public lead-capture URL for a gym slug — the shareable "enquire"
// link distinct from the member join link.
export function leadUrl(origin: string, slug: string): string {
  const cleanedOrigin = origin.replace(/\/+$/, '');
  return `${cleanedOrigin}/lead/${slug}`;
}

// Construct the accept-invite URL for a specific code. Used by the
// per-invite QR so scanning it lands in the signup flow with the
// code pre-filled.
export function inviteUrl(origin: string, code: string): string {
  const cleanedOrigin = origin.replace(/\/+$/, '');
  return `${cleanedOrigin}/accept-invite?code=${encodeURIComponent(code)}`;
}

// The trial-link URL for a minted token. One route serves both shapes —
// a poster link anyone can claim and a link sent to one prospect — so
// what the page shows is decided by the token, not the URL.
export function trialUrl(origin: string, token: string): string {
  const cleanedOrigin = origin.replace(/\/+$/, '');
  return `${cleanedOrigin}/trial/${encodeURIComponent(token)}`;
}

// Convert "#14161A" → "20 22 26" (space-separated RGB triplet) for the
// CSS variables Tailwind splices into `rgb(... / <alpha-value>)`. Only
// ThemedShell calls it, to push ACCENT into the `primary` token.
const FALLBACK_TRIPLET = '194 65 12';

export function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace(/^#/, '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return FALLBACK_TRIPLET;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}
