// The block document that the Communications editor authors and the
// renderer turns into HTML email. Kept free of React / RN deps so it
// stays unit-testable in vitest and can be reasoned about as plain
// data — the editor only ever swaps one immutable document for the
// next via the pure helpers at the bottom.

import { isThemeId, type BrandTheme, type ThemeId } from '../brand-themes';

export type BlockAlign = 'left' | 'center' | 'right';

export type HeadingBlock = {
  id: string;
  type: 'heading';
  text: string;
  level: 1 | 2 | 3;
  align: BlockAlign;
  color: string;
};

export type TextBlock = {
  id: string;
  type: 'text';
  text: string;
  align: BlockAlign;
  color: string;
};

export type ButtonBlock = {
  id: string;
  type: 'button';
  text: string;
  href: string;
  align: BlockAlign;
  backgroundColor: string;
  textColor: string;
  radius: number;
};

export type ImageBlock = {
  id: string;
  type: 'image';
  src: string;
  alt: string;
  href: string;
  // Display width as a percentage of the content column, 10–100.
  widthPct: number;
  align: BlockAlign;
};

export type DividerBlock = {
  id: string;
  type: 'divider';
  color: string;
};

export type SpacerBlock = {
  id: string;
  type: 'spacer';
  height: number;
};

export type EmailBlock =
  | HeadingBlock
  | TextBlock
  | ButtonBlock
  | ImageBlock
  | DividerBlock
  | SpacerBlock;

export type EmailBlockType = EmailBlock['type'];

export type EmailSettings = {
  backgroundColor: string; // page background, outside the card
  contentBackgroundColor: string; // the email card background
  textColor: string;
  linkColor: string;
  fontFamily: string;
  contentWidth: number; // px
  headingWeight: number; // matches the font-weight renderHeading used to hardcode (700)
  headingTransform: 'none' | 'uppercase';
  headingLetterSpacing: number; // px, can be negative
  buttonRadius: number; // px — new buttons seed from this, matching createBlock's prior hardcoded 8
  themeId: ThemeId | null; // last-applied stock theme, for swatch highlight
};

export type EmailDocument = {
  version: 1;
  settings: EmailSettings;
  blocks: EmailBlock[];
};

// The slice of the gym brand the editor seeds new content from. Matches
// the fields exposed by useGymBrand so a screen can pass it straight
// through.
export type BrandSeed = {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
};

export const FALLBACK_BRAND_SEED: BrandSeed = {
  primaryColor: '#14161A',
  secondaryColor: '#0F172A',
  textColor: '#0F172A',
};

const SYSTEM_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const BLOCK_LABELS: Record<EmailBlockType, string> = {
  heading: 'Heading',
  text: 'Text',
  button: 'Button',
  image: 'Image',
  divider: 'Divider',
  spacer: 'Spacer',
};

export const BLOCK_ICONS: Record<EmailBlockType, string> = {
  heading: 'text-outline',
  text: 'reader-outline',
  button: 'radio-button-on-outline',
  image: 'image-outline',
  divider: 'remove-outline',
  spacer: 'resize-outline',
};

// id generator — monotonic counter folded with the timestamp so two
// blocks created in the same tick never collide. Not security-sensitive.
let counter = 0;
function genId(): string {
  counter += 1;
  return `b_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function defaultSettings(brand: BrandSeed): EmailSettings {
  return {
    backgroundColor: '#F1F5F9',
    contentBackgroundColor: '#FFFFFF',
    textColor: brand.textColor || FALLBACK_BRAND_SEED.textColor,
    linkColor: brand.primaryColor || FALLBACK_BRAND_SEED.primaryColor,
    fontFamily: SYSTEM_FONT_STACK,
    contentWidth: 600,
    headingWeight: 700,
    headingTransform: 'none',
    headingLetterSpacing: 0,
    buttonRadius: 8,
    themeId: null,
  };
}

// A theme's generic shape enum, mapped to the concrete px radius the
// email renderer/canvas already use — matches the exact values the
// button block's own "Corners" control offers (EmailEditor.tsx).
const SHAPE_RADIUS_PX: Record<BrandTheme['shape']['buttonRadius'], number> = {
  square: 0,
  rounded: 8,
  pill: 24,
};

// Bulk-reskins a whole document to a theme: the document-level settings
// plus every existing block's own colour field(s). A "pick a theme"
// action that only changed defaults for blocks added afterward would
// leave everything already on the canvas looking untouched, which reads
// as broken — so this rewrites what's there now, not just what's next.
export function applyTheme(doc: EmailDocument, theme: BrandTheme): EmailDocument {
  const radius = SHAPE_RADIUS_PX[theme.shape.buttonRadius];
  const settings: EmailSettings = {
    ...doc.settings,
    backgroundColor: theme.palette.background,
    contentBackgroundColor: theme.palette.surface,
    textColor: theme.palette.text,
    linkColor: theme.palette.accent,
    fontFamily: theme.typography.fontFamily,
    headingWeight: theme.typography.headingWeight,
    headingTransform: theme.typography.headingTransform,
    headingLetterSpacing: theme.typography.headingLetterSpacing,
    buttonRadius: radius,
    themeId: theme.id,
  };
  const blocks = doc.blocks.map((block): EmailBlock => {
    switch (block.type) {
      case 'heading':
      case 'text':
        return { ...block, color: theme.palette.text };
      case 'button':
        return {
          ...block,
          backgroundColor: theme.palette.accent,
          textColor: theme.palette.accentText,
          radius,
        };
      case 'divider':
        return { ...block, color: theme.palette.muted };
      case 'image':
      case 'spacer':
        return block;
    }
  });
  return { ...doc, settings, blocks };
}

// A fresh block of the requested type, seeded from the gym's palette so
// new content already looks on-brand. `id` is injectable for tests.
export function createBlock(
  type: EmailBlockType,
  brand: BrandSeed,
  id: string = genId(),
): EmailBlock {
  switch (type) {
    case 'heading':
      return {
        id,
        type: 'heading',
        text: 'Your headline',
        level: 2,
        align: 'left',
        color: brand.textColor || FALLBACK_BRAND_SEED.textColor,
      };
    case 'text':
      return {
        id,
        type: 'text',
        text: 'Write something your members will want to read.',
        align: 'left',
        color: brand.textColor || FALLBACK_BRAND_SEED.textColor,
      };
    case 'button':
      return {
        id,
        type: 'button',
        text: 'Book a class',
        href: 'https://',
        align: 'left',
        backgroundColor: brand.primaryColor || FALLBACK_BRAND_SEED.primaryColor,
        textColor: '#FFFFFF',
        radius: 8,
      };
    case 'image':
      return {
        id,
        type: 'image',
        src: '',
        alt: '',
        href: '',
        widthPct: 100,
        align: 'center',
      };
    case 'divider':
      return { id, type: 'divider', color: '#E2E8F0' };
    case 'spacer':
      return { id, type: 'spacer', height: 24 };
  }
}

// A reasonable starting canvas: an optional logo, a heading, a line of
// body copy, and a primary button. Gives a brand-new campaign something
// to edit rather than a blank page.
export function starterDocument(
  brand: BrandSeed,
  opts: { gymName?: string; logoUrl?: string | null } = {},
): EmailDocument {
  const blocks: EmailBlock[] = [];
  if (opts.logoUrl) {
    const logo = createBlock('image', brand) as ImageBlock;
    logo.src = opts.logoUrl;
    logo.alt = opts.gymName ?? 'Logo';
    logo.widthPct = 35;
    logo.align = 'center';
    blocks.push(logo);
  }
  const heading = createBlock('heading', brand) as HeadingBlock;
  heading.text = opts.gymName ? `Hello from ${opts.gymName}` : 'Hello there';
  heading.align = 'center';
  blocks.push(heading);

  const text = createBlock('text', brand) as TextBlock;
  text.text =
    'Use this space to share news, an offer, or an update with your members. ' +
    'Add blocks from the toolbar to build out your email.';
  text.align = 'center';
  blocks.push(text);

  const button = createBlock('button', brand) as ButtonBlock;
  button.align = 'center';
  blocks.push(button);

  return { version: 1, settings: defaultSettings(brand), blocks };
}

export function emptyDocument(brand: BrandSeed): EmailDocument {
  return { version: 1, settings: defaultSettings(brand), blocks: [] };
}

// ---------------------------------------------------------------------------
// Pure document operations. Each returns a new document; the editor's
// state setter swaps the reference, so React re-renders predictably and
// undo/redo (if added later) is a stack of these snapshots.
// ---------------------------------------------------------------------------

export function insertBlock(
  doc: EmailDocument,
  block: EmailBlock,
  index: number,
): EmailDocument {
  const clamped = Math.max(0, Math.min(index, doc.blocks.length));
  const blocks = [...doc.blocks];
  blocks.splice(clamped, 0, block);
  return { ...doc, blocks };
}

export function appendBlock(doc: EmailDocument, block: EmailBlock): EmailDocument {
  return { ...doc, blocks: [...doc.blocks, block] };
}

export function removeBlock(doc: EmailDocument, id: string): EmailDocument {
  return { ...doc, blocks: doc.blocks.filter((b) => b.id !== id) };
}

export function updateBlock<B extends EmailBlock>(
  doc: EmailDocument,
  id: string,
  patch: Partial<B>,
): EmailDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) =>
      b.id === id ? ({ ...b, ...patch } as EmailBlock) : b,
    ),
  };
}

export function moveBlock(
  doc: EmailDocument,
  id: string,
  direction: 'up' | 'down',
): EmailDocument {
  const index = doc.blocks.findIndex((b) => b.id === id);
  if (index < 0) return doc;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= doc.blocks.length) return doc;
  const blocks = [...doc.blocks];
  const [moved] = blocks.splice(index, 1);
  blocks.splice(target, 0, moved);
  return { ...doc, blocks };
}

// Reorder by absolute indices — backs a drag-to-reorder gesture.
export function reorderBlocks(
  doc: EmailDocument,
  from: number,
  to: number,
): EmailDocument {
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

export function duplicateBlock(doc: EmailDocument, id: string): EmailDocument {
  const index = doc.blocks.findIndex((b) => b.id === id);
  if (index < 0) return doc;
  const copy = { ...doc.blocks[index], id: genId() } as EmailBlock;
  const blocks = [...doc.blocks];
  blocks.splice(index + 1, 0, copy);
  return { ...doc, blocks };
}

export function updateSettings(
  doc: EmailDocument,
  patch: Partial<EmailSettings>,
): EmailDocument {
  return { ...doc, settings: { ...doc.settings, ...patch } };
}

// ---------------------------------------------------------------------------
// Coercion — `design` is stored as untyped jsonb, so anything coming
// back from the DB (or a future schema change) is run through here
// before the editor / renderer touches it. Unknown block types and
// malformed fields are dropped rather than thrown on.
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asAlign(v: unknown): BlockAlign {
  return v === 'center' || v === 'right' ? v : 'left';
}
function asHeadingTransform(v: unknown): 'none' | 'uppercase' {
  return v === 'uppercase' ? v : 'none';
}
function asThemeId(v: unknown): ThemeId | null {
  return isThemeId(v) ? v : null;
}

function coerceBlock(raw: unknown): EmailBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = asString(r.id, genId());
  switch (r.type) {
    case 'heading': {
      const lvl = asNumber(r.level, 2);
      return {
        id,
        type: 'heading',
        text: asString(r.text, ''),
        level: (lvl === 1 || lvl === 3 ? lvl : 2) as 1 | 2 | 3,
        align: asAlign(r.align),
        color: asString(r.color, FALLBACK_BRAND_SEED.textColor),
      };
    }
    case 'text':
      return {
        id,
        type: 'text',
        text: asString(r.text, ''),
        align: asAlign(r.align),
        color: asString(r.color, FALLBACK_BRAND_SEED.textColor),
      };
    case 'button':
      return {
        id,
        type: 'button',
        text: asString(r.text, 'Button'),
        href: asString(r.href, ''),
        align: asAlign(r.align),
        backgroundColor: asString(r.backgroundColor, FALLBACK_BRAND_SEED.primaryColor),
        textColor: asString(r.textColor, '#FFFFFF'),
        radius: asNumber(r.radius, 8),
      };
    case 'image':
      return {
        id,
        type: 'image',
        src: asString(r.src, ''),
        alt: asString(r.alt, ''),
        href: asString(r.href, ''),
        widthPct: Math.max(10, Math.min(100, asNumber(r.widthPct, 100))),
        align: asAlign(r.align),
      };
    case 'divider':
      return { id, type: 'divider', color: asString(r.color, '#E2E8F0') };
    case 'spacer':
      return {
        id,
        type: 'spacer',
        height: Math.max(4, Math.min(160, asNumber(r.height, 24))),
      };
    default:
      return null;
  }
}

export function coerceDocument(raw: unknown, brand: BrandSeed): EmailDocument {
  const defaults = defaultSettings(brand);
  if (!raw || typeof raw !== 'object') {
    return { version: 1, settings: defaults, blocks: [] };
  }
  const r = raw as Record<string, unknown>;
  const s = (r.settings ?? {}) as Record<string, unknown>;
  const settings: EmailSettings = {
    backgroundColor: asString(s.backgroundColor, defaults.backgroundColor),
    contentBackgroundColor: asString(
      s.contentBackgroundColor,
      defaults.contentBackgroundColor,
    ),
    textColor: asString(s.textColor, defaults.textColor),
    linkColor: asString(s.linkColor, defaults.linkColor),
    fontFamily: asString(s.fontFamily, defaults.fontFamily),
    contentWidth: Math.max(320, Math.min(800, asNumber(s.contentWidth, 600))),
    headingWeight: asNumber(s.headingWeight, defaults.headingWeight),
    headingTransform: asHeadingTransform(s.headingTransform),
    headingLetterSpacing: asNumber(s.headingLetterSpacing, defaults.headingLetterSpacing),
    buttonRadius: asNumber(s.buttonRadius, defaults.buttonRadius),
    themeId: asThemeId(s.themeId),
  };
  const rawBlocks = Array.isArray(r.blocks) ? r.blocks : [];
  const blocks = rawBlocks
    .map(coerceBlock)
    .filter((b): b is EmailBlock => b !== null);
  return { version: 1, settings, blocks };
}

// Lightweight readiness check used to gate the Send button and to warn
// the author. Returns a list of human-readable problems (empty = ready).
export function documentWarnings(doc: EmailDocument): string[] {
  const warnings: string[] = [];
  if (doc.blocks.length === 0) {
    warnings.push('The email has no content blocks yet.');
  }
  for (const b of doc.blocks) {
    if (b.type === 'image' && !b.src) {
      warnings.push('An image block has no image set.');
    }
    if (b.type === 'button' && (!b.href || b.href === 'https://')) {
      warnings.push('A button block is missing its link.');
    }
  }
  return warnings;
}
