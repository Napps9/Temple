// The block document a gym's website editor authors and the public
// renderer (both the in-app preview and /api/site/[slug]) turns into a
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

export type SiteDocument = {
  version: 1;
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

// A reasonable starting page: the four blocks every gym site needs
// (hero, schedule, pricing, contact) — the same "something to edit,
// not a blank page" role starterDocument plays in the email builder.
// About/testimonials/gallery/location/team stay addable from the palette.
export function starterDocument(gymName?: string): SiteDocument {
  const hero = createBlock('hero') as HeroBlock;
  const trimmedName = gymName?.trim();
  if (trimmedName) hero.headline = trimmedName;
  return {
    version: 1,
    settings: defaultSettings(),
    blocks: [hero, createBlock('schedule'), createBlock('pricing'), createBlock('contact')],
  };
}

export function emptyDocument(): SiteDocument {
  return { version: 1, settings: defaultSettings(), blocks: [] };
}

// ---------------------------------------------------------------------------
// Pure document operations — identical shape to email/blocks.ts's set.
// ---------------------------------------------------------------------------

export function insertBlock(doc: SiteDocument, block: SiteBlock, index: number): SiteDocument {
  const clamped = Math.max(0, Math.min(index, doc.blocks.length));
  const blocks = [...doc.blocks];
  blocks.splice(clamped, 0, block);
  return { ...doc, blocks };
}

export function appendBlock(doc: SiteDocument, block: SiteBlock): SiteDocument {
  return { ...doc, blocks: [...doc.blocks, block] };
}

export function removeBlock(doc: SiteDocument, id: string): SiteDocument {
  return { ...doc, blocks: doc.blocks.filter((b) => b.id !== id) };
}

export function updateBlock<B extends SiteBlock>(
  doc: SiteDocument,
  id: string,
  patch: Partial<B>,
): SiteDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as SiteBlock) : b)),
  };
}

export function moveBlock(doc: SiteDocument, id: string, direction: 'up' | 'down'): SiteDocument {
  const index = doc.blocks.findIndex((b) => b.id === id);
  if (index < 0) return doc;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= doc.blocks.length) return doc;
  const blocks = [...doc.blocks];
  const [moved] = blocks.splice(index, 1);
  blocks.splice(target, 0, moved);
  return { ...doc, blocks };
}

export function reorderBlocks(doc: SiteDocument, from: number, to: number): SiteDocument {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= doc.blocks.length ||
    to >= doc.blocks.length
  ) {
    return doc;
  }
  const blocks = [...doc.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return { ...doc, blocks };
}

export function duplicateBlock(doc: SiteDocument, id: string): SiteDocument {
  const index = doc.blocks.findIndex((b) => b.id === id);
  if (index < 0) return doc;
  const copy = { ...doc.blocks[index], id: genId() } as SiteBlock;
  const blocks = [...doc.blocks];
  blocks.splice(index + 1, 0, copy);
  return { ...doc, blocks };
}

export function updateSettings(doc: SiteDocument, patch: Partial<SiteSettings>): SiteDocument {
  return { ...doc, settings: { ...doc.settings, ...patch } };
}

// ---------------------------------------------------------------------------
// Coercion — `design` is stored as untyped jsonb, so anything from the
// DB is run through here before the editor/renderer touches it. Unknown
// block types and malformed fields are dropped rather than thrown on.
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

export function coerceDocument(raw: unknown): SiteDocument {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object') {
    return { version: 1, settings: defaults, blocks: [] };
  }
  const r = raw as Record<string, unknown>;
  const s = (r.settings ?? {}) as Record<string, unknown>;
  const settings: SiteSettings = {
    themeId: isThemeId(s.themeId) ? s.themeId : defaults.themeId,
  };
  const rawBlocks = Array.isArray(r.blocks) ? r.blocks : [];
  const blocks = rawBlocks.map(coerceBlock).filter((b): b is SiteBlock => b !== null);
  return { version: 1, settings, blocks };
}

// Lightweight readiness check, same role as the email builder's
// documentWarnings — gates the Publish button, warns the author.
export function documentWarnings(doc: SiteDocument): string[] {
  const warnings: string[] = [];
  if (doc.blocks.length === 0) {
    warnings.push('The site has no content blocks yet.');
  }
  for (const b of doc.blocks) {
    if (b.type === 'hero' && !b.headline.trim()) {
      warnings.push('The hero block has no headline.');
    }
    if (b.type === 'testimonials' && b.quotes.length === 0) {
      warnings.push('The testimonials block has no quotes yet.');
    }
    if (b.type === 'gallery' && b.images.length === 0) {
      warnings.push('The gallery block has no photos yet.');
    }
    if (b.type === 'location' && !b.address.trim()) {
      warnings.push('The location block has no address.');
    }
  }
  return warnings;
}
