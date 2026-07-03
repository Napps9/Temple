import { describe, expect, it } from 'vitest';

import {
  appendBlock,
  coerceDocument,
  createBlock,
  documentWarnings,
  duplicateBlock,
  emptyDocument,
  insertBlock,
  moveBlock,
  removeBlock,
  reorderBlocks,
  starterDocument,
  updateBlock,
  updateSettings,
  type AboutBlock,
  type GalleryBlock,
  type HeroBlock,
  type PricingBlock,
  type SiteDocument,
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
  });
});

describe('starterDocument', () => {
  it('gives a new site hero, schedule, pricing and contact to start from', () => {
    const doc = starterDocument();
    expect(doc.blocks.map((b) => b.type)).toEqual(['hero', 'schedule', 'pricing', 'contact']);
    expect(doc.settings.themeId).toBe('forged');
  });

  it('uses the generic placeholder headline when no gym name is given', () => {
    const doc = starterDocument();
    expect((doc.blocks[0] as HeroBlock).headline).toBe("Your gym's name");
  });

  it('seeds the hero headline with the real gym name when given one', () => {
    const doc = starterDocument('Iron Gym');
    expect((doc.blocks[0] as HeroBlock).headline).toBe('Iron Gym');
  });

  it('falls back to the placeholder for a blank or whitespace-only name', () => {
    expect((starterDocument('').blocks[0] as HeroBlock).headline).toBe("Your gym's name");
    expect((starterDocument('   ').blocks[0] as HeroBlock).headline).toBe("Your gym's name");
  });
});

describe('document operations are immutable', () => {
  const base: SiteDocument = emptyDocument();
  const a = createBlock('hero', 'a');
  const b = createBlock('about', 'b');
  const c = createBlock('contact', 'c');
  const doc = appendBlock(appendBlock(appendBlock(base, a), b), c);

  it('insertBlock places at the index without mutating the original', () => {
    const sched = createBlock('schedule', 's');
    const next = insertBlock(doc, sched, 1);
    expect(next.blocks.map((x) => x.id)).toEqual(['a', 's', 'b', 'c']);
    expect(doc.blocks.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('moveBlock up/down respects bounds', () => {
    expect(moveBlock(doc, 'a', 'up').blocks.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(moveBlock(doc, 'c', 'down').blocks.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(moveBlock(doc, 'b', 'up').blocks.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('reorderBlocks moves by index', () => {
    expect(reorderBlocks(doc, 0, 2).blocks.map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(reorderBlocks(doc, 1, 1).blocks.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('removeBlock and duplicateBlock', () => {
    expect(removeBlock(doc, 'b').blocks.map((x) => x.id)).toEqual(['a', 'c']);
    const dup = duplicateBlock(doc, 'a');
    expect(dup.blocks).toHaveLength(4);
    expect(dup.blocks[1].type).toBe('hero');
    expect(dup.blocks[1].id).not.toBe('a');
  });

  it('updateBlock patches a single block', () => {
    const next = updateBlock<HeroBlock>(doc, 'a', { headline: 'Changed' });
    expect((next.blocks[0] as HeroBlock).headline).toBe('Changed');
    expect((doc.blocks[0] as HeroBlock).headline).not.toBe('Changed');
  });

  it('updateSettings patches the theme', () => {
    const next = updateSettings(doc, { themeId: 'ringside' });
    expect(next.settings.themeId).toBe('ringside');
    expect(doc.settings.themeId).toBe('forged');
  });
});

describe('coerceDocument', () => {
  it('returns an empty doc for junk input', () => {
    expect(coerceDocument(null).blocks).toEqual([]);
    expect(coerceDocument(42).blocks).toEqual([]);
    expect(coerceDocument('nope').blocks).toEqual([]);
  });

  it('drops unknown block types and keeps valid ones', () => {
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
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0].type).toBe('hero');
    expect((doc.blocks[0] as HeroBlock).layout).toBe('background'); // invalid layout falls back
    expect((doc.blocks[0] as HeroBlock).ctaTarget).toBe('join'); // invalid ctaTarget falls back
    expect(doc.blocks[1].type).toBe('schedule');
    expect(doc.blocks[1].id).toBeTruthy();
  });

  it('accepts a valid hero ctaTarget of contact', () => {
    const doc = coerceDocument({ blocks: [{ id: 'h', type: 'hero', ctaTarget: 'contact' }] });
    expect((doc.blocks[0] as HeroBlock).ctaTarget).toBe('contact');
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
    expect((doc.blocks[0] as GalleryBlock).images).toHaveLength(1);
    expect((doc.blocks[0] as GalleryBlock).images[0].url).toBe('https://x.com/a.png');
  });
});

describe('documentWarnings', () => {
  it('flags an empty document', () => {
    expect(documentWarnings(emptyDocument())).toContain('The site has no content blocks yet.');
  });

  it('flags an empty hero headline, testimonials, gallery and location address', () => {
    let doc = emptyDocument();
    doc = appendBlock(doc, { ...createBlock('hero'), headline: '' } as HeroBlock);
    doc = appendBlock(doc, createBlock('testimonials'));
    doc = appendBlock(doc, createBlock('gallery'));
    doc = appendBlock(doc, createBlock('location'));
    const warnings = documentWarnings(doc);
    expect(warnings.some((w) => w.includes('hero'))).toBe(true);
    expect(warnings.some((w) => w.includes('testimonials'))).toBe(true);
    expect(warnings.some((w) => w.includes('gallery'))).toBe(true);
    expect(warnings.some((w) => w.includes('address'))).toBe(true);
  });

  it('passes a filled-in starter document', () => {
    const doc = starterDocument();
    expect(documentWarnings(doc)).toEqual([]);
  });
});
