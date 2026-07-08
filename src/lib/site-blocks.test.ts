import { describe, expect, it } from 'vitest';

import {
  addPage,
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
  removePage,
  renamePage,
  reorderBlocks,
  reslugPage,
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

describe('page operations', () => {
  it('addPage appends with a title-derived, deduped slug and never touches the home page', () => {
    const doc = emptyDocument();
    const withSchedule = addPage(doc, 'Our Schedule!');
    expect(withSchedule.pages).toHaveLength(2);
    expect(withSchedule.pages[0]).toEqual(doc.pages[0]);
    expect(withSchedule.pages[1].slug).toBe('our-schedule');
    expect(withSchedule.pages[1].title).toBe('Our Schedule!');
    expect(withSchedule.pages[1].blocks).toEqual([]);

    const withDupe = addPage(withSchedule, 'Our Schedule!');
    expect(withDupe.pages[2].slug).toBe('our-schedule-2');
  });

  it('addPage falls back to "page" for a title that slugifies to nothing, and "Untitled" for a blank title', () => {
    const doc = emptyDocument();
    expect(addPage(doc, '!!!').pages[1].slug).toBe('page');
    const blank = addPage(doc, '   ');
    expect(blank.pages[1].title).toBe('Untitled');
    expect(blank.pages[1].slug).toBe('untitled');
  });

  it('removePage removes a non-home page but refuses to remove home', () => {
    const doc = addPage(emptyDocument(), 'Schedule');
    const homeId = doc.pages[0].id;
    const scheduleId = doc.pages[1].id;

    const withoutSchedule = removePage(doc, scheduleId);
    expect(withoutSchedule.pages).toHaveLength(1);
    expect(withoutSchedule.pages[0].id).toBe(homeId);

    const unchanged = removePage(doc, homeId);
    expect(unchanged).toEqual(doc);
  });

  it('renamePage updates the title of any page, including home', () => {
    const doc = addPage(emptyDocument(), 'Schedule');
    const homeId = doc.pages[0].id;
    const scheduleId = doc.pages[1].id;

    const renamedHome = renamePage(doc, homeId, 'Welcome');
    expect(renamedHome.pages[0].title).toBe('Welcome');
    expect(renamedHome.pages[0].slug).toBe('');

    const renamedOther = renamePage(doc, scheduleId, 'This Week');
    expect(renamedOther.pages[1].title).toBe('This Week');
    expect(renamedOther.pages[1].slug).toBe('schedule');
  });

  it('reslugPage updates a non-home page slug, deduping against the rest, but refuses home', () => {
    const doc = addPage(addPage(emptyDocument(), 'Schedule'), 'Team');
    const homeId = doc.pages[0].id;
    const teamId = doc.pages[2].id;

    const reslugged = reslugPage(doc, teamId, 'Schedule');
    expect(reslugged.pages[2].slug).toBe('schedule-2');

    const homeUnchanged = reslugPage(doc, homeId, 'anything');
    expect(homeUnchanged).toEqual(doc);

    const unknownPage = reslugPage(doc, 'not-a-real-id', 'whatever');
    expect(unknownPage).toEqual(doc);
  });
});
