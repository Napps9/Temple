// The website, as things you can say.
//
// The canvas keeps its screen — laying out a page is craft, and no
// sentence beats dragging a block. What has never needed a screen is the
// admin around it: taking the site live, taking it down, pointing a
// domain at it, asking whether the DNS has landed yet, and writing the
// line Google shows under the link. All five are one decision each, and
// four of the five currently cost a trip to a page whose whole job is to
// hold one button.
//
// The order matters here more than in most modules: 0220 was the
// hardening, and it went first for a reason. Hiding a plan from the
// website hid it from the rendered page and not from the public RPC
// behind it, so a verb offering "hide that from the site" would have been
// selling a privacy the server did not provide. The verbs are honest
// because the server is.

import { coerceDocument, allPageWarnings, type SiteDocument } from '../site-blocks';
import { validateCustomDomain } from '../site-domain';

import {
  ActionError,
  argString,
  erase,
  type ActionContext,
  type ActionSpec,
  type AnyAction,
} from './types';
import type { Json } from '../../types/database';

const CAPABILITY = 'can_manage_website';

type SiteRow = {
  id: string;
  design: Json;
  theme: string;
  published: boolean;
  updated_at: string;
};

type DomainRow = {
  domain: string;
  status: 'pending' | 'verified' | 'error';
  ownership_verified: boolean | null;
  error_message: string | null;
};

async function loadSite(ctx: ActionContext): Promise<SiteRow> {
  const { data, error } = await ctx.supabase
    .from('gym_websites')
    .select('id, design, theme, published, updated_at')
    .eq('gym_id', ctx.gymId)
    .maybeSingle();
  if (error) throw new ActionError('I could not read your website.');
  if (!data) {
    throw new ActionError(
      'You have not built a site yet — pick a template on the Website screen and I can take it from there.',
    );
  }
  return data as SiteRow;
}

async function loadDomain(ctx: ActionContext): Promise<DomainRow | null> {
  const { data } = await ctx.supabase
    .from('gym_website_domains')
    .select('domain, status, ownership_verified, error_message')
    .eq('gym_id', ctx.gymId)
    .maybeSingle();
  return (data as DomainRow | null) ?? null;
}

// Where the site actually lives, said only when it can be said exactly.
// A verified custom domain is the address the owner gave out; anything
// else is a platform URL this module cannot compose without inventing an
// origin, so it offers the screen instead of guessing.
function liveAt(domain: DomainRow | null): string | null {
  return domain?.status === 'verified' ? domain.domain : null;
}

// ============================================================================
// website.publish
// ============================================================================

export const publishSite: ActionSpec<Record<string, never>> = {
  name: 'website.publish',
  kind: 'do',
  capability: CAPABILITY,
  says:
    'Take the gym website live — "publish the website", "put the site live", ' +
    '"make the website public".',
  args: [],
  invalidate: ['gym-website', 'website-custom-domain'],
  sanitise: () => ({}),
  preview: async (_a, ctx) => {
    const site = await loadSite(ctx);
    if (site.published) {
      return { title: 'Your website is already live.', lines: [] };
    }

    const doc = coerceDocument(site.design);
    // The same warnings the editor blocks Publish on. Refusing here with
    // the list is the whole value — an owner who says "publish it" and is
    // told "done" while nothing changed is worse off than one who is told
    // what is missing.
    const warnings = allPageWarnings(doc);
    if (warnings.length > 0) {
      return {
        title:
          warnings.length === 1
            ? 'One thing to fix before it can go live.'
            : `${warnings.length} things to fix before it can go live.`,
        lines: warnings
          .slice(0, 6)
          .map((w) => (doc.pages.length > 1 ? `${w.pageTitle}: ${w.message}` : w.message))
          .concat(warnings.length > 6 ? [`And ${warnings.length - 6} more.`] : []),
      };
    }

    const domain = liveAt(await loadDomain(ctx));
    const pages = doc.pages.length;
    return {
      title: 'Take the website live?',
      lines: [
        pages === 1 ? 'One page goes public.' : `${pages} pages go public.`,
        domain
          ? `It will be live at ${domain}.`
          : 'It will be live at your Temple site link — connect your own domain any time and it moves across.',
        'Publishing takes a copy of the site as it is now. Editing afterwards changes the draft, not the live page, until you publish again.',
      ],
      yes: 'Yes, publish it',
    };
  },
  apply: async (_a, ctx) => {
    const { error } = await ctx.supabase.rpc('publish_gym_website', {
      p_gym_id: ctx.gymId,
    });
    if (error) {
      throw new ActionError(
        /entitle|enabled/i.test(error.message)
          ? 'The website builder is not switched on for this gym.'
          : 'That did not publish — try again.',
      );
    }
    const domain = liveAt(await loadDomain(ctx));
    ctx.offer?.('Open the website', '/management/website');
    return domain
      ? `Live. Your website is public at ${domain}.`
      : 'Live. Your website is public.';
  },
};

// ============================================================================
// website.unpublish
// ============================================================================

export const unpublishSite: ActionSpec<Record<string, never>> = {
  name: 'website.unpublish',
  kind: 'do',
  capability: CAPABILITY,
  says:
    'Take the gym website offline — "unpublish the website", "take the site ' +
    'down", "hide the website".',
  args: [],
  invalidate: ['gym-website', 'website-custom-domain'],
  sanitise: () => ({}),
  preview: async (_a, ctx) => {
    const site = await loadSite(ctx);
    if (!site.published) {
      return { title: 'Your website is not live at the moment.', lines: [] };
    }
    const domain = liveAt(await loadDomain(ctx));
    return {
      title: 'Take the website offline?',
      lines: [
        domain
          ? `Anyone visiting ${domain} stops seeing it.`
          : 'Anyone visiting your site link stops seeing it.',
        'Nothing is deleted — the pages stay exactly as they are and publishing again puts them straight back.',
      ],
      yes: 'Yes, take it down',
    };
  },
  apply: async (_a, ctx) => {
    const { error } = await ctx.supabase.rpc('unpublish_gym_website', {
      p_gym_id: ctx.gymId,
    });
    if (error) throw new ActionError('That did not come down — try again.');
    ctx.offer?.('Open the website', '/management/website');
    return 'Offline. The pages are still here whenever you want them back.';
  },
};

// ============================================================================
// website.connect_domain
// ============================================================================
//
// The one verb here that cannot finish in the conversation. Connecting
// registers the domain and hands back DNS records that have to be typed
// into a registrar, and a list of hostnames and values is a table, not a
// sentence — so the receipt says what happened and sends the owner to the
// screen that renders them properly. Saying it any other way would mean
// reading out a CNAME target in prose.

type ConnectDomain = { domain: string | null };

export const connectDomain: ActionSpec<ConnectDomain> = {
  name: 'website.connect_domain',
  kind: 'do',
  capability: CAPABILITY,
  says:
    'Point the gym\'s own web address at the site — "connect irontemple.com", ' +
    '"use our own domain for the website", "set up www.irontemple.co.uk".',
  args: [
    {
      name: 'domain',
      type: 'string',
      desc: 'The domain exactly as they said it, e.g. "irontemple.com".',
      required: true,
    },
  ],
  invalidate: ['website-custom-domain', 'gym-website'],
  sanitise: (raw) => {
    const domain = argString(raw, 'domain', 253);
    return domain ? { domain } : null;
  },
  preview: async (a, ctx) => {
    const check = validateCustomDomain(a.domain!);
    if (!check.ok) {
      return { title: check.error, lines: [] };
    }
    const existing = await loadDomain(ctx);
    if (existing && existing.domain === check.domain) {
      return {
        title:
          existing.status === 'verified'
            ? `${check.domain} is already connected and working.`
            : `${check.domain} is already registered and waiting on its DNS records.`,
        lines: [],
      };
    }
    return {
      title: `Point ${check.domain} at your website?`,
      lines: [
        ...(existing
          ? [`This replaces ${existing.domain}, which stops serving the site.`]
          : []),
        'I register it, then you add two DNS records at whoever you bought the domain from. I will show you exactly what to type.',
        'It usually goes live within minutes of the records being added, occasionally up to 48 hours.',
      ],
      yes: 'Yes, connect it',
    };
  },
  apply: async (a, ctx) => {
    const check = validateCustomDomain(a.domain!);
    if (!check.ok) throw new ActionError(check.error);
    const { error } = await ctx.supabase.functions.invoke('custom-domain', {
      body: { action: 'connect', gym_id: ctx.gymId, domain: check.domain },
    });
    if (error) {
      throw new ActionError(
        `I could not register ${check.domain}. It may already be pointed at another site.`,
      );
    }
    ctx.offer?.('Show me the DNS records', '/management/website/domain');
    return `${check.domain} is registered. Two DNS records to add next — they are on the domain page, ready to copy.`;
  },
};

// ============================================================================
// website.check_domain
// ============================================================================
//
// An `ask`, though it does re-ask the provider and store what came back.
// The rule it bends is worth bending: the stored status IS the answer to
// "is it working yet", nothing about the gym changes, and putting a
// confirmation tap in front of a DNS check would make the fastest
// question in this module the slowest.

export const checkDomain: ActionSpec<Record<string, never>> = {
  name: 'website.check_domain',
  kind: 'ask',
  capability: CAPABILITY,
  says:
    'Whether the gym\'s web address is working yet — "is the domain live", ' +
    '"has the DNS come through", "check the website domain".',
  args: [],
  sanitise: () => ({}),
  preview: async (_a, ctx) => {
    const existing = await loadDomain(ctx);
    if (!existing) {
      return {
        title: 'You have not connected your own domain yet.',
        lines: [
          'Your site is on its Temple link. Say "connect irontemple.com" and I will set it up.',
        ],
      };
    }

    // Re-check rather than reading the stored status back: the whole
    // point of asking is that DNS may have landed since anybody looked.
    const { data } = await ctx.supabase.functions.invoke('custom-domain', {
      body: { action: 'verify', gym_id: ctx.gymId },
    });
    const result = (data ?? {}) as {
      status?: DomainRow['status'];
      ownership_verified?: boolean;
      error_message?: string;
    };
    const status = result.status ?? existing.status;

    if (status === 'verified') {
      ctx.offer?.('Open the domain page', '/management/website/domain');
      return {
        title: `${existing.domain} is working.`,
        lines: ['Visitors reach your website there now.'],
      };
    }

    ctx.offer?.('Show me the DNS records', '/management/website/domain');
    if (status === 'error') {
      return {
        title: `${existing.domain} is not working yet.`,
        lines: [
          result.error_message ?? existing.error_message ?? 'The DNS records did not check out.',
          'The records to add are on the domain page — worth checking them against what your registrar has.',
        ],
      };
    }
    return {
      title: `${existing.domain} is still waiting on its DNS.`,
      lines: [
        result.ownership_verified === true
          ? 'Ownership is confirmed; the routing record has not come through yet.'
          : 'Neither record has come through yet.',
        'DNS changes usually take minutes and occasionally up to 48 hours.',
      ],
    };
  },
};

// ============================================================================
// website.set_seo
// ============================================================================
//
// The line Google shows under your link. It lives per page in the site
// document, which is one JSONB column the editor also autosaves to — so
// this goes through save_gym_website with the updated_at token the editor
// uses, and says so plainly when it loses the race rather than quietly
// overwriting whatever somebody typed a second ago.

type Seo = { title: string | null; description: string | null; page: string | null };

function findPage(doc: SiteDocument, named: string | null) {
  if (!named) return doc.pages[0] ?? null;
  const want = named.trim().toLowerCase();
  return (
    doc.pages.find((p) => p.title.trim().toLowerCase() === want) ??
    doc.pages.find((p) => p.slug.trim().toLowerCase() === want) ??
    doc.pages.find((p) => p.title.trim().toLowerCase().includes(want)) ??
    null
  );
}

export const setSeo: ActionSpec<Seo> = {
  name: 'website.set_seo',
  kind: 'do',
  capability: CAPABILITY,
  says:
    'What Google shows under your website link — "set the site description to ' +
    '…", "change the page title on the website to …", "write the search ' +
    'description for the schedule page".',
  args: [
    {
      name: 'title',
      type: 'string',
      desc: 'The title to show in search results, if they gave one.',
    },
    {
      name: 'description',
      type: 'string',
      desc: 'The description to show under the title, if they gave one.',
    },
    {
      name: 'page',
      type: 'string',
      desc: 'Which page, if they named one. Omit for the home page.',
    },
  ],
  invalidate: ['gym-website'],
  sanitise: (raw) => {
    const title = argString(raw, 'title', 70);
    const description = argString(raw, 'description', 200);
    if (!title && !description) return null;
    return { title, description, page: argString(raw, 'page', 60) };
  },
  preview: async (a, ctx) => {
    const site = await loadSite(ctx);
    const doc = coerceDocument(site.design);
    const page = findPage(doc, a.page);
    if (!page) {
      return {
        title: `You do not have a page called “${a.page}”.`,
        lines: doc.pages.map((p) => p.title),
      };
    }
    return {
      title: `Change what search engines show for ${page.title}?`,
      lines: [
        ...(a.title ? [`Title: ${a.title}`] : []),
        ...(a.description ? [`Description: ${a.description}`] : []),
        ...(a.title && a.title.length > 60
          ? ['Google usually cuts the title off around 60 characters.']
          : []),
        ...(a.description && a.description.length > 160
          ? ['Descriptions are usually cut off around 160 characters.']
          : []),
        site.published
          ? 'It goes live the next time you publish, not straight away.'
          : 'Your site is not live yet, so nobody sees it until you publish.',
      ],
      yes: 'Yes, change it',
    };
  },
  apply: async (a, ctx) => {
    const site = await loadSite(ctx);
    const doc = coerceDocument(site.design);
    const page = findPage(doc, a.page);
    if (!page) throw new ActionError('That page is no longer there.');

    const next: SiteDocument = {
      ...doc,
      pages: doc.pages.map((p) =>
        p.id === page.id
          ? {
              ...p,
              ...(a.title ? { metaTitle: a.title } : {}),
              ...(a.description ? { metaDescription: a.description } : {}),
            }
          : p,
      ),
    };

    const { error } = await ctx.supabase.rpc('save_gym_website', {
      p_gym_id: ctx.gymId,
      p_design: next as unknown as Json,
      p_theme: next.settings.themeId,
      p_expected_updated_at: site.updated_at,
    });
    if (error) {
      throw new ActionError(
        /conflict|updated|stale/i.test(error.message)
          ? 'Somebody was editing the site while I wrote that, so I stopped rather than overwrite them. Ask me again.'
          : 'That did not save — try again.',
      );
    }
    ctx.offer?.('Open the website', '/management/website');
    return site.published
      ? `Done, on ${page.title}. Publish when you are ready and search engines will pick it up.`
      : `Done, on ${page.title}.`;
  },
};

export const WEBSITE_ACTIONS: AnyAction[] = [
  erase(publishSite),
  erase(unpublishSite),
  erase(connectDomain),
  erase(checkDomain),
  erase(setSeo),
];
