// Shared Temple-branded layout for transactional emails sent from the
// edge functions (invites, store receipts). One place owns the company
// chrome — the brand mark, palette and footer — so every system email
// looks like Temple instead of bare black-on-white.
//
// Brand palette (docs/brand-assets.md): gold #E8B620, steel blue
// #3B6BA5, ink #111111, cream #F4F2ED, tagline grey #5A5550.
//
// Pure string builder — no imports — so it drops into any Deno function.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  );
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// The real Temple lockup (mark + wordmark, set in Outfit) served as a
// foreground PNG from the web app's static root. Gmail strips background
// images and SVGs but renders foreground <img>, so this shows the actual
// brand artwork instead of a CSS approximation. alt="Temple" degrades
// gracefully if a client blocks images.
const LOGO_URL = 'https://app.jointemple.io/email/temple-lockup.png';

function header(): string {
  return `<div style="text-align:center;padding:4px 0 28px;">
    <img src="${LOGO_URL}" alt="Temple" width="188" style="display:inline-block;width:188px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none;" />
  </div>`;
}

export function templeEmailHtml(opts: {
  // Card heading.
  title: string;
  // Raw HTML for the body (caller escapes any dynamic text). Typically a
  // paragraph or two; receipts pass a table here.
  bodyHtml: string;
  // Primary call-to-action button (steel blue).
  button?: { label: string; url: string };
  // Small grey line under the card.
  footerNote?: string;
  // Hidden inbox-preview line.
  preheader?: string;
}): string {
  const { title, bodyHtml, button, footerNote, preheader } = opts;
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
        preheader,
      )}</div>`
    : '';
  const buttonHtml = button
    ? `<div style="text-align:center;margin:22px 0 4px;"><a href="${button.url}" style="display:inline-block;background:#3B6BA5;color:#ffffff;text-decoration:none;font-family:${FONT};font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px;">${escapeHtml(
        button.label,
      )}</a></div>`
    : '';
  const footerHtml = footerNote
    ? `<p style="text-align:center;font-family:${FONT};font-size:12px;color:#94a3b8;margin:18px 0 4px;">${escapeHtml(
        footerNote,
      )}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F4F2ED;font-family:${FONT};">
  ${preheaderHtml}
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    ${header()}
    <div style="background:#ffffff;border-radius:16px;padding:28px;border:1px solid #ECE8DF;">
      <h1 style="margin:0 0 14px;font-family:${FONT};font-size:20px;color:#111111;">${escapeHtml(
        title,
      )}</h1>
      <div style="font-family:${FONT};font-size:15px;line-height:1.55;color:#334155;">${bodyHtml}</div>
      ${buttonHtml}
    </div>
    ${footerHtml}
    <p style="text-align:center;font-family:${FONT};font-size:11px;color:#B8B3AA;margin:6px 0 0;letter-spacing:1px;">TEMPLE TECHNOLOGY</p>
  </div></body></html>`;
}
