// The newsletter-by-sentence path (docs/roadmap.md phase 6): the model
// drafts subject + sections from the owner's brief inside the same
// parse-setup call the talk bar already makes; this module is the
// untrusted-output boundary (sanitise) and the pure document builder
// that turns the surviving draft into the comms suite's own block
// document. The result is an ordinary draft campaign — read, adjusted
// and sent through every existing rail (audience, topic, A/B,
// suppression), so "owner-approved wording" is the send button itself.

import {
  appendBlock,
  createBlock,
  emptyDocument,
  type BrandSeed,
  type EmailBlock,
  type EmailDocument,
} from './email/blocks';

export type NewsletterSection = { heading: string; body: string };
export type NewsletterDraft = { subject: string; sections: NewsletterSection[] };

const MAX_SECTIONS = 6;

function cleanLine(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length >= 2 ? s.slice(0, max) : null;
}

export function sanitiseNewsletter(raw: unknown): NewsletterDraft | null {
  const r = raw as { subject?: unknown; sections?: unknown } | null;
  if (!r) return null;
  const subject = cleanLine(r.subject, 80);
  if (!subject || !Array.isArray(r.sections)) return null;

  const sections: NewsletterSection[] = [];
  for (const item of r.sections.slice(0, MAX_SECTIONS)) {
    const it = item as { heading?: unknown; body?: unknown };
    const heading = cleanLine(it.heading, 60);
    const body =
      typeof it.body === 'string' ? it.body.trim().slice(0, 600) : null;
    if (!heading || !body || body.length < 10) continue;
    sections.push({ heading, body });
  }
  if (sections.length === 0) return null;
  return { subject, sections };
}

type HeadingLike = EmailBlock & { text: string; align: string };
type TextLike = EmailBlock & { text: string; align: string };
type ImageLike = EmailBlock & {
  src: string;
  alt: string;
  widthPct: number;
  align: string;
};

export function newsletterDocument(
  brand: BrandSeed,
  opts: { gymName?: string; logoUrl?: string | null },
  draft: NewsletterDraft,
): EmailDocument {
  let doc = emptyDocument(brand);
  if (opts.logoUrl) {
    const logo = createBlock('image', brand) as ImageLike;
    logo.src = opts.logoUrl;
    logo.alt = opts.gymName ?? 'Logo';
    logo.widthPct = 35;
    logo.align = 'center';
    doc = appendBlock(doc, logo);
  }
  for (const s of draft.sections) {
    const heading = createBlock('heading', brand) as HeadingLike;
    heading.text = s.heading;
    heading.align = 'left';
    doc = appendBlock(doc, heading);
    const text = createBlock('text', brand) as TextLike;
    text.text = s.body;
    text.align = 'left';
    doc = appendBlock(doc, text);
  }
  return doc;
}
