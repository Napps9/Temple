import { describe, expect, it, vi } from 'vitest';

import {
  checkDomain,
  connectDomain,
  publishSite,
  setSeo,
  unpublishSite,
} from './website';

type SiteRow = {
  id: string;
  design: unknown;
  theme: string;
  published: boolean;
  updated_at: string;
};

type DomainRow = {
  domain: string;
  status: 'pending' | 'verified' | 'error';
  ownership_verified: boolean | null;
  error_message: string | null;
} | null;

function doc(pages: { id: string; slug: string; title: string; blocks: unknown[] }[]) {
  return { version: 2, settings: { themeId: 'ember' }, pages };
}

const HOME_OK = doc([
  {
    id: 'p1',
    slug: '',
    title: 'Home',
    blocks: [
      { id: 'b1', type: 'hero', headline: 'Iron Temple', subhead: 'Train hard', ctaLabel: 'Join', ctaHref: '/join' },
    ],
  },
]);

function ctxFor(opts: {
  site?: SiteRow | null;
  domain?: DomainRow;
  rpc?: (name: string, args: unknown) => Promise<{ data?: unknown; error?: unknown }>;
  invoke?: (name: string, args: unknown) => Promise<{ data?: unknown; error?: unknown }>;
  offer?: (label: string, href: string) => void;
}) {
  const site =
    opts.site === undefined
      ? { id: 's1', design: HOME_OK, theme: 'ember', published: false, updated_at: 'T1' }
      : opts.site;
  return {
    supabase: {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === 'gym_websites' ? site : (opts.domain ?? null),
              error: null,
            }),
          }),
        }),
      }),
      rpc: opts.rpc ?? (async () => ({ data: 'T2', error: null })),
      functions: { invoke: opts.invoke ?? (async () => ({ data: {}, error: null })) },
    },
    gymId: 'gym',
    userId: 'user',
    currency: 'GBP',
    offer: opts.offer,
  } as never;
}

describe('taking the site live', () => {
  // The whole value of the verb: an owner who says "publish it" and is
  // told "done" while nothing changed is worse off than one who is told
  // what is missing.
  it('refuses with the list when the pages are not ready', async () => {
    const empty = doc([{ id: 'p1', slug: '', title: 'Home', blocks: [] }]);
    const p = await publishSite.preview(
      {},
      ctxFor({
        site: { id: 's1', design: empty, theme: 'ember', published: false, updated_at: 'T1' },
      }),
    );
    expect(p.yes).toBeUndefined();
    expect(p.title).toMatch(/before it can go live/);
    expect(p.lines.length).toBeGreaterThan(0);
  });

  it('names the address when a domain is verified, and does not invent one when it is not', async () => {
    const withDomain = await publishSite.preview(
      {},
      ctxFor({
        domain: {
          domain: 'irontemple.com',
          status: 'verified',
          ownership_verified: true,
          error_message: null,
        },
      }),
    );
    expect(withDomain.lines.join(' ')).toContain('live at irontemple.com');

    const without = await publishSite.preview({}, ctxFor({}));
    expect(without.lines.join(' ')).toMatch(/Temple site link/);
    expect(without.lines.join(' ')).not.toMatch(/https?:\/\//);
  });

  it('says that publishing snapshots the site rather than linking it live', async () => {
    const p = await publishSite.preview({}, ctxFor({}));
    expect(p.lines.join(' ')).toMatch(/Editing afterwards changes the draft/);
    expect(p.yes).toBe('Yes, publish it');
  });

  it('does not offer to publish a site that is already live', async () => {
    const p = await publishSite.preview(
      {},
      ctxFor({
        site: { id: 's1', design: HOME_OK, theme: 'ember', published: true, updated_at: 'T1' },
      }),
    );
    expect(p.title).toBe('Your website is already live.');
    expect(p.yes).toBeUndefined();
  });

  it('sends somebody with no site to the template picker rather than failing oddly', async () => {
    await expect(publishSite.preview({}, ctxFor({ site: null }))).rejects.toThrow(
      /not built a site yet/,
    );
  });
});

describe('taking the site down', () => {
  it('promises nothing is deleted, which is the thing an owner will worry about', async () => {
    const p = await unpublishSite.preview(
      {},
      ctxFor({
        site: { id: 's1', design: HOME_OK, theme: 'ember', published: true, updated_at: 'T1' },
      }),
    );
    expect(p.lines.join(' ')).toMatch(/Nothing is deleted/);
    expect(p.yes).toBe('Yes, take it down');
  });

  it('says so when it is already offline', async () => {
    const p = await unpublishSite.preview({}, ctxFor({}));
    expect(p.title).toBe('Your website is not live at the moment.');
    expect(p.yes).toBeUndefined();
  });
});

describe('connecting a domain', () => {
  it('reads the shapes people actually type', () => {
    expect(connectDomain.sanitise({ domain: 'https://IronTemple.com/' })).toEqual({
      domain: 'https://IronTemple.com/',
    });
    expect(connectDomain.sanitise({})).toBeNull();
  });

  it('normalises before it asks, so the card names what will be registered', async () => {
    const p = await connectDomain.preview(
      { domain: 'https://IronTemple.com/pricing' },
      ctxFor({}),
    );
    expect(p.title).toBe('Point irontemple.com at your website?');
  });

  it('refuses something that is not a domain', async () => {
    const p = await connectDomain.preview({ domain: 'my gym' }, ctxFor({}));
    expect(p.yes).toBeUndefined();
    expect(p.title).toMatch(/valid domain/);
  });

  it('warns that connecting a second one replaces the first', async () => {
    const p = await connectDomain.preview(
      { domain: 'newgym.com' },
      ctxFor({
        domain: {
          domain: 'oldgym.com',
          status: 'verified',
          ownership_verified: true,
          error_message: null,
        },
      }),
    );
    expect(p.lines[0]).toMatch(/replaces oldgym.com/);
  });

  it('does not re-register the one already connected', async () => {
    const p = await connectDomain.preview(
      { domain: 'irontemple.com' },
      ctxFor({
        domain: {
          domain: 'irontemple.com',
          status: 'verified',
          ownership_verified: true,
          error_message: null,
        },
      }),
    );
    expect(p.yes).toBeUndefined();
    expect(p.title).toMatch(/already connected/);
  });

  // The receipt cannot carry a DNS table, so it must not pretend to.
  it('hands the DNS records to the screen that can render them', async () => {
    const offer = vi.fn();
    const receipt = await connectDomain.apply!(
      { domain: 'irontemple.com' },
      ctxFor({ offer }),
    );
    expect(receipt).toMatch(/irontemple.com is registered/);
    expect(offer).toHaveBeenCalledWith('Show me the DNS records', '/management/website/domain');
  });
});

describe('asking whether the domain works yet', () => {
  it('is a question, and re-checks rather than reading a stale answer back', async () => {
    const invoke = vi.fn(async () => ({ data: { status: 'verified' }, error: null }));
    expect(checkDomain.kind).toBe('ask');
    expect(checkDomain.apply).toBeUndefined();
    const p = await checkDomain.preview(
      {},
      ctxFor({
        invoke,
        domain: {
          domain: 'irontemple.com',
          // Stored as pending; the provider now says otherwise.
          status: 'pending',
          ownership_verified: false,
          error_message: null,
        },
      }),
    );
    expect(invoke).toHaveBeenCalled();
    expect(p.title).toBe('irontemple.com is working.');
  });

  it('says which half is outstanding while it waits', async () => {
    const p = await checkDomain.preview(
      {},
      ctxFor({
        invoke: async () => ({
          data: { status: 'pending', ownership_verified: true },
          error: null,
        }),
        domain: {
          domain: 'irontemple.com',
          status: 'pending',
          ownership_verified: false,
          error_message: null,
        },
      }),
    );
    expect(p.lines[0]).toMatch(/Ownership is confirmed/);
  });

  it('passes the provider’s reason through rather than paraphrasing it', async () => {
    const p = await checkDomain.preview(
      {},
      ctxFor({
        invoke: async () => ({
          data: { status: 'error', error_message: 'CNAME points at example.com' },
          error: null,
        }),
        domain: {
          domain: 'irontemple.com',
          status: 'pending',
          ownership_verified: false,
          error_message: null,
        },
      }),
    );
    expect(p.lines[0]).toBe('CNAME points at example.com');
  });

  it('offers to set one up when there is no domain at all', async () => {
    const p = await checkDomain.preview({}, ctxFor({}));
    expect(p.title).toMatch(/not connected your own domain/);
  });
});

describe('what search engines show', () => {
  it('needs something to write', () => {
    expect(setSeo.sanitise({})).toBeNull();
    expect(setSeo.sanitise({ description: 'A strength gym in Leeds.' })).toEqual({
      title: null,
      description: 'A strength gym in Leeds.',
      page: null,
    });
  });

  it('defaults to the home page and names the page it will change', async () => {
    const p = await setSeo.preview(
      { title: null, description: 'A strength gym in Leeds.', page: null },
      ctxFor({}),
    );
    expect(p.title).toBe('Change what search engines show for Home?');
  });

  it('warns when the text is longer than Google will show', async () => {
    const p = await setSeo.preview(
      { title: null, description: 'x'.repeat(180), page: null },
      ctxFor({}),
    );
    expect(p.lines.join(' ')).toMatch(/cut off around 160/);
  });

  it('says a draft site shows this to nobody yet', async () => {
    const p = await setSeo.preview(
      { title: 'Iron Temple', description: null, page: null },
      ctxFor({}),
    );
    expect(p.lines.join(' ')).toMatch(/not live yet/);
  });

  it('lists the pages when the one named does not exist', async () => {
    const p = await setSeo.preview(
      { title: null, description: 'x', page: 'Pricing' },
      ctxFor({}),
    );
    expect(p.yes).toBeUndefined();
    expect(p.lines).toEqual(['Home']);
  });

  // The column the editor autosaves to. Losing that race quietly would
  // mean overwriting whatever somebody typed a second ago.
  it('refuses rather than overwriting a concurrent edit', async () => {
    const rpc = async () => ({ data: null, error: { message: 'Website changed since you loaded it (conflict)' } });
    await expect(
      setSeo.apply!({ title: 'Iron Temple', description: null, page: null }, ctxFor({ rpc })),
    ).rejects.toThrow(/stopped rather than overwrite/);
  });

  it('sends the editor’s own concurrency token with the write', async () => {
    const seen: Record<string, unknown>[] = [];
    const rpc = async (_name: string, args: unknown) => {
      seen.push(args as Record<string, unknown>);
      return { data: 'T2', error: null };
    };
    await setSeo.apply!(
      { title: null, description: 'A strength gym in Leeds.', page: null },
      ctxFor({ rpc }),
    );
    expect(seen[0].p_expected_updated_at).toBe('T1');
    const written = seen[0].p_design as { pages: { metaDescription?: string }[] };
    expect(written.pages[0].metaDescription).toBe('A strength gym in Leeds.');
  });
});
