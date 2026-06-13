import { describe, expect, it } from 'vitest';

import {
  appendBlock,
  createBlock,
  emptyDocument,
  type ButtonBlock,
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
