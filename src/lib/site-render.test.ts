import { describe, expect, it } from 'vitest';

import { contrastRatio } from './brand-derivation';
import { BRAND_THEMES, BRAND_THEME_LIST, composeThemeWithBrand } from './brand-themes';
import {
  appendBlock,
  createBlock,
  emptyPage,
  type AboutBlock,
  type ContactBlock,
  type GalleryBlock,
  type HeroBlock,
  type LocationBlock,
  type PricingBlock,
  type ScheduleBlock,
  type TeamBlock,
  type TestimonialsBlock,
} from './site-blocks';
import {
  renderSiteHtml,
  type PublicPlan,
  type ScheduleSession,
  type SiteRenderContext,
  type TeamMember,
} from './site-render';

const baseCtx: SiteRenderContext = {
  slug: 'iron-gym',
  gymName: 'Iron Gym',
  gymLogoUrl: null,
  gymCurrency: 'GBP',
  theme: BRAND_THEMES.forged,
  schedule: [],
  plans: [],
  team: [],
  now: '2026-07-06T08:00:00Z',
  platformOrigin: 'https://app.example.com',
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key-123',
  editable: false,
};

describe('renderSiteHtml', () => {
  it('produces a full HTML document with the theme CSS variables set', () => {
    const html = renderSiteHtml([], baseCtx);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain(`--accent:${BRAND_THEMES.forged.palette.accent};`);
    expect(html).toContain('<title>Iron Gym</title>');
    // Photo-less background heroes get an accent glow instead of a
    // flat colour slab — pin the rule so it can't silently vanish.
    expect(html).toContain('.hero-bg:not(.has-img)');
  });

  it('always renders a site header with the logo, unconditionally on every page', () => {
    const html = renderSiteHtml([], { ...baseCtx, gymLogoUrl: 'https://x.com/logo.png' });
    expect(html).toContain('<header class="site-header">');
    expect(html).toContain('src="https://x.com/logo.png"');
  });

  it('falls back to the gym name in the header when there is no logo', () => {
    const html = renderSiteHtml([], baseCtx);
    expect(html).toContain('<header class="site-header">');
    expect(html).toContain('<span>Iron Gym</span>');
  });

  it('renders a Temple footer with legal links absolute to the platform origin', () => {
    const html = renderSiteHtml([], baseCtx);
    expect(html).toContain('<footer class="site-footer">');
    expect(html).toContain('href="https://app.example.com">Powered by Temple');
    expect(html).toContain('href="https://app.example.com/privacy"');
    expect(html).toContain('href="https://app.example.com/terms"');
  });

  it('renders no nav and the plain gym-name title when pages is omitted or has one page', () => {
    const noPages = renderSiteHtml([], baseCtx);
    expect(noPages).not.toContain('class="site-nav"');
    expect(noPages).toContain('<title>Iron Gym</title>');

    const onePage = renderSiteHtml([], { ...baseCtx, pages: [{ slug: '', title: 'Home' }] });
    expect(onePage).not.toContain('class="site-nav"');
    expect(onePage).toContain('<title>Iron Gym</title>');
  });

  it('renders a nav link per page with PATH-absolute hrefs (no origin) so they work on a custom domain', () => {
    const pages = [
      { slug: '', title: 'Home' },
      { slug: 'schedule', title: 'Schedule' },
    ];
    const html = renderSiteHtml([], { ...baseCtx, pages, activePageSlug: 'schedule' });
    expect(html).toContain('<nav class="site-nav" aria-label="Site pages">');
    // Path-absolute, not origin-absolute: on a custom domain these stay on
    // the domain and resolve via vercel.json's host-agnostic /site/* rewrite.
    expect(html).toContain('href="/site/iron-gym"');
    expect(html).toContain('href="/site/iron-gym/schedule"');
    expect(html).not.toContain('href="https://app.example.com/site/iron-gym');
    // The active page gets aria-current + is-active; home (inactive here) doesn't.
    // Each link also carries data-page-slug so the editable-canvas bridge can
    // switch the editor's active page instead of navigating the iframe.
    expect(html).toContain('class="site-nav-link is-active" href="/site/iron-gym/schedule" data-page-slug="schedule" aria-current="page"');
    expect(html).toContain('class="site-nav-link" href="/site/iron-gym" data-page-slug=""');
  });

  it('titles a non-home page as "<page title> — <gym name>", but keeps home as just the gym name', () => {
    const pages = [
      { slug: '', title: 'Home' },
      { slug: 'schedule', title: 'This Week' },
    ];
    const home = renderSiteHtml([], { ...baseCtx, pages, activePageSlug: '' });
    expect(home).toContain('<title>Iron Gym</title>');

    const sub = renderSiteHtml([], { ...baseCtx, pages, activePageSlug: 'schedule' });
    expect(sub).toContain('<title>This Week — Iron Gym</title>');
    expect(sub).toContain('<meta property="og:title" content="This Week — Iron Gym">');
  });

  it('overrides the auto-generated title with a page metaTitle, on Home and other pages alike', () => {
    const pages = [
      { slug: '', title: 'Home', metaTitle: 'Best CrossFit Gym in Anytown' },
      { slug: 'schedule', title: 'This Week', metaTitle: 'Weekly Class Schedule' },
    ];
    const home = renderSiteHtml([], { ...baseCtx, pages, activePageSlug: '' });
    expect(home).toContain('<title>Best CrossFit Gym in Anytown</title>');
    expect(home).toContain('<meta property="og:title" content="Best CrossFit Gym in Anytown">');
    expect(home).toContain('<meta name="twitter:title" content="Best CrossFit Gym in Anytown">');

    const sub = renderSiteHtml([], { ...baseCtx, pages, activePageSlug: 'schedule' });
    expect(sub).toContain('<title>Weekly Class Schedule</title>');
  });

  it('falls back to the auto-generated title when metaTitle is blank', () => {
    const pages = [{ slug: '', title: 'Home', metaTitle: '   ' }];
    const html = renderSiteHtml([], { ...baseCtx, pages, activePageSlug: '' });
    expect(html).toContain('<title>Iron Gym</title>');
  });

  it('escapes a hostile metaTitle', () => {
    const pages = [{ slug: '', title: 'Home', metaTitle: '<script>alert(1)</script>' }];
    const html = renderSiteHtml([], { ...baseCtx, pages, activePageSlug: '' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes author text so it cannot inject markup', () => {
    const hero = createBlock('hero') as HeroBlock;
    const page = appendBlock(emptyPage(), {
      ...hero,
      headline: '<script>alert(1)</script>',
      subheadline: 'Safe & sound "quoted"',
    });
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('hero CTA links to the join flow on the platform origin, and to #contact when targeted at the page', () => {
    const hero = createBlock('hero') as HeroBlock;
    const joinPage = appendBlock(emptyPage(), { ...hero, ctaTarget: 'join' });
    // Absolute on purpose: on a custom domain a relative /join/<slug>
    // would land on the app shell at an origin auth emails can't use.
    expect(renderSiteHtml(joinPage.blocks, baseCtx)).toContain(
      'href="https://app.example.com/join/iron-gym"',
    );

    const contactPage = appendBlock(emptyPage(), { ...hero, ctaTarget: 'contact' });
    expect(renderSiteHtml(contactPage.blocks, baseCtx)).toContain('href="#contact"');
  });

  describe('canonical tag and og:url', () => {
    it('omits the canonical link and og:url when canonicalUrl is not set', () => {
      const html = renderSiteHtml([], baseCtx);
      expect(html).not.toContain('rel="canonical"');
      expect(html).not.toContain('og:url');
    });

    it('renders the canonical link and matching og:url when set', () => {
      const html = renderSiteHtml([], { ...baseCtx, canonicalUrl: 'https://iron-gym.example/' });
      expect(html).toContain('<link rel="canonical" href="https://iron-gym.example/">');
      expect(html).toContain('<meta property="og:url" content="https://iron-gym.example/">');
    });
  });

  describe('google-site-verification', () => {
    it('omits the meta tag when not set', () => {
      const html = renderSiteHtml([], baseCtx);
      expect(html).not.toContain('google-site-verification');
    });

    it('renders the verification meta tag when set', () => {
      const html = renderSiteHtml([], { ...baseCtx, searchConsoleVerification: 'abc123' });
      expect(html).toContain('<meta name="google-site-verification" content="abc123">');
    });
  });

  describe('Open Graph / Twitter tags', () => {
    it('emits og:type, og:site_name, and a summary twitter:card with no image', () => {
      const html = renderSiteHtml([], baseCtx);
      expect(html).toContain('<meta property="og:type" content="website">');
      expect(html).toContain('<meta property="og:site_name" content="Iron Gym">');
      expect(html).toContain('<meta name="twitter:card" content="summary">');
      expect(html).toContain('<meta name="twitter:title" content="Iron Gym">');
      expect(html).not.toContain('twitter:image');
      expect(html).not.toContain('og:image');
    });

    it('uses the gym logo for og:image/twitter:image and switches to summary_large_image', () => {
      const html = renderSiteHtml([], { ...baseCtx, gymLogoUrl: 'https://x.com/logo.png' });
      expect(html).toContain('<meta property="og:image" content="https://x.com/logo.png">');
      expect(html).toContain('<meta name="twitter:image" content="https://x.com/logo.png">');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    });

    it('falls back to the hero photo for og:image/twitter:image when there is no gym logo', () => {
      const hero = createBlock('hero') as HeroBlock;
      const page = appendBlock(emptyPage(), { ...hero, imageUrl: 'https://x.com/hero.jpg' });
      const html = renderSiteHtml(page.blocks, baseCtx);
      expect(html).toContain('<meta property="og:image" content="https://x.com/hero.jpg">');
      expect(html).toContain('<meta name="twitter:image" content="https://x.com/hero.jpg">');
    });

    it('prefers the gym logo over the hero photo when both are set', () => {
      const hero = createBlock('hero') as HeroBlock;
      const page = appendBlock(emptyPage(), { ...hero, imageUrl: 'https://x.com/hero.jpg' });
      const html = renderSiteHtml(page.blocks, { ...baseCtx, gymLogoUrl: 'https://x.com/logo.png' });
      expect(html).toContain('<meta property="og:image" content="https://x.com/logo.png">');
    });
  });

  describe('LocalBusiness JSON-LD', () => {
    it('emits nothing when there is no structuredAddress', () => {
      const html = renderSiteHtml([], baseCtx);
      expect(html).not.toContain('application/ld+json');
    });

    it('emits an ExerciseGym schema with the structured address, canonical url and image', () => {
      const html = renderSiteHtml([], {
        ...baseCtx,
        gymLogoUrl: 'https://x.com/logo.png',
        canonicalUrl: 'https://iron-gym.example/',
        structuredAddress: { street: '1 Gym St', city: 'Anytown', region: 'Anystate', postalCode: 'AB1 2CD', country: 'GB' },
      });
      expect(html).toContain('<script type="application/ld+json">');
      const match = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/);
      expect(match).not.toBeNull();
      const data = JSON.parse(match![1]);
      expect(data).toMatchObject({
        '@context': 'https://schema.org',
        '@type': 'ExerciseGym',
        name: 'Iron Gym',
        url: 'https://iron-gym.example/',
        image: 'https://x.com/logo.png',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '1 Gym St',
          addressLocality: 'Anytown',
          addressRegion: 'Anystate',
          postalCode: 'AB1 2CD',
          addressCountry: 'GB',
        },
      });
    });

    it('omits optional address fields and url/image when not provided', () => {
      const html = renderSiteHtml([], {
        ...baseCtx,
        structuredAddress: { street: '1 Gym St', city: 'Anytown' },
      });
      const match = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.url).toBeUndefined();
      expect(data.image).toBeUndefined();
      expect(data.address.addressRegion).toBeUndefined();
      expect(data.address.postalCode).toBeUndefined();
      expect(data.address.addressCountry).toBeUndefined();
    });

    it('neutralises a hostile value so it cannot break out of the script tag', () => {
      const html = renderSiteHtml([], {
        ...baseCtx,
        gymName: '</script><script>alert(1)</script>',
        structuredAddress: { street: '1 Gym St', city: 'Anytown' },
      });
      expect(html).not.toContain('</script><script>alert(1)</script>');
      expect(html).toContain('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>');
    });
  });

  describe('imageAlt overrides', () => {
    it('uses the hero imageAlt when set, falling back to the gym name', () => {
      const hero = createBlock('hero') as HeroBlock;
      const withAlt = appendBlock(emptyPage(), {
        ...hero,
        layout: 'side',
        imageUrl: 'https://x.com/hero.jpg',
        imageAlt: 'Members deadlifting',
      });
      expect(renderSiteHtml(withAlt.blocks, baseCtx)).toContain('alt="Members deadlifting"');

      const withoutAlt = appendBlock(emptyPage(), {
        ...hero,
        layout: 'side',
        imageUrl: 'https://x.com/hero.jpg',
      });
      expect(renderSiteHtml(withoutAlt.blocks, baseCtx)).toContain('alt="Iron Gym"');
    });

    it('uses the about imageAlt when set, falling back to the heading, and lazy-loads it', () => {
      const about = createBlock('about') as AboutBlock;
      const withAlt = appendBlock(emptyPage(), {
        ...about,
        heading: 'About us',
        imageUrl: 'https://x.com/about.jpg',
        imageAlt: 'Coach demonstrating a lift',
      });
      const html = renderSiteHtml(withAlt.blocks, baseCtx);
      expect(html).toContain('alt="Coach demonstrating a lift"');
      expect(html).toContain('loading="lazy"');

      const withoutAlt = appendBlock(emptyPage(), {
        ...about,
        heading: 'About us',
        imageUrl: 'https://x.com/about.jpg',
      });
      expect(renderSiteHtml(withoutAlt.blocks, baseCtx)).toContain('alt="About us"');
    });
  });

  it('uses a page meta description when set, falling back to the gym-level default', () => {
    const withMeta = renderSiteHtml([], {
      ...baseCtx,
      pages: [{ slug: '', title: 'Home', metaDescription: 'The best CrossFit in town.' }],
      activePageSlug: '',
    });
    expect(withMeta).toContain('<meta name="description" content="The best CrossFit in town.">');
    expect(withMeta).toContain('og:description" content="The best CrossFit in town.');

    const noMeta = renderSiteHtml([], {
      ...baseCtx,
      pages: [{ slug: '', title: 'Home' }],
      activePageSlug: '',
    });
    expect(noMeta).toContain('content="Iron Gym — book a class');
  });

  describe('image URL sanitisation (defence-in-depth for pre-validation rows)', () => {
    it('drops a javascript: URL from a hero background image', () => {
      const hero = createBlock('hero') as HeroBlock;
      const page = appendBlock(emptyPage(), {
        ...hero,
        layout: 'background',
        imageUrl: 'javascript:alert(document.cookie)',
      });
      const html = renderSiteHtml(page.blocks, baseCtx);
      expect(html).not.toContain('javascript:');
      // No background-image emitted: the hero renders with an empty style
      // and without the has-img modifier class on the section.
      expect(html).toContain('<section class="hero-bg" style="">');
    });

    it('drops a control-char-obfuscated javascript: URL', () => {
      const hero = createBlock('hero') as HeroBlock;
      const page = appendBlock(emptyPage(), {
        ...hero,
        layout: 'side',
        imageUrl: 'java\nscript:alert(1)',
      });
      const html = renderSiteHtml(page.blocks, baseCtx);
      expect(html).not.toContain('script:');
    });

    it('drops a data: URL and neutralises a CSS url() breakout attempt', () => {
      const hero = createBlock('hero') as HeroBlock;
      const dataPage = appendBlock(emptyPage(), {
        ...hero,
        layout: 'side',
        imageUrl: 'data:text/html,<script>alert(1)</script>',
      });
      expect(renderSiteHtml(dataPage.blocks, baseCtx)).not.toContain('data:text/html');

      // A quote/paren in the URL must never break out of url('...') in the
      // inline style — a non-http(s) value is dropped entirely.
      const breakout = appendBlock(emptyPage(), {
        ...hero,
        layout: 'background',
        imageUrl: "x'); } body { display:none } .x{ background:url('x",
      });
      const html = renderSiteHtml(breakout.blocks, baseCtx);
      expect(html).not.toContain('display:none');
      expect(html).toContain('<section class="hero-bg" style="">');
    });

    it('keeps a valid https image URL', () => {
      const hero = createBlock('hero') as HeroBlock;
      const page = appendBlock(emptyPage(), {
        ...hero,
        layout: 'side',
        imageUrl: 'https://cdn.example.com/hero.jpg',
      });
      const html = renderSiteHtml(page.blocks, baseCtx);
      expect(html).toContain('src="https://cdn.example.com/hero.jpg"');
    });

    it('drops unsafe gallery image URLs but keeps safe ones', () => {
      const gallery = createBlock('gallery') as GalleryBlock;
      const page = appendBlock(emptyPage(), {
        ...gallery,
        images: [
          { id: 'g1', url: 'https://cdn.example.com/ok.jpg', alt: 'ok' },
          { id: 'g2', url: 'javascript:alert(1)', alt: 'bad' },
        ],
      });
      const html = renderSiteHtml(page.blocks, baseCtx);
      expect(html).toContain('src="https://cdn.example.com/ok.jpg"');
      expect(html).not.toContain('javascript:');
    });

    it('drops an unsafe team avatar URL and falls back to initials', () => {
      const team = createBlock('team') as TeamBlock;
      const page = appendBlock(emptyPage(), team);
      const html = renderSiteHtml(page.blocks, {
        ...baseCtx,
        team: [{ profileId: 'p1', fullName: 'Dana Coach', avatarUrl: 'javascript:alert(1)' }],
      });
      expect(html).not.toContain('javascript:');
      expect(html).toContain('team-initials');
    });
  });

  it('never emits an --accent-ink that fails 4.5:1 text contrast on the background or a card surface', () => {
    const extractVar = (html: string, name: string): string => {
      const m = html.match(new RegExp(`--${name}:(#[0-9A-Fa-f]{3,8});`));
      return m ? m[1] : '';
    };
    // A muddy mid-grey clears the 3:1 fill floor on some themes but is
    // unreadable as text — exactly the case accent-ink must reject.
    for (const theme of BRAND_THEME_LIST) {
      for (const brand of ['#808080', '#FF5A1F', '#0F766E', '#C0C0C0']) {
        const composed = composeThemeWithBrand(theme, brand);
        const html = renderSiteHtml([], { ...baseCtx, theme: composed });
        const ink = extractVar(html, 'accent-ink');
        expect(ink).not.toBe('');
        expect(contrastRatio(ink, composed.palette.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(ink, composed.palette.surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('renders an empty-state message for the schedule block with no sessions', () => {
    const page = appendBlock(emptyPage(), createBlock('schedule') as ScheduleBlock);
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).toContain('Check back soon for the full schedule.');
  });

  it('renders session and coach details, with a next-up banner and closed-day placeholders', () => {
    const page = appendBlock(emptyPage(), createBlock('schedule') as ScheduleBlock);
    const sessions: ScheduleSession[] = [
      {
        sessionId: 's1',
        startsAt: '2026-07-06T09:00:00Z',
        durationMinutes: 60,
        classTypeName: 'CrossFit',
        classTypeColor: '#FF0000',
        coachName: 'Priya Sharma',
      },
    ];
    const html = renderSiteHtml(page.blocks, { ...baseCtx, schedule: sessions });
    expect(html).toContain('CrossFit');
    expect(html).toContain('Priya Sharma');
    // Reuses the Team block's avatar-initials pattern.
    expect(html).toContain('<span class="sched-coach-dot">PS</span>');
    // The one session is today, so it drives "next up"...
    expect(html).toContain('CrossFit today at 09:00 with Priya Sharma');
    // ...and the other six days in the grid render as closed, not blank.
    expect((html.match(/sched-empty">Closed</g) ?? []).length).toBe(6);
  });

  it('renders a 7-day grid with a today marker, closed-day states, and per-class colour ticket accents', () => {
    const page = appendBlock(emptyPage(), createBlock('schedule') as ScheduleBlock);
    const sessions: ScheduleSession[] = [
      {
        sessionId: 's1',
        startsAt: '2026-07-06T09:00:00Z', // today, matches baseCtx.now
        durationMinutes: 60,
        classTypeName: 'CrossFit',
        classTypeColor: '#FF0000',
        coachName: null,
      },
      {
        sessionId: 's2',
        startsAt: '2026-07-08T18:00:00Z', // Wednesday
        durationMinutes: 60,
        classTypeName: 'Open gym',
        classTypeColor: null,
        coachName: null,
      },
    ];
    const html = renderSiteHtml(page.blocks, { ...baseCtx, schedule: sessions });

    // Matches the column wrapper's own class attribute only — not the
    // sched-col-head div nested inside each one.
    expect((html.match(/class="sched-col["\s]/g) ?? []).length).toBe(7);
    expect(html).toContain('class="sched-col is-today"');
    expect(html).toContain('<span class="sched-today-chip">Today</span>');
    expect((html.match(/sched-empty">Closed</g) ?? []).length).toBe(5);
    expect(html).toContain('<b>2</b> classes · <b>0</b> coaches this week');
    expect(html).toContain('--dot:#FF0000;');
    expect(html).toContain('--dot:var(--accent);');
  });

  it('formats schedule times per theme — tight 24h for the intense themes, lowercase 12h for the calm ones', () => {
    const page = appendBlock(emptyPage(), createBlock('schedule') as ScheduleBlock);
    const sessions: ScheduleSession[] = [
      {
        sessionId: 's1',
        startsAt: '2026-07-06T09:00:00Z',
        durationMinutes: 60,
        classTypeName: 'CrossFit',
        classTypeColor: '#FF0000',
        coachName: null,
      },
      {
        sessionId: 's2',
        startsAt: '2026-07-06T14:30:00Z',
        durationMinutes: 60,
        classTypeName: 'Open gym',
        classTypeColor: null,
        coachName: null,
      },
      {
        sessionId: 's3',
        startsAt: '2026-07-06T00:00:00Z',
        durationMinutes: 60,
        classTypeName: 'Midnight open gym',
        classTypeColor: null,
        coachName: null,
      },
      {
        sessionId: 's4',
        startsAt: '2026-07-06T12:00:00Z',
        durationMinutes: 60,
        classTypeName: 'Noon session',
        classTypeColor: null,
        coachName: null,
      },
    ];

    const ticket = (time: string, name: string) =>
      `<div class="sched-ticket-time">${time}</div><div class="sched-ticket-name">${name}</div>`;

    const forgedHtml = renderSiteHtml(page.blocks, { ...baseCtx, theme: BRAND_THEMES.forged, schedule: sessions });
    expect(forgedHtml).toContain(ticket('09:00', 'CrossFit'));
    expect(forgedHtml).toContain(ticket('14:30', 'Open gym'));

    const ringsideHtml = renderSiteHtml(page.blocks, { ...baseCtx, theme: BRAND_THEMES.ringside, schedule: sessions });
    expect(ringsideHtml).toContain(ticket('09:00', 'CrossFit'));

    const baselineHtml = renderSiteHtml(page.blocks, { ...baseCtx, theme: BRAND_THEMES.baseline, schedule: sessions });
    expect(baselineHtml).toContain(ticket('9:00am', 'CrossFit'));
    expect(baselineHtml).toContain(ticket('2:30pm', 'Open gym'));
    expect(baselineHtml).toContain(ticket('12:00am', 'Midnight open gym'));
    expect(baselineHtml).toContain(ticket('12:00pm', 'Noon session'));

    const daybreakHtml = renderSiteHtml(page.blocks, { ...baseCtx, theme: BRAND_THEMES.daybreak, schedule: sessions });
    expect(daybreakHtml).toContain(ticket('9:00am', 'CrossFit'));
  });

  it('formats plan pricing by kind and hides plans in hiddenPlanIds', () => {
    const pricing = createBlock('pricing') as PricingBlock;
    const page = appendBlock(emptyPage(), { ...pricing, hiddenPlanIds: ['p2'] });
    const plans: PublicPlan[] = [
      { planId: 'p1', name: 'Unlimited', kind: 'unlimited', creditCount: null, monthlyPriceCents: 12000 },
      { planId: 'p2', name: 'Legacy plan', kind: 'unlimited', creditCount: null, monthlyPriceCents: 5000 },
      { planId: 'p3', name: 'Drop-in', kind: 'credit_pack', creditCount: 1, monthlyPriceCents: 1500 },
    ];
    const html = renderSiteHtml(page.blocks, { ...baseCtx, plans });
    expect(html).toContain('Unlimited');
    expect(html).toContain('Drop-in');
    expect(html).not.toContain('Legacy plan');
    expect(html).toContain('£120.00');
    expect(html).toContain('£15.00');
  });

  it('shows a fallback message when every plan is hidden or none exist', () => {
    const pricing = createBlock('pricing') as PricingBlock;
    const page = appendBlock(emptyPage(), pricing);
    const html = renderSiteHtml(page.blocks, { ...baseCtx, plans: [] });
    expect(html).toContain('Get in touch for membership options.');
  });

  it('omits the testimonials/gallery sections entirely when they have no content', () => {
    let page = emptyPage();
    page = appendBlock(page, createBlock('testimonials') as TestimonialsBlock);
    page = appendBlock(page, createBlock('gallery') as GalleryBlock);
    const html = renderSiteHtml(page.blocks, baseCtx);
    // The shared stylesheet always defines these classes; what matters
    // is that neither block emitted a <section> into the body at all.
    expect(html).not.toContain('<section');
  });

  it('renders testimonial quotes and gallery images when present', () => {
    let page = emptyPage();
    const testimonials = createBlock('testimonials') as TestimonialsBlock;
    testimonials.quotes = [{ id: 'q1', quote: 'Great gym', name: 'Sam' }];
    page = appendBlock(page, testimonials);
    const gallery = createBlock('gallery') as GalleryBlock;
    gallery.images = [{ id: 'g1', url: 'https://x.com/a.png', alt: 'Training' }];
    page = appendBlock(page, gallery);
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).toContain('Great gym');
    expect(html).toContain('Sam');
    expect(html).toContain('src="https://x.com/a.png"');
    expect(html).toContain('alt="Training"');
  });

  it('lets bold/italic/underline through on rich-text fields (About body, testimonial quotes)', () => {
    const about = createBlock('about') as AboutBlock;
    const page = appendBlock(emptyPage(), {
      ...about,
      body: 'Coached sessions, <b>smart programming</b> and a standard you <i>rise</i> to — <u>free</u> first class.',
    });
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).toContain('<b>smart programming</b>');
    expect(html).toContain('a standard you <i>rise</i> to');
    expect(html).toContain('<u>free</u> first class');

    // The field is marked rich so the canvas bridge captures innerHTML,
    // not innerText, for it specifically — only present on the editable path.
    const editableHtml = renderSiteHtml(page.blocks, { ...baseCtx, editable: true });
    expect(editableHtml).toContain('data-rich="true"');
  });

  it('strips everything except bold/italic/underline from rich-text fields, including tags written straight into stored content', () => {
    const about = createBlock('about') as AboutBlock;
    const hostile = appendBlock(emptyPage(), {
      ...about,
      body: '<script>alert(1)</script><img src=x onerror="alert(1)"><b onclick="alert(1)">bold</b><a href="javascript:alert(1)">link</a>',
    });
    const html = renderSiteHtml(hostile.blocks, baseCtx);
    // No real tag ever reaches the output for anything but b/i/u — the
    // words "onerror"/"onclick"/"javascript:" can still appear as inert
    // visible text (harmless letters on a page), but never as part of
    // an actual <img>/<a> element a browser would parse and act on.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).not.toContain('<a href="javascript:');
    // The escaped, inert text is still present — nothing silently
    // vanishes, it just can't execute or carry attributes.
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    // An attribute-bearing opening <b> doesn't match the exact allowed
    // literal, so it stays inert escaped text — no attribute (and no
    // onclick) ever reaches real markup. Its bare, attribute-less
    // </b> closing tag does match and becomes real markup, but an
    // unmatched closing tag is inert too — browsers just ignore it.
    expect(html).toContain('&lt;b onclick=&quot;alert(1)&quot;&gt;bold</b>');

    const testimonials = createBlock('testimonials') as TestimonialsBlock;
    const hostileQuote = appendBlock(emptyPage(), {
      ...testimonials,
      quotes: [{ id: 'q1', quote: '<b>Great</b> gym <script>alert(2)</script>', name: 'Sam' }],
    });
    const quoteHtml = renderSiteHtml(hostileQuote.blocks, baseCtx);
    expect(quoteHtml).toContain('<b>Great</b> gym');
    expect(quoteHtml).not.toContain('<script>');
    expect(quoteHtml).toContain('&lt;script&gt;');
  });

  it('renders the location address and hours', () => {
    const location = createBlock('location') as LocationBlock;
    location.address = '1 Gym St';
    location.hours = 'Mon-Fri 6am-8pm';
    const page = appendBlock(emptyPage(), location);
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).toContain('1 Gym St');
    expect(html).toContain('Mon-Fri 6am-8pm');
  });

  it('renders the visible team roster and hides members in hiddenMemberIds', () => {
    const team = createBlock('team') as TeamBlock;
    const page = appendBlock(emptyPage(), { ...team, hiddenMemberIds: ['m2'] });
    const members: TeamMember[] = [
      { profileId: 'm1', fullName: 'Priya Shah', avatarUrl: 'https://x.com/priya.png' },
      { profileId: 'm2', fullName: 'Hidden Coach', avatarUrl: null },
      { profileId: 'm3', fullName: 'Sam Lee', avatarUrl: null },
    ];
    const html = renderSiteHtml(page.blocks, { ...baseCtx, team: members });
    expect(html).toContain('Priya Shah');
    expect(html).toContain('src="https://x.com/priya.png"');
    expect(html).toContain('class="team-avatar" src="https://x.com/priya.png" alt="Priya Shah" loading="lazy"');
    expect(html).not.toContain('Hidden Coach');
    expect(html).toContain('Sam Lee');
    // No avatarUrl falls back to a static initials circle, not an <img>.
    expect(html).toContain('<div class="team-initials">S</div>');
  });

  it('omits the team section in public mode with no visible members, but keeps it editable', () => {
    const team = createBlock('team') as TeamBlock;
    const page = appendBlock(emptyPage(), { ...team, heading: 'Meet the team' });
    const publicHtml = renderSiteHtml(page.blocks, baseCtx);
    expect(publicHtml).not.toContain('<section');

    const editableHtml = renderSiteHtml(page.blocks, { ...baseCtx, editable: true });
    expect(editableHtml).toContain('<section');
    expect(editableHtml).toContain(`data-field="${team.id}:heading"`);
  });

  it('escapes team member names', () => {
    const team = createBlock('team') as TeamBlock;
    const page = appendBlock(emptyPage(), team);
    const members: TeamMember[] = [
      { profileId: 'm1', fullName: '<script>alert(1)</script>', avatarUrl: null },
    ];
    const html = renderSiteHtml(page.blocks, { ...baseCtx, team: members });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('wires the contact form to the right slug, supabase url and anon key', () => {
    const contact = createBlock('contact') as ContactBlock;
    const page = appendBlock(emptyPage(), contact);
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).toContain('id="temple-contact-form"');
    expect(html).toContain(JSON.stringify('iron-gym'));
    expect(html).toContain(JSON.stringify('https://example.supabase.co'));
    expect(html).toContain(JSON.stringify('anon-key-123'));
    expect(html).toContain('capture_public_lead');
  });

  it('marks fields as canvas-editable and suppresses the lead-capture script when editable', () => {
    const hero = createBlock('hero') as HeroBlock;
    const contact = createBlock('contact') as ContactBlock;
    let page = appendBlock(emptyPage(), { ...hero, headline: 'Iron Gym' });
    page = appendBlock(page, contact);
    const html = renderSiteHtml(page.blocks, { ...baseCtx, editable: true });
    expect(html).toContain(`data-field="${hero.id}:headline"`);
    expect(html).toContain('contenteditable="true"');
    expect(html).toContain('temple-site-canvas');
    expect(html).not.toContain('capture_public_lead');
  });

  it('keeps testimonials/gallery headings editable even with zero items when editable', () => {
    let page = emptyPage();
    const testimonials = createBlock('testimonials') as TestimonialsBlock;
    page = appendBlock(page, { ...testimonials, heading: 'What members say' });
    const html = renderSiteHtml(page.blocks, { ...baseCtx, editable: true });
    expect(html).toContain('<section');
    expect(html).toContain(`data-field="${testimonials.id}:heading"`);
  });

  it('produces zero editable markers or bridge script on the public (non-editable) path', () => {
    const hero = createBlock('hero') as HeroBlock;
    const testimonials = createBlock('testimonials') as TestimonialsBlock;
    let page = appendBlock(emptyPage(), hero);
    page = appendBlock(page, testimonials);
    // Same baseCtx shape api/site/[...path].ts actually passes (editable: false).
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).not.toContain('data-field');
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('temple-site-canvas');
  });
});

describe('accessibility structure', () => {
  it('emits a skip link, a main landmark, and labelled contact fields', () => {
    const page = appendBlock(emptyPage(), createBlock('contact') as ContactBlock);
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).toContain('class="skip-link" href="#main"');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('<label class="sr-only" for="temple-contact-name">');
    expect(html).toContain('<label class="sr-only" for="temple-contact-email">');
    expect(html).toContain('<label class="sr-only" for="temple-contact-message">');
    expect(html).toContain('role="status" aria-live="polite"');
  });

  it('keeps exactly one h1: first hero is h1, a second hero demotes to h2', () => {
    const heroA = { ...(createBlock('hero') as HeroBlock), id: 'hero_a' };
    const heroB = { ...(createBlock('hero') as HeroBlock), id: 'hero_b' };
    const html = renderSiteHtml(
      appendBlock(appendBlock(emptyPage(), heroA), heroB).blocks,
      baseCtx,
    );
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  });

  it('adds a visually-hidden h1 when the page has no hero block', () => {
    const page = appendBlock(emptyPage(), createBlock('about') as never);
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).toContain('<h1 class="sr-only">Iron Gym</h1>');
  });

  it('renders secondary text with the readable muted-text token, keeping --muted for borders only', () => {
    const page = appendBlock(emptyPage(), createBlock('schedule') as ScheduleBlock);
    const html = renderSiteHtml(page.blocks, baseCtx);
    expect(html).toContain(`--muted-text:${BRAND_THEMES.forged.palette.mutedText};`);
    expect(html).not.toContain('color:var(--muted);');
  });

  it('falls back to body text for accent-as-text when the accent misses 4.5:1', () => {
    // Ringside's red accent is ~4.0:1 on its background — fine as a
    // button fill, too low for link/eyebrow text.
    const html = renderSiteHtml([], {
      ...baseCtx,
      theme: BRAND_THEMES.ringside,
    });
    expect(html).toContain(`--accent-ink:${BRAND_THEMES.ringside.palette.text};`);
    // Forged's orange clears 4.5:1 and keeps the accent as ink.
    const forged = renderSiteHtml([], baseCtx);
    expect(forged).toContain(`--accent-ink:${BRAND_THEMES.forged.palette.accent};`);
  });

  it('keeps focus-visible outlines in the public CSS', () => {
    const html = renderSiteHtml([], baseCtx);
    expect(html).toContain(':focus-visible{outline:2px solid var(--text)');
  });
});
