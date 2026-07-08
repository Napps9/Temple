// The block document a gym's website editor authors and the public
// renderer (both the in-app preview and /api/site/[...path]) turns into a
// page. Mirrors src/lib/email/blocks.ts deliberately — same shape of
// pure, React-free document operations, same coerce-on-read defence for
// untyped jsonb — but is its own module, not a shared one, matching how
// the email builder itself is a bespoke module. Only the theme registry
// (brand-themes.ts) is actually shared between the two features.
//
// One real difference from email: a site is a living document, not a
// point-in-time send. `SiteSettings` stores only a `themeId` — the
// theme's colours are composed with the gym's CURRENT brand colour at
// render time (composeThemeWithBrand), never baked into the document.
// If an owner changes their brand colour later, every themed site page
// picks it up automatically; nothing needs "reapplying".
//
// A site is multi-page: `SiteDocument.pages` is an ordered list of
// `SitePage`, each with its own blocks. `pages[0]` is always the home
// page (its `slug` is always `''`, forced by coerceDocument and by
// addPage/reslugPage/removePage below never touching index 0) — home
// is identified by array position, not a flag, so it can never be
// deleted or given a real slug. The block-level operations below
// (insertBlock, appendBlock, etc.) work on a single `SitePage`
// directly, not the whole multi-page document, since the editor only
// ever has one page open for editing at a time; addPage/removePage/
// renamePage/reslugPage are the document-level page-list operations,
// since only they need to reason about "which page is home" and
// dedupe slugs across the whole page list.

import { slugify } from './brand';
import type { ThemeId } from './brand-themes';
import { isThemeId } from './brand-themes';

export type SiteBlockLayout = 'background' | 'side' | 'image-left' | 'image-right' | 'none';

export type HeroBlock = {
  id: string;
  type: 'hero';
  headline: string;
  subheadline: string;
  ctaLabel: string;
  // 'join' links to the existing public /join/<slug> signup flow;
  // 'contact' scrolls to the page's contact block (if present) instead
  // of sending a visitor away from the page they're already reading.
  ctaTarget: 'join' | 'contact';
  imageUrl: string;
  layout: 'background' | 'side';
};

export type AboutBlock = {
  id: string;
  type: 'about';
  heading: string;
  body: string;
  imageUrl: string;
  layout: 'image-left' | 'image-right' | 'none';
};

// Read-only from an editing standpoint — the actual schedule renders
// from the gym's live class-type/session data, not stored content.
export type ScheduleBlock = {
  id: string;
  type: 'schedule';
  heading: string;
};

// Reads the gym's real membership_plans at render time; hiddenPlanIds
// lets an owner hide specific plans (e.g. a legacy/grandfathered one)
// from the public page without touching the plan itself.
export type PricingBlock = {
  id: string;
  type: 'pricing';
  heading: string;
  hiddenPlanIds: string[];
};

export type Testimonial = { id: string; quote: string; name: string };
export type TestimonialsBlock = {
  id: string;
  type: 'testimonials';
  heading: string;
  quotes: Testimonial[];
};

export type GalleryImage = { id: string; url: string; alt: string };
export type GalleryBlock = {
  id: string;
  type: 'gallery';
  heading: string;
  images: GalleryImage[];
};

export type LocationBlock = {
  id: string;
  type: 'location';
  heading: string;
  address: string;
  hours: string;
};

// Restyled version of the existing /lead/<slug> form, to sit inside the
// page rather than stand alone.
export type ContactBlock = {
  id: string;
  type: 'contact';
  heading: string;
  subheading: string;
};

// Reads the gym's real staff roster (owner/admin/coach/staff) at
// render time, not stored content — same live-data-plus-hide-list
// shape as PricingBlock's hiddenPlanIds.
export type TeamBlock = {
  id: string;
  type: 'team';
  heading: string;
  hiddenMemberIds: string[];
};

export type SiteBlock =
  | HeroBlock
  | AboutBlock
  | ScheduleBlock
  | PricingBlock
  | TestimonialsBlock
  | GalleryBlock
  | LocationBlock
  | ContactBlock
  | TeamBlock;

export type SiteBlockType = SiteBlock['type'];

export type SiteSettings = {
  themeId: ThemeId;
};

// slug: '' for the home page, a URL segment (e.g. 'schedule') for every
// other page — /site/<gym-slug> vs /site/<gym-slug>/<page-slug>.
export type SitePage = {
  id: string;
  slug: string;
  title: string;
  blocks: SiteBlock[];
};

export type SiteDocument = {
  version: 2;
  settings: SiteSettings;
  pages: SitePage[];
};

// What SiteEditor (the side-panel form) actually needs: the active
// page's blocks, plus the document-level theme setting shown in its
// own "Theme & Ownership" section — not the whole multi-page document,
// which SiteEditor has no concept of. The caller (website.tsx) builds
// this from `document.pages[activePageIndex]` and splices the result
// back into the right page after an edit.
export type SiteEditorDocument = {
  settings: SiteSettings;
  blocks: SiteBlock[];
};

export const SITE_BLOCK_LABELS: Record<SiteBlockType, string> = {
  hero: 'Hero',
  about: 'About',
  schedule: 'Class schedule',
  pricing: 'Pricing',
  testimonials: 'Testimonials',
  gallery: 'Photo gallery',
  location: 'Hours & location',
  contact: 'Contact',
  team: 'Team',
};

export const SITE_BLOCK_ICONS: Record<SiteBlockType, string> = {
  hero: 'flag-outline',
  about: 'information-circle-outline',
  schedule: 'calendar-outline',
  pricing: 'card-outline',
  testimonials: 'chatbubble-ellipses-outline',
  gallery: 'images-outline',
  location: 'location-outline',
  contact: 'mail-outline',
  team: 'people-outline',
};

let counter = 0;
function genId(): string {
  counter += 1;
  return `sb_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function defaultSettings(): SiteSettings {
  return { themeId: 'forged' };
}

// A fresh block of the requested type, with placeholder content an
// owner overwrites — matches createBlock's role in the email builder.
export function createBlock(type: SiteBlockType, id: string = genId()): SiteBlock {
  switch (type) {
    case 'hero':
      return {
        id,
        type: 'hero',
        headline: "Your gym's name",
        subheadline: 'A one-line pitch that tells a visitor exactly what you offer.',
        ctaLabel: 'Book a free class',
        ctaTarget: 'join',
        imageUrl: '',
        layout: 'background',
      };
    case 'about':
      return {
        id,
        type: 'about',
        heading: 'About us',
        body: 'Tell visitors what makes your gym different.',
        imageUrl: '',
        layout: 'image-left',
      };
    case 'schedule':
      return { id, type: 'schedule', heading: 'This week' };
    case 'pricing':
      return { id, type: 'pricing', heading: 'Membership', hiddenPlanIds: [] };
    case 'testimonials':
      return { id, type: 'testimonials', heading: 'What members say', quotes: [] };
    case 'gallery':
      return { id, type: 'gallery', heading: 'Gallery', images: [] };
    case 'location':
      return { id, type: 'location', heading: 'Find us', address: '', hours: '' };
    case 'contact':
      return {
        id,
        type: 'contact',
        heading: 'Get in touch',
        subheading: "Leave your details and we'll get back to you.",
      };
    case 'team':
      return { id, type: 'team', heading: 'Meet the team', hiddenMemberIds: [] };
  }
}

// Starting pages live in site-templates.ts (four fully written
// archetypes), not here — a generic starter would be a second source
// of truth for starter copy, and site-templates already imports this
// module, so it can't live here without a circular import.

export function emptyPage(title = 'Home', slug = ''): SitePage {
  return { id: genId(), slug, title, blocks: [] };
}

export function emptyDocument(): SiteDocument {
  return { version: 2, settings: defaultSettings(), pages: [emptyPage()] };
}

// ---------------------------------------------------------------------------
// Page operations — document-level, unlike the block operations below,
// because they need to reason about the whole page list (dedupe a
// slug, refuse to touch index 0).
// ---------------------------------------------------------------------------

// Derives a URL-safe slug from a page title and de-dupes it against
// every other page's slug by suffixing -2, -3… A title that slugifies
// to nothing (e.g. "!!!" or "日本語" with only ascii-safe slugify)
// falls back to 'page' rather than producing an empty URL segment.
function uniquePageSlug(desired: string, others: SitePage[]): string {
  const base = slugify(desired) || 'page';
  const taken = new Set(others.map((p) => p.slug));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

// Appends a new page with a title-derived slug. The home page
// (pages[0]) is untouched.
export function addPage(doc: SiteDocument, title: string): SiteDocument {
  const trimmed = title.trim() || 'Untitled';
  const page: SitePage = {
    id: genId(),
    slug: uniquePageSlug(trimmed, doc.pages),
    title: trimmed,
    blocks: [],
  };
  return { ...doc, pages: [...doc.pages, page] };
}

// Refuses to remove the home page (index 0) — a site always has a
// home page, identified by position, not an id check.
export function removePage(doc: SiteDocument, pageId: string): SiteDocument {
  if (doc.pages[0]?.id === pageId) return doc;
  return { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) };
}

// Title is freely editable on every page, including home — only the
// URL (slug) is special-cased there.
export function renamePage(doc: SiteDocument, pageId: string, title: string): SiteDocument {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === pageId ? { ...p, title } : p)),
  };
}

// Refuses to reslug the home page — it's always '' (see coercePage),
// since /site/<gym-slug> with no further segment IS the home page by
// definition. De-dupes against every other page's slug the same way
// addPage does.
export function reslugPage(doc: SiteDocument, pageId: string, slug: string): SiteDocument {
  if (doc.pages[0]?.id === pageId) return doc;
  if (!doc.pages.some((p) => p.id === pageId)) return doc;
  const next = uniquePageSlug(slug, doc.pages.filter((p) => p.id !== pageId));
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === pageId ? { ...p, slug: next } : p)),
  };
}

// ---------------------------------------------------------------------------
// Pure block operations — generic over anything with a `.blocks` array,
// so the same functions work on a SitePage (page-level editing, most
// callers) and on SiteEditorDocument (what SiteEditor.tsx actually
// holds — the active page's blocks plus the document-level theme
// setting) without SiteEditor needing to know a page's id/slug/title
// even exist. Identical operation shape to email/blocks.ts's set
// (which has no page concept to worry about).
// ---------------------------------------------------------------------------

export function insertBlock<T extends { blocks: SiteBlock[] }>(
  target: T,
  block: SiteBlock,
  index: number,
): T {
  const clamped = Math.max(0, Math.min(index, target.blocks.length));
  const blocks = [...target.blocks];
  blocks.splice(clamped, 0, block);
  return { ...target, blocks };
}

export function appendBlock<T extends { blocks: SiteBlock[] }>(target: T, block: SiteBlock): T {
  return { ...target, blocks: [...target.blocks, block] };
}

export function removeBlock<T extends { blocks: SiteBlock[] }>(target: T, id: string): T {
  return { ...target, blocks: target.blocks.filter((b) => b.id !== id) };
}

// B first, T second: lets every existing call site keep writing
// updateBlock<HeroBlock>(target, id, patch) with T inferred from
// `target` — only B (rarely inferable from a patch alone) needs to be
// explicit.
export function updateBlock<B extends SiteBlock, T extends { blocks: SiteBlock[] }>(
  target: T,
  id: string,
  patch: Partial<B>,
): T {
  return {
    ...target,
    blocks: target.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as SiteBlock) : b)),
  };
}

export function moveBlock<T extends { blocks: SiteBlock[] }>(
  target: T,
  id: string,
  direction: 'up' | 'down',
): T {
  const index = target.blocks.findIndex((b) => b.id === id);
  if (index < 0) return target;
  const dest = direction === 'up' ? index - 1 : index + 1;
  if (dest < 0 || dest >= target.blocks.length) return target;
  const blocks = [...target.blocks];
  const [moved] = blocks.splice(index, 1);
  blocks.splice(dest, 0, moved);
  return { ...target, blocks };
}

export function reorderBlocks<T extends { blocks: SiteBlock[] }>(
  target: T,
  from: number,
  to: number,
): T {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= target.blocks.length ||
    to >= target.blocks.length
  ) {
    return target;
  }
  const blocks = [...target.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return { ...target, blocks };
}

export function duplicateBlock<T extends { blocks: SiteBlock[] }>(target: T, id: string): T {
  const index = target.blocks.findIndex((b) => b.id === id);
  if (index < 0) return target;
  const copy = { ...target.blocks[index], id: genId() } as SiteBlock;
  const blocks = [...target.blocks];
  blocks.splice(index + 1, 0, copy);
  return { ...target, blocks };
}

// Also generic — SiteDocument and SiteEditorDocument both carry
// `.settings`, and the theme is the one thing that's genuinely
// document-level (shared across every page of a site) rather than
// page-level like blocks are.
export function updateSettings<T extends { settings: SiteSettings }>(
  target: T,
  patch: Partial<SiteSettings>,
): T {
  return { ...target, settings: { ...target.settings, ...patch } };
}

// ---------------------------------------------------------------------------
// Coercion — `design` is stored as untyped jsonb, so anything from the
// DB is run through here before the editor/renderer touches it. Unknown
// block types and malformed fields are dropped rather than thrown on.
//
// Accepts both shapes: a legacy single-page document (`blocks` directly
// on the object, from before multi-page existed) gets wrapped into a
// single home page; a document already shaped as `pages` is coerced
// page by page. Either way the result always has at least one page.
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function asHeroLayout(v: unknown): HeroBlock['layout'] {
  return v === 'side' ? v : 'background';
}
function asHeroCtaTarget(v: unknown): HeroBlock['ctaTarget'] {
  return v === 'contact' ? v : 'join';
}
function asAboutLayout(v: unknown): AboutBlock['layout'] {
  return v === 'image-right' || v === 'none' ? v : 'image-left';
}

function coerceBlock(raw: unknown): SiteBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = asString(r.id, genId());
  switch (r.type) {
    case 'hero':
      return {
        id,
        type: 'hero',
        headline: asString(r.headline, ''),
        subheadline: asString(r.subheadline, ''),
        ctaLabel: asString(r.ctaLabel, 'Book a free class'),
        ctaTarget: asHeroCtaTarget(r.ctaTarget),
        imageUrl: asString(r.imageUrl, ''),
        layout: asHeroLayout(r.layout),
      };
    case 'about':
      return {
        id,
        type: 'about',
        heading: asString(r.heading, ''),
        body: asString(r.body, ''),
        imageUrl: asString(r.imageUrl, ''),
        layout: asAboutLayout(r.layout),
      };
    case 'schedule':
      return { id, type: 'schedule', heading: asString(r.heading, 'This week') };
    case 'pricing':
      return {
        id,
        type: 'pricing',
        heading: asString(r.heading, 'Membership'),
        hiddenPlanIds: asStringArray(r.hiddenPlanIds),
      };
    case 'testimonials': {
      const rawQuotes = Array.isArray(r.quotes) ? r.quotes : [];
      const quotes: Testimonial[] = rawQuotes
        .map((q): Testimonial | null => {
          if (!q || typeof q !== 'object') return null;
          const qr = q as Record<string, unknown>;
          return {
            id: asString(qr.id, genId()),
            quote: asString(qr.quote, ''),
            name: asString(qr.name, ''),
          };
        })
        .filter((q): q is Testimonial => q !== null);
      return { id, type: 'testimonials', heading: asString(r.heading, ''), quotes };
    }
    case 'gallery': {
      const rawImages = Array.isArray(r.images) ? r.images : [];
      const images: GalleryImage[] = rawImages
        .map((img): GalleryImage | null => {
          if (!img || typeof img !== 'object') return null;
          const ir = img as Record<string, unknown>;
          const url = asString(ir.url, '');
          if (!url) return null;
          return { id: asString(ir.id, genId()), url, alt: asString(ir.alt, '') };
        })
        .filter((img): img is GalleryImage => img !== null);
      return { id, type: 'gallery', heading: asString(r.heading, ''), images };
    }
    case 'location':
      return {
        id,
        type: 'location',
        heading: asString(r.heading, ''),
        address: asString(r.address, ''),
        hours: asString(r.hours, ''),
      };
    case 'contact':
      return {
        id,
        type: 'contact',
        heading: asString(r.heading, ''),
        subheading: asString(r.subheading, ''),
      };
    case 'team':
      return {
        id,
        type: 'team',
        heading: asString(r.heading, 'Meet the team'),
        hiddenMemberIds: asStringArray(r.hiddenMemberIds),
      };
    default:
      return null;
  }
}

function coercePage(raw: unknown, isHome: boolean): SitePage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rawBlocks = Array.isArray(r.blocks) ? r.blocks : [];
  const blocks = rawBlocks.map(coerceBlock).filter((b): b is SiteBlock => b !== null);
  return {
    id: asString(r.id, genId()),
    // The home page's slug is always '' regardless of what's stored —
    // position in the array is what makes a page "home", not its slug.
    slug: isHome ? '' : asString(r.slug, ''),
    title: asString(r.title, isHome ? 'Home' : 'Untitled'),
    blocks,
  };
}

export function coerceDocument(raw: unknown): SiteDocument {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object') {
    return { version: 2, settings: defaults, pages: [emptyPage()] };
  }
  const r = raw as Record<string, unknown>;
  const s = (r.settings ?? {}) as Record<string, unknown>;
  const settings: SiteSettings = {
    themeId: isThemeId(s.themeId) ? s.themeId : defaults.themeId,
  };

  if (Array.isArray(r.pages)) {
    const pages = r.pages
      .map((p, i) => coercePage(p, i === 0))
      .filter((p): p is SitePage => p !== null);
    return { version: 2, settings, pages: pages.length > 0 ? pages : [emptyPage()] };
  }

  // Legacy single-page shape: blocks lived directly on the document.
  const rawBlocks = Array.isArray(r.blocks) ? r.blocks : [];
  const blocks = rawBlocks.map(coerceBlock).filter((b): b is SiteBlock => b !== null);
  return { version: 2, settings, pages: [{ id: genId(), slug: '', title: 'Home', blocks }] };
}

// Lightweight readiness check, same role as the email builder's
// documentWarnings — gates the Publish button, warns the author. Scoped
// to a single page for now (generic over `.blocks`, same reason as the
// block operations above); called once per page rather than across the
// whole document.
export function documentWarnings<T extends { blocks: SiteBlock[] }>(target: T): string[] {
  const warnings: string[] = [];
  if (target.blocks.length === 0) {
    warnings.push('The site has no content blocks yet.');
  }
  for (const b of target.blocks) {
    if (b.type === 'hero' && !b.headline.trim()) {
      warnings.push('The hero block has no headline.');
    }
    if (b.type === 'testimonials' && b.quotes.length === 0) {
      warnings.push('The testimonials block is empty — add real member quotes or delete the block.');
    }
    if (b.type === 'gallery' && b.images.length === 0) {
      warnings.push('The gallery block has no photos yet.');
    }
    if (b.type === 'gallery' && b.images.some((img) => !img.alt.trim())) {
      const missing = b.images.filter((img) => !img.alt.trim()).length;
      warnings.push(
        `${missing} gallery ${missing === 1 ? 'photo needs' : 'photos need'} a short description — screen readers skip images without one.`,
      );
    }
    if (b.type === 'location' && !b.address.trim()) {
      warnings.push('The location block needs your real address before you publish.');
    }
  }
  return warnings;
}
