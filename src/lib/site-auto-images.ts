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
import { createBlock, type GalleryBlock, type GalleryImage, type SiteDocument } from './site-blocks';

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
  return {
    heroQuery: `${names[0]} gym`,
    galleryQueries: names.slice(0, MAX_GALLERY_PHOTOS).map((n) => `${n} training`),
  };
}

export type AutoImage = { url: string; alt: string };

// The hero keeps its 'background' layout — it already renders
// correctly with or without an image (see renderHero/
// `.hero-bg:not(.has-img)`) — so setting imageUrl is the only change
// needed. Gallery is only added when there's at least one photo to
// put in it: an empty gallery block would just trip the existing "no
// photos yet" publish warning for nothing.
export function applyAutoImages(
  doc: SiteDocument,
  hero: AutoImage | null,
  gallery: AutoImage[],
): SiteDocument {
  const home = doc.pages[0];
  if (!home) return doc;

  let blocks = hero
    ? home.blocks.map((b) => (b.type === 'hero' ? { ...b, imageUrl: hero.url } : b))
    : home.blocks;

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

  return { ...doc, pages: doc.pages.map((p, i) => (i === 0 ? { ...p, blocks } : p)) };
}
