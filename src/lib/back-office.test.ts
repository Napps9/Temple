import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BACK_OFFICE,
  CATEGORY_ORDER,
  RETIRED_ROUTES,
  categoriesWithEntries,
  retiredCount,
  searchBackOffice,
  visibleEntries,
} from './back-office';

const MANAGEMENT = 'src/app/(staff)/management';

// Sub-pages, and the screen that links to each. A route belongs here when
// it is reached from its parent in context — opening a campaign, a
// member, a lead's conversation — and would be meaningless as a tile.
// Everything else has to be in the manifest, or nobody can find it.
const PARENTED: Record<string, string> = {
  'communications/[id]': 'management/communications',
  'communications/new': 'management/communications',
  'communications/settings': 'management/communications',
  'communications/topics': 'management/communications',
  'communications/automations': 'management/communications',
  'communications/automations/[id]': 'management/communications/automations',
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

  it('does not claim a parent for a screen that has since gone', () => {
    const gone = Object.keys(PARENTED).filter((r) => !routes.includes(r));
    expect(gone).toEqual([]);
  });

  // Goals and the Roster had no door in Manage at all — only two
  // quick-links on the Timeline, which is not where anybody looks for
  // them. They are the only two entries that render a tile, because every
  // other category already shows a panel that is its own way in.
  it('gives a tile to the surfaces that have no other door', () => {
    expect(BACK_OFFICE.filter((e) => e.needsTile).map((e) => e.href)).toEqual([
      '/management/goals',
      '/management/roster',
    ]);
  });

  // Health screening reads as a third orphan and is not one: the Settings
  // tab embeds its panel from the same file. What it lacked was a way to
  // find it by name, which search now gives it.
  it('indexes health screening without duplicating the panel', () => {
    const parq = BACK_OFFICE.find((e) => e.href === '/management/parq');
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
    // Billing and Setup are the two owner-only surfaces with no
    // capability key behind them.
    expect(visibleEntries(nobody, 'owner').map((e) => e.href).sort()).toEqual([
      '/management/billing',
      '/setup',
    ]);
    expect(visibleEntries(nobody, 'coach')).toEqual([]);
  });

  // Cover has always been visible to anybody who can ask OR claim, and
  // Tasks to anybody who manages them OR holds the staff role. Moving the
  // gate into data must not quietly narrow either.
  it('keeps the two either-or gates', () => {
    const claimer = visibleEntries((c) => c === 'can_claim_cover', 'coach');
    expect(claimer.map((e) => e.title)).toEqual(['Cover']);

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
    expect(searchBackOffice('logo', all).map((e) => e.title)).toEqual(['Branding']);
  });

  it('finds one by the category it lives under', () => {
    expect(searchBackOffice('website', all).map((e) => e.title)).toContain('Website');
  });

  // The point of indexing the sentence too: somebody who half-remembers
  // the bar phrasing still lands on the screen.
  it('finds one by the sentence that does the same job', () => {
    expect(searchBackOffice('cancel cutoff', all).map((e) => e.title)).toEqual([
      'Gym settings',
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
      'logo',
      'permissions',
      'holiday',
      'newsletter',
      'seo',
      'credits',
      'timezone',
      // Both lost their route in the same change that wrote this line.
      // A surface that folds into a tab has to stay findable by the words
      // it was findable by before, or the retirement cost something.
      'dm',
      'rankings',
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
    expect(retiredCount()).toBe(3);
    expect(retiredCount()).toBe(RETIRED_ROUTES.length);
    expect(byStatus('primary') + byStatus('back-office')).toBe(BACK_OFFICE.length);
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

  // Leaderboards and Messaging have no route any more — their door is a
  // section of this screen. A renamed or dropped section would turn the
  // tile into a link that lands on the Members tab and does nothing
  // visible, which is worse than the dead end deleting a route gives you.
  it('has a settings section behind every section link', () => {
    const named = BACK_OFFICE.filter((e) => e.section);
    expect(named.map((e) => e.title).sort()).toEqual(['Leaderboards', 'Messaging']);
    for (const e of named) {
      expect(e.href).toBe('/management');
      expect(screen).toContain(`id: '${e.section}'`);
    }
    // The tile has to act rather than link: a Link back to the screen you
    // are standing on is not navigation, and the tab this screen is
    // showing lives in state, not in the URL.
    expect(screen).toMatch(/onPress=\{c\.section \? \(\) => openSettingsSection/);
    expect(screen).toMatch(/onPress=\{e\.section \? \(\) => onOpenSection/);
  });

  // The panels moved out of app/ when their routes went. Left under app/,
  // Expo Router would have kept serving them as routes and the retirement
  // would have been a heading deleted rather than a door closed.
  it('imports the two folded panels from components', () => {
    expect(screen).toContain("from '@/components/LeaderboardsPanel'");
    expect(screen).toContain("from '@/components/MessagingPanel'");
  });
});
