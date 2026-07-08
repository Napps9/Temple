// Resolves a verified gym custom domain to its published site.
//
// vercel.json's `rewrites` are static/path-based and can't branch on the
// Host header, and Expo Router's static export unconditionally claims
// `/` for the app shell (dist/index.html) — so a request arriving on
// trainhard.com/ has nowhere else to go. Vercel's Routing Middleware runs
// before both static file serving and vercel.json's rewrites, and *can*
// read Host, so this is the only place that gap can be closed.
//
// Scoped to `/` (see `matcher`) on purpose. Non-root paths on a custom
// domain intentionally serve the same content they do on the platform
// host — the deployment is shared, so `/join/<slug>` etc. resolve to the
// Expo app everywhere. The rendered site's own links point at the
// platform origin (see site-render.ts), so the only path a custom-domain
// visitor organically lands on is `/`.
//
// Implements Vercel's Routing Middleware protocol
// (https://vercel.com/docs/routing-middleware) directly — signalling
// `x-middleware-rewrite` / `x-middleware-next` response headers — rather
// than taking on the `@vercel/functions` package for two header-setting
// helpers, matching this repo's existing preference for a minimal
// dependency footprint in the Vercel-runtime layer
// (api/site/[...path].ts avoids src/lib/supabase.ts for the same
// reason).
//
// Only ever rewrites to the bare gym slug (the site's Home page) —
// a connected custom domain doesn't yet resolve any other page
// (/site/<slug>/<page-slug>); this middleware is scoped to `/` only
// (see `matcher`), so those links always point at the platform origin
// instead (see site-render.ts's renderSiteNav).

export const config = { matcher: ['/'] };

// The platform's own hosts. Keep in sync with PLATFORM_APEX in
// supabase/functions/custom-domain/index.ts, which blocks gyms from
// connecting these (or any subdomain of the apex) in the first place.
const PLATFORM_HOSTS = new Set(['app.jointemple.io', 'jointemple.io']);

// Host -> slug lookups are near-static (they change only on
// connect/verify/disconnect), but this middleware runs on every request
// to `/` of every custom domain — even when the rendered HTML itself is
// CDN-cached. A short module-scope TTL cache collapses repeat lookups on
// a warm edge instance to zero database traffic.
const SLUG_TTL_MS = 60_000;
const slugCache = new Map<string, { slug: string | null; expires: number }>();

function next(): Response {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

function rewrite(url: URL): Response {
  return new Response(null, { headers: { 'x-middleware-rewrite': url.toString() } });
}

function notConnectedHtml(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Domain not connected</title><meta name="robots" content="noindex"></head><body style="font-family:-apple-system,sans-serif;text-align:center;padding:80px 20px;color:#334155;"><h1>This domain isn't connected to a site yet.</h1></body></html>`;
}

function respond(slug: string | null, request: Request): Response {
  if (slug) {
    const url = new URL(request.url);
    url.pathname = `/api/site/${encodeURIComponent(slug)}`;
    return rewrite(url); // reuses api/site/[...path].ts verbatim — no rendering logic duplicated
  }
  return new Response(notConnectedHtml(), {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// A transient lookup failure must not tell crawlers a live site is gone
// (404 + noindex reads as "permanently removed") nor fall open to the
// Expo app shell — 503 + Retry-After is the honest retryable answer.
// This also covers the deploy window where a new middleware build goes
// live before a migration lands in PostgREST's schema cache.
function serviceUnavailable(): Response {
  return new Response('Temporarily unavailable — please retry shortly.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' },
  });
}

export default async function middleware(request: Request): Promise<Response> {
  // Lowercase, strip port, strip the FQDN trailing dot — `Host:
  // trainhard.com.` is valid and must match the stored `trainhard.com`.
  const host = (request.headers.get('host') ?? '')
    .toLowerCase()
    .split(':')[0]
    .replace(/\.$/, '');
  if (!host || PLATFORM_HOSTS.has(host) || host.endsWith('.vercel.app') || host === 'localhost') {
    return next();
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return next();

  const cached = slugCache.get(host);
  if (cached && cached.expires > Date.now()) {
    return respond(cached.slug, request);
  }

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
    if (!res.ok) return serviceUnavailable();
    const slug: unknown = await res.json();
    const resolved = typeof slug === 'string' && slug ? slug : null;
    if (slugCache.size > 1000) slugCache.clear();
    slugCache.set(host, { slug: resolved, expires: Date.now() + SLUG_TTL_MS });
    return respond(resolved, request);
  } catch {
    return serviceUnavailable();
  }
}
