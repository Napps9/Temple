// Every management surface, as data.
//
// The Manage screen has been a Back Office index since it was built — a
// tile per surface, grouped into seven categories, gated by capability.
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
//     Twenty-eight tiles behind seven category pills is findable only by
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
  | 'store'
  | 'team'
  | 'plans'
  | 'settings';

export const CATEGORY_ORDER: BackOfficeCategory[] = [
  'members',
  'crm',
  'comms',
  'store',
  'team',
  'plans',
  'settings',
];

export const CATEGORY_LABELS: Record<BackOfficeCategory, string> = {
  members: 'Members',
  crm: 'AI Front Desk',
  comms: 'Email campaigns',
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
  | 'closures'
  | 'branding'
  | 'health-screening'
  | 'leaderboards'
  | 'class-visibility'
  | 'appointments'
  | 'class-types';

export type BackOfficeEntry = {
  href: string;
  // Set when the surface lives inside the Manage screen rather than at a
  // route of its own. A tile on the Manage screen selects the Settings tab
  // and opens that section in place; somewhere else — /onboarding is the
  // only one — navigates to /management?section=… and lands on the same
  // thing.
  section?: SettingsSectionId;
  // The first-run checklist step this section completes, for the sections
  // that are checklist destinations. The checklist used to push the owner
  // at a route which bounced them back on completion; now the Manage
  // screen reads this and runs the same hook, so /onboarding still gets
  // its owner back.
  setupStep?: { key: string; fullRing?: boolean };
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
  // Where the sorting rule (docs/roadmap.md) says this surface ends up,
  // which is a different question from where it sits today. `status`
  // records the latter and cannot tell a screen that keeps its screen
  // forever from one still waiting to dissolve — so on its own it is a
  // scoreboard that can never reach zero.
  //
  //   keeps   craft, judgement or evidence lives here. Writing a page,
  //           authoring a product, listening to a call, the importers'
  //           mapping decisions. These are the floor: phase 5 finishing
  //           does not mean they go.
  //   moves   exists so a human can operate machinery. A sentence and a
  //           receipt replace it, and the route goes.
  //   splits  the routine path becomes a sentence; the screen survives
  //           one tap deeper for the deep dive.
  //
  // Phase 5 is done when nothing marked `moves` is still owed.
  ends: 'keeps' | 'moves' | 'splits';
  // The sentences that took this surface's job, once they exist.
  //
  // `ends` says where a surface is going; on its own it cannot say
  // whether it has got there, so a burndown keyed on it alone counts a
  // finished move forever and can only reach zero by deleting the
  // manifest. That is not what `moves` means — the roadmap's own
  // definition is that the interaction becomes a sentence and the SCREEN
  // DEMOTES to the Back Office, which is where all of these already sit.
  //
  // So the move is done when the job is sayable, and this records what
  // says it. Named actions rather than a boolean, because a boolean is a
  // claim and a name is checkable: a test asserts every one of these
  // exists in the registry, so deleting an action re-opens the surface it
  // was closing instead of quietly leaving a lie behind.
  movedTo?: string[];
};

// Routes that no longer exist, and where the job went. The burndown's
// numerator, kept in the repository rather than in a changelog: a deletion
// that leaves a record of itself is reviewable, one that leaves a gap is
// just a thing somebody cannot find any more.
export const RETIRED_ROUTES: { route: string; because: string }[] = [
  // The Communications section was seven routes for three jobs. Three of
  // them go; the two records stay, because a campaign and an automation
  // are different objects with different fields, and merging them would
  // cost more than the route saved.
  {
    route: '/management/communications/automations',
    because:
      'A Screen, a BackLink and a PageHead around a list of four rows and ' +
      'a switch each, reached by a card on the directory that already had ' +
      'room for the list itself. It is a section of the Email directory ' +
      'now, so the automations are visible without a tap and next to the ' +
      'campaigns they sit alongside.',
  },
  {
    route: '/management/communications/topics',
    because:
      'One decision — what a member can unsubscribe from separately — and ' +
      'the Settings pattern is one card per decision. It is a section of ' +
      'Email settings, beside the sender and the footer it is part of.',
  },
  {
    route: '/management/communications/new',
    because:
      'A screen whose entire job was to insert a row and redirect, shown ' +
      'for about a second with nothing on it but a spinner. Creating a ' +
      'campaign is a button with a loading state on the directory, the ' +
      'same shape the automations list already used to create one.',
  },
  {
    route: '/management?section=messaging',
    because:
      'One switch, and the rule sheet already says it: "Members can ' +
      'message anyone in the gym / coaches and staff only", tappable, ' +
      'through gym.change_rules like every other rule. The section had ' +
      'been shown on can_manage_staff while set_dm_scope asks ' +
      'user_is_owner_of, so the only people it ever worked for are the ' +
      'people the sheet already serves. Deleting it costs nobody a ' +
      'permission — which is exactly why Leaderboards, the switch beside ' +
      'it, could not go too.',
  },
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
  // The four the first-run checklist used to push people at. Each was the
  // same wrapper around a panel the Settings tab already rendered; what
  // kept them alive was the checklist navigating to them and bouncing the
  // owner back on completion. The section carries the step key now, so the
  // bounce survives without the route.
  {
    route: '/management/branding',
    because:
      'A Screen, a BackLink and a heading around BrandingPanel, already in ' +
      'the Settings tab behind the same can_manage_staff gate. The logo ' +
      'checklist step opens the section instead, and the marketing site’s ' +
      '"see it live" demo link is translated to it at sign-in.',
  },
  {
    route: '/management/class-types',
    because:
      'A Screen, a BackLink and a heading around ClassTypesPanel, already ' +
      'in the Settings tab behind the same can_edit_classes gate. The ' +
      'class-type checklist step opens the section instead, still waiting ' +
      'for the full ring rather than the step’s own done flag.',
  },
  {
    route: '/management/parq',
    because:
      'A Screen, a BackLink and a heading around HealthScreeningPanel — ' +
      'which renders WaiverPanel and ParqPanel — already in the Settings ' +
      'tab behind the same can_manage_parq gate. The health-screening ' +
      'checklist step opens the section instead.',
  },
  {
    route: '/management/operating',
    because:
      'A Screen, a BackLink and a heading around OperatingDefaultsPanel, ' +
      'already in the Settings tab behind the same can_manage_staff gate. ' +
      'The one thing the tab did not have was ClosuresCard, which is now ' +
      'its own section on can_bulk_edit_classes — the gate it always had, ' +
      'and one it would have lost by being nested under Gym settings.',
  },
  {
    route: '/management/cover',
    because:
      'The screen did four things and every one of them has somewhere ' +
      'else to be. Seeing what is waiting is `classes.uncovered` ("what ' +
      'is uncovered", "is Saturday covered"). Handing one class over is ' +
      '`classes.request_cover` ("I can’t do tomorrow’s 6:30"), and a ' +
      'holiday is the same sentence with two dates. Claiming arrives as a ' +
      'Timeline card for exactly the coaches the feed already gated on ' +
      'can_claim_cover, and the claim stays first-come in claim_cover ' +
      'rather than becoming an owner’s decision. Your own outstanding ' +
      'requests were the fourth, and they were always in the feed — the ' +
      'card just leaves the buttons off your own. The ops job has been ' +
      'chasing the coaches since 0208.',
  },
];

export const BACK_OFFICE: BackOfficeEntry[] = [
  // --- Members -------------------------------------------------------
  {
    href: '/management/members',
    title: 'Members',
    // The tab's stat tile is gated on insights capabilities, so without
    // this door a viewer holding only can_manage_tags had no way from the
    // Members tab to the member list it names.
    needsTile: true,
    blurb: 'Invite members, view them by cohort, see and edit their tags.',
    keywords: ['export', 'csv', 'cohort', 'tags', 'attendance', 'archive', 'remove'],
    category: 'members',
    capabilities: ['can_manage_tags'],
    saidInstead: 'show me Marcus',
    ends: 'splits',
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
    movedTo: ['money.summary', 'store.sales', 'leads.pipeline'],
    ends: 'moves',
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
    movedTo: ['classes.attendance', 'members.quiet'],
    ends: 'moves',
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
    ends: 'keeps',
    status: 'primary',
  },
  {
    href: '/management/tags',
    title: 'Tag rules',
    blurb: 'Auto-tag members based on cohort state.',
    keywords: ['automatic', 'segments', 'labels'],
    saidInstead: 'stop auto-tagging people as lapsed',
    category: 'members',
    capabilities: ['can_manage_tags'],
    movedTo: ['tags.rules', 'tags.add_rule', 'tags.remove_rule'],
    ends: 'moves',
    status: 'back-office',
  },
  {
    href: '/management/members/import',
    title: 'Import members',
    blurb: 'Stage members from Mindbody, PushPress, Glofox, Wodify or a spreadsheet.',
    keywords: ['migration', 'csv', 'mindbody', 'pushpress', 'glofox', 'wodify'],
    category: 'members',
    capabilities: ['can_manage_staff'],
    ends: 'splits',
    status: 'back-office',
  },
  {
    href: '/management/members/import-workouts',
    title: 'Import workout history',
    blurb: 'Seed past sets per member — lands in /track for PR pages and sparklines.',
    keywords: ['prs', 'sets', 'migration', 'csv'],
    category: 'members',
    capabilities: ['can_manage_staff'],
    ends: 'splits',
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
    ends: 'splits',
    status: 'back-office',
  },

  // --- Comms ---------------------------------------------------------
  {
    href: '/management/communications',
    title: 'Email',
    blurb: 'Campaigns you send, and the ones that send themselves.',
    keywords: ['newsletter', 'unsubscribe', 'bounce', 'sending domain', 'dns', 'spam', 'automations', 'topics', 'mailout'],
    category: 'comms',
    capabilities: ['can_manage_comms'],
    saidInstead: 'email everyone about the new opening times',
    ends: 'splits',
    status: 'back-office',
  },

  {
    href: '/management/attendance',
    title: 'Attendance report',
    blurb: 'Attended, no-shows and unmarked, over any date range.',
    keywords: ['check-in', 'no-show', 'register', 'report'],
    category: 'members',
    capabilities: ['can_view_attendance'],
    ends: 'keeps',
    status: 'primary',
  },
  {
    href: '/management/member-programming',
    title: 'Individual programming',
    blurb: 'Assign and manage one-to-one programming for members.',
    keywords: ['1-1', 'one to one', 'personal', 'coaching', 'assign'],
    category: 'members',
    capabilities: ['can_program_members'],
    ends: 'keeps',
    status: 'primary',
  },
  {
    href: '/management/account',
    title: 'Your account',
    blurb: 'Your name, avatar, password and sign-out.',
    keywords: ['profile', 'password', 'sign out', 'logout', 'avatar'],
    category: 'settings',
    // Every staff role holds this; the entry hides only while the
    // capability set is still loading, like the rest of the manifest.
    capabilities: ['can_access_staff_area'],
    ends: 'keeps',
    status: 'primary',
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
    ends: 'splits',
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
    ends: 'keeps',
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
    ends: 'splits',
    status: 'back-office',
  },
  {
    href: '/management/coach-earnings',
    title: 'Coach earnings',
    blurb: 'Set per-class-type rates and review what coaches earned.',
    keywords: ['pay', 'wages', 'rates', 'payroll', 'coach pay'],
    category: 'team',
    capabilities: ['can_set_coach_pay'],
    ends: 'keeps',
    status: 'back-office',
  },
  {
    href: '/management/sops',
    title: 'SOPs',
    blurb: 'How we do things here — for the whole team.',
    keywords: ['procedures', 'handbook', 'how-to'],
    category: 'team',
    capabilities: ['can_view_sops'],
    ends: 'splits',
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
    ends: 'splits',
    status: 'back-office',
  },

  // --- Plans ---------------------------------------------------------
  {
    href: '/management/billing',
    title: 'Billing & payments',
    blurb: 'Connect Stripe to charge members for memberships. You keep 100%.',
    keywords: ['stripe', 'refund', 'refunds', 'payouts', 'card', 'invoice', 'tax', 'vat', 'payments'],
    saidInstead: 'let members pay for their own membership',
    category: 'plans',
    capabilities: [],
    roles: ['owner'],
    movedTo: ['gym.change_rules', 'money.summary', 'money.refund'],
    ends: 'moves',
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
    movedTo: ['gym.add_plans', 'money.set_plan_price', 'plans.retire', 'plans.restore', 'plans.include_programming'],
    ends: 'moves',
    status: 'back-office',
  },

  // --- Settings ------------------------------------------------------
  {
    href: '/management',
    section: 'gym-settings',
    setupStep: { key: 'settings' },
    title: 'Gym settings',
    blurb:
      'Week start, booking windows, PAR-Q expiry, plan resolution, retention.',
    keywords: ['cancellation', 'cutoff', 'booking window', 'timezone', 'retention', 'week start', 'parq expiry'],
    category: 'settings',
    // Owner-only, matching the panel: SettingsTab shows gym-settings on
    // isOwner, and a search result that opens an absent section is worse
    // than no result.
    capabilities: [],
    roles: ['owner'],
    saidInstead: 'make the cancel cutoff 2 hours',
    movedTo: ['gym.change_rules'],
    ends: 'moves',
    status: 'back-office',
  },
  {
    href: '/management',
    section: 'closures',
    title: 'Closures',
    blurb: 'Days the gym is shut, and putting classes back when it reopens.',
    keywords: ['closure', 'closed', 'holiday', 'bank holiday', 'christmas', 'reopen', 'shut'],
    category: 'settings',
    // Not can_manage_staff: this card has always been gated on who may
    // bulk-edit classes, and folding it under Gym settings would have
    // narrowed it. Its own section keeps the gate it had.
    capabilities: ['can_bulk_edit_classes'],
    saidInstead: 'close the gym 24 to 28 December',
    movedTo: ['gym.close_dates', 'gym.reopen'],
    ends: 'moves',
    status: 'back-office',
  },
  {
    href: '/management',
    section: 'branding',
    title: 'Gym details',
    blurb: 'Gym name, public join link, enquiry link.',
    keywords: ['name', 'rename', 'join link', 'enquiry link', 'slug'],
    saidInstead: 'rename the gym',
    category: 'settings',
    // Owner-only for the same reason as gym-settings above.
    capabilities: [],
    roles: ['owner'],
    movedTo: ['gym.rename'],
    ends: 'moves',
    status: 'back-office',
  },
  {
    href: '/management',
    section: 'class-types',
    // The step counts as done on the type alone but is not useful without
    // a schedule, so it waits for the full ring.
    setupStep: { key: 'class_type_and_schedule', fullRing: true },
    title: 'Class types',
    blurb: 'Name and colour the kinds of class you run.',
    keywords: ['colours', 'categories', 'capacity'],
    category: 'settings',
    capabilities: ['can_edit_classes'],
    saidInstead: 'add a 7am Wednesday spin class',
    movedTo: ['gym.add_classes', 'classes.rename_type', 'classes.retire_type', 'classes.restore_type'],
    ends: 'moves',
    status: 'back-office',
  },
  {
    href: '/management',
    section: 'health-screening',
    setupStep: { key: 'parq' },
    title: 'Health screening',
    blurb: 'The PAR-Q members answer before they train, and who has flagged.',
    keywords: ['parq', 'par-q', 'medical', 'screening', 'waiver', 'injury'],
    category: 'settings',
    capabilities: ['can_manage_parq'],
    // Not a form waiting to become a sentence. A waiver is a PDF
    // somebody uploads and members sign with their own hand, and a PAR-Q
    // is a questionnaire being authored question by question — both are
    // craft, and neither is sayable. Its two settings that ARE rules
    // (parq_expiry_days, health_retention_months) are already in the rule
    // sheet; what is left is the authoring, which keeps its screen.
    ends: 'keeps',
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
    ends: 'moves',
    status: 'back-office',
  },
  // The rule sheet, which is where retiring settings go.
  //
  // Not a screen — a card the Timeline draws from the gym's live settings,
  // every rule a tappable sentence. It earns a manifest row because it is
  // now a destination: sections fold into it as they retire, and each
  // arrives carrying the words people searched for it by. Without a row
  // those words have nowhere to land and the retirement costs a door.
  // ?rules=1 is the address; the chip above the bar is the other way in.
  {
    href: '/timeline?rules=1',
    title: 'Your rules',
    blurb:
      'Every rule the gym runs by, as sentences with tappable values.',
    keywords: [
      'settings',
      'dm',
      'chat',
      'direct messages',
      'cancellation',
      'cutoff',
      'booking window',
      'minors',
      'week start',
      'kilograms',
      'pounds',
    ],
    category: 'settings',
    capabilities: [],
    roles: ['owner'],
    ends: 'keeps',
    status: 'primary',
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
    ends: 'keeps',
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

// The burndown's denominator, and phase 5's finish line: surfaces that
// exist only so a human can operate machinery. `retiredCount` counts what
// has gone; this counts what is still owed. A phase whose scoreboard only
// counts upwards can never be finished, only abandoned.
export function movesLeft(): number {
  return BACK_OFFICE.filter((e) => e.ends === 'moves' && !e.movedTo).length;
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
