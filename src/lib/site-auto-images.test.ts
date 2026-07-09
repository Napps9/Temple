import { describe, expect, it } from 'vitest';

import { applyAutoImages, buildAutoImageQueries } from './site-auto-images';
import { appendBlock, createBlock, emptyDocument, type HeroBlock } from './site-blocks';

describe('buildAutoImageQueries', () => {
  it('falls back to the archetype default when the gym has no class types yet', () => {
    const queries = buildAutoImageQueries([], 'forged');
    expect(queries).toEqual({ heroQuery: 'weightlifting gym', galleryQueries: [] });
  });

  it('also falls back when every class type name is blank/whitespace', () => {
    const queries = buildAutoImageQueries(['  ', ''], 'daybreak');
    expect(queries).toEqual({ heroQuery: 'yoga studio', galleryQueries: [] });
  });

  it('derives a hero query from the first class type and a gallery query per class type, capped at 3', () => {
    const queries = buildAutoImageQueries(
      ['CrossFit', 'Olympic Lifting', 'Yoga', 'Boxing', 'Pilates'],
      'forged',
    );
    expect(queries.heroQuery).toBe('CrossFit gym');
    expect(queries.galleryQueries).toEqual([
      'CrossFit training',
      'Olympic Lifting training',
      'Yoga training',
    ]);
  });

  it('trims class type names before using them', () => {
    const queries = buildAutoImageQueries(['  Boxing  '], 'ringside');
    expect(queries.heroQuery).toBe('Boxing gym');
    expect(queries.galleryQueries).toEqual(['Boxing training']);
  });
});

describe('applyAutoImages', () => {
  function docWithHeroAndAbout() {
    let doc = emptyDocument();
    doc = { ...doc, pages: [appendBlock(appendBlock(doc.pages[0], createBlock('hero')), createBlock('about'))] };
    return doc;
  }

  it('sets the hero image while keeping its background layout', () => {
    const doc = docWithHeroAndAbout();
    const next = applyAutoImages(doc, { url: 'https://x/hero.jpg', alt: 'A gym' }, []);
    const hero = next.pages[0].blocks[0] as HeroBlock;
    expect(hero.imageUrl).toBe('https://x/hero.jpg');
    expect(hero.layout).toBe('background');
  });

  it('does nothing to the hero when no photo was found', () => {
    const doc = docWithHeroAndAbout();
    const next = applyAutoImages(doc, null, []);
    const hero = next.pages[0].blocks[0] as HeroBlock;
    expect(hero.imageUrl).toBe('');
  });

  it('inserts a gallery block right after About with the given photos', () => {
    const doc = docWithHeroAndAbout();
    const next = applyAutoImages(doc, null, [
      { url: 'https://x/a.jpg', alt: 'CrossFit training' },
      { url: 'https://x/b.jpg', alt: 'Yoga training' },
    ]);
    const types = next.pages[0].blocks.map((b) => b.type);
    expect(types).toEqual(['hero', 'about', 'gallery']);
    const gallery = next.pages[0].blocks[2];
    if (gallery.type !== 'gallery') throw new Error('expected gallery');
    expect(gallery.images).toHaveLength(2);
    expect(gallery.images[0].url).toBe('https://x/a.jpg');
    expect(gallery.images[0].alt).toBe('CrossFit training');
    expect(gallery.images[1].url).toBe('https://x/b.jpg');
    // Distinct ids, so two auto-added images never collide.
    expect(gallery.images[0].id).not.toBe(gallery.images[1].id);
  });

  it('adds no gallery block when there are no gallery photos', () => {
    const doc = docWithHeroAndAbout();
    const next = applyAutoImages(doc, { url: 'https://x/hero.jpg', alt: '' }, []);
    expect(next.pages[0].blocks.map((b) => b.type)).toEqual(['hero', 'about']);
  });

  it('appends the gallery at the end when the page has no About block', () => {
    let doc = emptyDocument();
    doc = { ...doc, pages: [appendBlock(doc.pages[0], createBlock('hero'))] };
    const next = applyAutoImages(doc, null, [{ url: 'https://x/a.jpg', alt: '' }]);
    expect(next.pages[0].blocks.map((b) => b.type)).toEqual(['hero', 'gallery']);
  });

  it('leaves a non-home page untouched when it has no about block', () => {
    let doc = docWithHeroAndAbout();
    doc = {
      ...doc,
      pages: [...doc.pages, { id: 'p2', slug: 'schedule', title: 'Schedule', blocks: [createBlock('schedule')] }],
    };
    const next = applyAutoImages(doc, { url: 'https://x/hero.jpg', alt: '' }, [
      { url: 'https://x/a.jpg', alt: '' },
    ]);
    expect(next.pages[1]).toEqual(doc.pages[1]);
  });

  it("gives a non-home page's intro about block one of the fetched photos", () => {
    let doc = docWithHeroAndAbout();
    doc = {
      ...doc,
      pages: [
        ...doc.pages,
        {
          id: 'p2',
          slug: 'schedule',
          title: 'Schedule',
          blocks: [createBlock('about'), createBlock('schedule')],
        },
      ],
    };
    const next = applyAutoImages(doc, null, [{ url: 'https://x/a.jpg', alt: 'CrossFit training' }]);
    const about = next.pages[1].blocks[0];
    if (about.type !== 'about') throw new Error('expected about');
    expect(about.imageUrl).toBe('https://x/a.jpg');
    // A photo was set, so it renders side-by-side rather than text-only.
    expect(about.layout).not.toBe('none');
    // The live-data block on that page is left alone.
    expect(next.pages[1].blocks[1].type).toBe('schedule');
  });

  it('leaves non-home about blocks untouched when there are no photos', () => {
    let doc = docWithHeroAndAbout();
    doc = {
      ...doc,
      pages: [
        ...doc.pages,
        { id: 'p2', slug: 'team', title: 'Team', blocks: [createBlock('about'), createBlock('team')] },
      ],
    };
    const next = applyAutoImages(doc, { url: 'https://x/hero.jpg', alt: '' }, []);
    expect(next.pages[1]).toEqual(doc.pages[1]);
  });
});
