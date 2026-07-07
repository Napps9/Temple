import { describe, expect, it } from 'vitest';

import { BRAND_THEMES, isThemeId } from './brand-themes';
import { coerceDocument, documentWarnings } from './site-blocks';
import { renderSiteHtml, type SiteRenderContext } from './site-render';
import {
  DEFAULT_STOCK_QUERIES,
  SITE_TEMPLATES,
  SITE_TEMPLATE_LIST,
  isSiteTemplateId,
} from './site-templates';

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

describe('SITE_TEMPLATES registry', () => {
  it('offers 4 templates paired 1:1 with the 4 themes', () => {
    expect(SITE_TEMPLATE_LIST).toHaveLength(4);
    const ids = SITE_TEMPLATE_LIST.map((t) => t.id);
    expect(new Set(ids).size).toBe(4);
    const themeIds = SITE_TEMPLATE_LIST.map((t) => t.themeId).sort();
    expect(themeIds).toEqual(['baseline', 'daybreak', 'forged', 'ringside']);
    for (const t of SITE_TEMPLATE_LIST) {
      expect(isThemeId(t.themeId)).toBe(true);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('recognises template ids and rejects junk', () => {
    expect(isSiteTemplateId('strength')).toBe(true);
    expect(isSiteTemplateId('coaching')).toBe(true);
    expect(isSiteTemplateId('nope')).toBe(false);
    expect(isSiteTemplateId(42)).toBe(false);
  });
});

describe('DEFAULT_STOCK_QUERIES', () => {
  it('covers every theme with a distinct, usable search query', () => {
    expect(Object.keys(DEFAULT_STOCK_QUERIES).sort()).toEqual([
      'baseline',
      'daybreak',
      'forged',
      'ringside',
    ]);
    const queries = Object.values(DEFAULT_STOCK_QUERIES);
    expect(new Set(queries).size).toBe(queries.length);
    for (const q of queries) {
      expect(q).toBe(q.trim());
      expect(q.length).toBeGreaterThan(2);
      expect(q.length).toBeLessThanOrEqual(100);
    }
  });
});

describe.each(SITE_TEMPLATE_LIST.map((t) => [t.id, t] as const))('template %s', (_id, t) => {
  it('round-trips through JSON serialisation and coerceDocument unchanged', () => {
    const doc = t.build('Iron Gym');
    expect(coerceDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('follows the research section skeleton, with no gallery', () => {
    const doc = t.build('Iron Gym');
    expect(doc.pages[0].blocks.map((b) => b.type)).toEqual([
      'hero',
      'about',
      'schedule',
      'team',
      'pricing',
      'testimonials',
      'location',
      'contact',
    ]);
    expect(doc.settings.themeId).toBe(t.themeId);
  });

  it('builds a typographic hero — background layout, no image, headline seeded', () => {
    const seeded = t.build('Iron Gym');
    const hero = seeded.pages[0].blocks[0];
    if (hero.type !== 'hero') throw new Error('first block must be hero');
    expect(hero.layout).toBe('background');
    expect(hero.imageUrl).toBe('');
    expect(hero.headline).toContain('Iron Gym');

    for (const name of [undefined, '', '   ']) {
      const doc = t.build(name);
      const h = doc.pages[0].blocks[0];
      if (h.type !== 'hero') throw new Error('first block must be hero');
      expect(h.headline.trim().length).toBeGreaterThan(0);
    }
  });

  it('ships exactly the two launch-checklist warnings (testimonials + address)', () => {
    const warnings = documentWarnings(t.build('Iron Gym').pages[0]);
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.includes('testimonials'))).toBe(true);
    expect(warnings.some((w) => w.includes('address'))).toBe(true);
  });

  it('generates fresh, unique block ids on every build', () => {
    const a = t.build('Iron Gym');
    const b = t.build('Iron Gym');
    const aIds = a.pages[0].blocks.map((blk) => blk.id);
    expect(new Set(aIds).size).toBe(aIds.length);
    const bIds = new Set(b.pages[0].blocks.map((blk) => blk.id));
    expect(aIds.some((id) => bIds.has(id))).toBe(false);
  });

  it('renders without throwing in both public and editable modes', () => {
    const doc = t.build('Iron Gym');
    const publicHtml = renderSiteHtml(doc.pages[0].blocks, baseCtx);
    expect(publicHtml).toContain('Iron Gym');
    const editableHtml = renderSiteHtml(doc.pages[0].blocks, { ...baseCtx, editable: true });
    expect(editableHtml).toContain('contenteditable');
  });
});

describe('CTA funnels', () => {
  it('coaching is the consult-first template: its CTA scrolls to the contact form', () => {
    const html = renderSiteHtml(SITE_TEMPLATES.coaching.build('Iron Gym').pages[0].blocks, baseCtx);
    expect(html).toContain('class="btn" href="#contact"');
  });

  it('the other three link to the join flow', () => {
    for (const id of ['strength', 'combat', 'studio'] as const) {
      const html = renderSiteHtml(SITE_TEMPLATES[id].build('Iron Gym').pages[0].blocks, baseCtx);
      expect(html).toContain('href="https://app.example.com/join/iron-gym"');
    }
  });
});
