import { describe, expect, it } from 'vitest';

import { BRAND_THEMES } from '../brand-themes';
import {
  appendBlock,
  applyTheme,
  coerceDocument,
  createBlock,
  documentWarnings,
  duplicateBlock,
  emptyDocument,
  FALLBACK_BRAND_SEED,
  insertBlock,
  moveBlock,
  removeBlock,
  reorderBlocks,
  starterDocument,
  updateBlock,
  type ButtonBlock,
  type DividerBlock,
  type EmailDocument,
  type HeadingBlock,
  type ImageBlock,
  type TextBlock,
} from './blocks';

const brand = { primaryColor: '#112233', secondaryColor: '#445566', textColor: '#778899' };

describe('createBlock', () => {
  it('seeds a button from the brand primary', () => {
    const b = createBlock('button', brand, 'fixed') as ButtonBlock;
    expect(b.type).toBe('button');
    expect(b.id).toBe('fixed');
    expect(b.backgroundColor).toBe('#112233');
  });
  it('seeds heading/text colour from the brand text colour', () => {
    const h = createBlock('heading', brand) as HeadingBlock;
    expect(h.color).toBe('#778899');
  });
});

describe('document operations are immutable', () => {
  const base: EmailDocument = emptyDocument(brand);
  const a = createBlock('heading', brand, 'a');
  const b = createBlock('text', brand, 'b');
  const c = createBlock('button', brand, 'c');
  const doc = appendBlock(appendBlock(appendBlock(base, a), b), c);

  it('insertBlock places at the index without mutating the original', () => {
    const spacer = createBlock('spacer', brand, 's');
    const next = insertBlock(doc, spacer, 1);
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
    expect(reorderBlocks(doc, 2, 0).blocks.map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(reorderBlocks(doc, 1, 1).blocks.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('removeBlock and duplicateBlock', () => {
    expect(removeBlock(doc, 'b').blocks.map((x) => x.id)).toEqual(['a', 'c']);
    const dup = duplicateBlock(doc, 'a');
    expect(dup.blocks).toHaveLength(4);
    expect(dup.blocks[1].type).toBe('heading');
    expect(dup.blocks[1].id).not.toBe('a');
  });

  it('updateBlock patches a single block', () => {
    const next = updateBlock<HeadingBlock>(doc, 'a', { text: 'Changed' });
    expect((next.blocks[0] as HeadingBlock).text).toBe('Changed');
    expect((doc.blocks[0] as HeadingBlock).text).not.toBe('Changed');
  });
});

describe('coerceDocument', () => {
  it('returns an empty doc for junk input', () => {
    expect(coerceDocument(null, brand).blocks).toEqual([]);
    expect(coerceDocument(42, brand).blocks).toEqual([]);
    expect(coerceDocument('nope', brand).blocks).toEqual([]);
  });

  it('drops unknown block types and keeps valid ones', () => {
    const raw = {
      version: 1,
      settings: {},
      blocks: [
        { id: 'x', type: 'heading', text: 'Hi', level: 9, align: 'weird' },
        { id: 'y', type: 'mystery' },
        { type: 'spacer', height: 999 },
      ],
    };
    const doc = coerceDocument(raw, brand);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0].type).toBe('heading');
    // level clamped to a valid value, align defaulted to left.
    expect((doc.blocks[0] as HeadingBlock).level).toBe(2);
    expect((doc.blocks[0] as HeadingBlock).align).toBe('left');
    // spacer height clamped into range, id generated when absent.
    expect(doc.blocks[1].type).toBe('spacer');
    expect(doc.blocks[1].id).toBeTruthy();
  });

  it('fills settings defaults from the brand and clamps content width', () => {
    const doc = coerceDocument({ settings: { contentWidth: 5000 } }, brand);
    expect(doc.settings.contentWidth).toBe(800);
    expect(doc.settings.linkColor).toBe('#112233');
  });

  it('back-fills the new typography/theme settings for a pre-existing stored campaign', () => {
    // Simulates a row written to email_campaigns.design before themes
    // existed — settings has none of the 5 new keys at all.
    const oldRow = {
      version: 1,
      settings: {
        backgroundColor: '#EEEEEE',
        contentBackgroundColor: '#FFFFFF',
        textColor: '#111111',
        linkColor: '#222222',
        fontFamily: 'Arial',
        contentWidth: 600,
      },
      blocks: [{ id: 'a', type: 'heading', text: 'Hi', level: 2, align: 'left', color: '#111111' }],
    };
    const doc = coerceDocument(oldRow, brand);
    expect(doc.settings.headingWeight).toBe(700);
    expect(doc.settings.headingTransform).toBe('none');
    expect(doc.settings.headingLetterSpacing).toBe(0);
    expect(doc.settings.buttonRadius).toBe(8);
    expect(doc.settings.themeId).toBeNull();
    // and everything that WAS already there is preserved untouched.
    expect(doc.settings.backgroundColor).toBe('#EEEEEE');
    expect(doc.settings.linkColor).toBe('#222222');
  });

  it('drops an unrecognised or stale themeId back to null instead of crashing', () => {
    const doc = coerceDocument({ settings: { themeId: 'retired-theme-2024' } }, brand);
    expect(doc.settings.themeId).toBeNull();
  });

  it('accepts a valid themeId', () => {
    const doc = coerceDocument({ settings: { themeId: 'ringside' } }, brand);
    expect(doc.settings.themeId).toBe('ringside');
  });
});

describe('applyTheme', () => {
  it('reskins every existing block to match the theme, not just future ones', () => {
    let doc = emptyDocument(brand);
    doc = appendBlock(doc, createBlock('heading', brand, 'h'));
    doc = appendBlock(doc, createBlock('text', brand, 't'));
    doc = appendBlock(doc, createBlock('button', brand, 'btn'));
    doc = appendBlock(doc, createBlock('divider', brand, 'd'));
    doc = appendBlock(doc, createBlock('image', brand, 'img'));
    doc = appendBlock(doc, createBlock('spacer', brand, 'sp'));

    const themed = applyTheme(doc, BRAND_THEMES.forged);

    expect((themed.blocks.find((b) => b.id === 'h') as HeadingBlock).color).toBe(
      BRAND_THEMES.forged.palette.text,
    );
    expect((themed.blocks.find((b) => b.id === 't') as TextBlock).color).toBe(
      BRAND_THEMES.forged.palette.text,
    );
    const button = themed.blocks.find((b) => b.id === 'btn') as ButtonBlock;
    expect(button.backgroundColor).toBe(BRAND_THEMES.forged.palette.accent);
    expect(button.textColor).toBe(BRAND_THEMES.forged.palette.accentText);
    expect(button.radius).toBe(0); // 'square' shape
    expect((themed.blocks.find((b) => b.id === 'd') as DividerBlock).color).toBe(
      BRAND_THEMES.forged.palette.muted,
    );
    // image/spacer have no themeable colour fields — untouched.
    const original = doc.blocks.find((b) => b.id === 'img') as ImageBlock;
    const afterTheme = themed.blocks.find((b) => b.id === 'img') as ImageBlock;
    expect(afterTheme).toEqual(original);

    expect(themed.settings.themeId).toBe('forged');
    expect(themed.settings.backgroundColor).toBe(BRAND_THEMES.forged.palette.background);
    expect(themed.settings.headingWeight).toBe(BRAND_THEMES.forged.typography.headingWeight);
  });

  it('does not mutate the source document', () => {
    let doc = emptyDocument(brand);
    doc = appendBlock(doc, createBlock('heading', brand, 'h'));
    const before = JSON.stringify(doc);
    applyTheme(doc, BRAND_THEMES.daybreak);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('documentWarnings', () => {
  it('flags an empty document', () => {
    expect(documentWarnings(emptyDocument(brand))).toContain(
      'The email has no content blocks yet.',
    );
  });
  it('flags an image without a source and a button without a link', () => {
    let doc = appendBlock(emptyDocument(brand), createBlock('image', brand));
    doc = appendBlock(doc, createBlock('button', brand)); // default href 'https://'
    const warnings = documentWarnings(doc);
    expect(warnings.some((w) => w.includes('image'))).toBe(true);
    expect(warnings.some((w) => w.includes('button'))).toBe(true);
  });
  it('passes a complete document', () => {
    const doc = starterDocument(FALLBACK_BRAND_SEED, { gymName: 'Iron' });
    // The starter button keeps the placeholder href, so fix it up.
    const ready = updateBlock<ButtonBlock>(
      doc,
      doc.blocks.find((b) => b.type === 'button')!.id,
      { href: 'https://example.com' },
    );
    expect(documentWarnings(ready)).toEqual([]);
  });
});
