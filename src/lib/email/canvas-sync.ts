// The single source of truth for "what's editable on the email canvas" —
// shared by the emitter (render.ts's fieldAttrs, which decides what gets
// a data-field attribute) and the receiver (EmailEditor.tsx's
// handleCanvasFieldChange, which decides what's allowed to write into
// document state). Mirrors site-canvas-sync.ts's role for the website
// builder, minus the array-item case — no email block has a
// testimonials-style repeating list today.

import type { EmailBlockType } from './blocks';

export type ParsedFieldPath = { blockId: string; field: string };

// data-field values are "<blockId>:<field>" — block ids (genId() in
// blocks.ts) never contain ':', so splitting on it is safe.
export function parseFieldPath(raw: string): ParsedFieldPath | null {
  const parts = raw.split(':');
  if (parts.length !== 2) return null;
  const [blockId, field] = parts;
  if (!blockId || !field) return null;
  return { blockId, field };
}

// Only the plain-text fields — colour, alignment, href, image src and
// the rest stay sidebar-only, same reasoning as the website builder's
// whitelist (a link URL or a colour swatch isn't something you'd want
// to type in place).
export const EDITABLE_FIELDS: Record<EmailBlockType, string[]> = {
  heading: ['text'],
  text: ['text'],
  button: ['text'],
  image: [],
  divider: [],
  spacer: [],
};

export function isFieldEditable(blockType: EmailBlockType, field: string): boolean {
  return EDITABLE_FIELDS[blockType].includes(field);
}
