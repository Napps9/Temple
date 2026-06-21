import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { InviteSection } from '@/components/InviteSection';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { can, type Capability } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { GymRole } from '@/types/database';

// Owners can mint any staff role. Admins can mint coach / staff only
// — the create_invite RPC enforces this at the DB layer; the UI hides
// the disallowed options so the picker doesn't reveal a path the RPC
// will reject. Member invites live on the Members screen.
const OWNER_STAFF_ROLES: GymRole[] = ['owner', 'admin', 'coach', 'staff'];
const ADMIN_STAFF_ROLES: GymRole[] = ['coach', 'staff'];

const CONFIGURABLE_ROLES: GymRole[] = ['admin', 'coach', 'staff', 'member'];

type CapabilityGroup = {
  title: string;
  caps: { value: Capability; label: string; description: string }[];
};

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    title: 'Access',
    caps: [
      {
        value: 'can_access_staff_area',
        label: 'Access staff area',
        description: 'See the staff calendar, manage screen, and programming.',
      },
    ],
  },
  {
    title: 'People & invites',
    caps: [
      { value: 'can_invite', label: 'Generate invite codes', description: 'Create invite codes for new members and staff.' },
      { value: 'can_manage_staff', label: 'Manage staff', description: 'Invite owners/coaches/staff and configure the team.' },
      { value: 'can_archive_members', label: 'Archive members', description: 'Remove members from the gym (soft-delete).' },
      { value: 'can_hard_delete', label: 'Hard delete', description: 'Permanently delete records with no dependents.' },
      { value: 'can_see_full_pii', label: 'See full PII', description: 'View member personal info beyond name.' },
      { value: 'can_see_email', label: 'See email', description: 'View member email addresses.' },
      { value: 'can_see_health_flag', label: 'See health flag', description: 'View members’ PAR-Q health flag state.' },
    ],
  },
  {
    title: 'Money & plans',
    caps: [
      { value: 'can_see_money', label: 'See revenue', description: 'View revenue tiles, billing events, and money figures.' },
      { value: 'can_manage_plans', label: 'Manage plans', description: 'Create / edit / archive membership plans.' },
      { value: 'can_assign_plan', label: 'Assign plans', description: 'Put members onto plans and adjust subscriptions.' },
      { value: 'can_refund', label: 'Issue refunds', description: 'Trigger Stripe refunds against billing events.' },
      { value: 'can_archive_plans', label: 'Archive plans', description: 'Retire plans without deleting their history.' },
    ],
  },
  {
    title: 'Classes & attendance',
    caps: [
      { value: 'can_edit_classes', label: 'Edit classes', description: 'Create, edit, and reschedule class sessions.' },
      { value: 'can_check_in_member', label: 'Check in members', description: 'Mark bookings as attended at class time.' },
      { value: 'can_issue_override', label: 'Issue overrides', description: 'Book a member into a class outside normal rules.' },
      { value: 'can_issue_comp_grant', label: 'Issue comp grants', description: 'Hand out free credits or class access.' },
      { value: 'can_view_attendance', label: 'View attendance', description: 'See attendance trends and check-in counts.' },
      { value: 'can_archive_classes', label: 'Archive classes', description: 'Soft-delete class types from the active list.' },
    ],
  },
  {
    title: 'Tasks & cover',
    caps: [
      { value: 'can_manage_tasks', label: 'Manage tasks', description: 'Create, assign, and reopen staff tasks.' },
      { value: 'can_request_cover', label: 'Request cover', description: 'Hand a class off to be claimed by another coach.' },
      { value: 'can_claim_cover', label: 'Claim cover', description: 'Take an open cover request and teach the class.' },
    ],
  },
  {
    title: 'Insights & data',
    caps: [
      { value: 'can_see_insights', label: 'See insights', description: 'View cohort tiles and the insights dashboard.' },
      { value: 'can_set_targets', label: 'Set insight targets', description: 'Configure monthly and quarterly business goals.' },
      { value: 'can_export_members', label: 'Export CSVs', description: 'Download member, membership, and attendance exports.' },
      { value: 'can_manage_tags', label: 'Manage member tags', description: 'View the members screen, edit tags and tag rules.' },
    ],
  },
  {
    title: 'SOPs',
    caps: [
      { value: 'can_view_sops', label: 'View SOPs', description: 'Read standard operating procedure documents.' },
      { value: 'can_manage_sops', label: 'Manage SOPs', description: 'Create and edit SOP documents.' },
    ],
  },
  {
    title: 'Store',
    caps: [
      { value: 'can_manage_store', label: 'Manage store', description: 'Add, price and remove products; fulfil orders.' },
      { value: 'can_see_store_revenue', label: 'See store revenue', description: 'View store sales and revenue figures.' },
    ],
  },
];

export default function TeamScreen() {
  const callerRole = useRole();
  const roleOptions = callerRole === 'owner' ? OWNER_STAFF_ROLES : ADMIN_STAFF_ROLES;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <InviteSection
          title="Invites"
          subtitle="Email a teammate an invite, or hand over a code & QR."
          roles={roleOptions}
          initialRole="coach"
          filterRole={(r) => r !== 'member'}
          canDelete={callerRole === 'owner'}
        />
        {callerRole === 'owner' ? <RolePermissionsLauncher /> : null}
      </ScrollView>
    </Screen>
  );
}

// ============================================================================
// Role permissions — owner-only editor for gym_role_capabilities.
// ============================================================================

// Tucked behind a CTA so it doesn't dominate the Team screen — owners
// rarely need to touch role configuration after initial setup.
function RolePermissionsLauncher() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <View className="mt-4">
        <Button variant="secondary" onPress={() => setOpen(true)}>
          Configure role permissions
        </Button>
      </View>
    );
  }
  return (
    <View className="gap-3">
      <RolePermissionsSection />
      <View className="self-start">
        <Button variant="ghost" onPress={() => setOpen(false)}>
          Hide permissions
        </Button>
      </View>
    </View>
  );
}

type OverrideRow = {
  role: GymRole;
  capability: string;
  enabled: boolean;
};

function RolePermissionsSection() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [activeRole, setActiveRole] = useState<GymRole>('admin');
  const [error, setError] = useState<string | null>(null);

  const overrides = useQuery({
    queryKey: ['role-capabilities-owner', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<OverrideRow[]> => {
      const { data, error } = await supabase
        .from('gym_role_capabilities')
        .select('role, capability, enabled')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as OverrideRow[];
    },
  });

  const overrideMap = new Map<string, boolean>();
  for (const row of overrides.data ?? []) {
    overrideMap.set(`${row.role}:${row.capability}`, row.enabled);
  }

  const setCap = useMutation({
    mutationFn: async (args: { capability: Capability; enabled: boolean }) => {
      if (!membership || !session?.user.id) throw new Error('No gym selected');
      const { error } = await supabase.from('gym_role_capabilities').upsert(
        {
          gym_id: membership.gymId,
          role: activeRole,
          capability: args.capability,
          enabled: args.enabled,
          updated_by: session.user.id,
        },
        { onConflict: 'gym_id,role,capability' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['role-capabilities-owner'] });
      queryClient.invalidateQueries({ queryKey: ['role-capabilities'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save permission')),
  });

  const resetRole = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym selected');
      const { error } = await supabase
        .from('gym_role_capabilities')
        .delete()
        .eq('gym_id', membership.gymId)
        .eq('role', activeRole);
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['role-capabilities-owner'] });
      queryClient.invalidateQueries({ queryKey: ['role-capabilities'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not reset permissions')),
  });

  return (
    <View className="gap-4 pt-4 border-t border-gray-200 dark:border-gray-800">
      <View className="gap-2">
        <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
          Role permissions
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Configure what each role can do at this gym. Owners always have
          every capability and members never have staff-area capabilities —
          neither is editable. Changes take effect server-side immediately.
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {CONFIGURABLE_ROLES.map((r) => {
          const selected = activeRole === r;
          return (
            <Pressable
              key={r}
              onPress={() => setActiveRole(r)}
              className={`px-4 py-2 rounded-full border ${
                selected
                  ? 'border-primary bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
              <Text
                className={
                  selected
                    ? 'text-primary capitalize'
                    : 'text-gray-600 dark:text-gray-300 capitalize'
                }>
                {r}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {overrides.isLoading ? (
        <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
      ) : (
        <View className="gap-4">
          {CAPABILITY_GROUPS.map((group) => (
            <View key={group.title} className="gap-2">
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                {group.title}
              </Text>
              <View className="bg-white dark:bg-gray-900 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
                {group.caps.map((c) => {
                  const overrideValue = overrideMap.get(`${activeRole}:${c.value}`);
                  const isOverridden = overrideValue !== undefined;
                  const defaultValue = can(activeRole, c.value);
                  const effective = isOverridden ? overrideValue : defaultValue;
                  return (
                    <CapabilityRow
                      key={c.value}
                      label={c.label}
                      description={c.description}
                      enabled={effective}
                      isOverridden={isOverridden}
                      onToggle={() =>
                        setCap.mutate({ capability: c.value, enabled: !effective })
                      }
                      disabled={setCap.isPending}
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      <ChipButton
        tone="neutral"
        className="self-start"
        label={`Reset ${activeRole} to defaults`}
        icon="refresh"
        onPress={() => resetRole.mutate()}
        disabled={resetRole.isPending}
      />
    </View>
  );
}

function CapabilityRow({
  label,
  description,
  enabled,
  isOverridden,
  onToggle,
  disabled,
}: {
  label: string;
  description: string;
  enabled: boolean;
  isOverridden: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      className={`flex-row items-center justify-between gap-3 p-4 ${
        disabled ? 'opacity-60' : ''
      }`}>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="text-gray-900 dark:text-gray-50 font-medium">{label}</Text>
          {isOverridden ? (
            <View className="w-1.5 h-1.5 rounded-full bg-primary" />
          ) : null}
        </View>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">{description}</Text>
      </View>
      <View
        className={`w-11 h-6 rounded-full justify-center px-0.5 ${
          enabled ? 'bg-primary items-end' : 'bg-gray-300 dark:bg-gray-700 items-start'
        }`}>
        <View className="w-5 h-5 rounded-full bg-white" />
      </View>
    </Pressable>
  );
}
