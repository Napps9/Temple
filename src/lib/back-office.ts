// Every management surface, as data.
//
// The Manage screen has been a Back Office index since it was built — a
// tile per surface, grouped into eight categories, gated by capability.
// What it has not been is *countable*. The catalogue lived inline in a
// 1,600-line screen, entangled with the panels that render underneath it,
// which is why "routes retired" — one of the roadmap's two public
// measures — has stayed a claim in a document rather than a number a test
// can assert.
//
// So it moves here, pure and unable to import Supabase, the same split
// site-domain.ts and sending-domain.ts use so vitest can load it. Three
// things follow that could not before:
//
//   * A guard can read every route file under (staff)/management and
//     assert each one is either in this list or explicitly parented to a
//     screen that links to it. A surface can no longer be built and then
//     become unreachable — which had already happened three times when
//     this was written: health screening, Goals and the Roster.
//   * The index can be searched, because there is something to search.
//     Twenty-five tiles behind eight category pills is findable only by
//     somebody who knows which pill owns what.
//   * RETIRED_ROUTES gives the burndown a numerator. A route that goes is
//     recorded here rather than deleted silently, so "routes retired" is a
//     number a test asserts and a reason somebody can read.
//
// The gate is expressed as data rather than as `useCan` calls, so the
// screen still does the asking and this module only says what to ask —
// the same shape as actionsFor(can) in src/lib/actions/index.ts. Nobody's
// visible tiles change.

export type BackOfficeCategory =
  | 'members'
  | 'crm'
  | 'comms'
  | 'website'
  | 'store'
  | 'team'
  | 'plans'
  | 'settings';

export const CATEGORY_ORDER: BackOfficeCategory[] = [
  'members',
  'crm',
  'comms',
  'website',
  'store',
  'team',
  'plans',
  'settings',
];

export const CATEGORY_LABELS: Record<BackOfficeCategory, string> = {
  members: 'Members',
  crm: 'AI Front Desk',
  comms: 'Email campaigns',
  website: 'Website',
  store: 'Store',
  team: 'Team',
  plans: 'Plans',
  settings: 'Settings',
};

// The collapsible sections of the Manage screen's Settings tab. A surface
// whose only route was a heading wrapped around one of these panels points
// here instead: same component, same gate, one door.
export type SettingsSectionId =
  | 'gym-settings'
  | 'branding'
  | 'health-screening'
  | 'leaderboards'
  | 'messaging'
  | 'class-types';

export type BackOfficeEntry = {
  href: string;
  // Set when the surface lives inside the Manage screen rather than at a
  // route of its own. The tile selects the Settings tab and opens that
  // section first, in place — there is nowhere to navigate to.
  section?: SettingsSectionId;
  title: string;
  blurb: string;
  category: BackOfficeCategory;
  // Any one of these is enough to see the tile. Empty means the tile is
  // gated on role alone.
  capabilities: string[];
  // Any one of these roles is enough, independent of capabilities — two
  // tiles have always worked this way and the manifest must not quietly
  // narrow them.
  roles?: string[];
  // The words somebody reaches for that are not in the title or the
  // blurb. Written after watching the search return nothing for "refund",
  // "coach pay", "dns" and "parq" — every one a thing an owner does, and
  // none of them a word the marketing sentence happened to use. A search
  // index that only knows the names we chose is a search index for the
  // people who chose them.
  keywords?: string[];
  // The sentence that does the same job in the bar, where one exists.
  // Shown on the tile, because the moment somebody goes looking for a
  // screen is the moment worth telling them they need not have.
  saidInstead?: string;
  // Two entries exist only to keep their category visible for a role that
  // can see the stats but not the member list — the Members panel renders
  // them itself, so a tile pointing at the page you are already on would
  // be noise. They are not tiles and they are not search results; they
  // are the reason the category appears at all.
  categoryOnly?: boolean;
  // Most categories render a panel that already offers its own way in, so
  // a tile would sit above the thing it links to. These two have no panel
  // and no other door — before the manifest they were reachable only from
  // two quick-links on the Timeline.
  needsTile?: boolean;
  status: 'primary' | 'back-office';
};

// Routes that no longer exist, and where the job went. The burndown's
// numerator, kept in the repository rather than in a changelog: a deletion
// that leaves a record of itself is reviewable, one that leaves a gap is
// just a thing somebody cannot find any more.
export const RETIRED_ROUTES: { route: string; because: string }[] = [
  {
    route: '/management/membership-requests',
    because:
      'The Timeline asks the same question with the same two choices, ' +
      'through the same RPC, and shows the member’s note beside it. The ' +
      'feed gates those rows on can_assign_plan — the capability this ' +
      'screen required — so the front-desk role it existed for is served ' +
      'without it, and owners already action them from the Members list.',
  },
  {
    route: '/management/leaderboards',
    because:
      'A Screen, a BackLink and a heading around LeaderboardsPanel, which ' +
      'the Manage screen’s Settings tab already rendered behind the same ' +
      'can_configure_leaderboards gate. Nothing in the app linked to the ' +
      'route; the panel moved to components/ and the entry now opens the ' +
      'Settings section.',
  },
  {
    route: '/management/messaging',
    because:
      'A Screen, a BackLink and a heading around MessagingPanel, which the ' +
      'Manage screen’s Settings tab already rendered behind the same ' +
      'can_manage_staff gate. Nothing in the app linked to the route; the ' +
      'panel moved to components/ and the entry now opens the Settings ' +
      'section.',
  },
];

export const BACK_OFFICE: BackOfficeEntry[] = [
  // --- Members -------------------------------------------------------
  {
    href: '/management/members',
    title: 'Members',
    blurb: 'Invite members, view them by cohort, see and edit their tags.',
    keywords: ['export', 'csv', 'cohort', 'tags', 'attendance', 'archive', 'remove'],
    category: 'members',
    capabilities: ['can_manage_tags'],
    saidInstead: 'show me Marcus',
    status: 'back-office',
  },
  {
    href: '/management/members',
    title: 'Insights',
    blurb: 'Revenue, members and attendance.',
    keywords: ['revenue', 'kpi', 'stats'],
    category: 'members',
    capabilities: ['can_see_insights'],
    saidInstead: 'what did we take last month',
    categoryOnly: true,
    status: 'back-office',
  },
  {
    href: '/management/members',
    title: 'Attendance',
    blurb: 'Trends from check-ins on class bookings.',
    keywords: ['check-in', 'no-show', 'register'],
    category: 'members',
    capabilities: ['can_view_attendance'],
    saidInstead: 'how busy have we been',
    categoryOnly: true,
    status: 'back-office',
  },
  {
    href: '/management/goals',
    title: 'Goals',
    blurb: 'What you are aiming at, scored off the live roster.',
    keywords: ['targets', 'kpi', 'objectives'],
    category: 'members',
    capabilities: ['can_see_insights'],
    needsTile: true,
    status: 'primary',
  },
  {
    href: '/management/tags',
    title: 'Tag rules',
    blurb: 'Auto-tag members based on cohort state.',
    keywords: ['automatic', 'segments', 'labels'],
    category: 'members',
    capabilities: ['can_manage_tags'],
    status: 'back-office',
  },
  {
    href: '/management/members/import',
    title: 'Import members',
    blurb: 'Stage members from Mindbody, PushPress, Glofox, Wodify or a spreadsheet.',
    keywords: ['migration', 'csv', 'mindbody', 'pushpress', 'glofox', 'wodify'],
    category: 'members',
    capabilities: ['can_manage_staff'],
    status: 'back-office',
  },
  {
    href: '/management/members/import-workouts',
    title: 'Import workout history',
    blurb: 'Seed past sets per member — lands in /track for PR pages and sparklines.',
    keywords: ['prs', 'sets', 'migration', 'csv'],
    category: 'members',
    capabilities: ['can_manage_staff'],
    status: 'back-office',
  },

  // --- AI Front Desk -------------------------------------------------
  {
    href: '/management/leads',
    title: 'AI Front Desk',
    blurb: 'Track prospects from first contact through conversion.',
    keywords: ['leads', 'enquiries', 'enquiry', 'prospects', 'sms', 'calls'],
    category: 'crm',
    capabilities: ['can_work_leads'],
    saidInstead: 'how are the enquiries looking',
    status: 'back-office',
  },

  // --- Comms ---------------------------------------------------------
  {
    href: '/management/communications',
    title: 'Email campaigns',
    blurb: 'Design, send and analyse email campaigns to your members.',
    keywords: ['newsletter', 'unsubscribe', 'bounce', 'sending domain', 'dns', 'spam', 'automations', 'topics', 'mailout'],
    category: 'comms',
    capabilities: ['can_manage_comms'],
    saidInstead: 'email everyone about the new opening times',
    status: 'back-office',
  },

  // --- Website -------------------------------------------------------
  {
    href: '/management/website',
    title: 'Website',
    blurb: 'A public site built from your own schedule, pricing and brand.',
    keywords: ['domain', 'dns', 'seo', 'publish', 'pages', 'public site'],
    category: 'website',
    capabilities: ['can_manage_website'],
    saidInstead: 'publish the website',
    status: 'back-office',
  },

  // --- Store ---------------------------------------------------------
  {
    href: '/management/store',
    title: 'Store',
    blurb: 'Sell merch, programmes and tickets; manage stock and orders.',
    keywords: ['refund', 'refunds', 'orders', 'stock', 'merch', 'shipping', 'products'],
    category: 'store',
    capabilities: ['can_manage_store'],
    saidInstead: 'how is the shop doing',
    status: 'back-office',
  },

  // --- Team ----------------------------------------------------------
  {
    href: '/management/roster',
    title: 'Roster',
    blurb: 'Who works for you — the coaches, and Temple’s jobs with their rope.',
    keywords: ['jobs', 'agents', 'rope', 'coaches', 'staff'],
    category: 'team',
    capabilities: ['can_manage_staff'],
    needsTile: true,
    status: 'primary',
  },
  {
    href: '/management/team',
    title: 'Team',
    blurb: 'Invite owners, coaches and staff.',
    keywords: ['staff', 'permissions', 'roles', 'capabilities', 'access'],
    category: 'team',
    capabilities: ['can_manage_staff'],
    saidInstead: 'invite Sam as a coach',
    status: 'back-office',
  },
  {
    href: '/management/coach-earnings',
    title: 'Coach earnings',
    blurb: 'Set per-class-type rates and review what coaches earned.',
    keywords: ['pay', 'wages', 'rates', 'payroll', 'coach pay'],
    category: 'team',
    capabilities: ['can_set_coach_pay'],
    status: 'back-office',
  },
  {
    href: '/management/sops',
    title: 'SOPs',
    blurb: 'How we do things here — for the whole team.',
    keywords: ['procedures', 'handbook', 'how-to'],
    category: 'team',
    capabilities: ['can_view_sops'],
    status: 'back-office',
  },
  {
    href: '/management/tasks',
    title: 'Tasks',
    blurb: 'Day-to-day staff work, assigned and tracked.',
    keywords: ['todo', 'checklist', 'jobs'],
    category: 'team',
    capabilities: ['can_manage_tasks'],
    roles: ['staff'],
    status: 'back-office',
  },
  {
    href: '/management/cover',
    title: 'Cover',
    blurb: 'Hand a class to another coach; first-claim wins.',
    keywords: ['swap', 'sub', 'holiday', 'absence'],
    category: 'team',
    capabilities: ['can_request_cover', 'can_claim_cover'],
    saidInstead: 'Jo is taking Saturday’s 9am',
    status: 'back-office',
  },

  // --- Plans ---------------------------------------------------------
  {
    href: '/management/billing',
    title: 'Billing & payments',
    blurb: 'Connect Stripe to charge members for memberships. You keep 100%.',
    keywords: ['stripe', 'refund', 'refunds', 'payouts', 'card', 'invoice', 'tax', 'vat', 'payments'],
    category: 'plans',
    capabilities: [],
    roles: ['owner'],
    status: 'back-office',
  },
  {
    href: '/management/plans',
    title: 'Plans',
    blurb: 'Define your membership plans, prices, and credit packs.',
    keywords: ['pricing', 'price', 'membership', 'credits', 'packs'],
    category: 'plans',
    capabilities: ['can_manage_plans'],
    saidInstead: 'Unlimited is £95 a month now',
    status: 'back-office',
  },

  // --- Settings ------------------------------------------------------
  {
    href: '/management/operating',
    title: 'Gym settings',
    blurb:
      'Week start, booking windows, PAR-Q expiry, plan resolution, retention.',
    keywords: ['cancellation', 'cutoff', 'booking window', 'timezone', 'retention', 'week start', 'parq expiry'],
    category: 'settings',
    capabilities: ['can_manage_staff'],
    saidInstead: 'make the cancel cutoff 2 hours',
    status: 'back-office',
  },
  {
    href: '/management/branding',
    title: 'Branding',
    blurb: 'Logo, colours, gym name, public join link.',
    keywords: ['logo', 'colours', 'colors', 'theme', 'join link'],
    category: 'settings',
    capabilities: ['can_manage_staff'],
    status: 'back-office',
  },
  {
    href: '/management/class-types',
    title: 'Class types',
    blurb: 'Name and colour the kinds of class you run.',
    keywords: ['colours', 'categories', 'capacity'],
    category: 'settings',
    capabilities: ['can_edit_classes'],
    saidInstead: 'add a 7am Wednesday spin class',
    status: 'back-office',
  },
  {
    href: '/management/parq',
    title: 'Health screening',
    blurb: 'The PAR-Q members answer before they train, and who has flagged.',
    keywords: ['parq', 'par-q', 'medical', 'screening', 'waiver', 'injury'],
    category: 'settings',
    capabilities: ['can_manage_parq'],
    // The Settings tab embeds HealthScreeningPanel from this same screen,
    // so the browse path already works; what was missing was any way to
    // find it by name. No tile, because one would sit directly above the
    // panel it links to.
    status: 'back-office',
  },
  {
    href: '/management',
    section: 'leaderboards',
    title: 'Leaderboards',
    blurb: 'Turn class and strength comparisons on or off.',
    keywords: ['rankings', 'comparisons', 'boards'],
    category: 'settings',
    capabilities: ['can_configure_leaderboards'],
    status: 'back-office',
  },
  {
    href: '/management',
    section: 'messaging',
    title: 'Messaging',
    blurb: 'Decide who can DM whom inside the gym.',
    keywords: ['dm', 'chat', 'direct messages'],
    category: 'settings',
    capabilities: ['can_manage_staff'],
    status: 'back-office',
  },
  // Setup is a place, not a nag. Every other route into it is conditional
  // on being unfinished, which left an owner who finished the required
  // steps with no way back to the optional ones.
  {
    href: '/setup',
    title: 'Set up your gym',
    blurb:
      'The setup conversation — walks you through anything you left, whenever you want it.',
    keywords: ['onboarding', 'checklist', 'getting started'],
    category: 'settings',
    capabilities: [],
    roles: ['owner'],
    status: 'back-office',
  },
];

// The screen still does the asking; this only says what to ask. `can`
// returns undefined while the capability set is loading, which is not
// permission — same rule as actionsFor.
export function visibleEntries(
  can: (capability: string) => boolean | undefined,
  role: string | null | undefined,
): BackOfficeEntry[] {
  return BACK_OFFICE.filter(
    (e) =>
      e.capabilities.some((c) => can(c) === true) ||
      (e.roles ?? []).some((r) => r === role),
  );
}

// The measure, computed rather than claimed.
export function retiredCount(): number {
  return RETIRED_ROUTES.length;
}

export function categoriesWithEntries(
  entries: BackOfficeEntry[],
): BackOfficeCategory[] {
  return CATEGORY_ORDER.filter((c) => entries.some((e) => e.category === c));
}

// Search across the words somebody would actually reach for: the title,
// the blurb, the category it sits under, and the sentence that does the
// same job. Matching the category name is what makes "settings" or
// "team" work as a query rather than only as a pill.
export function searchBackOffice(
  query: string,
  entries: BackOfficeEntry[],
): BackOfficeEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries.filter((e) => !e.categoryOnly);
  const words = needle.split(/\s+/);
  return entries.filter((e) => !e.categoryOnly).filter((e) => {
    const hay = [
      e.title,
      e.blurb,
      CATEGORY_LABELS[e.category],
      e.saidInstead ?? '',
      ...(e.keywords ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
