import { AIMark } from '@/components/AIMark';
import type { IconSlot } from '@/components/icon-slot';
import { useGymMembership } from '@/lib/auth';
import { useCan } from '@/lib/useCan';

export type GymNavLink = {
  href: string;
  label: string;
  icon: IconSlot;
};

// The gym's own destinations, as the persistent nav names them — the
// rail's "The gym" group at 1024+, the Manage pill's sheet below. One
// list so the two surfaces cannot drift.
//
// Each destination carries the gate its own page checks. A nav that
// showed a coach a link they cannot open would be worse than not having
// the link.
export function useGymNavLinks(): GymNavLink[] {
  const { data: membership } = useGymMembership();
  const canManageTags = useCan('can_manage_tags') ?? false;
  const canManagePlans = useCan('can_manage_plans') ?? false;
  const canManageComms = useCan('can_manage_comms') ?? false;
  const canWorkLeads = useCan('can_work_leads') ?? false;
  const canManageWebsite = useCan('can_manage_website') ?? false;
  const isOwner = membership?.role === 'owner';

  return [
    // Same gate as the page's own redirect (members.tsx) — a coach shown
    // this link was bounced straight back to /management.
    ...(canManageTags
      ? [
          {
            href: '/management/members',
            label: 'Members',
            icon: 'people-outline' as const,
          },
        ]
      : []),
    ...(canManagePlans
      ? [{ href: '/management/plans', label: 'Plans', icon: 'card-outline' as const }]
      : []),
    ...(canManageComms
      ? [
          {
            href: '/management/communications',
            label: 'Communications',
            icon: 'mail-outline' as const,
          },
        ]
      : []),
    ...(canWorkLeads
      ? [
          {
            href: '/management/leads',
            label: 'AI Front Desk',
            icon: <AIMark />,
          },
        ]
      : []),
    ...(canManageWebsite
      ? [
          {
            href: '/management/website',
            label: 'Website',
            icon: 'globe-outline' as const,
          },
        ]
      : []),
    ...(isOwner
      ? [
          {
            href: '/management/billing',
            label: 'Billing',
            icon: 'cash-outline' as const,
          },
        ]
      : []),
  ];
}
