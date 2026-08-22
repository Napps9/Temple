import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BACK_OFFICE,
  movesLeft,
  CATEGORY_ORDER,
  RETIRED_ROUTES,
  categoriesWithEntries,
  retiredCount,
  searchBackOffice,
  visibleEntries,
} from './back-office';
import { ACTIONS } from './actions';

const MANAGEMENT = 'src/app/(staff)/management';

// Sub-pages, and the screen that links to each. A route belongs here when
// it is reached from its parent in context — opening a campaign, a
// member, a lead's conversation — and would be meaningless as a tile.
// Everything else has to be in the manifest, or nobody can find it.
const PARENTED: Record<string, string> = {
  'communications/[id]': 'management/communications',
  'communications/settings': 'management/communications',
  'communications/automations/[id]': 'management/communications (the automations section)',
  'members/[profile]': 'management/members',
  'members/imported/[id]': 'management/members/import',
  'members/import-stripe': 'management/members/import',
  'website/domain': 'management/website',
  'leads/agent': 'management/leads',
  'leads/agent-setup': 'management/leads',
  'leads/settings': 'management/leads',
  'leads/conversations': 'management/leads',
  'leads/conversation/[id]': 'management/leads/conversations',
  attendance: 'management/index (the Attendance stat tile)',
  'member-programming': 'management/members/[profile] and programming',
  account: 'components/TopNav (the avatar)',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function routeFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full, `${prefix}${name}/`);
    if (!name.endsWith('.tsx')) return [];
    if (name === '_layout.tsx' || name === 'index.tsx') return [];
    return [`${prefix}${name.replace(/\.tsx$/, '')}`];
  });
}

describe('nothing is built and then lost', () => {
  const routes = routeFiles(MANAGEMENT);

  it('has a door or a parent for every management screen', () => {
    const hrefs = new Set(BACK_OFFICE.map((e) => e.href));
    const orphans = routes.filter(
      (r) => !hrefs.has(`/management/${r}`) && !(r in PARENTED),
    );
    if (orphans.length > 0) {
      throw new Error(
        'These screens exist and nothing links to them. Add a manifest ' +
          'entry, or name the screen that links to them in PARENTED:\n' +
          orphans.map((o) => `  /management/${o}`).join('\n'),
      );
    }
    expect(orphans).toEqual([]);
  });

  // The other direction: a tile pointing at a screen somebody deleted is
  // a dead end that looks like a feature.
  it('has a screen behind every door', () => {
    const known = new Set([...routes, 'members', 'index']);
    const dead = BACK_OFFICE.filter((e) => e.href.startsWith('/management'))
      .map((e) => (e.href === '/management' ? 'index' : e.href.replace('/management/', '')))
      .filter((r) => !known.has(r));
    expect(dead).toEqual([]);
  });

  // A retired route has to be genuinely gone and genuinely unreferenced,
  // or the record is a claim about a screen still sitting there.
  it('has no file and no door behind a retired route', () => {
    expect(RETIRED_ROUTES.length).toBeGreaterThan(0);
    const hrefs = new Set(BACK_OFFICE.map((e) => e.href));
    for (const r of RETIRED_ROUTES) {
      expect(routes).not.toContain(r.route.replace('/management/', ''));
      expect(hrefs.has(r.route)).toBe(false);
      expect(r.because.length).toBeGreaterThan(40);
    }
  });

  // The filesystem check above is not enough. /setup still pushed
  // '/management/parq?backTo=setup' after that route was deleted — a
  // button that lands on nothing, which no test noticed because the
  // manifest was clean and the file was gone. So: no source file may name
  // a retired route in a string.
  //
  // Two files legitimately do. back-office.ts is the record itself, and
  // sign-in.tsx keys the marketing site's demo redirect on the old path
  // because that repo deploys separately and still sends it — the value
  // beside it is where it actually goes.
  it('never sends anybody to a retired route', () => {
    const allowed = ['back-office.ts', 'sign-in.tsx'];
    const files = sourceFiles('src').filter(
      (f) => !allowed.some((a) => f.endsWith(a)) && !f.endsWith('.test.ts'),
    );
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const r of RETIRED_ROUTES) {
        if (new RegExp(`['"\`]${r.route}(['"\`?])`).test(text)) {
          offenders.push(`${f} → ${r.route}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not claim a parent for a screen that has since gone', () => {
    const gone = Object.keys(PARENTED).filter((r) => !routes.includes(r));
    expect(gone).toEqual([]);
  });

  // Surfaces whose tab shows no panel that is its own way in. Goals and
  // the Roster only ever had Timeline quick-links; Members joined them
  // when the hub stopped embedding the member list — its stat tile is
  // gated on insights capabilities, so the tile alone stranded a viewer
  // holding only can_manage_tags.
  it('gives a tile to the surfaces that have no other door', () => {
    expect(BACK_OFFICE.filter((e) => e.needsTile).map((e) => e.href)).toEqual([
      '/management/members',
      '/management/goals',
      '/management/roster',
    ]);
  });

  // Health screening reads as a third orphan and is not one: the Settings
  // tab renders its panel. What it lacked was a way to find it by name,
  // which search now gives it.
  it('indexes health screening without duplicating the panel', () => {
    const parq = BACK_OFFICE.find((e) => e.section === 'health-screening');
    expect(parq).toBeDefined();
    expect(parq!.needsTile).toBeUndefined();
    const all = visibleEntries(() => true, 'owner');
    // Gym settings mentions PAR-Q expiry, so it matches too — both are
    // honest answers to the query and neither is a wrong door.
    expect(searchBackOffice('par-q', all).map((e) => e.title)).toContain(
      'Health screening',
    );
    expect(searchBackOffice('health screening', all).map((e) => e.title)).toEqual([
      'Health screening',
    ]);
  });
});

describe('who sees what', () => {
  const owner = () => true;
  const nobody = () => false;
  const loading = () => undefined;

  it('shows an owner everything that still exists', () => {
    expect(visibleEntries(owner, 'owner')).toHaveLength(BACK_OFFICE.length);
  });

  it('never offers a retired route to anybody', () => {
    const shown = visibleEntries(owner, 'owner').map((e) => e.href);
    for (const r of RETIRED_ROUTES) expect(shown).not.toContain(r.route);
  });

  it('shows a member with no capabilities nothing at all', () => {
    expect(visibleEntries(nobody, 'member')).toEqual([]);
  });

  // Loading is not permission — the same rule the action catalogue follows.
  it('shows nothing while the capability set is still loading', () => {
    expect(visibleEntries(loading, 'coach')).toEqual([]);
  });

  it('honours a role gate where one exists, without a capability', () => {
    // The owner-only surfaces with no capability key behind them. Billing,
    // Setup and the rule sheet drive setters that ask user_is_owner_of;
    // Gym settings and Gym details are role-gated because SettingsTab
    // shows their panels on isOwner, and a search result that opens an
    // absent section is worse than no result.
    expect(visibleEntries(nobody, 'owner').map((e) => e.href).sort()).toEqual([
      '/management',
      '/management',
      '/management/billing',
      '/setup',
      '/timeline?rules=1',
    ]);
    expect(visibleEntries(nobody, 'coach')).toEqual([]);
  });

  // Tasks is visible to anybody who manages them OR holds the staff role.
  // Moving the gate into data must not quietly narrow it.
  //
  // Cover was the other either-or gate and has no entry any more (0243):
  // a coach who can only claim now meets offers in the Timeline, which
  // the feed has always gated on the same can_claim_cover. The gate did
  // not narrow — it moved to where the work is.
  it('keeps the either-or gate', () => {
    const claimer = visibleEntries((c) => c === 'can_claim_cover', 'coach');
    expect(claimer).toEqual([]);

    const staff = visibleEntries(nobody, 'staff');
    expect(staff.map((e) => e.title)).toEqual(['Tasks']);
  });

  it('only offers categories that have something in them', () => {
    const comms = visibleEntries((c) => c === 'can_manage_comms', 'admin');
    expect(categoriesWithEntries(comms)).toEqual(['comms']);
    expect(categoriesWithEntries(visibleEntries(owner, 'owner'))).toEqual(
      CATEGORY_ORDER,
    );
  });
});

describe('finding it by typing', () => {
  const all = visibleEntries(() => true, 'owner');

  it('finds a surface by a word in its description', () => {
    expect(searchBackOffice('stock', all).map((e) => e.title)).toEqual(['Store']);
    expect(searchBackOffice('join link', all).map((e) => e.title)).toEqual([
      'Gym details',
    ]);
  });

  it('finds one by the category it lives under', () => {
    expect(searchBackOffice('website', all).map((e) => e.title)).toContain('Website');
  });

  // The point of indexing the sentence too: somebody who half-remembers
  // the bar phrasing still lands on the screen.
  // Two answers, and both are right: the panel that has always held the
  // setting, and the rule sheet that now says it as a sentence. A search
  // that returned only the panel would be sending people to the surface
  // the sorting rule is trying to retire.
  it('finds one by the sentence that does the same job', () => {
    expect(searchBackOffice('cancel cutoff', all).map((e) => e.title).sort()).toEqual([
      'Gym settings',
      'Your rules',
    ]);
  });

  it('narrows on every word rather than any of them', () => {
    expect(searchBackOffice('import workout', all).map((e) => e.title)).toEqual([
      'Import workout history',
    ]);
  });

  it('is not case or whitespace fussy', () => {
    expect(searchBackOffice('  COACH earnings ', all).map((e) => e.title)).toEqual([
      'Coach earnings',
    ]);
  });

  // Written after watching the search return nothing for "refund", "coach
  // pay", "dns" and "parq" — every one a thing an owner does, and none of
  // them a word the tile's own sentence happened to use. A search index
  // that only knows the names we chose is an index for the people who
  // chose them, so the manifest carries the words people reach for and
  // this list is the proof it keeps carrying them.
  it('answers the words people actually type', () => {
    const asked = [
      'refund',
      'sending domain',
      'coach pay',
      'stripe',
      'dns',
      'unsubscribe',
      'attendance',
      'parq',
      'waiver',
      'export',
      'vat',
      'permissions',
      'holiday',
      'newsletter',
      'seo',
      'credits',
      'timezone',
      // Every one of these lost its route to the Settings tab. A surface
      // that folds into a tab has to stay findable by the words it was
      // findable by before, or the retirement cost something.
      'dm',
      'rankings',
      'closure',
      'bank holiday',
      'cancellation',
      'join link',
    ];
    const empty = asked.filter((q) => searchBackOffice(q, all).length === 0);
    expect(empty).toEqual([]);
  });

  it('says nothing rather than everything when nothing matches', () => {
    expect(searchBackOffice('kettlebell juggling', all)).toEqual([]);
  });

  // The two category-only entries keep the Members pill visible for a
  // coach with stats and no member list; they are not rows anybody taps.
  it('never returns a row that is only there to hold a category open', () => {
    expect(searchBackOffice('', all).some((e) => e.categoryOnly)).toBe(false);
    expect(searchBackOffice('revenue', all)).toEqual([]);
  });
});

describe('the burndown has a baseline', () => {
  it('counts what is where', () => {
    const byStatus = (s: string) => BACK_OFFICE.filter((e) => e.status === s).length;
    // The number moving is the measure; this test exists so it cannot move
    // by accident, and so raising it means writing down why.
    // Nine: the Messaging section went. One switch, and the rule sheet
    // already said it — see RETIRED_ROUTES for why Leaderboards, the
    // switch beside it, could not go with it.
    // Twelve: Communications was seven routes for three jobs. The
    // automations list, the topics editor and the create-a-campaign
    // interstitial are sections and a button now.
    expect(retiredCount()).toBe(12);
    expect(retiredCount()).toBe(RETIRED_ROUTES.length);
    expect(byStatus('primary') + byStatus('back-office')).toBe(BACK_OFFICE.length);
  });

  // `status` says where a surface sits; `ends` says where the sorting rule
  // sends it. Without the second, the scoreboard cannot tell Website —
  // which keeps its screen forever, because building a page is craft —
  // from Tag rules, which is a form waiting to become a sentence. A
  // burndown that cannot reach zero is an appetite, not a plan.
  // `movedTo` is the difference between a scoreboard that can finish and
  // one that can only be abandoned. A name is checkable where a boolean
  // is not: delete the action and the surface it was closing re-opens,
  // rather than the manifest quietly keeping a claim that stopped being
  // true.
  it('can prove every move it claims', () => {
    const names = new Set(ACTIONS.map((a) => a.name));
    const missing: string[] = [];
    for (const e of BACK_OFFICE) {
      for (const n of e.movedTo ?? []) {
        if (!names.has(n)) missing.push(`${e.title} → ${n}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // Only a surface on its way out can have got there. A `keeps` entry
  // claiming it moved is a category error, and the one place this would
  // go wrong quietly.
  it('only lets a surface that was going somewhere claim to have arrived', () => {
    for (const e of BACK_OFFICE) {
      if (e.movedTo) expect(e.ends).toBe('moves');
    }
  });

  it('knows which surfaces are still owed', () => {
    const by = (e: string) => BACK_OFFICE.filter((x) => x.ends === e).length;
    expect(by('keeps') + by('moves') + by('splits')).toBe(BACK_OFFICE.length);
    // One. Nine of the eleven had already moved and the manifest could
    // not say so — `ends` records where a surface is going, not whether
    // it got there, so a finished move counted against the burndown
    // forever. The tenth, Billing, needed one more rule field.
    //
    // The last is Leaderboards, and it is blocked rather than unbuilt:
    // set_leaderboard_config is the only rule setter gated on a
    // capability rather than on being the owner, so its panel is the one
    // door an admin holding can_configure_leaderboards has. It cannot
    // move until the gym's rules can be spoken by somebody who is not the
    // owner, which is a product decision and not a chore.
    expect(movesLeft()).toBe(1);
    // Phase 5 is done when this is zero. It is not a target for the count
    // of screens — `keeps` is the floor and is supposed to stay.
    expect(by('keeps')).toBeGreaterThan(0);
  });

  // Named rather than counted, so moving one is a decision somebody wrote
  // down. Every one of these is quoted from docs/roadmap.md's inventory —
  // Earnings keeps its screen because a coach checking their pay is
  // evidence, and the website builder's canvas is craft.
  it('keeps the surfaces the sorting rule says keep their screen', () => {
    expect(
      BACK_OFFICE.filter((e) => e.ends === 'keeps')
        .map((e) => e.title)
        .sort(),
    ).toEqual([
      'Coach earnings',
      'Goals',
      'Health screening',
      'Roster',
      'Set up your gym',
      'Website',
      // Not a screen and not craft, but a destination — the place
      // retiring settings land. It cannot itself be owed a sentence: it
      // IS the sentence.
      'Your rules',
    ]);
    // Reclassified from `moves`: a waiver is a PDF somebody signs with
    // their own hand and a PAR-Q is a questionnaire being authored, so
    // neither was ever going to become a sentence. Its two settings that
    // are rules already live in the sheet.
    expect(
      BACK_OFFICE.find((e) => e.title === 'Health screening')?.ends,
    ).toBe('keeps');
  });

  it('offers the bar sentence wherever one exists', () => {
    const spoken = BACK_OFFICE.filter((e) => e.saidInstead);
    expect(spoken.length).toBeGreaterThan(8);
    for (const e of spoken) expect(e.saidInstead!.length).toBeGreaterThan(6);
  });
});

// The manifest is only useful if the screen actually reads it.
describe('the screen reads the manifest', () => {
  const screen = readFileSync(join(MANAGEMENT, 'index.tsx'), 'utf8');

  it('renders entries rather than an inline list', () => {
    expect(screen).toMatch(/from '@\/lib\/back-office'/);
    expect(screen).toMatch(/visibleEntries\(/);
    expect(screen).toMatch(/searchBackOffice\(/);
  });

  // Six surfaces have no route any more — their door is a section of
  // this screen. A renamed or dropped section would turn the tile into a
  // tap that lands nowhere visible, which is worse than the dead end
  // deleting a route gives you.
  it('has a settings section behind every section link', () => {
    const named = BACK_OFFICE.filter((e) => e.section);
    expect(named.map((e) => e.title).sort()).toEqual([
      'Class types',
      'Closures',
      'Gym details',
      'Gym settings',
      'Health screening',
      'Leaderboards',
    ]);
    for (const e of named) {
      expect(e.href).toBe('/management');
      expect(screen).toContain(`id: '${e.section}'`);
    }
    // The tile has to act rather than link: a Link back to the screen you
    // are standing on is not navigation, and the tab this screen is
    // showing lives in state, not in the URL.
    expect(screen).toMatch(/onPress=\{c\.section \? \(\) => openSettingsSection/);
    expect(screen).toMatch(/onPress=\{e\.section \? \(\) => onOpenSection/);
    // …and arriving from somewhere else really is navigation, so the
    // screen has to read where it was sent.
    expect(screen).toMatch(/useLocalSearchParams<\{ section\?: string \}>/);
  });

  // The panels moved out of app/ when their routes went. Left under app/,
  // Expo Router would have kept serving them as routes and the retirement
  // would have been a heading deleted rather than a door closed.
  it('imports every folded panel from components', () => {
    for (const name of [
      'BrandingPanel',
      'ClassTypesPanel',
      'ClosuresCard',
      'HealthScreeningPanel',
      'LeaderboardsPanel',
      'OperatingDefaultsPanel',
    ]) {
      expect(screen).toContain(`from '@/components/${name}'`);
    }
  });

  // Closures shared a route with the gym-settings panel and never its
  // capability. Nesting it under that section would have taken it away
  // from whoever can bulk-edit classes without managing staff — the
  // capability-mismatch bug this repo keeps finding, in reverse.
  it('keeps closures on its own gate', () => {
    const closures = BACK_OFFICE.find((e) => e.section === 'closures');
    expect(closures?.capabilities).toEqual(['can_bulk_edit_classes']);
    expect(screen).toMatch(/visible: canBulkEditClasses/);
  });

  // The first-run bounce used to live on each retired route. It lives on
  // the destination now, so every step key the manifest names has to be a
  // step the checklist actually tracks — a typo here silently stops
  // returning the owner to /onboarding.
  it('names a real checklist step for every section that completes one', () => {
    const checklist = readFileSync(
      join('src/components', 'GymSetupChecklist.tsx'),
      'utf8',
    );
    const steps = BACK_OFFICE.filter((e) => e.setupStep);
    expect(steps.map((e) => e.setupStep!.key).sort()).toEqual([
      'class_type_and_schedule',
      'parq',
      'settings',
    ]);
    for (const e of steps) {
      expect(checklist).toContain(`key: '${e.setupStep!.key}'`);
      expect(checklist).toContain(`section: '${e.section}'`);
    }
    expect(screen).toMatch(/useSetupAutoReturn\(/);
  });
});
