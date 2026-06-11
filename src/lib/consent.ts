import { useQuery } from '@tanstack/react-query';

import { useGymMembership, useSession } from './auth';
import { supabase } from './supabase';

// The version of the data-processing consent text members agree to.
// Bumping this string re-gates everyone: the entry check looks for a
// member_consents row matching the current version, so a new policy
// forces re-consent on next entry. Keep it in sync with the copy shown
// on the consent screen.
export const CONSENT_POLICY_VERSION = '2026-01';

// The clauses presented on the consent screen. Each must be ticked.
export const CONSENT_CLAUSES: { key: string; label: string }[] = [
  {
    key: 'processing',
    label:
      'I consent to my gym storing and processing my health information ' +
      '(PAR-Q answers and any injuries I log) to keep my training safe.',
  },
  {
    key: 'staff_access',
    label:
      'I understand my coaches and gym admins can see this health ' +
      'information, and that every access is logged.',
  },
  {
    key: 'retention',
    label:
      'I understand my health data is erased when I leave the gym, and ' +
      'at the latest three months after my membership ends.',
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
