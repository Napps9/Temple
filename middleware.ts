// Resolves a verified gym custom domain to its published site.
//
// vercel.json's `rewrites` are static/path-based and can't branch on the
// Host header, and Expo Router's static export unconditionally claims
// `/` for the app shell (dist/index.html) — so a request arriving on
// trainhard.com/ has nowhere else to go. Vercel's Routing Middleware runs
// before both static file serving and vercel.json's rewrites, and *can*
// read Host, so this is the only place that gap can be closed.
//
// Scoped to `/` only (see `matcher` below) on purpose: every rendered
// site page is a single self-contained document — theme CSS is inlined,
// images are absolute Supabase Storage URLs, the contact form posts
// cross-origin straight to Supabase — so no other same-origin path is
// ever requested for a custom domain. Every other path (`/join/:slug`,
// `/_expo/static/*`, `/api/*`, ...) already resolves identically
// regardless of which attached domain a request arrives on, and bypasses
// this file entirely under the matcher.
//
// Implements Vercel's Routing Middleware protocol
// (https://vercel.com/docs/routing-middleware) directly — signalling
// `x-middleware-rewrite` / `x-middleware-next` response headers — rather
// than taking on the `@vercel/functions` package for two header-setting
// helpers, matching this repo's existing preference for a minimal
// dependency footprint in the Vercel-runtime layer (api/site/[slug].ts
// avoids src/lib/supabase.ts for the same reason).

export const config = { matcher: ['/'] };

// The platform's own app host(s). Anything not in this set and not a
// Vercel preview/local host is treated as a possible gym custom domain.
const PLATFORM_HOSTS = new Set(['app.jointemple.io']);

function next(): Response {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

function rewrite(url: URL): Response {
  return new Response(null, { headers: { 'x-middleware-rewrite': url.toString() } });
}

function notConnectedHtml(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Domain not connected</title><meta name="robots" content="noindex"></head><body style="font-family:-apple-system,sans-serif;text-align:center;padding:80px 20px;color:#334155;"><h1>This domain isn't connected to a site yet.</h1></body></html>`;
}

export default async function middleware(request: Request): Promise<Response> {
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0];
  if (!host || PLATFORM_HOSTS.has(host) || host.endsWith('.vercel.app') || host === 'localhost') {
    return next();
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return next();

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/gym_slug_for_domain`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ p_host: host }),
    });
    const slug: unknown = res.ok ? await res.json() : null;
    if (typeof slug === 'string' && slug) {
      const url = new URL(request.url);
      url.pathname = `/api/site/${encodeURIComponent(slug)}`;
      return rewrite(url);
    }
  } catch {
    // Fall through to the not-connected page below.
  }

  return new Response(notConnectedHtml(), {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
