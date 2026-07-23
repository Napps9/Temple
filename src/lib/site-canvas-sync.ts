// The single source of truth for "what's editable on the canvas" —
// shared by the emitter (site-render.ts's fieldAttrs, which decides
// what gets a data-field attribute) and the receiver (website.tsx's
// handleCanvasFieldChange, which decides what's allowed to write into
// document state). site-render.ts only ever emits data-field on
// whitelisted fields, but the receiver re-checks independently,
// matching this repo's re-check-client-and-server convention.

import type { SiteBlockType } from './site-blocks';

export type ParsedFieldPath =
  | { kind: 'scalar'; blockId: string; field: string }
  | { kind: 'array-item'; blockId: string; arrayKey: 'quotes'; itemId: string; field: string };

// data-field values are "<blockId>:<field>" or
// "<blockId>:quotes:<itemId>:<field>" — block ids (genId() in
// site-blocks.ts) never contain ':', so splitting on it is safe.
export function parseFieldPath(raw: string): ParsedFieldPath | null {
  const parts = raw.split(':');
  if (parts.length === 2) {
    const [blockId, field] = parts;
    if (!blockId || !field) return null;
    return { kind: 'scalar', blockId, field };
  }
  if (parts.length === 4 && parts[1] === 'quotes') {
    const [blockId, , itemId, field] = parts;
    if (!blockId || !itemId || !field) return null;
    return { kind: 'array-item', blockId, arrayKey: 'quotes', itemId, field };
  }
  return null;
}

export const EDITABLE_FIELDS: Record<SiteBlockType, string[]> = {
  hero: ['headline', 'subheadline', 'ctaLabel'],
  about: ['heading', 'body'],
  schedule: ['heading'],
  pricing: ['heading'],
  testimonials: ['heading'],
  gallery: ['heading'],
  location: ['heading', 'address', 'hours'],
  contact: ['heading', 'subheading'],
  team: ['heading'],
  call: ['heading', 'subheading'],
};

export const EDITABLE_TESTIMONIAL_FIELDS: string[] = ['quote', 'name'];

export function isFieldEditable(blockType: SiteBlockType, parsed: ParsedFieldPath): boolean {
  if (parsed.kind === 'scalar') {
    return EDITABLE_FIELDS[blockType].includes(parsed.field);
  }
  return blockType === 'testimonials' && EDITABLE_TESTIMONIAL_FIELDS.includes(parsed.field);
}
