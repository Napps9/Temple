import { describe, expect, it } from 'vitest';

import { BRAND_THEMES } from './brand-themes';
import {
  appendBlock,
  createBlock,
  emptyDocument,
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
  platformOrigin: 'https://app.example.com',
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key-123',
  editable: false,
};

describe('renderSiteHtml', () => {
  it('produces a full HTML document with the theme CSS variables set', () => {
    const html = renderSiteHtml(emptyDocument(), baseCtx);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain(`--accent:${BRAND_THEMES.forged.palette.accent};`);
    expect(html).toContain('<title>Iron Gym</title>');
    // Photo-less background heroes get an accent glow instead of a
    // flat colour slab — pin the rule so it can't silently vanish.
    expect(html).toContain('.hero-bg:not(.has-img)');
  });

  it('always renders a site header with the logo, unconditionally on every page', () => {
    const html = renderSiteHtml(emptyDocument(), { ...baseCtx, gymLogoUrl: 'https://x.com/logo.png' });
    expect(html).toContain('<header class="site-header">');
    expect(html).toContain('src="https://x.com/logo.png"');
  });

  it('falls back to the gym name in the header when there is no logo', () => {
    const html = renderSiteHtml(emptyDocument(), baseCtx);
    expect(html).toContain('<header class="site-header">');
    expect(html).toContain('<span>Iron Gym</span>');
  });

  it('escapes author text so it cannot inject markup', () => {
    const hero = createBlock('hero') as HeroBlock;
    const doc = appendBlock(emptyDocument(), {
      ...hero,
      headline: '<script>alert(1)</script>',
      subheadline: 'Safe & sound "quoted"',
    });
    const html = renderSiteHtml(doc, baseCtx);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('hero CTA links to the join flow on the platform origin, and to #contact when targeted at the page', () => {
    const hero = createBlock('hero') as HeroBlock;
    const joinDoc = appendBlock(emptyDocument(), { ...hero, ctaTarget: 'join' });
    // Absolute on purpose: on a custom domain a relative /join/<slug>
    // would land on the app shell at an origin auth emails can't use.
    expect(renderSiteHtml(joinDoc, baseCtx)).toContain(
      'href="https://app.example.com/join/iron-gym"',
    );

    const contactDoc = appendBlock(emptyDocument(), { ...hero, ctaTarget: 'contact' });
    expect(renderSiteHtml(contactDoc, baseCtx)).toContain('href="#contact"');
  });

  it('renders an empty-state message for the schedule block with no sessions', () => {
    const doc = appendBlock(emptyDocument(), createBlock('schedule') as ScheduleBlock);
    const html = renderSiteHtml(doc, baseCtx);
    expect(html).toContain('Check back soon for the full schedule.');
  });

  it('groups schedule sessions by day and formats the coach name', () => {
    const doc = appendBlock(emptyDocument(), createBlock('schedule') as ScheduleBlock);
    const sessions: ScheduleSession[] = [
      {
        sessionId: 's1',
        startsAt: '2026-07-06T09:00:00Z',
        durationMinutes: 60,
        classTypeName: 'CrossFit',
        classTypeColor: '#FF0000',
        coachName: 'Priya',
      },
    ];
    const html = renderSiteHtml(doc, { ...baseCtx, schedule: sessions });
    expect(html).toContain('CrossFit');
    expect(html).toContain('Priya');
  });

  it('colour-codes schedule rows by class type, falling back to the theme accent', () => {
    const doc = appendBlock(emptyDocument(), createBlock('schedule') as ScheduleBlock);
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
        startsAt: '2026-07-06T10:00:00Z',
        durationMinutes: 60,
        classTypeName: 'Open gym',
        classTypeColor: null,
        coachName: null,
      },
    ];
    const html = renderSiteHtml(doc, { ...baseCtx, schedule: sessions });
    expect(html).toContain('background:#FF0000;');
    expect(html).toContain('background:var(--accent);');
  });

  it('formats plan pricing by kind and hides plans in hiddenPlanIds', () => {
    const pricing = createBlock('pricing') as PricingBlock;
    const doc = appendBlock(emptyDocument(), { ...pricing, hiddenPlanIds: ['p2'] });
    const plans: PublicPlan[] = [
      { planId: 'p1', name: 'Unlimited', kind: 'unlimited', creditCount: null, monthlyPriceCents: 12000 },
      { planId: 'p2', name: 'Legacy plan', kind: 'unlimited', creditCount: null, monthlyPriceCents: 5000 },
      { planId: 'p3', name: 'Drop-in', kind: 'credit_pack', creditCount: 1, monthlyPriceCents: 1500 },
    ];
    const html = renderSiteHtml(doc, { ...baseCtx, plans });
    expect(html).toContain('Unlimited');
    expect(html).toContain('Drop-in');
    expect(html).not.toContain('Legacy plan');
    expect(html).toContain('£120.00');
    expect(html).toContain('£15.00');
  });

  it('shows a fallback message when every plan is hidden or none exist', () => {
    const pricing = createBlock('pricing') as PricingBlock;
    const doc = appendBlock(emptyDocument(), pricing);
    const html = renderSiteHtml(doc, { ...baseCtx, plans: [] });
    expect(html).toContain('Get in touch for membership options.');
  });

  it('omits the testimonials/gallery sections entirely when they have no content', () => {
    let doc = emptyDocument();
    doc = appendBlock(doc, createBlock('testimonials') as TestimonialsBlock);
    doc = appendBlock(doc, createBlock('gallery') as GalleryBlock);
    const html = renderSiteHtml(doc, baseCtx);
    // The shared stylesheet always defines these classes; what matters
    // is that neither block emitted a <section> into the body at all.
    expect(html).not.toContain('<section');
  });

  it('renders testimonial quotes and gallery images when present', () => {
    let doc = emptyDocument();
    const testimonials = createBlock('testimonials') as TestimonialsBlock;
    testimonials.quotes = [{ id: 'q1', quote: 'Great gym', name: 'Sam' }];
    doc = appendBlock(doc, testimonials);
    const gallery = createBlock('gallery') as GalleryBlock;
    gallery.images = [{ id: 'g1', url: 'https://x.com/a.png', alt: 'Training' }];
    doc = appendBlock(doc, gallery);
    const html = renderSiteHtml(doc, baseCtx);
    expect(html).toContain('Great gym');
    expect(html).toContain('Sam');
    expect(html).toContain('src="https://x.com/a.png"');
    expect(html).toContain('alt="Training"');
  });

  it('renders the location address and hours', () => {
    const location = createBlock('location') as LocationBlock;
    location.address = '1 Gym St';
    location.hours = 'Mon-Fri 6am-8pm';
    const doc = appendBlock(emptyDocument(), location);
    const html = renderSiteHtml(doc, baseCtx);
    expect(html).toContain('1 Gym St');
    expect(html).toContain('Mon-Fri 6am-8pm');
  });

  it('renders the visible team roster and hides members in hiddenMemberIds', () => {
    const team = createBlock('team') as TeamBlock;
    const doc = appendBlock(emptyDocument(), { ...team, hiddenMemberIds: ['m2'] });
    const members: TeamMember[] = [
      { profileId: 'm1', fullName: 'Priya Shah', avatarUrl: 'https://x.com/priya.png' },
      { profileId: 'm2', fullName: 'Hidden Coach', avatarUrl: null },
      { profileId: 'm3', fullName: 'Sam Lee', avatarUrl: null },
    ];
    const html = renderSiteHtml(doc, { ...baseCtx, team: members });
    expect(html).toContain('Priya Shah');
    expect(html).toContain('src="https://x.com/priya.png"');
    expect(html).not.toContain('Hidden Coach');
    expect(html).toContain('Sam Lee');
    // No avatarUrl falls back to a static initials circle, not an <img>.
    expect(html).toContain('<div class="team-initials">S</div>');
  });

  it('omits the team section in public mode with no visible members, but keeps it editable', () => {
    const team = createBlock('team') as TeamBlock;
    const doc = appendBlock(emptyDocument(), { ...team, heading: 'Meet the team' });
    const publicHtml = renderSiteHtml(doc, baseCtx);
    expect(publicHtml).not.toContain('<section');

    const editableHtml = renderSiteHtml(doc, { ...baseCtx, editable: true });
    expect(editableHtml).toContain('<section');
    expect(editableHtml).toContain(`data-field="${team.id}:heading"`);
  });

  it('escapes team member names', () => {
    const team = createBlock('team') as TeamBlock;
    const doc = appendBlock(emptyDocument(), team);
    const members: TeamMember[] = [
      { profileId: 'm1', fullName: '<script>alert(1)</script>', avatarUrl: null },
    ];
    const html = renderSiteHtml(doc, { ...baseCtx, team: members });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('wires the contact form to the right slug, supabase url and anon key', () => {
    const contact = createBlock('contact') as ContactBlock;
    const doc = appendBlock(emptyDocument(), contact);
    const html = renderSiteHtml(doc, baseCtx);
    expect(html).toContain('id="temple-contact-form"');
    expect(html).toContain(JSON.stringify('iron-gym'));
    expect(html).toContain(JSON.stringify('https://example.supabase.co'));
    expect(html).toContain(JSON.stringify('anon-key-123'));
    expect(html).toContain('capture_public_lead');
  });

  it('marks fields as canvas-editable and suppresses the lead-capture script when editable', () => {
    const hero = createBlock('hero') as HeroBlock;
    const contact = createBlock('contact') as ContactBlock;
    let doc = appendBlock(emptyDocument(), { ...hero, headline: 'Iron Gym' });
    doc = appendBlock(doc, contact);
    const html = renderSiteHtml(doc, { ...baseCtx, editable: true });
    expect(html).toContain(`data-field="${hero.id}:headline"`);
    expect(html).toContain('contenteditable="true"');
    expect(html).toContain('temple-site-canvas');
    expect(html).not.toContain('capture_public_lead');
  });

  it('keeps testimonials/gallery headings editable even with zero items when editable', () => {
    let doc = emptyDocument();
    const testimonials = createBlock('testimonials') as TestimonialsBlock;
    doc = appendBlock(doc, { ...testimonials, heading: 'What members say' });
    const html = renderSiteHtml(doc, { ...baseCtx, editable: true });
    expect(html).toContain('<section');
    expect(html).toContain(`data-field="${testimonials.id}:heading"`);
  });

  it('produces zero editable markers or bridge script on the public (non-editable) path', () => {
    const hero = createBlock('hero') as HeroBlock;
    const testimonials = createBlock('testimonials') as TestimonialsBlock;
    let doc = appendBlock(emptyDocument(), hero);
    doc = appendBlock(doc, testimonials);
    // Same baseCtx shape api/site/[slug].ts actually passes (editable: false).
    const html = renderSiteHtml(doc, baseCtx);
    expect(html).not.toContain('data-field');
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('temple-site-canvas');
  });
});
