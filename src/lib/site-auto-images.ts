// Pure placement logic for filling a freshly-templated site with real
// photos at creation time, using the gym's own class types to search
// Pexels rather than a generic archetype stock photo — a CrossFit box
// and a yoga studio on the same theme shouldn't get the same hero
// image. Deliberately has no import of stock-photos.ts (which pulls in
// supabase.ts, and through it react-native — not parseable by vitest):
// the actual network fetch + orchestration lives beside its one
// caller, createSite in management/website.tsx, matching this
// codebase's existing split between pure lib modules (tested) and
// network-touching ones (not).

import type { ThemeId } from './brand-themes';
import { DEFAULT_STOCK_QUERIES } from './site-templates';
import {
  createBlock,
  type AboutBlock,
  type GalleryBlock,
  type GalleryImage,
  type SiteDocument,
} from './site-blocks';

const MAX_GALLERY_PHOTOS = 3;

let counter = 0;
function autoImageId(): string {
  counter += 1;
  return `ai_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export type AutoImageQueries = {
  heroQuery: string;
  galleryQueries: string[];
};

// Falls back to the archetype's generic query when the gym has no
// class types yet (e.g. a brand-new gym that hasn't set up Programming).
export function buildAutoImageQueries(
  classTypeNames: string[],
  themeId: ThemeId,
): AutoImageQueries {
  const names = classTypeNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) {
    return { heroQuery: DEFAULT_STOCK_QUERIES[themeId], galleryQueries: [] };
  }
  // "<name> workout", not "<name> training": Pexels stems "training"
  // down to "train" and happily returns steam locomotives — a gym whose
  // class types include words like "Engine" got a literal train on its
  // Team page. "workout" carries no such homonym and still returns
  // people exercising, while the class-type name keeps each query
  // specific ("Boxing workout" vs "Yoga workout"). Hero stays "<name>
  // gym" so it and the first gallery photo don't resolve to the same
  // top result.
  return {
    heroQuery: `${names[0]} gym`,
    galleryQueries: names.slice(0, MAX_GALLERY_PHOTOS).map((n) => `${n} workout`),
  };
}

export type AutoImage = { url: string; alt: string };

// The hero keeps its 'background' layout — it already renders
// correctly with or without an image (see renderHero/
// `.hero-bg:not(.has-img)`) — so setting imageUrl is the only change
// needed. Gallery is only added when there's at least one photo to
// put in it: an empty gallery block would just trip the existing "no
// photos yet" publish warning for nothing.
//
// Every non-home page (Schedule/Team/Pricing) opens with an intro
// about block; each gets one of the same fetched photos so those pages
// don't open with a bare heading. Reusing the gallery photos rather
// than fetching more is deliberate — the Pexels budget is small and
// platform-wide — cycling if there are more pages than photos and
// alternating the image side page-to-page for a little rhythm. A page
// with no about block, or no photos at all, is left untouched (an
// about with an empty imageUrl already renders as clean text — see
// renderAbout).
export function applyAutoImages(
  doc: SiteDocument,
  hero: AutoImage | null,
  gallery: AutoImage[],
): SiteDocument {
  const home = doc.pages[0];
  if (!home) return doc;

  return {
    ...doc,
    pages: doc.pages.map((page, i) => {
      if (i === 0) return { ...page, blocks: applyHomeImages(page.blocks, hero, gallery) };
      if (gallery.length === 0) return page;
      const aboutIdx = page.blocks.findIndex((b) => b.type === 'about');
      if (aboutIdx < 0) return page;
      const photo = gallery[(i - 1) % gallery.length]!;
      const layout: AboutBlock['layout'] = i % 2 === 1 ? 'image-right' : 'image-left';
      return {
        ...page,
        blocks: page.blocks.map((b, bi) =>
          bi === aboutIdx && b.type === 'about'
            ? { ...b, imageUrl: photo.url, layout }
            : b,
        ),
      };
    }),
  };
}

// Backfill counterpart to applyAutoImages, for the "add intro sections
// to an existing site" flow: set a photo on the intro about block of
// just the named pages (the ones addMissingIntros created), leaving
// Home and every other page's existing imagery untouched. Cycles photos
// if there are more pages than photos and alternates the image side by
// page position, matching applyAutoImages so a backfilled site looks
// the same as one built fresh.
export function applyIntroImages(
  doc: SiteDocument,
  slugs: string[],
  photos: AutoImage[],
): SiteDocument {
  if (photos.length === 0 || slugs.length === 0) return doc;
  const targets = new Set(slugs);
  let assigned = 0;
  return {
    ...doc,
    pages: doc.pages.map((page, i) => {
      if (!targets.has(page.slug)) return page;
      const aboutIdx = page.blocks.findIndex((b) => b.type === 'about');
      if (aboutIdx < 0) return page;
      const photo = photos[assigned % photos.length]!;
      assigned += 1;
      const layout: AboutBlock['layout'] = i % 2 === 1 ? 'image-right' : 'image-left';
      return {
        ...page,
        blocks: page.blocks.map((b, bi) =>
          bi === aboutIdx && b.type === 'about' ? { ...b, imageUrl: photo.url, layout } : b,
        ),
      };
    }),
  };
}

function applyHomeImages(
  homeBlocks: SiteDocument['pages'][number]['blocks'],
  hero: AutoImage | null,
  gallery: AutoImage[],
) {
  let blocks = hero
    ? homeBlocks.map((b) => (b.type === 'hero' ? { ...b, imageUrl: hero.url } : b))
    : homeBlocks;

  if (gallery.length > 0) {
    const images: GalleryImage[] = gallery.map((g) => ({
      id: autoImageId(),
      url: g.url,
      alt: g.alt,
    }));
    const galleryBlock: GalleryBlock = { ...(createBlock('gallery') as GalleryBlock), images };
    // Right after About — "here's what makes us different, here's what
    // it looks like" — ahead of the testimonials/location/contact tail.
    const aboutIdx = blocks.findIndex((b) => b.type === 'about');
    const insertAt = aboutIdx >= 0 ? aboutIdx + 1 : blocks.length;
    blocks = [...blocks.slice(0, insertAt), galleryBlock, ...blocks.slice(insertAt)];
  }

  return blocks;
}
