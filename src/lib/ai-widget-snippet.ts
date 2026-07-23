// A self-contained HTML snippet an owner can paste into a website Temple
// doesn't host (Wix, Squarespace, a custom-HTML block, etc.) - the
// off-platform half of "add my AI number to the website". Inline styles
// throughout, same reasoning as the email builder (src/lib/email/render.ts):
// the destination page's stylesheet is out of our control, so nothing
// here can depend on it.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCallWidgetSnippet(params: {
  phoneNumber: string;
  gymName: string;
  accentColor: string;
}): string {
  const phone = escapeHtml(params.phoneNumber);
  const gymName = escapeHtml(params.gymName);
  const accent = escapeHtml(params.accentColor);
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:20px;">
  <p style="margin:0 0 12px;font-size:15px;color:#334155;">Call or text ${gymName} — our AI front desk answers instantly.</p>
  <a href="tel:${phone}" style="display:inline-block;margin:0 6px 8px;padding:12px 22px;border-radius:8px;background:${accent};color:#ffffff;font-weight:600;text-decoration:none;font-size:14px;">Call ${phone}</a>
  <a href="sms:${phone}" style="display:inline-block;margin:0 6px 8px;padding:12px 22px;border-radius:8px;border:1px solid ${accent};color:${accent};font-weight:600;text-decoration:none;font-size:14px;">Text us</a>
</div>`;
}
