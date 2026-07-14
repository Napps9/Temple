import { describe, expect, it } from 'vitest';

import { BRAND_THEMES } from '../brand-themes';
import {
  appendBlock,
  applyTheme,
  createBlock,
  emptyDocument,
  type ButtonBlock,
  type HeadingBlock,
  type ImageBlock,
  type TextBlock,
} from './blocks';
import {
  renderEmailHtml,
  renderEmailText,
  UNSUBSCRIBE_PLACEHOLDER,
} from './render';

const brand = { primaryColor: '#FF0000', secondaryColor: '#00FF00', textColor: '#0000FF' };

describe('renderEmailHtml', () => {
  it('always renders a footer with the unsubscribe placeholder', () => {
    const html = renderEmailHtml(emptyDocument(brand));
    expect(html).toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(html).toContain('Unsubscribe');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('lets the preview override the unsubscribe url', () => {
    const html = renderEmailHtml(emptyDocument(brand), { unsubscribeUrl: '#' });
    expect(html).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
  });

  it('escapes author text so it cannot inject markup', () => {
    let doc = emptyDocument(brand);
    const t = createBlock('text', brand) as TextBlock;
    t.text = '<script>alert(1)</script> & "quotes"';
    doc = appendBlock(doc, t);
    const html = renderEmailHtml(doc);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('preserves newlines in text as <br>', () => {
    let doc = emptyDocument(brand);
    const t = createBlock('text', brand) as TextBlock;
    t.text = 'line one\nline two';
    doc = appendBlock(doc, t);
    expect(renderEmailHtml(doc)).toContain('line one<br>line two');
  });

  it('drops a javascript: href on a button down to #', () => {
    let doc = emptyDocument(brand);
    const b = createBlock('button', brand) as ButtonBlock;
    b.href = 'javascript:alert(1)';
    b.text = 'Click';
    doc = appendBlock(doc, b);
    const html = renderEmailHtml(doc);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('keeps a safe https href and wraps a linked image', () => {
    let doc = emptyDocument(brand);
    const img = createBlock('image', brand) as ImageBlock;
    img.src = 'https://cdn.example.com/a.png';
    img.href = 'https://example.com';
    img.alt = 'Promo';
    doc = appendBlock(doc, img);
    const html = renderEmailHtml(doc);
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('alt="Promo"');
  });

  it('omits an image block with no source', () => {
    let doc = emptyDocument(brand);
    doc = appendBlock(doc, createBlock('image', brand)); // empty src
    const html = renderEmailHtml(doc);
    expect(html).not.toContain('<img');
  });

  it('includes a hidden preheader when provided', () => {
    const html = renderEmailHtml(emptyDocument(brand), { preheader: 'Sneak peek' });
    expect(html).toContain('Sneak peek');
    expect(html).toContain('display:none');
  });

  it('renders the configured footer business + address', () => {
    const html = renderEmailHtml(emptyDocument(brand), {
      footer: { businessName: 'Iron Temple', address: '1 Gym St' },
    });
    expect(html).toContain('Iron Temple');
    expect(html).toContain('1 Gym St');
  });

  it('defaults a heading to font-weight:700 with no transform/spacing, unmodified from before themes existed', () => {
    let doc = emptyDocument(brand);
    const h = createBlock('heading', brand) as HeadingBlock;
    h.text = 'Plain heading';
    doc = appendBlock(doc, h);
    const html = renderEmailHtml(doc);
    expect(html).toContain('font-weight:700');
    expect(html).toContain('text-transform:none');
    expect(html).toContain('letter-spacing:0px');
  });

  it('threads a theme’s heading weight/transform/letter-spacing into the compiled HTML', () => {
    let doc = emptyDocument(brand);
    const h = createBlock('heading', brand) as HeadingBlock;
    h.text = 'Themed heading';
    doc = appendBlock(doc, h);
    doc = applyTheme(doc, BRAND_THEMES.ringside);
    const html = renderEmailHtml(doc);
    expect(html).toContain(`font-weight:${BRAND_THEMES.ringside.typography.headingWeight}`);
    expect(html).toContain('text-transform:uppercase');
    expect(html).toContain(
      `letter-spacing:${BRAND_THEMES.ringside.typography.headingLetterSpacing}px`,
    );
    expect(html).toContain(BRAND_THEMES.ringside.palette.background);
  });

  describe('editable canvas', () => {
    it('adds no data-field/contenteditable markers or bridge script by default', () => {
      let doc = emptyDocument(brand);
      doc = appendBlock(doc, createBlock('heading', brand));
      const html = renderEmailHtml(doc);
      expect(html).not.toContain('data-field');
      expect(html).not.toContain('contenteditable');
      expect(html).not.toContain('temple-email-canvas');
    });

    it('marks heading/text/button labels editable, but not colour/link/image fields', () => {
      let doc = emptyDocument(brand);
      const h = createBlock('heading', brand) as HeadingBlock;
      doc = appendBlock(doc, h);
      const t = createBlock('text', brand) as TextBlock;
      doc = appendBlock(doc, t);
      const btn = createBlock('button', brand) as ButtonBlock;
      doc = appendBlock(doc, btn);
      const img = createBlock('image', brand) as ImageBlock;
      img.src = 'https://cdn.example.com/a.png';
      doc = appendBlock(doc, img);
      const html = renderEmailHtml(doc, { unsubscribeUrl: '#', editable: true });
      expect(html).toContain(`data-field="${h.id}:text"`);
      expect(html).toContain(`data-field="${t.id}:text"`);
      expect(html).toContain(`data-field="${btn.id}:text"`);
      expect(html).not.toContain(`data-field="${img.id}`);
      expect(html).toContain('contenteditable="true"');
    });

    it('includes the canvas bridge script and highlight styles only when editable', () => {
      const html = renderEmailHtml(emptyDocument(brand), { editable: true });
      expect(html).toContain('temple-email-canvas');
      expect(html).toContain('tp-email-selected');
    });

    it('still escapes author text inside editable fields', () => {
      let doc = emptyDocument(brand);
      const t = createBlock('text', brand) as TextBlock;
      t.text = '<script>alert(1)</script>';
      doc = appendBlock(doc, t);
      const html = renderEmailHtml(doc, { editable: true });
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });
});

describe('renderEmailText', () => {
  it('produces a readable plain-text fallback with the unsubscribe line', () => {
    let doc = emptyDocument(brand);
    const h = createBlock('heading', brand);
    (h as { text: string }).text = 'Big news';
    doc = appendBlock(doc, h);
    const b = createBlock('button', brand) as ButtonBlock;
    b.text = 'Book';
    b.href = 'https://book.example.com';
    doc = appendBlock(doc, b);
    const text = renderEmailText(doc);
    expect(text).toContain('Big news');
    expect(text).toContain('Book: https://book.example.com');
    expect(text).toContain(`Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`);
  });
});
