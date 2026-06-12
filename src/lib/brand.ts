// Pure brand helpers — colour normalisation, slug suggestion, logo
// fallback initial. The React hook that reads the gym's row from
// Supabase lives separately in useGymBrand.ts so this module stays
// free of React / RN deps and is unit-testable in vitest.

export const DEFAULT_BRAND = {
  primaryColor: '#2563EB',
  secondaryColor: '#0F172A',
  textColor: '#0F172A',
} as const;

export type GymBrand = {
  gymId: string | null;
  gymName: string;
  slug: string | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  publicSignupEnabled: boolean;
};

export const FALLBACK_BRAND: GymBrand = {
  gymId: null,
  gymName: 'Temple',
  slug: null,
  logoUrl: null,
  ...DEFAULT_BRAND,
  publicSignupEnabled: true,
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

// Construct the accept-invite URL for a specific code. Used by the
// per-invite QR so scanning it lands in the signup flow with the
// code pre-filled.
export function inviteUrl(origin: string, code: string): string {
  const cleanedOrigin = origin.replace(/\/+$/, '');
  return `${cleanedOrigin}/accept-invite?code=${encodeURIComponent(code)}`;
}
