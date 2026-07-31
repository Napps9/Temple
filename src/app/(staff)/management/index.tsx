import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import {
  DATE_RE,
  DateRangeCta,
  PRESET_LABELS,
  type Preset,
  isoDate,
  presetRange,
} from '@/components/DateRangeCta';
import { GymSetupChecklist } from '@/components/GymSetupChecklist';
import { ImportDataModal } from '@/components/ImportDataModal';
import { Input } from '@/components/Input';
import { InviteMemberModal } from '@/components/InviteMemberModal';
import { LeaderboardsPanel } from '@/components/LeaderboardsPanel';
import { MemberSignupLinkCard } from '@/components/MemberSignupLinkCard';
import { MembersList } from '@/components/MembersList';
import { MessagingPanel } from '@/components/MessagingPanel';
import { Screen } from '@/components/Screen';
import { TagRulesModal } from '@/components/TagRulesModal';
import { StatTile } from '@/components/StatTile';
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
import {
  dayBefore,
  mirrorRange,
  pctDelta,
  pickPrimaryCurrency,
  ppDelta,
  type RevenueRow,
} from '@/lib/metrics';
import { useGymCurrency } from '@/lib/useGymCurrency';
import type { GymRole } from '@/types/database';
import { useCan } from '@/lib/useCan';
import {
  categoriesWithEntries,
  searchBackOffice,
  visibleEntries,
  CATEGORY_LABELS,
  type BackOfficeCategory,
  type BackOfficeEntry,
  type SettingsSectionId,
} from '@/lib/back-office';
import { useSavedFlag } from '@/lib/useSavedFlag';
import { useThemeColors } from '@/lib/theme';
import { BrandingPanel } from './branding';
import { ClassTypesPanel } from './class-types';
import { CommunicationsHome } from './communications';
import { OperatingDefaultsPanel } from './operating';
import { HealthScreeningPanel } from './parq';
import { PlansPanel } from './plans';
import { StoreHome } from './store';

type LinkHref = ComponentProps<typeof Link>['href'];

function ManagementCard({
  title,
  description,
  href,
  onPress,
  comingSoon,
  saidInstead,
}: {
  title: string;
  description: string;
  href?: LinkHref;
  // Set instead of `href` for a surface that lives inside this screen —
  // Leaderboards and Messaging, whose routes are retired. A Link back to
  // the screen you are already standing on is not navigation, and this
  // screen already keeps which tab is showing in state rather than in the
  // URL, so a section belongs in state too.
  onPress?: () => void;
  comingSoon?: boolean;
  // The sentence that does the same job in the bar. Somebody reading a
  // tile is somebody who came looking for a screen — the one moment worth
  // telling them they need not have.
  saidInstead?: string;
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
      {saidInstead ? (
        <Text className="text-gray-400 dark:text-gray-500 text-xs">
          or say “{saidInstead}”
        </Text>
      ) : null}
    </View>
  );
  if (onPress && !comingSoon) {
    return <Pressable onPress={onPress}>{body}</Pressable>;
  }
  if (href && !comingSoon) {
    return (
      <Link href={href} asChild>
        <Pressable>{body}</Pressable>
      </Link>
    );
  }
  return body;
}

type IconName = ComponentProps<typeof Ionicons>['name'];

const CATEGORY_ICONS: Record<BackOfficeCategory, IconName> = {
  members: 'people-outline',
  crm: 'sparkles-outline',
  comms: 'mail-outline',
  website: 'globe-outline',
  store: 'bag-handle-outline',
  team: 'briefcase-outline',
  plans: 'pricetags-outline',
  settings: 'settings-outline',
};

// Section nav, shared by the desktop sidebar menu (vertical, transparent
// rows in a bordered panel) and the mobile pill row (horizontal white
// cards on the page). Same items, two layouts.
function ManageNav({
  categories,
  active,
  onSelect,
  vertical,
}: {
  categories: BackOfficeCategory[];
  active: BackOfficeCategory;
  onSelect: (c: BackOfficeCategory) => void;
  vertical: boolean;
}) {
  const colors = useThemeColors();
  const pills = categories.map((c) => {
    const selected = c === active;
    return (
      <Pressable
        key={c}
        onPress={() => onSelect(c)}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        className={`flex-row items-center gap-2.5 rounded-lg px-3 py-2.5 active:opacity-80 ${
          vertical ? 'w-full' : ''
        } ${
          selected
            ? 'bg-primary shadow-card'
            : vertical
              ? 'hover:bg-slate-200/60 dark:hover:bg-gray-800'
              : 'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700'
        }`}>
        <Ionicons
          name={CATEGORY_ICONS[c]}
          size={17}
          color={selected ? '#FFFFFF' : colors.iconSecondary}
        />
        <Text
          className={`text-sm font-medium ${
            selected ? 'text-white' : 'text-gray-700 dark:text-gray-200'
          }`}>
          {CATEGORY_LABELS[c]}
        </Text>
      </Pressable>
    );
  });

  if (vertical) {
    return <View className="gap-1">{pills}</View>;
  }

  // Mobile: a single horizontal strip that bleeds to the screen edges
  // (the parent content padding is px-4) rather than wrapping into
  // ragged rows. The last pill peeking off the right edge is the scroll
  // affordance.
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-4"
      contentContainerClassName="flex-row gap-2 px-4">
      {pills}
    </ScrollView>
  );
}

// Everything behind this door, found by typing.
//
// Twenty-odd surfaces behind eight category pills is findable only by
// somebody who already knows which pill owns what — which is fine for the
// person who built it and no use to the owner who wants "the thing where
// I refund somebody". Searching crosses every category, and matches the
// bar sentence too, so half-remembering either one lands in the same
// place.
function SearchResults({
  results,
  query,
  onOpenSection,
}: {
  results: BackOfficeEntry[];
  query: string;
  onOpenSection: (id: SettingsSectionId) => void;
}) {
  if (results.length === 0) {
    return (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 border border-gray-100 dark:border-gray-800 shadow-card">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">
          Nothing here matches “{query.trim()}”.
        </Text>
        <Text className="text-gray-500 dark:text-gray-400">
          It may be something you can just say — try asking for it in the
          Timeline.
        </Text>
      </View>
    );
  }
  return (
    <View className="gap-3">
      {results.map((e) => (
        <ManagementCard
          key={`${e.href}:${e.title}`}
          title={e.title}
          description={e.blurb}
          href={e.section ? undefined : (e.href as LinkHref)}
          onPress={e.section ? () => onOpenSection(e.section!) : undefined}
          saidInstead={e.saidInstead}
        />
      ))}
    </View>
  );
}

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
  const canWorkLeads = useCan('can_work_leads');
  const canManageWebsite = useCan('can_manage_website');

  const canManageParq = useCan('can_manage_parq');

  // The catalogue lives in src/lib/back-office.ts so it can be counted,
  // searched and guarded. The hooks stay here — they cannot be called from
  // a loop — and the manifest only says which key to look up, the same
  // shape actionsFor(can) uses for the bar's vocabulary.
  const capabilities: Record<string, boolean | undefined> = {
    can_see_insights: canSeeInsights,
    can_view_attendance: canViewAttendance,
    can_manage_tasks: canManageTasks,
    can_request_cover: canRequestCover,
    can_claim_cover: canClaimCover,
    can_view_sops: canViewSops,
    can_manage_staff: canManageStaff,
    can_edit_classes: canEditClasses,
    can_manage_tags: canManageTags,
    can_manage_plans: canManagePlans,
    can_set_coach_pay: canSetCoachPay,
    can_configure_leaderboards: canConfigureLeaderboards,
    can_manage_comms: canManageComms,
    can_manage_store: canManageStore,
    can_assign_plan: canAssignPlan,
    can_work_leads: canWorkLeads,
    can_manage_website: canManageWebsite,
    can_manage_parq: canManageParq,
  };
  const entries = visibleEntries((c) => capabilities[c], role);
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const results = searchBackOffice(query, entries);

  const availableCategories = categoriesWithEntries(entries);
  const [active, setActive] = useState<BackOfficeCategory>(
    availableCategories[0] ?? 'members',
  );

  // Leaderboards and Messaging have no route any more — their door is a
  // section of this screen. Asking for one lands on Settings with that
  // section first and open, and clears the search, because results replace
  // the tab body and leaving the query set would show the row again
  // instead of the thing it points at.
  const [openSection, setOpenSection] = useState<SettingsSectionId | null>(null);
  function openSettingsSection(id: SettingsSectionId) {
    setActive('settings');
    setOpenSection(id);
    setQuery('');
  }
  const activeCategory = availableCategories.includes(active)
    ? active
    : availableCategories[0] ?? 'members';
  // Most categories render a panel that is its own way in. These are the
  // surfaces with no panel and no other door — before the manifest, Goals
  // and the Roster were reachable only from two quick-links on the
  // Timeline, which is not somewhere anybody thinks to look for them.
  const visibleCards = entries.filter(
    (e) => e.needsTile && e.category === activeCategory,
  );

  // The Website "category" is really just a doorway to the full-screen
  // site builder — it has no inline panel, only a single card that
  // links onward. So selecting it in the nav goes straight to the
  // builder rather than parking the user on a one-card page.
  function selectCategory(c: BackOfficeCategory) {
    if (c === 'website') {
      router.push('/management/website');
      return;
    }
    // AI Front Desk is a doorway to the leads page, like Website — no inline panel.
    if (c === 'crm') {
      router.push('/management/leads');
      return;
    }
    setActive(c);
  }

  return (
    <Screen edges={['bottom', 'left', 'right']} className="px-0">
      <View className="flex-1 lg:flex-row">
        {/* Desktop: a full-height left sidebar menu. Mobile: hidden — the
            pills render inside the scroll area instead. */}
        {availableCategories.length > 1 ? (
          <View className="hidden lg:flex lg:w-60 lg:shrink-0 border-r border-gray-200 dark:border-gray-800 px-4 py-6">
            <ManageNav
              categories={availableCategories}
              active={activeCategory}
              onSelect={selectCategory}
              vertical
            />
          </View>
        ) : null}
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-4 py-6 px-4 lg:px-8 lg:max-w-5xl lg:w-full">
          {entries.length > 1 ? (
            <Input
              label="Find a setting"
              value={query}
              onChangeText={setQuery}
              placeholder="refunds, sending domain, coach pay…"
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          {searching ? null : availableCategories.length > 1 ? (
            <View className="lg:hidden">
              <ManageNav
                categories={availableCategories}
                active={activeCategory}
                onSelect={selectCategory}
                vertical={false}
              />
            </View>
          ) : null}
          {/* Owner-only setup nudge. Self-hides once all five steps are done
              so the card never nags a finished gym. */}
          {searching ? null : <GymSetupChecklist />}
          {searching ? (
            <SearchResults
              results={results}
              query={query}
              onOpenSection={openSettingsSection}
            />
          ) : activeCategory === 'members' ? (
          <MembersTab />
        ) : activeCategory === 'comms' ? (
          <CommunicationsHome />
        ) : activeCategory === 'store' ? (
          <StoreHome />
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
          <SettingsTab open={openSection} />
        ) : null}
        {searching
          ? null
          : visibleCards.map((c) => (
              <ManagementCard
                key={c.title}
                title={c.title}
                description={c.blurb}
                href={c.section ? undefined : (c.href as LinkHref)}
                onPress={c.section ? () => openSettingsSection(c.section!) : undefined}
                saidInstead={c.saidInstead}
              />
            ))}
        </ScrollView>
      </View>
    </Screen>
  );
}

function SettingsTab({ open }: { open: SettingsSectionId | null }) {
  const canManageStaff = useCan('can_manage_staff') ?? false;
  const canConfigureLeaderboards = useCan('can_configure_leaderboards') ?? false;
  const canEditClasses = useCan('can_edit_classes') ?? false;
  const canManageParq = useCan('can_manage_parq') ?? false;

  const sections: {
    id: SettingsSectionId;
    title: string;
    description: string;
    icon: IconName;
    visible: boolean;
    panel: ReactNode;
  }[] = [
    {
      id: 'gym-settings',
      title: 'Gym settings',
      description:
        'Week start, booking windows, cancel cutoff, PAR-Q expiry, plan resolution.',
      icon: 'options-outline',
      visible: canManageStaff,
      panel: <OperatingDefaultsPanel />,
    },
    {
      id: 'branding',
      title: 'Branding',
      description: 'Logo, colours, gym name, public join link.',
      icon: 'color-palette-outline',
      visible: canManageStaff,
      panel: <BrandingPanel />,
    },
    {
      id: 'health-screening',
      title: 'Health screening',
      description: 'Upload a waiver to sign, or build a PAR-Q. One is enough.',
      icon: 'heart-outline',
      visible: canManageParq,
      panel: <HealthScreeningPanel />,
    },
    {
      id: 'leaderboards',
      title: 'Leaderboards',
      description: 'Turn class and strength comparisons on or off.',
      icon: 'trophy',
      visible: canConfigureLeaderboards,
      panel: <LeaderboardsPanel />,
    },
    {
      id: 'messaging',
      title: 'Messaging',
      description: 'Decide who can DM whom inside the gym.',
      icon: 'chatbubbles-outline',
      visible: canManageStaff,
      panel: <MessagingPanel />,
    },
    {
      id: 'class-types',
      title: 'Class types',
      description: 'Name, colour and schedule the kinds of class you run.',
      icon: 'calendar-outline',
      visible: canEditClasses,
      panel: <ClassTypesPanel />,
    },
  ];

  // The named section goes to the top rather than being scrolled to.
  // Landing at the top of six collapsed cards with the one you asked for
  // below the fold is the same as not opening it.
  const shown = sections.filter((s) => s.visible);
  const ordered = open
    ? [...shown.filter((s) => s.id === open), ...shown.filter((s) => s.id !== open)]
    : shown;

  return (
    <View className="gap-3">
      {ordered.map((s) => (
        <SettingsSection
          key={s.id}
          title={s.title}
          description={s.description}
          icon={s.icon}
          defaultOpen={s.id === open}>
          {s.panel}
        </SettingsSection>
      ))}
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
  defaultOpen,
  children,
}: {
  title: string;
  description: string;
  icon: IconName;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  // Opens on a deep link and never force-closes: somebody who arrived at
  // one section and then collapsed it has said what they want.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  const colors = useThemeColors();
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl shadow-card">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-3 p-4 active:opacity-70">
        <View className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
          <Ionicons name={icon} size={18} color={colors.iconSecondary} />
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
          color={colors.iconTertiary}
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
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
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
      // claimed_by lives on the per-session offers, not the header —
      // querying it on cover_requests errored, so this pill always
      // rendered 0.
      const { count, error } = await supabase
        .from('cover_request_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', membership!.gymId)
        .eq('original_coach_id', member.profile_id)
        .is('claimed_by', null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl shadow-card">
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
  const colors = useThemeColors();
  const body = (
    <View className="flex-row items-center gap-1 px-2 py-1 rounded-full bg-gray-50 dark:bg-gray-800">
      <Ionicons name={icon} size={13} color={colors.iconSecondary} />
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
  const colors = useThemeColors();

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
          <Ionicons name="ribbon-outline" size={16} color={colors.iconSecondary} />
          <Text className="text-gray-700 dark:text-gray-200 text-sm">
            Class type qualifications
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.iconTertiary}
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
                    accessibilityLabel={ct.name}
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
  const colors = useThemeColors();
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
          <Ionicons name="cash-outline" size={16} color={colors.iconSecondary} />
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



// ============================================================================
// Insights tab — Revenue, Members, Attendance. Everything lead/lifecycle
// related (intros, conversions, retention, targets) lives on the AI Front
// Desk tab instead — see LeadsScreen's stats row.
// ============================================================================

// Insights stats — the KPI grid, driven by the Members tab's shared date
// range (passed in) so the same picker filters these and the attendance
// summary together.
function InsightsStats({
  range,
  rangeValid,
}: {
  range: { start: string; end: string };
  rangeValid: boolean;
}) {
  const { data: membership } = useGymMembership();
  const gymCurrency = useGymCurrency();
  const canSeeInsights = useCan('can_see_insights') ?? false;
  const showRevenue = useCan('can_see_money') ?? false;
  const showMembers = useCan('can_view_attendance') ?? false;

  const { start, end } = range;
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

  if (!canSeeInsights && !showRevenue && !showMembers) return null;

  const queryError =
    revenueCurrent.error ??
    revenuePrev.error ??
    membersCurrent.error ??
    membersPrev.error ??
    attendeesCurrent.error ??
    attendeesPrev.error;

  const revenueNow = pickPrimaryCurrency(revenueCurrent.data ?? [], gymCurrency);
  const revenueThen = pickPrimaryCurrency(revenuePrev.data ?? [], gymCurrency);
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
      {queryError ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(queryError, 'Could not load insights')}
        </Text>
      ) : null}

      {/* One continuous grid so tiles pair up two-per-row on mobile
          instead of each group stranding a full-width odd one out. */}
      {/* KPI grid — 2-up on mobile, 3-up on desktop, via padding-gutter
          cells so the tiles stay a comfortable size instead of stranding
          six tiny columns across a wide dashboard. */}
      <View className="flex-row flex-wrap -m-1.5">
        {showRevenue ? (
          <View className="w-1/2 lg:w-1/3 p-1.5">
            <StatTile
              title="Revenue"
              value={
                revenueLoading
                  ? '—'
                  : formatMoney(revenueNow.gross_cents, revenueNow.currency)
              }
              subtitle="vs previous period"
              delta={revenueDelta}
              href="/management/plans"
            />
          </View>
        ) : null}
        {showMembers ? (
          <View className="w-1/2 lg:w-1/3 p-1.5">
            <StatTile
              title="Members"
              value={membersLoading ? '—' : membersNow}
              subtitle="vs previous period"
              delta={membersDelta}
              href="/management/members"
            />
          </View>
        ) : null}
        {showMembers ? (
          <View className="w-1/2 lg:w-1/3 p-1.5">
            <StatTile
              title="Attendance"
              value={attendanceLoading ? '—' : `${ratePctNow.toFixed(0)}%`}
              subtitle="of members checked in"
              delta={attendanceDelta}
              href="/management/attendance"
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ============================================================================
// Members tab — one shared date range drives the insight KPIs and the
// attendance summary; the member list sits high with Invite / Import / Tag
// rules folded into CTA modals so it stays the focus of the page.
// ============================================================================

function MembersTab() {
  const { data: membership } = useGymMembership();
  const canViewAttendance = useCan('can_view_attendance') ?? false;
  const canSeeInsights = useCan('can_see_insights') ?? false;
  const canSeeMoney = useCan('can_see_money') ?? false;
  const canExport = useCan('can_export_members') ?? false;
  const canManageTags = useCan('can_manage_tags') ?? false;
  const canManageStaff = useCan('can_manage_staff') ?? false;
  const canInvite = useCan('can_invite') ?? false;
  const canAssignPlan = useCan('can_assign_plan') ?? false;
  const exportMembers = useExportMembersCsv();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tagRulesOpen, setTagRulesOpen] = useState(false);

  // can_see_money and can_see_insights are owner/admin; can_view_attendance
  // extends to coaches/staff, who then get the member + attendance tiles.
  const showInsights = canSeeInsights || canSeeMoney || canViewAttendance;

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
      {showInsights ? (
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
      ) : null}

      {showInsights && !rangeValid ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          Pick valid dates with From on or before To.
        </Text>
      ) : null}

      {showInsights ? (
        <InsightsStats range={range} rangeValid={rangeValid} />
      ) : null}

      {canViewAttendance ? (
        <View className="gap-3">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Attendance
          </Text>
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

      {canInvite || canManageStaff || canManageTags || canExport ? (
        <View className="gap-2">
          <View className="flex-row flex-wrap gap-2">
            {canInvite ? (
              <ActionCta
                icon="person-add-outline"
                label="Invite a member"
                onPress={() => setInviteOpen(true)}
              />
            ) : null}
            {canManageStaff ? (
              <ActionCta
                icon="cloud-upload-outline"
                label="Import data"
                onPress={() => setImportOpen(true)}
              />
            ) : null}
            {canManageTags ? (
              <ActionCta
                icon="pricetag-outline"
                label="Tag rules"
                onPress={() => setTagRulesOpen(true)}
              />
            ) : null}
            {canExport ? (
              <ActionCta
                icon="download-outline"
                label={exportMembers.isPending ? 'Exporting…' : 'Export CSV'}
                onPress={() => exportMembers.mutate()}
                disabled={exportMembers.isPending}
              />
            ) : null}
          </View>
          {canExport && exportMembers.error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {exportErrorMessage(exportMembers.error, 'members')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Inviters get the branded signup link + QR inside the Invite modal;
          front-desk staff who can't invite keep it inline so they can still
          hand a walk-in the join link. */}
      {!canInvite ? <MemberSignupLinkCard /> : null}

      {canManageTags ? <MembersList /> : null}

      {canInvite ? (
        <InviteMemberModal
          visible={inviteOpen}
          onClose={() => setInviteOpen(false)}
          canInvite={canInvite}
        />
      ) : null}
      {canManageStaff ? (
        <ImportDataModal
          visible={importOpen}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      {canManageTags ? (
        <TagRulesModal
          visible={tagRulesOpen}
          onClose={() => setTagRulesOpen(false)}
        />
      ) : null}
    </View>
  );
}

// A compact tappable tile for the Members-tab actions (Invite, Import, Tag
// rules, Export) — small enough to sit in one wrapping row so the member
// list stays high on the page.
function ActionCta({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`flex-1 min-w-[150px] flex-row items-center gap-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3.5 py-3 shadow-card active:opacity-70 ${
        disabled ? 'opacity-50' : ''
      }`}>
      <View className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
        <Ionicons name={icon} size={16} color={colors.iconSecondary} />
      </View>
      <Text className="text-gray-900 dark:text-gray-50 font-medium text-sm">
        {label}
      </Text>
    </Pressable>
  );
}

