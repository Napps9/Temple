// /site/<slug>/sitemap.xml — every page of a gym's published site, so
// search engines discover pages a visitor would only otherwise find by
// clicking through the nav. A separate function from api/site/[...path].ts
// (which would otherwise treat "sitemap.xml" as a page slug and 404) —
// vercel.json rewrites this exact path here BEFORE the catch-all rule,
// since Vercel matches rewrites in array order.
//
// Same minimal-client approach as api/site/[...path].ts, and for the
// same reason: can't import src/lib/supabase.ts in a Node serverless
// runtime.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

import { coerceDocument } from '../../src/lib/site-blocks';
import type { Database } from '../../src/types/database';

function escapeXml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
    // api/site/[...path].ts uses, so an unpublished or unknown gym 404s
    // here exactly the same way.
    const { data: siteRows, error: siteError } = await supabase.rpc('gym_website_by_slug', {
      p_slug: slug,
    });
    if (siteError) throw siteError;
    const site = siteRows?.[0];
    if (!site) {
      res.status(404).send('Not found');
      return;
    }

    const document = coerceDocument(site.design);
    const origin = (process.env.APP_ORIGIN ?? 'https://app.jointemple.io').replace(/\/+$/, '');
    const base = `${origin}/site/${encodeURIComponent(slug)}`;
    const urls = document.pages
      .map((p) => (p.slug ? `${base}/${encodeURIComponent(p.slug)}` : base))
      .map((loc) => `<url><loc>${escapeXml(loc)}</loc></url>`)
      .join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    // Pages change rarely compared to schedule/pricing content — a
    // longer cache than the page renderer's is fine here.
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.status(200).send(xml);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('sitemap render failed', e);
    res.status(500).send('Something went wrong.');
  }
}
