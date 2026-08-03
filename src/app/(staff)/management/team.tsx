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

// No 'member': gym_role_capabilities has check (role not in ('owner',
// 'member')) (0020:37), so every toggle on that tab failed with "Could
// not save permission" — while this page's own copy already says a
// member's permissions are not editable.
const CONFIGURABLE_ROLES: GymRole[] = ['admin', 'coach', 'staff'];

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
      { value: 'can_work_leads', label: 'Work the enquiries', description: 'See and work the front desk — take enquiries, assign them, follow them up.' },
      { value: 'can_invite', label: 'Send invites', description: 'Email invites to new members and staff.' },
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
      { value: 'can_program_members', label: 'Program individuals', description: 'Write personal programming for a single member and configure its access.' },
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
        <BackLink fallbackHref="/management" />
        <InviteSection
          title="Invites"
          subtitle="Email a teammate an invite to join your team."
          roles={roleOptions}
          initialRole="coach"
        />
        {callerRole === 'owner' ? <RolePermissionsLauncher /> : null}
        {callerRole === 'owner' ? <MemberPermissionsLauncher /> : null}
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
              <View className="bg-white dark:bg-gray-900 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 shadow-card">
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

// ============================================================================
// Individual permissions — owner-only editor for gym_member_capabilities.
// Sits above the per-role layer: whatever's set here for one person wins
// over their role's config (Ed gets refunds, Charlotte doesn't).
// ============================================================================

function MemberPermissionsLauncher() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <View className="mt-2">
        <Button variant="secondary" onPress={() => setOpen(true)}>
          Configure individual permissions
        </Button>
      </View>
    );
  }
  return (
    <View className="gap-3">
      <MemberPermissionsSection />
      <View className="self-start">
        <Button variant="ghost" onPress={() => setOpen(false)}>
          Hide individual permissions
        </Button>
      </View>
    </View>
  );
}

type StaffRosterRow = {
  profile_id: string;
  role: GymRole;
  profiles: { full_name: string | null } | null;
};

function MemberPermissionsSection() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<StaffRosterRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roster = useQuery({
    queryKey: ['staff-roster', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<StaffRosterRow[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, role, profiles!profile_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .in('role', ['admin', 'coach', 'staff'])
        .is('left_at', null);
      if (error) throw error;
      return (data ?? []) as unknown as StaffRosterRow[];
    },
  });

  // Role overrides supply the baseline the per-person toggles start from —
  // shared cache with the role editor above.
  const roleOverrides = useQuery({
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

  const memberOverrides = useQuery({
    queryKey: [
      'member-capabilities-owner',
      membership?.gymId,
      selected?.profile_id,
    ],
    enabled: !!membership?.gymId && !!selected?.profile_id,
    queryFn: async (): Promise<{ capability: string; enabled: boolean }[]> => {
      const { data, error } = await supabase
        .from('gym_member_capabilities')
        .select('capability, enabled')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', selected!.profile_id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const roleOverrideMap = new Map<string, boolean>();
  for (const row of roleOverrides.data ?? []) {
    roleOverrideMap.set(`${row.role}:${row.capability}`, row.enabled);
  }
  const memberOverrideMap = new Map<string, boolean>();
  for (const row of memberOverrides.data ?? []) {
    memberOverrideMap.set(row.capability, row.enabled);
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['member-capabilities-owner'] });
    // The edited person's own useCan mirror (and the owner's, harmlessly).
    queryClient.invalidateQueries({ queryKey: ['member-capabilities'] });
  };

  const setCap = useMutation({
    mutationFn: async (args: { capability: Capability; enabled: boolean }) => {
      if (!membership || !session?.user.id || !selected) {
        throw new Error('No teammate selected');
      }
      const { error } = await supabase.from('gym_member_capabilities').upsert(
        {
          gym_id: membership.gymId,
          profile_id: selected.profile_id,
          capability: args.capability,
          enabled: args.enabled,
          updated_by: session.user.id,
        },
        { onConflict: 'gym_id,profile_id,capability' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(errorMessage(e, 'Could not save permission')),
  });

  const clearCap = useMutation({
    mutationFn: async (capability: Capability) => {
      if (!membership || !selected) throw new Error('No teammate selected');
      const { error } = await supabase
        .from('gym_member_capabilities')
        .delete()
        .eq('gym_id', membership.gymId)
        .eq('profile_id', selected.profile_id)
        .eq('capability', capability);
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(errorMessage(e, 'Could not reset permission')),
  });

  const resetMember = useMutation({
    mutationFn: async () => {
      if (!membership || !selected) throw new Error('No teammate selected');
      const { error } = await supabase
        .from('gym_member_capabilities')
        .delete()
        .eq('gym_id', membership.gymId)
        .eq('profile_id', selected.profile_id);
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(errorMessage(e, 'Could not reset permissions')),
  });

  const busy = setCap.isPending || clearCap.isPending || resetMember.isPending;

  if (!selected) {
    const rows = roster.data ?? [];
    return (
      <View className="gap-4 pt-4 border-t border-gray-200 dark:border-gray-800">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            Individual permissions
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Give one teammate more (or less) than their role allows. Anything
            set here overrides their role — everyone else on that role is
            unaffected. Pick a teammate to configure.
          </Text>
        </View>
        {roster.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : rows.length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            No coaches or staff yet. Invite a teammate above first.
          </Text>
        ) : (
          <View className="bg-white dark:bg-gray-900 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 shadow-card">
            {rows.map((r) => (
              <Pressable
                key={r.profile_id}
                onPress={() => setSelected(r)}
                className="flex-row items-center justify-between gap-3 p-4">
                <View className="gap-0.5">
                  <Text className="text-gray-900 dark:text-gray-50 font-medium">
                    {r.profiles?.full_name ?? 'Unnamed teammate'}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs capitalize">
                    {r.role}
                  </Text>
                </View>
                <Text className="text-primary text-sm">Configure</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <View className="gap-4 pt-4 border-t border-gray-200 dark:border-gray-800">
      <View className="gap-2">
        <ChipButton
          tone="neutral"
          className="self-start"
          label="All teammates"
          icon="chevron-back"
          onPress={() => setSelected(null)}
        />
        <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
          {selected.profiles?.full_name ?? 'Unnamed teammate'}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          A blue dot marks a capability set for this person specifically. Toggle
          to override their <Text className="capitalize">{selected.role}</Text>{' '}
          role; clear it to fall back to the role.
        </Text>
      </View>

      {roleOverrides.isLoading || memberOverrides.isLoading ? (
        <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
      ) : (
        <View className="gap-4">
          {CAPABILITY_GROUPS.map((group) => (
            <View key={group.title} className="gap-2">
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                {group.title}
              </Text>
              <View className="bg-white dark:bg-gray-900 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 shadow-card">
                {group.caps.map((c) => {
                  const memberValue = memberOverrideMap.get(c.value);
                  const isOverridden = memberValue !== undefined;
                  const roleValue = roleOverrideMap.get(
                    `${selected.role}:${c.value}`,
                  );
                  const baseline =
                    roleValue !== undefined
                      ? roleValue
                      : can(selected.role, c.value);
                  const effective = isOverridden ? memberValue : baseline;
                  return (
                    <CapabilityRow
                      key={c.value}
                      label={c.label}
                      description={c.description}
                      enabled={effective}
                      isOverridden={isOverridden}
                      onToggle={() =>
                        setCap.mutate({
                          capability: c.value,
                          enabled: !effective,
                        })
                      }
                      onClear={
                        isOverridden ? () => clearCap.mutate(c.value) : undefined
                      }
                      disabled={busy}
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
        label="Reset to role defaults"
        icon="refresh"
        onPress={() => resetMember.mutate()}
        disabled={busy}
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
  onClear,
  disabled,
}: {
  label: string;
  description: string;
  enabled: boolean;
  isOverridden: boolean;
  onToggle: () => void;
  // Only the per-member editor passes this — clears the person-specific
  // pin so the capability inherits from their role again.
  onClear?: () => void;
  disabled: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-2 p-4 ${disabled ? 'opacity-60' : ''}`}>
      <Pressable
        onPress={onToggle}
        disabled={disabled}
        className="flex-1 flex-row items-center justify-between gap-3">
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
      {onClear ? (
        <Pressable onPress={onClear} disabled={disabled} hitSlop={8}>
          <Text className="text-gray-400 dark:text-gray-500 text-xs">Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
