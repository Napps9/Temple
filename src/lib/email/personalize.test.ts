import { describe, expect, it } from 'vitest';

// The personalize() helper lives in the send-campaign edge function
// (Deno), so we can't import it directly into vitest. Re-paste the
// pieces under test as plain TS so the regression we hit in code
// review (HTML-entity-encoded URLs in href= getting double-encoded
// through encodeURIComponent and breaking multi-param links) stays
// covered. The implementation in supabase/functions/send-campaign/
// index.ts must stay in sync — if you change one, change the other.

const UNSUB_PLACEHOLDER = '{{unsubscribe_url}}';

function unescapeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function personalize(
  html: string,
  ctx: {
    campaignId: string;
    recipientId: string;
    trackBase: string;
    unsubUrl: string;
  },
): string {
  let out = html.split(UNSUB_PLACEHOLDER).join(ctx.unsubUrl);
  out = out.replace(/href="(https?:\/\/[^"]+)"/g, (_m, raw: string) => {
    if (raw.startsWith(ctx.trackBase)) return `href="${raw}"`;
    const decoded = unescapeHtmlEntities(raw);
    const wrapped = `${ctx.trackBase}?e=c&c=${ctx.campaignId}&r=${ctx.recipientId}&u=${encodeURIComponent(
      decoded,
    )}`;
    return `href="${wrapped}"`;
  });
  const pixel = `<img src="${ctx.trackBase}?e=o&c=${ctx.campaignId}&r=${ctx.recipientId}" width="1" height="1" alt="" style="display:none;border:0;" />`;
  out = out.includes('</body>')
    ? out.replace('</body>', `${pixel}</body>`)
    : out + pixel;
  return out;
}

const ctx = {
  campaignId: 'CAMP',
  recipientId: 'REC',
  trackBase: 'https://track.example/v1/track',
  unsubUrl: 'https://track.example/v1/track?e=u&c=CAMP&r=REC',
};

describe('personalize() — URL wrapping', () => {
  it('wraps a plain http link through the tracker', () => {
    const out = personalize('<a href="https://shop.example/page">x</a>', ctx);
    expect(out).toContain(
      'href="https://track.example/v1/track?e=c&c=CAMP&r=REC&u=https%3A%2F%2Fshop.example%2Fpage"',
    );
  });

  it('decodes &amp; in stored hrefs so multi-param URLs survive the round trip', () => {
    // Renderer's escapeHtml turns `&` into `&amp;` inside href=.
    // The tracker's `u` param has to URL-decode back to the original
    // `&`, not literal `&amp;`.
    const stored = '<a href="https://shop.example/path?a=1&amp;b=2">x</a>';
    const out = personalize(stored, ctx);
    expect(out).toContain(
      'u=' + encodeURIComponent('https://shop.example/path?a=1&b=2'),
    );
    expect(out).not.toContain('amp%3B');
  });

  it('substitutes the unsubscribe placeholder before click-wrapping, so the unsub link is not double-wrapped', () => {
    const stored = `<a href="${UNSUB_PLACEHOLDER}">Unsub</a>`;
    const out = personalize(stored, ctx);
    expect(out).toContain(`href="${ctx.unsubUrl}"`);
    // The unsub URL contains the trackBase, so it must NOT be wrapped
    // by the click-tracker (which would have given us a `?e=c…?e=u…`
    // monstrosity that breaks on Resend's parsing).
    expect(out).not.toContain(`?e=c&c=CAMP&r=REC&u=${encodeURIComponent(ctx.unsubUrl)}`);
  });

  it("doesn't rewrite an already-tracker href on a second pass", () => {
    const tracker = `${ctx.trackBase}?e=c&c=CAMP&r=REC&u=https%3A%2F%2Fexample.com`;
    const stored = `<a href="${tracker}">x</a>`;
    const out = personalize(stored, ctx);
    expect(out).toContain(`href="${tracker}"`);
  });

  it('injects the open pixel before </body>', () => {
    const out = personalize('<body><p>hi</p></body>', ctx);
    expect(out.indexOf('<img')).toBeGreaterThan(out.indexOf('<p>hi</p>'));
    expect(out.indexOf('<img')).toBeLessThan(out.indexOf('</body>'));
  });

  it('appends the open pixel if there is no </body>', () => {
    const out = personalize('<p>hi</p>', ctx);
    expect(out.endsWith('alt="" style="display:none;border:0;" />')).toBe(true);
  });
});
