import { useQuery } from '@tanstack/react-query';

import { useGymMembership, useSession } from './auth';
import { supabase } from './supabase';

// The version of the data-processing consent text members agree to.
// Bumping this string re-gates everyone: the entry check looks for a
// member_consents row matching the current version, so a new policy
// forces re-consent on next entry. Keep it in sync with the copy shown
// on the consent screen.
export const CONSENT_POLICY_VERSION = '2026-07';

// Whole years between an ISO `YYYY-MM-DD` date of birth and today. Returns
// null for a malformed string. The server enforces the same rule from
// profiles.date_of_birth (migration 0110) — this is for the UI.
export function computeAge(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const today = new Date();
  let age = today.getFullYear() - y;
  const beforeBirthday =
    today.getMonth() + 1 < mo ||
    (today.getMonth() + 1 === mo && today.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function isMinor(iso: string): boolean {
  const age = computeAge(iso);
  return age != null && age < 18;
}

// The clauses presented on the consent screen. Each must be ticked.
// Wording is aligned with docs/legal/privacy-policy.md and docs/legal/dpa.md
// — a material change here must bump CONSENT_POLICY_VERSION above so members
// re-consent against the new text.
export const CONSENT_CLAUSES: { key: string; label: string }[] = [
  {
    key: 'processing',
    label:
      'I give my explicit consent to my gym collecting and processing my ' +
      'health information — my PAR-Q screening answers and any injuries I ' +
      'record — to keep my training safe. I understand this is ' +
      'special-category data.',
  },
  {
    key: 'staff_access',
    label:
      'I understand the coaches and admins at my gym can view this health ' +
      'information to support my training, and that every access is recorded ' +
      'in an audit log.',
  },
  {
    key: 'retention',
    label:
      'I understand I can withdraw this consent at any time from my account, ' +
      'which erases my health data, and that it is in any case erased when I ' +
      'leave the gym and no later than three months after my membership ends.',
  },
];

// Whether the signed-in member has recorded consent for the active
// policy version. Sole owner of the ['member-consent'] key. Staff are
// allowed in without it being loaded (the gate only enforces for
// members), but the query runs for anyone with a membership so the
// account screen can show consent status.
export function useConsentState() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['member-consent', membership?.gymId, session?.user.id],
    enabled: !!session?.user.id && !!membership?.gymId,
    queryFn: async (): Promise<{ consented: boolean }> => {
      const { data, error } = await supabase
        .from('member_consents')
        .select('id')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', session!.user.id)
        .eq('policy_version', CONSENT_POLICY_VERSION)
        .maybeSingle();
      if (error) throw error;
      return { consented: data != null };
    },
  });
}
