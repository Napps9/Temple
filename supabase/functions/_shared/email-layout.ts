// Shared Temple-branded layout for transactional emails sent from the
// edge functions (invites, store receipts). One place owns the company
// chrome — the brand mark, palette and footer — so every system email
// looks like Temple instead of bare black-on-white.
//
// Table-based (not div/max-width) so it renders consistently across
// clients including Outlook's Word engine, with a "bulletproof" button.
//
// Brand palette (docs/brand-assets.md): ink #14161A, paper #F4F5F6.
// The action button is ink; the card's top rule carries the dawn
// gradient — the brand's one moment of colour (solid-ink fallback for
// clients that drop CSS gradients). Emails are light-only.
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

// The real Temple lockup, served as a foreground PNG from the web app's
// static root. Gmail strips background images and SVGs but renders
// foreground <img>; alt="Temple" degrades gracefully if images are off.
const LOGO_URL = 'https://app.jointemple.io/email/temple-lockup.png';

// Premium "copy & paste this link" fallback, shown under the primary
// CTA for the rare client that strips the button (and to reassure
// people who'd rather see where a link goes). Email clients can't run
// clipboard JS, so this is a select-and-copy monospace field with a
// clipboard cue — not a functional button — styled as quiet field chrome
// so it reads as intentional rather than a raw pasted URL.
export function linkFallbackHtml(url: string): string {
  const safe = escapeHtml(url);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 2px;">
    <tr><td style="padding:0 0 9px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.2px;color:#8A8F98;text-transform:uppercase;">&#128203;&nbsp;Copy &amp; paste this link into your browser</td></tr>
    <tr><td style="background:#EEF0F3;border:1px solid #E1E4E8;border-radius:10px;padding:13px 15px;">
      <a href="${url}" style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:12px;line-height:1.6;color:#14161A;text-decoration:none;word-break:break-all;">${safe}</a>
    </td></tr>
  </table>`;
}

export function templeEmailHtml(opts: {
  // Card heading.
  title: string;
  // Raw HTML for the body (caller escapes any dynamic text). Typically a
  // paragraph or two; receipts pass a table here.
  bodyHtml: string;
  // Primary call-to-action button (ink, centered, bulletproof).
  button?: { label: string; url: string };
  // Small grey line under the card.
  footerNote?: string;
  // Hidden inbox-preview line.
  preheader?: string;
}): string {
  const { title, bodyHtml, button, footerNote, preheader } = opts;

  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(
        preheader,
      )}</div>`
    : '';

  const buttonHtml = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:26px auto 6px;">
         <tr><td align="center" bgcolor="#14161A" style="border-radius:8px;">
           <a href="${button.url}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(
             button.label,
           )}</a>
         </td></tr>
       </table>`
    : '';

  const footerHtml = footerNote
    ? `<tr><td align="center" style="padding:24px 12px 2px;">
         <span style="font-family:${FONT};font-size:12px;line-height:1.5;color:#94a3b8;">${escapeHtml(
           footerNote,
         )}</span>
       </td></tr>`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
</head>
<body style="margin:0;padding:0;background:#F4F5F6;">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F5F6;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">

        <tr><td align="center" style="padding:6px 0 26px;">
          <img src="${LOGO_URL}" alt="Temple" width="196" style="display:block;width:196px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none;">
        </td></tr>

        <tr><td style="background:#ffffff;border:1px solid #E4E6E9;border-radius:16px;overflow:hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td height="4" style="height:4px;background:#14161A;background-image:linear-gradient(100deg,#E04898 0%,#EE5E7E 55%,#F08260 100%);font-size:0;line-height:0;">&nbsp;</td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:32px;">
              <h1 style="margin:0 0 16px;font-family:${FONT};font-size:23px;line-height:1.3;font-weight:700;color:#14161A;">${escapeHtml(
                title,
              )}</h1>
              <div style="font-family:${FONT};font-size:16px;line-height:1.6;color:#3f4650;">${bodyHtml}</div>
              ${buttonHtml}
            </td></tr>
          </table>
        </td></tr>

        ${footerHtml}

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
