// Turns an EmailDocument into the two payloads a send needs: a
// table-based HTML body that survives Gmail / Outlook / Apple Mail, and
// a plain-text fallback. Pure and dependency-free so it runs identically
// in the in-app preview (WebView / iframe) and is exercised by vitest.
//
// The compiled HTML carries a literal `{{unsubscribe_url}}` token in the
// footer. The delivery worker swaps that per recipient (and wraps links
// + injects the open pixel); the in-app preview passes a real `#` so the
// token never shows to the author.

import type {
  BlockAlign,
  ButtonBlock,
  DividerBlock,
  EmailBlock,
  EmailDocument,
  EmailSettings,
  HeadingBlock,
  ImageBlock,
  SpacerBlock,
  TextBlock,
} from './blocks';

export const UNSUBSCRIBE_PLACEHOLDER = '{{unsubscribe_url}}';

export type RenderContext = {
  preheader?: string;
  footer?: { businessName?: string | null; address?: string | null };
  // Defaults to the placeholder the delivery worker replaces. The live
  // preview overrides this with '#'.
  unsubscribeUrl?: string;
  // Optional, unlike site-render.ts's equivalent flag — every existing
  // caller (the delivery worker, the report view, the mobile "Preview"
  // toggle) keeps rendering exactly as before when this is omitted, only
  // the in-app editor's canvas opts in. When true, editable text fields
  // get data-field/contenteditable markers and an in-frame canvas-sync
  // bridge script is appended — never true outside the staff editor.
  editable?: boolean;
};

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}

// Marks an element as an on-canvas-editable field, addressed by
// "<blockId>:<field>" — see canvas-sync.ts for the matching
// parser/whitelist on the receiving end. A no-op when not editable, so
// every non-editor call site is byte-identical by construction. Unlike
// the website builder's fieldAttrs, there's no data-rich marker — email
// blocks store plain text (EmailBlock.text: string), so the canvas
// bridge script captures innerText, not innerHTML, and there is no
// bold/italic/underline toolbar to gate.
function fieldAttrs(
  ctx: RenderContext,
  blockId: string,
  field: string,
  opts?: { multiline?: boolean },
): string {
  if (!ctx.editable) return '';
  return ` data-field="${escapeAttr(`${blockId}:${field}`)}" contenteditable="true"${
    opts?.multiline ? ' data-multiline="true"' : ''
  }`;
}

// Escape, then turn author newlines into <br> so multi-line text blocks
// keep their shape.
function escapeMultiline(input: string): string {
  return escapeHtml(input).replace(/\r?\n/g, '<br>');
}

// Only allow http(s) and mailto hrefs through to the HTML so a stray
// "javascript:" can't ride along into a member's inbox.
function safeHref(href: string): string {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  return '';
}

function alignToText(align: BlockAlign): string {
  return align;
}

function renderHeading(b: HeadingBlock, s: EmailSettings, ctx: RenderContext): string {
  const size = b.level === 1 ? 28 : b.level === 2 ? 22 : 18;
  return `<h${b.level} style="margin:0;font-weight:${s.headingWeight};font-size:${size}px;line-height:1.3;color:${b.color};text-align:${alignToText(
    b.align,
  )};text-transform:${s.headingTransform};letter-spacing:${s.headingLetterSpacing}px;"${fieldAttrs(
    ctx,
    b.id,
    'text',
    { multiline: true },
  )}>${escapeMultiline(b.text)}</h${b.level}>`;
}

function renderText(b: TextBlock, ctx: RenderContext): string {
  return `<div style="margin:0;font-size:16px;line-height:1.6;color:${b.color};text-align:${alignToText(
    b.align,
  )};"${fieldAttrs(ctx, b.id, 'text', { multiline: true })}>${escapeMultiline(b.text)}</div>`;
}

function renderButton(b: ButtonBlock, ctx: RenderContext): string {
  const href = safeHref(b.href) || '#';
  // Bulletproof button: an outer table the email clients respect for the
  // background + radius, an inner padded <a> for the click target.
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${alignToText(
    b.align,
  )}"><tr><td style="background-color:${b.backgroundColor};border-radius:${b.radius}px;">` +
    `<a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:16px;font-weight:600;color:${b.textColor};text-decoration:none;border-radius:${b.radius}px;"${fieldAttrs(
      ctx,
      b.id,
      'text',
    )}>${escapeHtml(b.text)}</a></td></tr></table>`;
}

function renderImage(b: ImageBlock): string {
  if (!b.src) return '';
  const img = `<img src="${escapeHtml(b.src)}" alt="${escapeHtml(
    b.alt,
  )}" style="display:inline-block;width:${b.widthPct}%;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />`;
  const href = safeHref(b.href);
  const inner = href
    ? `<a href="${escapeHtml(href)}" target="_blank">${img}</a>`
    : img;
  return `<div style="text-align:${alignToText(b.align)};">${inner}</div>`;
}

function renderDivider(b: DividerBlock): string {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-top:1px solid ${b.color};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

function renderSpacer(b: SpacerBlock): string {
  return `<div style="height:${b.height}px;line-height:${b.height}px;font-size:0;">&nbsp;</div>`;
}

function renderBlockInner(block: EmailBlock, s: EmailSettings, ctx: RenderContext): string {
  switch (block.type) {
    case 'heading':
      return renderHeading(block, s, ctx);
    case 'text':
      return renderText(block, ctx);
    case 'button':
      return renderButton(block, ctx);
    case 'image':
      return renderImage(block);
    case 'divider':
      return renderDivider(block);
    case 'spacer':
      return renderSpacer(block);
  }
}

// Wrap a block's content in a table row. Spacers carry their own height,
// so they get no vertical padding of their own.
function renderRow(block: EmailBlock, s: EmailSettings, ctx: RenderContext): string {
  const vPad = block.type === 'spacer' ? 0 : 12;
  return `<tr><td style="padding:${vPad}px 24px;">${renderBlockInner(block, s, ctx)}</td></tr>`;
}

// Hover/focus affordance for editable fields plus the "selected in
// sidebar" highlight the canvas-sync bridge script toggles. Only ever
// rendered when ctx.editable — this HTML never ships to a real inbox.
// Uses the document's own link colour as the accent so the highlight
// stays on-brand rather than a hardcoded blue.
function editableStyleBlock(accent: string): string {
  return `<style>
[contenteditable]{outline:none;border-radius:3px;cursor:text;}
[contenteditable]:hover{outline:2px dashed ${accent};outline-offset:2px;}
[contenteditable]:focus{outline:2px solid ${accent};outline-offset:2px;}
.tp-email-selected{outline:2px solid ${accent};outline-offset:2px;}
</style>`;
}

// Runs inside the editable staff-preview iframe only (sandbox
// allow-scripts). Listens for keystrokes on [data-field] elements and
// reports them to the parent via postMessage; the parent
// (HtmlPreview.web.tsx / EmailEditor.tsx) is the only place field values
// are validated against the editable-field whitelist before being
// written into document state (canvas-sync.ts) — this script's job is
// purely to observe the DOM and forward it, not to decide what's
// writable. Captures innerText, not innerHTML — EmailBlock.text is a
// plain string and render.ts escapes it on the way back out, so there's
// no rich-text round-trip to support here (contrast site-render.ts's
// bridge script, which captures innerHTML for its bold/italic/underline
// fields).
const CANVAS_BRIDGE_SCRIPT = `
<script>
(function(){
  var SRC = 'temple-email-canvas';
  function post(msg){ window.parent.postMessage(Object.assign({ source: SRC }, msg), '*'); }

  document.addEventListener('input', function(e){
    var el = e.target.closest && e.target.closest('[data-field]');
    if (!el) return;
    post({ type: 'field-input', path: el.getAttribute('data-field'), value: el.innerText });
  });

  document.addEventListener('focusin', function(e){
    var el = e.target.closest && e.target.closest('[data-field]');
    if (!el) return;
    post({ type: 'field-focus', path: el.getAttribute('data-field') });
  });

  document.addEventListener('keydown', function(e){
    var el = e.target.closest && e.target.closest('[data-field]');
    if (!el || e.key !== 'Enter') return;
    if (el.getAttribute('data-multiline') !== 'true') {
      e.preventDefault();
      el.blur();
    }
  });

  document.addEventListener('paste', function(e){
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  // A real navigation (the button's own href) would carry the editing
  // iframe away from the editable canvas — swallow every link click.
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a');
    if (a) e.preventDefault();
  });

  window.addEventListener('message', function(e){
    if (e.source !== window.parent) return;
    var msg = e.data;
    if (!msg || msg.type !== 'select-block') return;
    var prev = document.querySelector('.tp-email-selected');
    if (prev) prev.classList.remove('tp-email-selected');
    if (msg.blockId) {
      var next = document.querySelector('[data-field^="' + msg.blockId + ':"]');
      if (next) next.classList.add('tp-email-selected');
    }
  });
})();
</script>`;

function renderFooter(ctx: RenderContext): string {
  const unsub = ctx.unsubscribeUrl ?? UNSUBSCRIBE_PLACEHOLDER;
  const business = ctx.footer?.businessName?.trim();
  const address = ctx.footer?.address?.trim();
  const lines: string[] = [];
  if (business) lines.push(escapeHtml(business));
  if (address) lines.push(escapeMultiline(address));
  lines.push(
    `You're receiving this because you're a member. <a href="${escapeHtml(
      unsub,
    )}" target="_blank" style="color:#94A3B8;text-decoration:underline;">Unsubscribe</a>.`,
  );
  return `<tr><td style="padding:24px;border-top:1px solid #E2E8F0;"><div style="margin:0;font-size:12px;line-height:1.6;color:#94A3B8;text-align:center;">${lines.join(
    '<br>',
  )}</div></td></tr>`;
}

export function renderEmailHtml(doc: EmailDocument, ctx: RenderContext = {}): string {
  const s = doc.settings;
  const rows = doc.blocks.map((b) => renderRow(b, s, ctx)).join('');
  const footer = renderFooter(ctx);
  // Hidden preheader: the snippet inboxes show next to the subject.
  const preheader = ctx.preheader
    ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(
        ctx.preheader,
      )}</span>`
    : '';
  const editableStyle = ctx.editable ? editableStyleBlock(s.linkColor) : '';
  const bridgeScript = ctx.editable ? CANVAS_BRIDGE_SCRIPT : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">${editableStyle}</head><body style="margin:0;padding:0;background-color:${s.backgroundColor};font-family:${s.fontFamily};">${preheader}<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${s.backgroundColor};"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${s.contentWidth}" style="width:100%;max-width:${s.contentWidth}px;background-color:${s.contentBackgroundColor};border-radius:12px;overflow:hidden;">${rows}${footer}</table></td></tr></table>${bridgeScript}</body></html>`;
}

// Plain-text alternative. Keeps the same order so a text-only client
// reads the campaign coherently.
export function renderEmailText(doc: EmailDocument, ctx: RenderContext = {}): string {
  const parts: string[] = [];
  for (const b of doc.blocks) {
    switch (b.type) {
      case 'heading':
      case 'text':
        if (b.text.trim()) parts.push(b.text.trim());
        break;
      case 'button': {
        const href = safeHref(b.href);
        parts.push(href ? `${b.text}: ${href}` : b.text);
        break;
      }
      case 'image':
        if (b.alt.trim()) parts.push(`[${b.alt.trim()}]`);
        break;
      case 'divider':
        parts.push('--------------------');
        break;
      case 'spacer':
        break;
    }
  }
  const footerLines: string[] = [];
  const business = ctx.footer?.businessName?.trim();
  const address = ctx.footer?.address?.trim();
  if (business) footerLines.push(business);
  if (address) footerLines.push(address);
  footerLines.push(`Unsubscribe: ${ctx.unsubscribeUrl ?? UNSUBSCRIBE_PLACEHOLDER}`);
  parts.push('--------------------');
  parts.push(footerLines.join('\n'));
  return parts.join('\n\n');
}
