import { describe, expect, it } from 'vitest';

import {
  appendBlock,
  coerceDocument,
  createBlock,
  documentWarnings,
  duplicateBlock,
  emptyDocument,
  emptyPage,
  insertBlock,
  moveBlock,
  removeBlock,
  reorderBlocks,
  updateBlock,
  updateSettings,
  type AboutBlock,
  type GalleryBlock,
  type HeroBlock,
  type PricingBlock,
  type SitePage,
  type TeamBlock,
  type TestimonialsBlock,
} from './site-blocks';

describe('createBlock', () => {
  it('seeds sensible defaults for every block type', () => {
    expect((createBlock('hero', 'h') as HeroBlock).layout).toBe('background');
    expect((createBlock('about', 'a') as AboutBlock).layout).toBe('image-left');
    expect((createBlock('pricing', 'p') as PricingBlock).hiddenPlanIds).toEqual([]);
    expect((createBlock('testimonials', 't') as TestimonialsBlock).quotes).toEqual([]);
    expect((createBlock('gallery', 'g') as GalleryBlock).images).toEqual([]);
    expect(createBlock('schedule', 's').type).toBe('schedule');
    expect(createBlock('location', 'l').type).toBe('location');
    expect(createBlock('contact', 'c').type).toBe('contact');
    expect((createBlock('team', 'tm') as TeamBlock).hiddenMemberIds).toEqual([]);
  });
});

describe('block operations are immutable, and generic over any {blocks} shape', () => {
  const base: SitePage = emptyPage();
  const a = createBlock('hero', 'a');
  const b = createBlock('about', 'b');
  const c = createBlock('contact', 'c');
  const page = appendBlock(appendBlock(appendBlock(base, a), b), c);

  it('insertBlock places at the index without mutating the original', () => {
    const sched = createBlock('schedule', 's');
    const next = insertBlock(page, sched, 1);
    expect(next.blocks.map((x) => x.id)).toEqual(['a', 's', 'b', 'c']);
    expect(page.blocks.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('moveBlock up/down respects bounds', () => {
    expect(moveBlock(page, 'a', 'up').blocks.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(moveBlock(page, 'c', 'down').blocks.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(moveBlock(page, 'b', 'up').blocks.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('reorderBlocks moves by index', () => {
    expect(reorderBlocks(page, 0, 2).blocks.map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(reorderBlocks(page, 1, 1).blocks.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('removeBlock and duplicateBlock', () => {
    expect(removeBlock(page, 'b').blocks.map((x) => x.id)).toEqual(['a', 'c']);
    const dup = duplicateBlock(page, 'a');
    expect(dup.blocks).toHaveLength(4);
    expect(dup.blocks[1].type).toBe('hero');
    expect(dup.blocks[1].id).not.toBe('a');
  });

  it('updateBlock patches a single block', () => {
    const next = updateBlock<HeroBlock, SitePage>(page, 'a', { headline: 'Changed' });
    expect((next.blocks[0] as HeroBlock).headline).toBe('Changed');
    expect((page.blocks[0] as HeroBlock).headline).not.toBe('Changed');
  });

  it('preserves the page id/slug/title — only .blocks changes', () => {
    const next = insertBlock(page, createBlock('schedule'), 0);
    expect(next.id).toBe(page.id);
    expect(next.slug).toBe(page.slug);
    expect(next.title).toBe(page.title);
  });

  it('updateSettings patches the theme on a full document', () => {
    const doc = emptyDocument();
    const next = updateSettings(doc, { themeId: 'ringside' });
    expect(next.settings.themeId).toBe('ringside');
    expect(doc.settings.themeId).toBe('forged');
  });
});

describe('coerceDocument', () => {
  it('wraps junk input in a single empty home page', () => {
    for (const junk of [null, 42, 'nope']) {
      const doc = coerceDocument(junk);
      expect(doc.pages).toHaveLength(1);
      expect(doc.pages[0].slug).toBe('');
      expect(doc.pages[0].blocks).toEqual([]);
    }
  });

  it('migrates a legacy single-page document (blocks directly on the object) into a home page', () => {
    const raw = {
      version: 1,
      settings: {},
      blocks: [
        { id: 'x', type: 'hero', headline: 'Hi', layout: 'nonsense', ctaTarget: 'nonsense' },
        { id: 'y', type: 'mystery' },
        { type: 'schedule', heading: 'Custom heading' },
      ],
    };
    const doc = coerceDocument(raw);
    expect(doc.version).toBe(2);
    expect(doc.pages).toHaveLength(1);
    const page = doc.pages[0];
    expect(page.slug).toBe('');
    expect(page.title).toBe('Home');
    expect(page.blocks).toHaveLength(2);
    expect(page.blocks[0].type).toBe('hero');
    expect((page.blocks[0] as HeroBlock).layout).toBe('background'); // invalid layout falls back
    expect((page.blocks[0] as HeroBlock).ctaTarget).toBe('join'); // invalid ctaTarget falls back
    expect(page.blocks[1].type).toBe('schedule');
    expect(page.blocks[1].id).toBeTruthy();
  });

  it('coerces an already multi-page document, forcing the first page to slug ""', () => {
    const raw = {
      pages: [
        { id: 'p1', slug: 'ignored-should-become-home', title: 'Home', blocks: [{ id: 'h', type: 'hero' }] },
        { id: 'p2', slug: 'schedule', title: 'Schedule', blocks: [{ id: 's', type: 'schedule' }] },
      ],
    };
    const doc = coerceDocument(raw);
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0].slug).toBe('');
    expect(doc.pages[0].title).toBe('Home');
    expect(doc.pages[1].slug).toBe('schedule');
    expect(doc.pages[1].title).toBe('Schedule');
    expect(doc.pages[1].blocks[0].type).toBe('schedule');
  });

  it('falls back to a single empty home page when pages is an empty array', () => {
    const doc = coerceDocument({ pages: [] });
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].slug).toBe('');
  });

  it('accepts a valid hero ctaTarget of contact', () => {
    const doc = coerceDocument({ blocks: [{ id: 'h', type: 'hero', ctaTarget: 'contact' }] });
    expect((doc.pages[0].blocks[0] as HeroBlock).ctaTarget).toBe('contact');
  });

  it('defaults an invalid or missing themeId rather than crashing', () => {
    expect(coerceDocument({ settings: { themeId: 'retired-theme' } }).settings.themeId).toBe(
      'forged',
    );
    expect(coerceDocument({}).settings.themeId).toBe('forged');
  });

  it('accepts a valid themeId', () => {
    expect(coerceDocument({ settings: { themeId: 'daybreak' } }).settings.themeId).toBe(
      'daybreak',
    );
  });

  it('drops a gallery image with no url', () => {
    const raw = {
      blocks: [
        {
          id: 'g',
          type: 'gallery',
          images: [{ id: '1', url: '', alt: 'no url' }, { id: '2', url: 'https://x.com/a.png', alt: 'ok' }],
        },
      ],
    };
    const doc = coerceDocument(raw);
    expect((doc.pages[0].blocks[0] as GalleryBlock).images).toHaveLength(1);
    expect((doc.pages[0].blocks[0] as GalleryBlock).images[0].url).toBe('https://x.com/a.png');
  });

  it('round-trips a team block including hiddenMemberIds', () => {
    const raw = {
      blocks: [
        { id: 'tm', type: 'team', heading: 'Our coaches', hiddenMemberIds: ['m1', 'm2'] },
      ],
    };
    const doc = coerceDocument(raw);
    expect(doc.pages[0].blocks[0].type).toBe('team');
    expect((doc.pages[0].blocks[0] as TeamBlock).heading).toBe('Our coaches');
    expect((doc.pages[0].blocks[0] as TeamBlock).hiddenMemberIds).toEqual(['m1', 'm2']);
  });

  it('defaults a team block with no heading or hiddenMemberIds', () => {
    const doc = coerceDocument({ blocks: [{ id: 'tm', type: 'team' }] });
    expect((doc.pages[0].blocks[0] as TeamBlock).heading).toBe('Meet the team');
    expect((doc.pages[0].blocks[0] as TeamBlock).hiddenMemberIds).toEqual([]);
  });
});

describe('documentWarnings', () => {
  it('flags an empty page', () => {
    expect(documentWarnings(emptyPage())).toContain('The site has no content blocks yet.');
  });

  it('flags an empty hero headline, testimonials, gallery and location address', () => {
    let page = emptyPage();
    page = appendBlock(page, { ...createBlock('hero'), headline: '' } as HeroBlock);
    page = appendBlock(page, createBlock('testimonials'));
    page = appendBlock(page, createBlock('gallery'));
    page = appendBlock(page, createBlock('location'));
    const warnings = documentWarnings(page);
    expect(warnings.some((w) => w.includes('hero'))).toBe(true);
    expect(warnings.some((w) => w.includes('testimonials'))).toBe(true);
    expect(warnings.some((w) => w.includes('gallery'))).toBe(true);
    expect(warnings.some((w) => w.includes('address'))).toBe(true);
  });

  it('passes a page whose blocks all have their required content', () => {
    let page = emptyPage();
    page = appendBlock(page, createBlock('hero'));
    page = appendBlock(page, createBlock('schedule'));
    page = appendBlock(page, createBlock('pricing'));
    page = appendBlock(page, createBlock('contact'));
    expect(documentWarnings(page)).toEqual([]);
  });
});

describe('gallery alt warnings', () => {
  it('warns when gallery photos are missing a description, and clears once filled', () => {
    const gallery = createBlock('gallery');
    if (gallery.type !== 'gallery') throw new Error('expected gallery');
    const withImages = {
      ...gallery,
      images: [
        { id: 'a', url: 'https://x/a.jpg', alt: '' },
        { id: 'b', url: 'https://x/b.jpg', alt: 'Members mid-workout' },
      ],
    };
    const page = appendBlock(emptyPage(), withImages);
    expect(documentWarnings(page).some((w) => w.includes('needs a short description'))).toBe(true);

    const filled = {
      ...withImages,
      images: withImages.images.map((i) => ({ ...i, alt: i.alt || 'Gym floor' })),
    };
    const okPage = appendBlock(emptyPage(), filled);
    expect(documentWarnings(okPage).some((w) => w.includes('description'))).toBe(false);
  });
});
