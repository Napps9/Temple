import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { BillingNotLiveTile } from '@/components/BillingNotLiveTile';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import {
  DATE_RE,
  DateRangeCta,
  PRESET_LABELS,
  type Preset,
  isoDate,
  presetRange,
} from '@/components/DateRangeCta';
import { GymSetupChecklist } from '@/components/GymSetupChecklist';
import { Input } from '@/components/Input';
import { InviteSection } from '@/components/InviteSection';
import { MemberSignupLinkCard } from '@/components/MemberSignupLinkCard';
import { MembersList } from '@/components/MembersList';
import { Screen } from '@/components/Screen';
import { StatTile, type Delta, type DeltaDirection } from '@/components/StatTile';
import {
  bucketByClassType,
  type AttendanceBooking,
  type AttendanceSession,
} from '@/lib/attendance';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import {
  formatMoney,
  totalEarnings,
  type EarningsRow,
} from '@/lib/coach-earnings';
import { useExportMembersCsv, exportErrorMessage } from '@/lib/csv-exports';
import { errorMessage } from '@/lib/errors';
import {
  useMembershipPolicies,
  useSetMembershipPolicies,
  type MembershipChangePolicy,
  type MembershipPolicies,
} from '@/lib/membership-changes';
import { supabase } from '@/lib/supabase';
import type { GymRole } from '@/types/database';
import { useCan } from '@/lib/useCan';
import { useSavedFlag } from '@/lib/useSavedFlag';
import { BrandingPanel } from './branding';
import { ClassTypesPanel } from './class-types';
import { CommunicationsHome } from './communications';
import { LeaderboardsPanel } from './leaderboards';
import { MessagingPanel } from './messaging';
import { OperatingDefaultsPanel } from './operating';
import { HealthScreeningPanel } from './parq';
import { PlansPanel } from './plans';

type LinkHref = ComponentProps<typeof Link>['href'];

function ManagementCard({
  title,
  description,
  href,
  comingSoon,
}: {
  title: string;
  description: string;
  href?: LinkHref;
  comingSoon?: boolean;
}) {
  const body = (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 border border-gray-100 dark:border-gray-800 shadow-card">
      <View className="flex-row justify-between items-center">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">{title}</Text>
        {comingSoon ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Coming soon
          </Text>
        ) : (
          <Text className="text-primary">→</Text>
        )}
      </View>
      <Text className="text-gray-500 dark:text-gray-400">{description}</Text>
    </View>
  );
  if (href && !comingSoon) {
    return (
      <Link href={href} asChild>
        <Pressable>{body}</Pressable>
      </Link>
    );
  }
  return body;
}

type Category = 'insights' | 'members' | 'comms' | 'store' | 'team' | 'plans' | 'settings';

type IconName = ComponentProps<typeof Ionicons>['name'];

const CATEGORY_LABELS: Record<Category, string> = {
  insights: 'Insights',
  members: 'Members',
  comms: 'Comms',
  store: 'Store',
  team: 'Team',
  plans: 'Plans',
  settings: 'Settings',
};

const CATEGORY_ICONS: Record<Category, IconName> = {
  insights: 'bar-chart-outline',
  members: 'people-outline',
  comms: 'mail-outline',
  store: 'bag-handle-outline',
  team: 'briefcase-outline',
  plans: 'pricetags-outline',
  settings: 'settings-outline',
};

const CATEGORY_ORDER: Category[] = [
  'insights',
  'members',
  'comms',
  'store',
  'team',
  'plans',
  'settings',
];

type Card = {
  category: Category;
  title: string;
  description: string;
  href: LinkHref;
  visible: boolean;
};

export default function ManagementHome() {
  const role = useRole();
  const canSeeInsights = useCan('can_see_insights');
  const canViewAttendance = useCan('can_view_attendance');
  const canManageTasks = useCan('can_manage_tasks');
  const canRequestCover = useCan('can_request_cover');
  const canClaimCover = useCan('can_claim_cover');
  const canViewSops = useCan('can_view_sops');
  const canManageStaff = useCan('can_manage_staff');
  const canEditClasses = useCan('can_edit_classes');
  const canManageTags = useCan('can_manage_tags');
  const canManagePlans = useCan('can_manage_plans');
  const canSetCoachPay = useCan('can_set_coach_pay');
  const canConfigureLeaderboards = useCan('can_configure_leaderboards');
  const canManageComms = useCan('can_manage_comms');
  const canManageStore = useCan('can_manage_store');
  const canAssignPlan = useCan('can_assign_plan');

  const cards: Card[] = [
    {
      category: 'insights',
      title: 'Insights',
      description: 'Intros, expiring members, conversion vs targets.',
      href: '/management/insights',
      visible: !!canSeeInsights,
    },
    {
      category: 'insights',
      title: 'Attendance',
      description: 'Trends from check-ins on class bookings.',
      href: '/management/attendance',
      visible: !!canViewAttendance,
    },
    {
      category: 'team',
      title: 'Team',
      description: 'Invite owners, coaches and staff.',
      href: '/management/team',
      visible: !!canManageStaff,
    },
    {
      category: 'team',
      title: 'Coach earnings',
      description: 'Set per-class-type rates and review what coaches earned.',
      href: '/management/coach-earnings',
      visible: !!canSetCoachPay,
    },
    {
      category: 'team',
      title: 'SOPs',
      description: 'How we do things here — for the whole team.',
      href: '/management/sops',
      visible: !!canViewSops,
    },
    {
      category: 'team',
      title: 'Tasks',
      description: 'Day-to-day staff work, assigned and tracked.',
      href: '/management/tasks',
      visible: !!canManageTasks || role === 'staff',
    },
    {
      category: 'team',
      title: 'Cover',
      description: 'Hand a class to another coach; first-claim wins.',
      href: '/management/cover',
      visible: !!canRequestCover || !!canClaimCover,
    },
    {
      category: 'settings',
      title: 'Branding',
      description: 'Logo, colours, gym name, public join link.',
      href: '/management/branding',
      visible: !!canManageStaff,
    },
    {
      category: 'settings',
      title: 'Leaderboards',
      description: 'Turn class and strength comparisons on or off.',
      href: '/management/leaderboards',
      visible: !!canConfigureLeaderboards,
    },
    {
      category: 'settings',
      title: 'Messaging',
      description: 'Decide who can DM whom inside the gym.',
      href: '/management/messaging',
      visible: !!canManageStaff,
    },
    {
      category: 'settings',
      title: 'Class types',
      description: 'Name and colour the kinds of class you run.',
      href: '/management/class-types',
      visible: !!canEditClasses,
    },
    {
      category: 'settings',
      title: 'Gym settings',
      description:
        'Week start, booking windows, PAR-Q expiry, plan resolution, retention.',
      href: '/management/operating',
      visible: !!canManageStaff,
    },
    {
      category: 'members',
      title: 'Members',
      description: 'Invite members, view them by cohort, see and edit their tags.',
      href: '/management/members',
      visible: !!canManageTags,
    },
    {
      category: 'comms',
      title: 'Communications',
      description: 'Design, send and analyse email campaigns to your members.',
      href: '/management/communications',
      visible: !!canManageComms,
    },
    {
      category: 'store',
      title: 'Store',
      description: 'Sell merch, programmes and tickets; manage stock and orders.',
      href: '/management/store',
      visible: !!canManageStore,
    },
    {
      category: 'members',
      title: 'Tag rules',
      description: 'Auto-tag members based on cohort state.',
      href: '/management/tags',
      visible: !!canManageTags,
    },
    {
      category: 'members',
      title: 'Import members',
      description: 'Stage members from Mindbody, PushPress, Glofox, Wodify or a spreadsheet.',
      href: '/management/members/import',
      visible: !!canManageStaff,
    },
    {
      category: 'members',
      title: 'Import workout history',
      description: 'Seed past sets per member — lands in /track for PR pages and sparklines.',
      href: '/management/members/import-workouts',
      visible: !!canManageStaff,
    },
    {
      category: 'members',
      title: 'Leads',
      description: 'Track prospects from first contact through conversion.',
      href: '/management/leads',
      visible: !!canAssignPlan,
    },
    {
      category: 'members',
      title: 'Membership requests',
      description: 'Approve or reject member requests to switch or cancel a plan.',
      href: '/management/membership-requests',
      visible: !!canAssignPlan,
    },
    {
      category: 'plans',
      title: 'Plans',
      description: 'Define your membership plans, prices, and credit packs.',
      href: '/management/plans',
      visible: !!canManagePlans,
    },
  ];

  const availableCategories = CATEGORY_ORDER.filter((c) =>
    cards.some((card) => card.category === c && card.visible),
  );
  const [active, setActive] = useState<Category>(
    availableCategories[0] ?? 'insights',
  );
  const activeCategory = availableCategories.includes(active)
    ? active
    : availableCategories[0] ?? 'insights';
  const visibleCards = cards.filter(
    (c) => c.visible && c.category === activeCategory,
  );

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        {/* Owner-only setup nudge. Self-hides once all five steps are
            done so the card never nags a finished gym. */}
        <GymSetupChecklist />
        {/* Tabs lead the page; the headline KPI tiles live inside the
            Insights tab where the rest of the metrics are. */}
        {availableCategories.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2">
            {availableCategories.map((c) => {
              const selected = c === activeCategory;
              return (
                <Pressable
                  key={c}
                  onPress={() => setActive(c)}
                  className={`px-4 py-2 rounded-full flex-row items-center gap-1.5 ${
                    selected ? 'bg-primary' : 'bg-slate-200 dark:bg-gray-800'
                  }`}>
                  <Ionicons
                    name={CATEGORY_ICONS[c]}
                    size={16}
                    color={selected ? '#FFFFFF' : '#6B7280'}
                  />
                  <Text
                    className={`text-sm font-medium ${
                      selected
                        ? 'text-white'
                        : 'text-gray-700 dark:text-gray-200'
                    }`}>
                    {CATEGORY_LABELS[c]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {activeCategory === 'insights' ? (
          <InsightsTab />
        ) : activeCategory === 'members' ? (
          <MembersTab />
        ) : activeCategory === 'comms' ? (
          <CommunicationsHome />
        ) : activeCategory === 'team' ? (
          <TeamTab />
        ) : activeCategory === 'plans' ? (
          <View className="gap-4">
            {role === 'owner' ? (
              <ManagementCard
                title="Billing & payments"
                description="Connect Stripe to charge members for memberships. You keep 100%."
                href={'/management/billing' as never}
              />
            ) : null}
            <PlansPanel />
            {role === 'owner' ? (
              <SettingsSection
                title="Member Management Configuration"
                description="Which membership changes are self-serve vs need your approval."
                icon="swap-horizontal-outline">
                <MembershipPoliciesPanel />
              </SettingsSection>
            ) : null}
          </View>
        ) : activeCategory === 'settings' ? (
          <SettingsTab />
        ) : (
          visibleCards.map((c) => (
            <ManagementCard
              key={c.title}
              title={c.title}
              description={c.description}
              href={c.href}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function SettingsTab() {
  const canManageStaff = useCan('can_manage_staff') ?? false;
  const canConfigureLeaderboards = useCan('can_configure_leaderboards') ?? false;
  const canEditClasses = useCan('can_edit_classes') ?? false;
  const canManageParq = useCan('can_manage_parq') ?? false;

  return (
    <View className="gap-3">
      {canManageStaff ? (
        <SettingsSection
          title="Gym settings"
          description="Week start, booking windows, cancel cutoff, PAR-Q expiry, plan resolution."
          icon="options-outline">
          <OperatingDefaultsPanel />
        </SettingsSection>
      ) : null}
      {canManageStaff ? (
        <SettingsSection
          title="Branding"
          description="Logo, colours, gym name, public join link."
          icon="color-palette-outline">
          <BrandingPanel />
        </SettingsSection>
      ) : null}
      {canManageParq ? (
        <SettingsSection
          title="Health screening"
          description="Upload a waiver to sign, or build a PAR-Q. One is enough."
          icon="heart-outline">
          <HealthScreeningPanel />
        </SettingsSection>
      ) : null}
      {canConfigureLeaderboards ? (
        <SettingsSection
          title="Leaderboards"
          description="Turn class and strength comparisons on or off."
          icon="trophy-outline">
          <LeaderboardsPanel />
        </SettingsSection>
      ) : null}
      {canManageStaff ? (
        <SettingsSection
          title="Messaging"
          description="Decide who can DM whom inside the gym."
          icon="chatbubbles-outline">
          <MessagingPanel />
        </SettingsSection>
      ) : null}
      {canEditClasses ? (
        <SettingsSection
          title="Class types"
          description="Name, colour and schedule the kinds of class you run."
          icon="calendar-outline">
          <ClassTypesPanel />
        </SettingsSection>
      ) : null}
    </View>
  );
}

// Collapsed-by-default section card: the header row is the CTA, the
// panel renders only while open. Keeps the Settings tab scannable —
// five fully-expanded editors stacked end to end was a wall.
function SettingsSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: IconName;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl shadow-card">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-3 p-4 active:opacity-70">
        <View className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
          <Ionicons name={icon} size={18} color="#6B7280" />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {title}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {description}
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#9CA3AF"
        />
      </Pressable>
      {open ? (
        <View className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-800">
          {children}
        </View>
      ) : null}
    </View>
  );
}

// ============================================================================
// Membership change policies — owner picks self-serve vs approval per
// direction. Lives in the Plans tab alongside plans + billing.
// ============================================================================

function PolicyRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: MembershipChangePolicy;
  onChange: (v: MembershipChangePolicy) => void;
}) {
  return (
    <View className="gap-2">
      <View>
        <Text className="text-gray-900 dark:text-gray-50 font-medium">{label}</Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {description}
        </Text>
      </View>
      <View className="flex-row gap-2">
        {(['self_serve', 'request'] as const).map((opt) => {
          const selected = value === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              className={`flex-1 px-3 py-2 rounded-lg border items-center ${
                selected
                  ? 'bg-primary border-primary'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
              }`}>
              <Text
                className={`text-sm font-medium ${
                  selected ? 'text-white' : 'text-gray-700 dark:text-gray-200'
                }`}>
                {opt === 'self_serve' ? 'Self-serve' : 'Needs approval'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MembershipPoliciesPanel() {
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId;
  const policiesQuery = useMembershipPolicies(gymId);
  const save = useSetMembershipPolicies(gymId);
  const [draft, setDraft] = useState<MembershipPolicies | null>(null);
  const [saved, markSaved] = useSavedFlag();

  useEffect(() => {
    if (policiesQuery.data) setDraft(policiesQuery.data);
  }, [policiesQuery.data]);

  if (policiesQuery.isLoading || !draft) {
    return (
      <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
    );
  }

  return (
    <View className="gap-4">
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        Choose which changes members make themselves and which need your
        approval. Credit packs and one-off class buys aren't affected.
      </Text>
      <PolicyRow
        label="Upgrades"
        description="Switching to a more expensive plan."
        value={draft.upgrade}
        onChange={(v) => setDraft({ ...draft, upgrade: v })}
      />
      <PolicyRow
        label="Downgrades"
        description="Switching to a cheaper plan."
        value={draft.downgrade}
        onChange={(v) => setDraft({ ...draft, downgrade: v })}
      />
      <PolicyRow
        label="Cancellations"
        description="Ending a membership."
        value={draft.cancel}
        onChange={(v) => setDraft({ ...draft, cancel: v })}
      />
      {save.error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(save.error, 'Could not save policies')}
        </Text>
      ) : null}
      <Button
        onPress={() => save.mutate(draft, { onSuccess: markSaved })}
        loading={save.isPending}
        success={saved}>
        Save policies
      </Button>
    </View>
  );
}

// ============================================================================
// Team tab — roster of staff first, each row expands to show their tasks,
// earnings, cover requests. SOPs / invites / role permissions sit at the
// bottom as CTAs.
// ============================================================================

type StaffMember = {
  profile_id: string;
  role: GymRole;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

function TeamTab() {
  const { data: membership } = useGymMembership();
  const canViewSops = useCan('can_view_sops') ?? false;
  const canManageStaff = useCan('can_manage_staff') ?? false;
  const canSetCoachPay = useCan('can_set_coach_pay') ?? false;

  const staffQuery = useQuery({
    queryKey: ['team-roster', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<StaffMember[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select(
          'profile_id, role, profiles!profile_id(full_name, avatar_url)',
        )
        .eq('gym_id', membership!.gymId)
        .in('role', ['owner', 'admin', 'coach', 'staff'])
        .is('left_at', null);
      if (error) throw error;
      return (data ?? []) as unknown as StaffMember[];
    },
  });

  const staff = staffQuery.data ?? [];
  // Owners first, then admins, coaches, staff — alphabetised within each.
  const sorted = [...staff].sort((a, b) => {
    const order: Record<GymRole, number> = {
      owner: 0,
      admin: 1,
      coach: 2,
      staff: 3,
      member: 4,
    };
    const ra = order[a.role] ?? 5;
    const rb = order[b.role] ?? 5;
    if (ra !== rb) return ra - rb;
    return (a.profiles?.full_name ?? '').localeCompare(
      b.profiles?.full_name ?? '',
    );
  });

  return (
    <View className="gap-4">
      {staffQuery.isLoading ? (
        <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
      ) : sorted.length === 0 ? (
        <Text className="text-gray-500 dark:text-gray-400">
          No team members yet — invite some below.
        </Text>
      ) : (
        <View className="gap-2">
          {sorted.map((m) => (
            <TeamMemberRow
              key={m.profile_id}
              member={m}
              showEarnings={canSetCoachPay}
            />
          ))}
        </View>
      )}

      <View className="gap-2 mt-2">
        {canViewSops ? (
          <ManagementCard
            title="SOPs"
            description="Standard operating procedures — add docs the whole team can read."
            href="/management/sops"
          />
        ) : null}
        {canManageStaff ? (
          <ManagementCard
            title="Invites"
            description="Email an invite to add a new owner, admin, coach or staff."
            href="/management/team"
          />
        ) : null}
      </View>
    </View>
  );
}

function TeamMemberRow({
  member,
  showEarnings,
}: {
  member: StaffMember;
  showEarnings: boolean;
}) {
  const { data: membership } = useGymMembership();
  const name = member.profiles?.full_name ?? 'Team member';
  const showCover =
    member.role === 'coach' ||
    member.role === 'admin' ||
    member.role === 'owner';
  const showCoachDetails = showEarnings && member.role === 'coach';

  const openTasks = useQuery({
    queryKey: ['team-tasks-open', membership?.gymId, member.profile_id],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('coach_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', membership!.gymId)
        .eq('assigned_to', member.profile_id)
        .eq('status', 'open');
      if (error) throw error;
      return count ?? 0;
    },
  });

  const openCover = useQuery({
    queryKey: ['team-cover-open', membership?.gymId, member.profile_id],
    enabled: !!membership?.gymId && showCover,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('cover_requests')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', membership!.gymId)
        .eq('requested_by', member.profile_id)
        .is('claimed_by', null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl">
      <View className="flex-row items-center gap-3 p-4">
        <Avatar
          name={name}
          avatarUrl={member.profiles?.avatar_url}
          size={40}
        />
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {name}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
            {member.role}
          </Text>
        </View>
        <CountPill
          icon="checkbox-outline"
          value={openTasks.isLoading ? null : openTasks.data ?? 0}
          href="/management/tasks"
        />
        {showCover ? (
          <CountPill
            icon="swap-horizontal-outline"
            value={openCover.isLoading ? null : openCover.data ?? 0}
            href="/management/cover"
          />
        ) : null}
      </View>
      {showCoachDetails ? (
        <View className="px-4 pb-4 gap-3 border-t border-gray-100 dark:border-gray-800 pt-3">
          <CoachEarningsSummary profileId={member.profile_id} />
          <CoachQualifications profileId={member.profile_id} />
        </View>
      ) : null}
    </View>
  );
}

function CountPill({
  icon,
  value,
  href,
}: {
  icon: IconName;
  value: number | null;
  href: LinkHref;
}) {
  const body = (
    <View className="flex-row items-center gap-1 px-2 py-1 rounded-full bg-gray-50 dark:bg-gray-800">
      <Ionicons name={icon} size={13} color="#6B7280" />
      <Text className="text-gray-700 dark:text-gray-200 text-xs font-semibold min-w-[10px] text-center">
        {value === null ? '—' : value}
      </Text>
    </View>
  );
  return (
    <Link href={href} asChild>
      <Pressable hitSlop={4} className="active:opacity-70">
        {body}
      </Pressable>
    </Link>
  );
}

type ClassTypeLite = { id: string; name: string; color: string };
type QualRow = { class_type_id: string; qualified: boolean };

function CoachQualifications({ profileId }: { profileId: string }) {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const classTypesQuery = useQuery({
    queryKey: ['class-types-roster', membership?.gymId],
    enabled: !!membership?.gymId && open,
    queryFn: async (): Promise<ClassTypeLite[]> => {
      const { data, error } = await supabase
        .from('class_types')
        .select('id, name, color')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as ClassTypeLite[];
    },
  });

  const qualsQuery = useQuery({
    queryKey: ['coach-quals', membership?.gymId, profileId],
    enabled: !!membership?.gymId && open,
    queryFn: async (): Promise<QualRow[]> => {
      const { data, error } = await supabase
        .from('coach_class_type_qualifications')
        .select('class_type_id, qualified')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return (data ?? []) as QualRow[];
    },
  });

  const qualByType = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const q of qualsQuery.data ?? []) m.set(q.class_type_id, q.qualified);
    return m;
  }, [qualsQuery.data]);

  const toggle = useMutation({
    mutationFn: async ({
      classTypeId,
      next,
    }: {
      classTypeId: string;
      next: boolean;
    }) => {
      if (!membership || !session?.user.id) throw new Error('No gym');
      // Default is qualified; only persist a row when the answer is "no" or
      // when we previously persisted one. Deleting a "yes" row when toggling
      // back to the default keeps the table small and the read query cheap.
      const existing = qualByType.get(classTypeId);
      if (next && existing === undefined) return;
      if (next) {
        const { error } = await supabase
          .from('coach_class_type_qualifications')
          .delete()
          .eq('gym_id', membership.gymId)
          .eq('profile_id', profileId)
          .eq('class_type_id', classTypeId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('coach_class_type_qualifications')
          .upsert(
            {
              gym_id: membership.gymId,
              profile_id: profileId,
              class_type_id: classTypeId,
              qualified: false,
              updated_by: session.user.id,
            },
            { onConflict: 'gym_id,profile_id,class_type_id' },
          );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['coach-quals', membership?.gymId, profileId],
      });
    },
  });

  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center justify-between active:opacity-70 py-1">
        <View className="flex-row items-center gap-2">
          <Ionicons name="ribbon-outline" size={16} color="#6B7280" />
          <Text className="text-gray-700 dark:text-gray-200 text-sm">
            Class type qualifications
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color="#9CA3AF"
        />
      </Pressable>
      {open ? (
        <View className="gap-1 mt-2">
          {classTypesQuery.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Loading…
            </Text>
          ) : (classTypesQuery.data ?? []).length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No class types yet.
            </Text>
          ) : (
            (classTypesQuery.data ?? []).map((ct) => {
              const explicit = qualByType.get(ct.id);
              const qualified = explicit ?? true;
              return (
                <View
                  key={ct.id}
                  className="flex-row items-center justify-between py-2">
                  <View className="flex-row items-center gap-2 flex-1">
                    <View
                      style={{ backgroundColor: ct.color }}
                      className="w-2 h-2 rounded-full"
                    />
                    <Text className="text-gray-900 dark:text-gray-50 text-sm">
                      {ct.name}
                    </Text>
                  </View>
                  <Switch
                    value={qualified}
                    onValueChange={(v) =>
                      toggle.mutate({ classTypeId: ct.id, next: v })
                    }
                    disabled={toggle.isPending}
                  />
                </View>
              );
            })
          )}
          <Text className="text-gray-400 dark:text-gray-500 text-xs mt-1">
            Off means this coach can't be assigned or claim cover for this
            class type.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function CoachEarningsSummary({ profileId }: { profileId: string }) {
  const { data: membership } = useGymMembership();
  const range = useMemo(() => presetRange('month', new Date()), []);
  const earnings = useQuery({
    queryKey: ['team-earnings', membership?.gymId, profileId, range.start, range.end],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<EarningsRow[]> => {
      const { data, error } = await supabase.rpc('compute_coach_earnings', {
        p_gym_id: membership!.gymId,
        p_coach_id: profileId,
        p_period_start: range.start,
        p_period_end: range.end,
      });
      if (error) throw error;
      return (data ?? []) as EarningsRow[];
    },
  });
  const rows = earnings.data ?? [];
  const total = totalEarnings(rows);
  return (
    <Link href="/management/coach-earnings" asChild>
      <Pressable className="flex-row items-center justify-between active:opacity-70">
        <View className="flex-row items-center gap-2">
          <Ionicons name="cash-outline" size={16} color="#6B7280" />
          <Text className="text-gray-700 dark:text-gray-200 text-sm">
            Earnings this month
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {earnings.isLoading
              ? '—'
              : `${formatMoney(total.cents, total.currency)} · ${total.classes} classes`}
          </Text>
          <Text className="text-primary text-sm">→</Text>
        </View>
      </Pressable>
    </Link>
  );
}

// ============================================================================
// Key stats — at-a-glance KPIs on the manage page, with a shared date filter.
// ============================================================================



function formatCurrency(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

type RevenueRow = { currency: string; gross_cents: number; charge_count: number };

// Build the "previous period" — same length as the current range,
// immediately preceding it. Inclusive on both ends.
//
// e.g. current = (2026-06-01, 2026-06-07) — 7 days
//      mirror  = (2026-05-25, 2026-05-31) — 7 days, ending the day before current starts
function mirrorRange(range: { start: string; end: string }): { start: string; end: string } {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const mirrorEnd = new Date(start.getTime() - 86400000);
  const mirrorStart = new Date(mirrorEnd.getTime() - (days - 1) * 86400000);
  return { start: isoDate(mirrorStart), end: isoDate(mirrorEnd) };
}

// The day before a given period — used as the as-of date for the
// mirror member count, so it's strictly before the current period starts.
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return isoDate(new Date(d.getTime() - 86400000));
}

// Pick the dominant currency by charge_count, otherwise USD. Multi-
// currency gyms are rare enough that one tile per gym is the right
// trade — if a gym needs more, the Plans / Reports screens still show
// per-currency detail.
function pickPrimaryCurrency(rows: RevenueRow[]): RevenueRow {
  if (rows.length === 0) return { currency: 'USD', gross_cents: 0, charge_count: 0 };
  return [...rows].sort((a, b) => b.charge_count - a.charge_count)[0]!;
}

function pctDelta(current: number, previous: number): Delta {
  if (previous === 0 && current === 0) return { direction: 'flat', label: 'no change' };
  if (previous === 0) return { direction: 'up', label: 'new' };
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < 0.001) return { direction: 'flat', label: '0%' };
  const pct = ratio * 100;
  const direction: DeltaDirection = pct > 0 ? 'up' : 'down';
  const sign = pct > 0 ? '+' : '';
  return { direction, label: `${sign}${pct.toFixed(1)}%` };
}

function ppDelta(current: number, previous: number): Delta {
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) return { direction: 'flat', label: '0 pp' };
  const direction: DeltaDirection = diff > 0 ? 'up' : 'down';
  const sign = diff > 0 ? '+' : '';
  return { direction, label: `${sign}${diff.toFixed(1)} pp` };
}

// ============================================================================
// Insights tab — lifecycle metrics on display + attendance summary + CTAs.
// ============================================================================

type InsightsSummary = {
  intros_new: number;
  intros_target: number;
  conversions: number;
  conversions_target: number;
  expiring_soon: number;
  expired: number;
  paying_now: number;
  billing_live: boolean;
};

type TargetMetric = 'intros_new' | 'conversions' | 'retention';
type TargetPeriod = 'month' | 'quarter';
type TargetRow = {
  metric: TargetMetric;
  period: TargetPeriod;
  target_value: number;
};

const TARGET_METRICS: { value: TargetMetric; label: string; description: string }[] = [
  {
    value: 'intros_new',
    label: 'New intros',
    description: 'Members starting an intro period (e.g. trial, foundations).',
  },
  {
    value: 'conversions',
    label: 'Conversions',
    description: 'Intros who became paying members in the period.',
  },
  {
    value: 'retention',
    label: 'Retention',
    description: 'Members who stay active across the period.',
  },
];

const TARGET_PERIODS: TargetPeriod[] = ['month', 'quarter'];

function InsightsTab() {
  const { data: membership } = useGymMembership();
  const canSeeInsights = useCan('can_see_insights') ?? false;
  const canSetTargets = useCan('can_set_targets') ?? false;
  const showRevenue = useCan('can_see_money') ?? false;
  const showMembers = useCan('can_view_attendance') ?? false;

  // One range drives every tile on this tab — the headline KPIs and
  // the lifecycle metrics used to carry their own pickers.
  const [preset, setPreset] = useState<Preset>('month');
  const [customStart, setCustomStart] = useState(() => isoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const range = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetRange(preset, new Date());
  }, [preset, customStart, customEnd]);
  const { start, end } = range;
  const rangeValid =
    DATE_RE.test(start) && DATE_RE.test(end) && start <= end;
  const prev = useMemo(
    () => (rangeValid ? mirrorRange(range) : null),
    [start, end, rangeValid],
  );
  const gymId = membership?.gymId;

  const revenueCurrent = useQuery({
    queryKey: ['manage-revenue', gymId, start, end],
    enabled: !!gymId && showRevenue && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('compute_revenue_summary', {
        p_gym_id: gymId!,
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      return (data ?? []) as RevenueRow[];
    },
  });
  const revenuePrev = useQuery({
    queryKey: ['manage-revenue', gymId, prev?.start, prev?.end],
    enabled: !!gymId && showRevenue && rangeValid && !!prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('compute_revenue_summary', {
        p_gym_id: gymId!,
        p_period_start: prev!.start,
        p_period_end: prev!.end,
      });
      if (error) throw error;
      return (data ?? []) as RevenueRow[];
    },
  });

  const membersCurrent = useQuery({
    queryKey: ['manage-members-asof', gymId, end],
    enabled: !!gymId && showMembers && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('count_members_as_of', {
        p_gym_id: gymId!,
        p_as_of: end,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
  const membersPrev = useQuery({
    queryKey: ['manage-members-asof', gymId, prev ? dayBefore(start) : null],
    enabled: !!gymId && showMembers && rangeValid && !!prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('count_members_as_of', {
        p_gym_id: gymId!,
        p_as_of: dayBefore(start),
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  const attendeesCurrent = useQuery({
    queryKey: ['manage-attendees', gymId, start, end],
    enabled: !!gymId && showMembers && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('count_attendance_attendees', {
        p_gym_id: gymId!,
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
  const attendeesPrev = useQuery({
    queryKey: ['manage-attendees', gymId, prev?.start, prev?.end],
    enabled: !!gymId && showMembers && rangeValid && !!prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('count_attendance_attendees', {
        p_gym_id: gymId!,
        p_period_start: prev!.start,
        p_period_end: prev!.end,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  const summary = useQuery({
    queryKey: ['insights-summary', membership?.gymId, preset, start, end],
    enabled: !!membership?.gymId && canSeeInsights && rangeValid,
    queryFn: async (): Promise<InsightsSummary> => {
      const { data, error } = await supabase.rpc('compute_insight_summary', {
        p_gym_id: membership!.gymId,
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      const rows = data as unknown as InsightsSummary[];
      if (!rows || rows.length === 0) {
        return {
          intros_new: 0,
          intros_target: 0,
          conversions: 0,
          conversions_target: 0,
          expiring_soon: 0,
          expired: 0,
          paying_now: 0,
          billing_live: false,
        };
      }
      return rows[0];
    },
  });

  if (!canSeeInsights && !showRevenue && !showMembers) {
    return (
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        You don't have permission to see insights.
      </Text>
    );
  }

  const queryError =
    revenueCurrent.error ??
    revenuePrev.error ??
    membersCurrent.error ??
    membersPrev.error ??
    attendeesCurrent.error ??
    attendeesPrev.error ??
    summary.error;

  const revenueNow = pickPrimaryCurrency(revenueCurrent.data ?? []);
  const revenueThen = pickPrimaryCurrency(revenuePrev.data ?? []);
  const revenueLoading = revenueCurrent.isLoading || revenuePrev.isLoading;
  const revenueDelta = revenueLoading
    ? undefined
    : pctDelta(revenueNow.gross_cents, revenueThen.gross_cents);

  const membersNow = membersCurrent.data ?? 0;
  const membersThen = membersPrev.data ?? 0;
  const membersLoading = membersCurrent.isLoading || membersPrev.isLoading;
  const membersDelta = membersLoading ? undefined : pctDelta(membersNow, membersThen);

  // Attendance rate = distinct attendees / total members at period end * 100.
  const attendanceLoading =
    attendeesCurrent.isLoading ||
    attendeesPrev.isLoading ||
    membersCurrent.isLoading ||
    membersPrev.isLoading;
  const ratePctNow = membersNow > 0 ? ((attendeesCurrent.data ?? 0) / membersNow) * 100 : 0;
  const ratePctThen = membersThen > 0 ? ((attendeesPrev.data ?? 0) / membersThen) * 100 : 0;
  const attendanceDelta = attendanceLoading ? undefined : ppDelta(ratePctNow, ratePctThen);

  return (
    <View className="gap-4">
      <DateRangeCta
        preset={preset}
        range={range}
        customStart={customStart}
        customEnd={customEnd}
        onChange={(next) => {
          setPreset(next.preset);
          if (next.preset === 'custom') {
            setCustomStart(next.start);
            setCustomEnd(next.end);
          }
        }}
      />

      {!rangeValid ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          Pick valid dates with From on or before To.
        </Text>
      ) : null}

      {queryError ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(queryError, 'Could not load insights')}
        </Text>
      ) : null}

      {/* One continuous grid so tiles pair up two-per-row on mobile
          instead of each group stranding a full-width odd one out. */}
      <View className="flex-row gap-3 flex-wrap">
        {showRevenue ? (
          <StatTile
            title="Revenue"
            value={
              revenueLoading
                ? '—'
                : formatCurrency(revenueNow.gross_cents, revenueNow.currency)
            }
            subtitle="vs previous period"
            delta={revenueDelta}
            href="/management/plans"
          />
        ) : null}
        {showMembers ? (
          <StatTile
            title="Members"
            value={membersLoading ? '—' : membersNow}
            subtitle="vs previous period"
            delta={membersDelta}
            href="/management/members"
          />
        ) : null}
        {showMembers ? (
          <StatTile
            title="Attendance"
            value={attendanceLoading ? '—' : `${ratePctNow.toFixed(0)}%`}
            subtitle="of members checked in"
            delta={attendanceDelta}
            href="/management/attendance"
          />
        ) : null}
        {canSeeInsights ? (
          <StatTile
            title="Intros"
            value={summary.data?.intros_new ?? '—'}
            subtitle="new this period"
          />
        ) : null}
        {canSeeInsights ? (
          <StatTile
            title="Expiring soon"
            value={summary.data?.expiring_soon ?? '—'}
            subtitle="≤ 7 days"
          />
        ) : null}
        {canSeeInsights ? (
          <StatTile
            title="Expired"
            value={summary.data?.expired ?? '—'}
            subtitle="no live access"
          />
        ) : null}
      </View>

      {canSeeInsights && summary.data ? (
        <View className="gap-3">
          {summary.data.billing_live ? (
            <View className="flex-row gap-3 flex-wrap">
              <StatTile
                title="Paying"
                value={summary.data.paying_now}
                subtitle="ever paid"
              />
              <ConversionTile
                conversions={summary.data.conversions}
                target={summary.data.conversions_target}
              />
            </View>
          ) : (
            <View className="flex-row gap-3 flex-wrap">
              <BillingNotLiveTile title="Paying" />
              <BillingNotLiveTile title="Conversion" />
            </View>
          )}
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Period: {start} → {end}. Intros target:{' '}
            {summary.data.intros_target > 0
              ? `${summary.data.intros_new} / ${summary.data.intros_target}`
              : 'not set'}
            .
          </Text>
        </View>
      ) : null}

      {canSetTargets ? <TargetsLauncher /> : null}
    </View>
  );
}

function ConversionTile({
  conversions,
  target,
}: {
  conversions: number;
  target: number;
}) {
  const hasTarget = target > 0;
  const ratio = hasTarget ? Math.min(1, conversions / target) : 0;
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 flex-1 min-w-[150px]">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        Conversion
      </Text>
      <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
        {conversions}
        {hasTarget ? (
          <Text className="text-gray-500 dark:text-gray-400 text-lg"> / {target}</Text>
        ) : null}
      </Text>
      {hasTarget ? (
        <View className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <View
            className="h-full bg-primary"
            style={{ width: `${ratio * 100}%` }}
          />
        </View>
      ) : (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          Target not set
        </Text>
      )}
    </View>
  );
}

function TargetsLauncher() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <View className="mt-2">
        <Button variant="secondary" onPress={() => setOpen(true)}>
          Configure targets
        </Button>
      </View>
    );
  }
  return (
    <View className="gap-3">
      <TargetsSection />
      <View className="self-start">
        <Button variant="ghost" onPress={() => setOpen(false)}>
          Hide targets
        </Button>
      </View>
    </View>
  );
}

function TargetsSection() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const targetsQuery = useQuery({
    queryKey: ['insight-targets', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_insight_targets')
        .select('metric, period, target_value')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as TargetRow[];
    },
  });

  useEffect(() => {
    if (!targetsQuery.data) return;
    const next: Record<string, string> = {};
    for (const t of targetsQuery.data) {
      next[`${t.metric}-${t.period}`] = String(t.target_value);
    }
    setValues(next);
  }, [targetsQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('No gym selected');
      const toUpsert: {
        gym_id: string;
        metric: TargetMetric;
        period: TargetPeriod;
        target_value: number;
        updated_by: string;
      }[] = [];
      for (const m of TARGET_METRICS) {
        for (const p of TARGET_PERIODS) {
          const key = `${m.value}-${p}`;
          const raw = values[key]?.trim() ?? '';
          if (raw.length === 0) continue;
          const n = Number.parseInt(raw, 10);
          if (!Number.isFinite(n) || n < 0) {
            throw new Error(`${m.label} (${p}): must be a non-negative integer`);
          }
          toUpsert.push({
            gym_id: membership.gymId,
            metric: m.value,
            period: p,
            target_value: n,
            updated_by: session.user.id,
          });
        }
      }
      if (toUpsert.length === 0) return;
      const { error } = await supabase
        .from('gym_insight_targets')
        .upsert(toUpsert, { onConflict: 'gym_id,metric,period' });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['insight-targets'] });
      queryClient.invalidateQueries({ queryKey: ['insights-summary'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save targets')),
  });

  return (
    <View className="gap-4 pt-4 border-t border-gray-200 dark:border-gray-800">
      <View className="gap-2">
        <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
          Targets
        </Text>
        <Text className="text-gray-500 dark:text-gray-400">
          Set monthly and quarterly goals. The tiles above show progress
          against these.
        </Text>
      </View>

      <View className="gap-4">
        {TARGET_METRICS.map((m) => (
          <View
            key={m.value}
            className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <View className="gap-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                {m.label}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                {m.description}
              </Text>
            </View>
            <View className="flex-row gap-3">
              {TARGET_PERIODS.map((p) => {
                const key = `${m.value}-${p}`;
                return (
                  <View key={p} className="flex-1">
                    <Input
                      label={p === 'month' ? 'Per month' : 'Per quarter'}
                      value={values[key] ?? ''}
                      onChangeText={(v) => setValues({ ...values, [key]: v })}
                      placeholder="0"
                      keyboardType="number-pad"
                    />
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      <Button onPress={() => save.mutate()} loading={save.isPending} success={saved}>
        Save targets
      </Button>
    </View>
  );
}

// ============================================================================
// Members tab — attendance stats first, export CTA, then the member list.
// Tag rules sit at the bottom as a CTA.
// ============================================================================

function MembersTab() {
  const { data: membership } = useGymMembership();
  const canViewAttendance = useCan('can_view_attendance') ?? false;
  const canExport = useCan('can_export_members') ?? false;
  const canManageTags = useCan('can_manage_tags') ?? false;
  const canManageStaff = useCan('can_manage_staff') ?? false;
  const canInvite = useCan('can_invite') ?? false;
  const exportMembers = useExportMembersCsv();

  const [preset, setPreset] = useState<Preset>('month');
  const [customStart, setCustomStart] = useState(() => isoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const range = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetRange(preset, new Date());
  }, [preset, customStart, customEnd]);
  const { start, end } = range;
  const rangeValid =
    DATE_RE.test(start) && DATE_RE.test(end) && start <= end;

  const sessionsQuery = useQuery({
    queryKey: ['attendance-sessions', membership?.gymId, start, end],
    enabled: !!membership?.gymId && canViewAttendance && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select('id, class_type_id, starts_at')
        .gte('starts_at', `${start}T00:00:00Z`)
        .lte('starts_at', `${end}T23:59:59Z`);
      if (error) throw error;
      return (data ?? []) as AttendanceSession[];
    },
  });

  const sessionIds = useMemo(
    () => (sessionsQuery.data ?? []).map((s) => s.id),
    [sessionsQuery.data],
  );

  const bookingsQuery = useQuery({
    queryKey: ['attendance-bookings', membership?.gymId, sessionIds.join(',')],
    enabled: !!membership?.gymId && canViewAttendance && sessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select('class_session_id, attended_at, no_show')
        .in('class_session_id', sessionIds);
      if (error) throw error;
      return (data ?? []) as AttendanceBooking[];
    },
  });

  const totals = useMemo(() => {
    const typeBuckets = bucketByClassType(
      bookingsQuery.data ?? [],
      sessionsQuery.data ?? [],
    );
    return typeBuckets.reduce(
      (acc, b) => ({
        attended: acc.attended + b.attended,
        no_show: acc.no_show + b.no_show,
        unmarked: acc.unmarked + b.unmarked,
      }),
      { attended: 0, no_show: 0, unmarked: 0 },
    );
  }, [bookingsQuery.data, sessionsQuery.data]);

  return (
    <View className="gap-4">
      {canViewAttendance ? (
        <View className="gap-3">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Attendance
          </Text>
          <DateRangeCta
            preset={preset}
            range={range}
            customStart={customStart}
            customEnd={customEnd}
            onChange={(next) => {
              setPreset(next.preset);
              if (next.preset === 'custom') {
                setCustomStart(next.start);
                setCustomEnd(next.end);
              }
            }}
          />
          <View className="flex-row gap-3 flex-wrap">
            <StatTile
              title="Attended"
              value={totals.attended}
              tone="green"
              minWidth={120}
            />
            <StatTile
              title="No-show"
              value={totals.no_show}
              tone="red"
              minWidth={120}
            />
            <StatTile
              title="Unmarked"
              value={totals.unmarked}
              tone="muted"
              minWidth={120}
            />
          </View>
        </View>
      ) : null}

      {canExport ? (
        <View className="gap-2">
          <ChipButton
            className="self-start"
            label={exportMembers.isPending ? 'Exporting…' : 'Export members CSV'}
            icon="download-outline"
            tone="neutral"
            onPress={() => exportMembers.mutate()}
            disabled={exportMembers.isPending}
          />
          {exportMembers.error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {exportErrorMessage(exportMembers.error, 'members')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {canInvite ? (
        <InviteSection
          title="Invite a member"
          subtitle="Email a member an invite to join your gym."
          roles={['member']}
          initialRole="member"
        />
      ) : null}

      <MemberSignupLinkCard />

      {canManageStaff ? (
        <View className="gap-3">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Bring data across
          </Text>
          <ManagementCard
            title="Import members"
            description="Drop in a CSV from Mindbody, PushPress, Glofox, Wodify or a spreadsheet — members link to their data when they sign up."
            href="/management/members/import"
          />
          <ManagementCard
            title="Import workout history"
            description="Seed past sets per member — one row per movement result. Lands in /track so PR pages and trends light up immediately."
            href="/management/members/import-workouts"
          />
        </View>
      ) : null}

      {canManageTags ? (
        <>
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Members
          </Text>
          <MembersList />
          <ManagementCard
            title="Tag rules"
            description="Auto-tag members based on cohort state."
            href="/management/tags"
          />
        </>
      ) : null}
    </View>
  );
}

