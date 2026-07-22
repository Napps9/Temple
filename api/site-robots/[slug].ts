// /site/<slug>/robots.txt — points crawlers at the gym's own sitemap.xml.
// Without this, a crawler discovering /site/<slug> organically has no
// signal that a sitemap exists at all; robots.txt is the standard place
// search engines check for one. A separate function from
// api/site/[...path].ts for the same reason api/site-sitemap/[slug].ts is:
// that catch-all would otherwise treat "robots.txt" as a page slug and
// 404 — vercel.json rewrites this exact path here BEFORE the catch-all
// rule, since Vercel matches rewrites in array order.
//
// Deliberately permissive (Allow: /) rather than trying to disallow the
// platform path once a custom domain connects — the <link rel="canonical">
// api/site/[...path].ts emits is what tells a crawler which URL is
// authoritative; robots.txt disallowing a URL would stop it being crawled
// (and any canonical signal on it discovered) at all, which is worse.
//
// Same minimal-client approach as the other site-* functions, and for the
// same reason: can't import src/lib/supabase.ts in a Node serverless
// runtime.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slugParam = req.query.slug;
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;
  if (!slug) {
    res.status(400).send('Bad request');
    return;
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).send('Server misconfigured.');
    return;
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  try {
    // Re-checks published = true itself (security definer) — same RPC
    // api/site/[...path].ts and api/site-sitemap/[slug].ts use, so an
    // unpublished or unknown gym 404s here exactly the same way.
    const { data: siteRows, error: siteError } = await supabase.rpc('gym_website_by_slug', {
      p_slug: slug,
    });
    if (siteError) throw siteError;
    if (!siteRows?.[0]) {
      res.status(404).send('Not found');
      return;
    }

    const platformOrigin = (process.env.APP_ORIGIN ?? 'https://app.jointemple.io').replace(/\/+$/, '');
    const sitemapUrl = `${platformOrigin}/site/${encodeURIComponent(slug)}/sitemap.xml`;
    const body = `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    // Same cache profile as the sitemap — this changes only when a site
    // is published/unpublished, far less often than page content.
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.status(200).send(body);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('robots.txt render failed', e);
    res.status(500).send('Something went wrong.');
  }
}
